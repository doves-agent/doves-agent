/**
 * 聊天消息发送 - sendMessage 完整逻辑
 * 
 * 含多 gateway 通信（扇出/容灾）、超时续期、SSE 监听、
 * 流式输出、用户问题队列等
 *
 * 子模块拆分：
 * - 聊天消息发送-多网关.js: 多网关通信（扇出/容灾）
 * - 聊天消息发送-问答队列.js: 用户交互问题串行队列
 * - 聊天消息发送-结果展示.js: 结果提取与展示 + 流式空行折叠
 */

import chalk from 'chalk';
import { existsSync, statSync } from 'fs';
import { display } from '../../display.js';
import { 对话日志 } from '../../lib/chat-logger.js';
import { TaskProgressUI } from '../../lib/progress-ui.js';
import { _检查语义事件, getWeChatChannel, 提取执行配置 } from './辅助函数.js';
import { isNetworkError, 多网关发送 } from './聊天消息发送-多网关.js';
import { streamUploadFile, getDownloadUrl } from '../../lib/stream-upload.js';
import { 创建问答队列 } from './聊天消息发送-问答队列.js';
import { collapseBlankLines, 展示结果, 记录模型信息 } from './聊天消息发送-结果展示.js';

// OSS 路径前缀（从环境变量读取，默认 'dove'）
const OSS_PREFIX = process.env.OSS_PREFIX || 'dove';

// 发送消息（基于任务）
// gateways: 可选的多 gateway URL 列表（扇出发送）
export async function sendMessage(client, conversationId, message, options = {}, gateways = null, nonInteractive = false) {
  // debug 模式：禁用 TUI（不清屏），改用 spinner；强制写日志
  const isDebug = options.debug || process.env.DOVE_DEBUG;
  if (isDebug) {
    process.env.DEBUG_CHAT = '1';  // 启用详细调试输出
  }
  
  // 创建进度 TUI（如果 TTY 可用且非 debug 模式）
  const isTTY = process.stdout.isTTY;
  const effectiveNonInteractive = nonInteractive || !isTTY;
  const progressUI = (!isDebug && isTTY && !effectiveNonInteractive) ? new TaskProgressUI() : null;
  // 非 TTY 或 debug 模式降级使用 spinner（不清屏）
  const spinner = (!isTTY || isDebug) ? display.spinner('发送消息...').start() : null;
  
  // 微信通道：服务端自动处理推送，CLI 无需操作
  const wechat = getWeChatChannel();
  let fullResponseText = '';
  let convId = conversationId;  // 声明在 try 外，确保 catch 块可访问
  
  try {
    // 1. 通过 API 发送消息（自动创建任务）
    // 解析执行配置参数
    const { profile, constraints } = 提取执行配置(options);

    // ========== 检测本地文件路径，提示用户确认上传 ==========
    const IMAGE_EXT = /\.(?:png|jpg|jpeg|gif|bmp|webp)$/i;
    const localPaths = [];
    const quotedPaths = [...message.matchAll(/["']([A-Za-z]:[\\\/][^"']+?\.(?:png|jpg|jpeg|gif|bmp|webp))["']/gi)];
    for (const m of quotedPaths) localPaths.push(m[1]);
    const winPaths = [...message.matchAll(/([A-Za-z]:[\\\/][^\s"'<>]+?\.(?:png|jpg|jpeg|gif|bmp|webp))/gi)];
    for (const m of winPaths) { if (!localPaths.includes(m[1])) localPaths.push(m[1]); }
    const unixPaths = [...message.matchAll(/(\/[^\s"'<>]+?\.(?:png|jpg|jpeg|gif|bmp|webp))/gi)];
    for (const m of unixPaths) { if (!localPaths.includes(m[1])) localPaths.push(m[1]); }

    const existingFiles = localPaths.filter(p => { try { return existsSync(p) && IMAGE_EXT.test(p); } catch (_) { console.warn('[Chat] 检查本地文件失败:', p); return false; } });
    if (existingFiles.length > 0 && !effectiveNonInteractive) {
      const fileList = existingFiles.map(p => {
        try { const s = statSync(p); return `  ${p} (${(s.size / 1024).toFixed(1)} KB)`; } catch (_) { console.warn('[Chat] 获取文件大小失败:', p); return `  ${p}`; }
      }).join('\n');
      const { confirm } = await import('../../lib/interactive.js');
      const 用户确认 = await confirm(
        `检测到 ${existingFiles.length} 个本地文件将上传到 OSS：\n${fileList}\n\n是否允许上传并继续？`
      );
      if (!用户确认) {
        display.warn('已取消上传，对话终止');
        return convId;
      }
      display.info(`已确认上传 ${existingFiles.length} 个文件到 OSS`);
    }

    // ==================== 多 Gateway 通信（扇出/容灾/单网关） ====================
    const { result, conversationId: 实际ConvId } = await 多网关发送(
      client, message, conversationId, profile, constraints, options, gateways
    );
    const taskId = result.taskId;
    convId = result.conversationId || 实际ConvId;
    
    // 启动进度 TUI
    if (progressUI) {
      progressUI.start();
      progressUI.updateTask({
        id: taskId,
        status: '执行中',
        type: 'routing',
        description: message.slice(0, 50),
        childrenStatus: { total: 0, completed: 0, failed: 0 },
        children: [],
      });
    } else {
      spinner.spinner = display.spinners.routing;
      spinner.text = '';
    }
    
    // 记录任务创建
    对话日志.任务状态(convId, taskId, '已创建');
    
    // 异步检查语义事件触发（不阻塞主流程）
    _检查语义事件(client, message);
    
    // 2. 等待任务完成（通过 Change Stream 监听）
    let streamingStarted = false;
    let lastOutputIndex = 0;
    const 流式状态 = { _consecutiveNewlines: 0 };
    let lastActivityTime = Date.now();
    let lastSubtaskFetch = 0;
    let lastStatus = null;
    let _lastDebugState = '';
    
    const eventAbortController = new AbortController();
    let taskWatchAbortController = new AbortController();
    
    // ========== 问答队列（防止多子任务并发提问竞争 stdin） ==========
    let settled = false;
    const 共享状态 = { get settled() { return settled; }, set settled(v) { settled = v; }, get streamingStarted() { return streamingStarted; } };
    const refs = { progressUI, spinner, 对话日志, convId };
    const { enqueueQuestion, cancelAllQuestions } = 创建问答队列(共享状态, refs);
    
    // ========== Ctrl+C 取消当前任务 ==========
    let currentWatchTaskId = taskId;
    let _reject = null;
    let _timeout = null;
    let sigintHandler = null;
    if (progressUI) {
      sigintHandler = async () => {
        if (settled) return;
        settled = true;
        progressUI.stop();
        process.stdout.write('\n');
        display.warn('正在取消任务...');
        try {
          await client.cancelTask(currentWatchTaskId);
          display.info('任务已取消');
        } catch (e) {
          console.warn('[Chat] 取消任务失败:', e.message);
        }
        clearTimeout(_timeout);
        eventAbortController.abort();
        taskWatchAbortController.abort();
        if (_reject) _reject(new Error('任务已取消 (Ctrl+C)'));
      };
      process.once('SIGINT', sigintHandler);
    }
    
    const taskResult = await new Promise((resolve, reject) => {
      _reject = reject;
      
      const TIMEOUT_IDLE = 180000;
      const TIMEOUT_MAX_RENEWALS = 40;
      let maxRenewalCount = 0;
      
      async function checkTaskStillAlive() {
        try {
          const task = await client.getTask(currentWatchTaskId);
          if (!task) return false;
          const status = task.status;
          if (status === '已完成' || status === '已完成(部分失败)' || status === '失败' || status === '已取消' || status === '已终止') return false;
          const 心跳时间戳 = task.心跳时间戳 || 0;
          if (心跳时间戳 > 0 && (Date.now() - 心跳时间戳) < 120000) return true;
          if (task.type === 'branch') {
            try {
              const subTasks = await client.getSubTasks(currentWatchTaskId);
              if (subTasks && subTasks.length > 0) {
                const hasRunning = subTasks.some(s => s.status === '执行中');
                if (hasRunning) return true;
                const recentlyDone = subTasks.some(s => {
                  const ts = s.completedAt || 0;
                  return ts > 0 && (Date.now() - ts) < 300000;
                });
                if (recentlyDone) return true;
              }
            } catch {
              console.warn('[Chat] 检查子任务存活状态失败');
            }
          }
          return false;
        } catch {
          console.warn('[Chat] 检查任务存活状态失败');
          return false;
        }
      }
      
      function handleTimeout() {
        if (settled) return;
        maxRenewalCount++;
        
        if (maxRenewalCount >= TIMEOUT_MAX_RENEWALS) {
          checkTaskStillAlive().then(alive => {
            if (settled) return;
            if (alive) {
              maxRenewalCount = Math.max(0, maxRenewalCount - 3);
              if (process.env.DEBUG_CHAT) {
                console.log(`[Chat] 任务达到最大续期但有进展，续期 (${maxRenewalCount}/${TIMEOUT_MAX_RENEWALS})`);
              }
              timeout.refresh();
            } else {
              settled = true;
              reject(new Error('任务超时（无进展且达最大续期次数）'));
            }
          }).catch(() => {
            if (settled) return;
            settled = true;
            reject(new Error('任务超时（无法确认任务状态）'));
          });
        } else {
          if (process.env.DEBUG_CHAT) {
            console.log(`[Chat] 任务续期 (${maxRenewalCount}/${TIMEOUT_MAX_RENEWALS})`);
          }
          timeout.refresh();
        }
      }
      
      const timeout = setTimeout(handleTimeout, TIMEOUT_IDLE);
      _timeout = timeout;
      
      function resetTimeout() {
        if (settled) return;
        lastActivityTime = Date.now();
        clearTimeout(timeout);
        timeout.refresh();
      }
      
      watchTaskRecursive(taskId);
      
      const processedEvents = new Set();
      
      (async () => {
        try {
          if (process.env.DEBUG_CHAT) console.log('[Chat] 事件流连接中...');
          await client.watchUserEvents(async (event) => {
            if (settled) return;
            
            const eventId = event.事件ID || event.id;
            if (eventId && processedEvents.has(eventId)) return;
            if (eventId) processedEvents.add(eventId);
            
            if (event.问题) {
              if (process.env.DEBUG_CHAT) {
                console.log(`[Chat] 收到用户交互事件: ${event.事件ID}, 问题: ${String(event.问题.question || event.问题).substring(0, 50)}`);
              }
              resetTimeout();
              
              const qId = event.问题.id;
              if (qId && processedEvents.has(`q-${qId}`)) return;
              if (qId) processedEvents.add(`q-${qId}`);
              
              if (effectiveNonInteractive) {
                if (process.env.DEBUG_CHAT) {
                  console.log(`[Chat] 非交互模式，自动跳过用户提问: ${String(event.问题).slice(0, 50)}`);
                }
                try {
                  const defaultAnswer = event.默认答案 || event.defaultAnswer || 'skip';
                  await client.submitEventAnswer(event.事件ID || event.id, defaultAnswer);
                } catch (e) {
                  console.warn('[Chat] 自动提交事件答案失败:', e.message);
                }
                return;
              }
              
              streamingStarted = false;
              await enqueueQuestion(client, currentWatchTaskId, event.问题, event.事件ID);
            }
            
            // CLI 操作请求事件（Doves/Server 请求 CLI 执行操作）
            if (event.事件类型 === 'cli_action' && event.操作请求) {
              if (process.env.DEBUG_CHAT) {
                console.log(`[Chat] 收到 CLI 操作请求: ${event.事件ID}, 能力: ${event.操作请求.capability}`);
              }
              resetTimeout();

              if (effectiveNonInteractive) {
                if (process.env.DEBUG_CHAT) {
                  console.log(`[Chat] 非交互模式，自动拒绝 CLI 操作: ${event.操作请求.capability}`);
                }
                try {
                  await client.post('/api/cli/action/complete', { actionId: event.事件ID, result: { success: false, error: '非交互模式，无法确认操作' } });
                } catch (e) {
                  console.warn('[Chat] 自动完成CLI操作失败:', e.message);
                }
                return;
              }

              await enqueueQuestion(
                client, currentWatchTaskId,
                { _cliAction: true, eventData: event },
                event.事件ID
              );
            }
          }, eventAbortController.signal);
        } catch (err) {
          if (err.name !== 'AbortError') {
            console.error(`[Chat] 事件流连接失败: ${err.message}`);
          } else if (process.env.DEBUG_CHAT || process.env.DEBUG) {
            console.log('[Chat] 事件流已正常关闭');
          }
        }
      })();
      
      async function watchTaskRecursive(currentTaskId) {
        try {
        taskWatchAbortController.abort();
        taskWatchAbortController = new AbortController();
        
        await client.watchTask(currentTaskId, async (update) => {
          if (update.error) {
            reject(new Error(update.error));
            return;
          }
          if (process.env.DEBUG_CHAT) {
            const stateKey = `${update.id}|${update.type}|${update.status}|${update.phase}|${update.result?.branchTaskId}`;
            if (stateKey !== _lastDebugState) {
              _lastDebugState = stateKey;
              console.error(`[DEBUG] watchTask update: id=${update.id}, type=${update.type}, status=${update.status}, phase=${update.phase || '-'}, branchTaskId=${update.result?.branchTaskId || '-'}`);
            }
          }
          lastStatus = update.status;
          resetTimeout();
          
          // 监工终止标记检测
          if (update.终止标记 && !settled) {
            const 原因 = update.终止标记.原因 || '未知原因';
            if (progressUI) { progressUI.stop(); }
            else if (spinner) { spinner.stop(); }
            
            if (effectiveNonInteractive) {
              settled = true;
              clearTimeout(timeout);
              cancelAllQuestions();
              display.warn(`监工判定异常: ${原因}`);
              try { await client.cancelTask(currentWatchTaskId); } catch (e) { console.warn('[Chat] 取消任务失败:', e.message); }
              reject(new Error(`监工终止: ${原因}`));
              return;
            }
            
            const { handleUserQuestion } = await import('./对话管理.js');
            const 用户选择 = await handleUserQuestion(client, currentWatchTaskId, {
              question: `监工判定此任务异常：${原因}\n是否终止任务？`,
              type: 'single_choice',
              options: [
                { label: '终止任务', value: 'stop' },
                { label: '继续执行', value: 'continue' },
              ],
              defaultAnswer: 'continue',
              header: '监工提醒',
              riskLevel: 'medium',
            }, null);
            
            if (用户选择?.answer?.value === 'stop') {
              settled = true;
              clearTimeout(timeout);
              cancelAllQuestions();
              try { await client.cancelTask(currentWatchTaskId); } catch (e) { console.warn('[Chat] 取消任务失败:', e.message); }
              reject(new Error(`用户确认终止: ${原因}`));
              return;
            }
            
            if (!streamingStarted) {
              if (progressUI) { progressUI.start(); }
              else if (spinner) { spinner.spinner = display.spinners.thinking; spinner.start(); }
            }
          }
          
          if (!streamingStarted) {
            if (progressUI) { progressUI.updateTask(update); }
            
            const now = Date.now();
            if (now - lastSubtaskFetch > 3000 && update.type === 'branch') {
              lastSubtaskFetch = now;
              try {
                const subtasks = await client.getSubTasks(currentTaskId);
                if (subtasks && subtasks.length > 0) {
                  if (progressUI && !progressUI.isQuestionActive) {
                    progressUI.subtasks = subtasks.map((s, i) => ({
                      id: s.id, description: s.description || `子任务 ${i + 1}`,
                      status: s.status, progress: s.progress || 0, assignedTo: s.assignedTo,
                      model: s.model, provider: s.provider, toolLevel: s.toolLevel || '安全',
                      phase: s.phase, duration: s.duration,
                    }));
                    progressUI.render();
                  }
                  if (spinner) {
                    const completed = subtasks.filter(s => s.status === '已完成').length;
                    const running = subtasks.filter(s => s.status === '执行中').length;
                    spinner.text = `子任务 ${completed}/${subtasks.length} 完成, ${running} 执行中`;
                  }
                }
              } catch (e) {
                console.warn('[Chat] 获取子任务列表失败:', e.message);
              }
            }
            
            if (spinner) {
              const taskType = update.type;
              if (taskType === 'routing') {
                spinner.spinner = display.spinners.routing;
                spinner.text = update.status === '已完成' ? '路由完成' : '';
              } else if (taskType === 'branch') {
                if (update.phase === 'tool_calling' || update.phase === 'generating') {
                  spinner.spinner = display.spinners.thinking;
                } else { spinner.spinner = display.spinners.waiting; }
                if (!spinner.text || !spinner.text.startsWith('子任务')) { spinner.text = '任务执行中'; }
              } else if (update.phase === 'tool_calling' || update.phase === 'generating') {
                spinner.spinner = display.spinners.thinking; spinner.text = '';
              } else { spinner.spinner = display.spinners.waiting; spinner.text = ''; }
            }
          }
          
          if (update.streamBuffer && update.streamBuffer.length > 0) {
            for (let i = lastOutputIndex; i < update.streamBuffer.length; i++) {
              const chunk = update.streamBuffer[i];
              
              if (chunk.类型 === 'user_question') {
                const qData = chunk.问题数据;
                if (!qData) continue;
                if (process.env.DEBUG_CHAT) {
                  console.log(`[Chat] 流缓冲通道收到 user_question: ${qData.id}, 问题: ${String(qData.question || '').substring(0, 50)}`);
                }
                const qId = qData.id;
                if (qId && processedEvents.has(`q-${qId}`)) continue;
                if (qId) processedEvents.add(`q-${qId}`);
                
                resetTimeout();
                
                if (effectiveNonInteractive) {
                  try {
                    const defaultAnswer = qData.defaultAnswer || 'skip';
                    const evId = chunk.来源事件ID || null;
                    if (evId) { await client.submitEventAnswer(evId, defaultAnswer); }
                    else { await client.submitAnswer(currentWatchTaskId, qId, defaultAnswer); }
                  } catch (e) {
                    console.warn('[Chat] 自动提交流缓冲答案失败:', e.message);
                  }
                  continue;
                }
                
                streamingStarted = false;
                await enqueueQuestion(client, currentWatchTaskId, qData, null);
                continue;
              }
              
              if (chunk.类型 === 'text') {
                if (!streamingStarted) {
                  if (progressUI) { progressUI.stop(); }
                  else if (spinner) { spinner.stop(); }
                  streamingStarted = true;
                  process.stdout.write('\n');
                  process.stdout.write(chalk.magenta('🕊️ 白鸽: '));
                }
                const compressed = collapseBlankLines(chunk.内容, 流式状态);
                process.stdout.write(compressed);
                对话日志.白鸽文本(convId, chunk.内容);
                fullResponseText += chunk.内容;
              }
              
              if (chunk.类型 === 'reasoning') {
                if (!streamingStarted) {
                  if (progressUI) { progressUI.stop(); }
                  else if (spinner) { spinner.stop(); }
                  streamingStarted = true;
                  process.stdout.write('\n');
                }
                const compressed = collapseBlankLines(chunk.内容, 流式状态);
                process.stdout.write(chalk.gray(compressed));
                对话日志.白鸽思考(convId, chunk.内容);
              }
            }
            lastOutputIndex = update.streamBuffer.length;
          }
          
          if (update.status === '已完成' || update.status === '已完成(部分失败)') {
            if (update.status === '已完成(部分失败)') {
              对话日志.错误(convId, '任务部分子任务失败');
              if (progressUI) progressUI.addError('部分子任务执行失败');
            }
            if (update.type === 'routing' && update.result?.branchTaskId) {
              const branchTaskId = update.result.branchTaskId;
              if (progressUI) { progressUI.updateTask({ id: branchTaskId, status: '执行中', type: 'branch' }); }
              else if (spinner) { spinner.spinner = display.spinners.waiting; }
              lastOutputIndex = 0;
              streamingStarted = false;
              lastSubtaskFetch = 0;
              _lastDebugState = '';
              流式状态._consecutiveNewlines = 0;
              currentWatchTaskId = branchTaskId;
              watchTaskRecursive(branchTaskId);
              return;
            }
            settled = true;
            clearTimeout(timeout);
            if (streamingStarted) { process.stdout.write('\n'); }
            else if (progressUI) { progressUI.stop(); }
            else if (spinner) { spinner.stop(); }
            try { 对话日志.任务状态(convId, update.id, '完成'); } catch (_) { console.warn('[Chat] 记录任务完成日志失败'); }
            resolve(update);
          } else if (update.status === 'awaiting_cli') {
            // ★ Dove 请求 CLI 协作（如上传文件到 OSS）
            const resp = update.响应;
            if (!resp) {
              if (process.env.DEBUG_CHAT) console.error('[Chat] awaiting_cli 但无响应数据');
              return;
            }

            resetTimeout();

            if (resp.type === 'need_upload') {
              if (progressUI) { progressUI.stop(); }
              else if (spinner) { spinner.stop(); }

              display.info(`\n  Dove 需要上传 ${resp.files?.length || 0} 个文件...`);
              try {
                const urls = [];
                for (const fp of (resp.files || [])) {
                  process.stdout.write(`  ⬆ ${fp}\n`);
                  const uploadResult = await streamUploadFile({
                    client,
                    localPath: fp,
                    targetDir: `${OSS_PREFIX}/uploads`,
                  });
                  urls.push(uploadResult.url);
                  process.stdout.write(`  ✅ ${uploadResult.url}\n`);
                }
                const replyMsg = `[CLI已上传到OSS]\n${(resp.files || []).map((fp, j) => `  ${fp} → ${urls[j]}`).join('\n')}\n\n请继续处理任务。`;
                await client.replyTask(currentWatchTaskId, replyMsg);
                display.info('  已回复 Dove，继续等待...');
              } catch (e) {
                display.error(`  上传失败: ${e.message}`);
                await client.replyTask(currentWatchTaskId, `上传失败: ${e.message}。请告知用户并重试。`);
              }

              if (!streamingStarted) {
                if (progressUI) { progressUI.start(); }
                else if (spinner) { spinner.spinner = display.spinners.waiting; spinner.start(); }
              }
              return;
            }

            display.warn(`Dove 请求: ${JSON.stringify(resp)}`);
          } else if (update.status === '失败' || update.status === '已终止') {
            settled = true;
            clearTimeout(timeout);
            const 终止原因 = update.status === '已终止' ? '任务被监工终止（超时无进展）' : (update.error || '任务执行失败');
            try { 对话日志.错误(convId, 终止原因); } catch (_) { console.warn('[Chat] 记录任务错误日志失败'); }
            if (progressUI) progressUI.addError(终止原因);
            if (progressUI) progressUI.stop();
            if (spinner) spinner.stop();
            cancelAllQuestions();
            reject(new Error(终止原因));
          }
          if (update.type === 'routing' && update.result?.branchTaskId && update.status !== '已完成' && update.status !== '已完成(部分失败)' && update.status !== '失败') {
            const branchTaskId = update.result.branchTaskId;
            if (progressUI) { progressUI.updateTask({ id: branchTaskId, status: '执行中', type: 'branch' }); }
            else if (spinner) { spinner.spinner = display.spinners.waiting; }
            lastOutputIndex = 0;
            streamingStarted = false;
            lastSubtaskFetch = 0;
            _lastDebugState = '';
            流式状态._consecutiveNewlines = 0;
            currentWatchTaskId = branchTaskId;
            watchTaskRecursive(branchTaskId);
            return;
          }
        }, taskWatchAbortController.signal);
        } catch (err) {
          if (!settled) {
            settled = true;
            reject(new Error(`监听任务失败: ${err.message}`));
          }
        }
      }
    }).finally(() => {
      eventAbortController.abort();
      taskWatchAbortController.abort();
      
      if (sigintHandler) {
        process.off("SIGINT", sigintHandler);
        sigintHandler = null;
      }
      
      cancelAllQuestions();
      
      if (progressUI) {
        progressUI.destroy();
      }
    });
    
    // 3. 显示结果（如果没有流式输出，则显示最终结果）
    if (!streamingStarted) {
      展示结果(taskResult, convId, 对话日志);
    }
    
    记录模型信息(taskResult, convId, taskId, 对话日志);
    
    // 返回对话ID用于多轮对话
    return convId;
    
  } catch (err) {
    if (progressUI) {
      try { progressUI.addError(err.message); } catch (_) { console.warn('[Chat] progressUI.addError 失败'); }
      try { progressUI.destroy(); } catch (_) { console.warn('[Chat] progressUI.destroy 失败'); }
    }
    if (spinner) { try { spinner.stop(); } catch (_) { console.warn('[Chat] spinner.stop 失败'); } }
    display.error(err.message);
    try { 对话日志.错误(convId || conversationId, err.message); } catch (_) { console.warn('[Chat] 记录对话错误日志失败'); }
    return conversationId;
  }
}
