/**
 * @file 智能体-KISS执行器
 * @description KISS 执行核心 —— 单 LLM 循环 + 精简工具执行
 * 
 * 设计：build messages → callLLM(tools) → executeSkill → repeat → submit
 * 
 * 核心改进（v2 精简版）：
 * - 用精简工具定义（~25个）替代老系统76个工具，减少模型选择困难
 * - 用精简工具执行器替代多层管道（tools/index → 执行路由器 → Node执行器）
 * - 改进系统提示词：明确图片处理流程、禁止安装依赖
 * - 移除"询问用户"工具（模型滥用且事件集合模式与KISS不兼容）
 * 
 * 使用方式：
 *   import { KISS执行 } from './智能体-KISS执行器.js';
 *   const result = await KISS执行(任务, {
 *     提供商客户端: client,
 *     模型名: 'deepseek-v4-pro',
 *     任务队列: queue,
 *     DovesProxy: proxy,
 *   });
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';
import { 获取或生成机器标识 } from '@dove/common/机器标识.js';
import { 获取精简工具定义, 获取保底工具定义 } from './精简工具定义.js';
import { executeSkill } from './精简工具执行.js';
import { 生成系统提示词 } from './系统提示词生成器.js';
import { ObjectId } from '@dove/common/对象标识.js';
import { 获取记忆适配器 } from './精简工具执行-扩展交互.js';

const logger = 创建日志器('KISS执行器', { 前缀: '[KISS]', 级别: 'debug' });

/** 最大工具调用轮数（防止死循环） */
const MAX_TOOL_ROUNDS = parseInt(process.env.DOVE_MAX_TOOL_ROUNDS) || 20;

// ==================== KISS 执行核心 ====================

/**
 * KISS 执行核心
 * 
 * @param {Object} 任务 - { 任务ID, 消息, 描述, 上下文... }
 * @param {Object} 上下文 - {
 *   提供商客户端: 提供商客户端实例（必填，用于 LLM 调用）,
 *   模型名: 模型名（默认 'deepseek-v4-pro'）,
 *   任务队列: 任务队列实例（必填，用于提交结果）,
 *   DovesProxy: 代理实例（可选，传给工具执行上下文）,
 * }
 * @returns {Promise<{success: boolean, result: string, error?: string}>}
 */
export async function KISS执行(任务, 上下文 = {}) {
  const 任务ID = 任务.任务ID || 任务.id;
  const 对话ID = 任务.对话ID || null;
  const 用户消息 = 任务.消息 || 任务.描述 || '';
  const 提供商客户端 = 上下文.提供商客户端;
  const 模型名 = 上下文.模型名 || 'deepseek-v4-pro';
  const 任务队列 = 上下文.任务队列;
  const DovesProxy = 上下文.DovesProxy;
  const conversationTools = 上下文.conversationTools;

  if (!提供商客户端) {
    return { success: false, result: '', error: 'KISS执行器: 缺少 提供商客户端' };
  }
  if (!任务队列) {
    return { success: false, result: '', error: 'KISS执行器: 缺少 任务队列' };
  }

  logger.info(`开始执行: ${任务ID} | ${用户消息.substring(0, 80)}`);

  // KISS 按需加载：初始只给保底工具（~7个），LLM 通过 load_tool_group 按需拉取各组完整定义
  let allTools = 获取保底工具定义();
  let loadedGroups = new Set();

  // ★ 检测是否与 CLI 同机（决定系统提示词中的运行位置描述）
  let 同机 = false;
  if (DovesProxy) {
    const cliInfo = await DovesProxy.getCliCapabilities();
    if (cliInfo) {
      const myMachineId = 获取或生成机器标识();
      const cliMachineIds = cliInfo.cliMachineIds || [];
      同机 = cliMachineIds.includes(myMachineId);
      logger.info(`同机检测: ${同机 ? '是' : '否'} (我=${myMachineId}, CLI=[${cliMachineIds.join(',')}])`);
    }
  }

  const 系统提示 = await 生成系统提示词({ 能力管理器实例: 上下文.能力管理器, 同机 });

  // ★ 恢复对话状态：如果任务是 awaiting_cli 恢复的，从保存的 messages 继续
  let messages;
  let toolRounds = 0;
  const savedState = 任务.对话状态;
  if (savedState?.messages?.length > 0) {
    messages = savedState.messages;
    toolRounds = savedState.toolRounds || 0;
    logger.info(`  恢复对话: ${messages.length} 条消息, ${toolRounds} 轮已执行`);

    // ★ 注入 CLI 回复：Server /reply 端点把 CLI 回复追加到了 任务.消息 中
    // 提取追加部分（保存时的原始消息 vs 当前任务消息的差值）
    const 原始消息 = savedState.原始消息 || '';
    const 当前消息 = 用户消息;
    if (当前消息.length > 原始消息.length && 当前消息.includes('[CLI已上传到OSS]')) {
      const cliReply = 当前消息.substring(原始消息.length).trim();
      if (cliReply) {
        // 将 CLI 回复作为 user 消息追加，让模型知道上传结果
        messages.push({ role: 'user', content: cliReply });
        logger.info(`  注入 CLI 回复: ${cliReply.substring(0, 100)}`);
      }
    }

    // 清除保存的状态，避免重复恢复
    if (DovesProxy) {
      await DovesProxy.dbOperation('任务', 'updateOne', {
        query: { 任务ID },
        update: { $unset: { 对话状态: '' } },
      }).catch(e => logger.warn(`清除对话状态失败: ${e.message}`));
    }
  } else {
    // ★ 注入历史对话轮次（多轮对话上下文）
    const historyMessages = await _加载历史对话(conversationTools, 对话ID);

    // ★ 自动感知用户近期活动
    const 活动上下文 = await _获取近期活动(任务.用户ID);

    messages = [
      { role: 'system', content: 系统提示 },
      ...historyMessages,
      ...(活动上下文 ? [{ role: 'system', content: 活动上下文 }] : []),
      { role: 'user', content: 用户消息 },
    ];
  }

  // ★ 恢复已加载的工具组（从 awaiting_cli 恢复时，重新扩展 allTools）
  if (savedState?.loadedGroups?.length > 0) {
    loadedGroups = new Set(savedState.loadedGroups);
    const { 获取分组工具定义: getGrp } = await import('./精简工具定义.js');
    for (const 组名 of loadedGroups) {
      const groupDef = getGrp(组名);
      if (groupDef) {
        for (const tool of groupDef.tools) {
          const name = tool.function?.name || tool.name;
          if (!allTools.find(t => (t.function?.name || t.name) === name)) {
            allTools.push(tool);
          }
        }
      }
    }
    logger.info(`  恢复工具组: ${[...loadedGroups].join('、')}，累计 ${allTools.length} 个工具`);
  }

  logger.info(`  工具: ${allTools.length} 个（保底 + 按需扩展）`);
  let finalResult = '';

  try {
    while (toolRounds < MAX_TOOL_ROUNDS) {
      toolRounds++;

      const resp = await 提供商客户端.工具调用({
        model: 模型名,
        messages,
        tools: allTools,
        temperature: 0.7,
      });

      if (!resp.成功) {
        logger.error(`LLM 调用失败: ${resp.错误}`);
        await _提交失败(任务队列, 任务ID, resp.错误);
        return { success: false, result: '', error: resp.错误 };
      }

      // 检查工具调用
      if (resp.工具调用列表 && resp.工具调用列表.length > 0) {
        // ★ harness 级工具预处理：think 不计轮次，summarize_progress 压缩历史
        const harnessTools = new Set(['think', 'summarize_progress']);
        const hasOnlyHarness = resp.工具调用列表.every(tc => harnessTools.has(tc.function.name));

        // think 工具：不计入轮次
        if (hasOnlyHarness) toolRounds--;

        // summarize_progress：压缩历史消息
        for (const tc of resp.工具调用列表) {
          if (tc.function.name === 'summarize_progress') {
            let 参数;
            try { 参数 = JSON.parse(tc.function.arguments); } catch { 参数 = {}; }
            const keepLast = 参数.keep_last || 3;
            // 保留 system + 最近 keepLast 轮的消息，中间用摘要替代
            if (messages.length > keepLast * 3 + 2) {
              const systemMsg = messages[0];
              const recentMessages = messages.slice(-(keepLast * 3));
              messages.length = 0;
              messages.push(systemMsg);
              messages.push({ role: 'user', content: `[历史摘要] ${参数.summary || '(无摘要)'}` });
              messages.push(...recentMessages);
              logger.info(`  📝 上下文已压缩: 保留最近 ${keepLast} 轮，历史用摘要替代`);
            }
          }
        }

        // 添加 assistant 消息（含 tool_calls）
        messages.push({
          role: 'assistant',
          content: resp.内容 || null,
          tool_calls: resp.工具调用列表,
        });

        // ★ 先执行所有工具调用，收集结果，再统一判断是否需要暂停
        // 无副作用的只读工具可并行执行，其余顺序执行
        let needPause = false;
        let pauseResponse = null;
        let pauseToolCallId = null;

        const 只读工具 = new Set([
          'read_file', 'list_dir', 'search_files', 'grep_code', 'search_codebase',
          'list_definitions', 'directory_tree', 'batch_read',
          'git_status', 'git_diff', 'git_log',
          'web_search', 'web_fetch', 'http_get',
          'recall', 'think',
        ]);

        // 分离只读和有副作用的调用
        const 只读调用 = [];
        const 副作用调用 = [];
        for (const tc of resp.工具调用列表) {
          if (只读工具.has(tc.function.name)) {
            只读调用.push(tc);
          } else {
            副作用调用.push(tc);
          }
        }

        // 只读工具并行执行
        const 并行结果 = await Promise.all(只读调用.map(async (tc) => {
          const 工具名 = tc.function.name;
          let 参数;
          try { 参数 = JSON.parse(tc.function.arguments); } catch { 参数 = {}; }
          logger.info(`  🔧 ${工具名}(${JSON.stringify(参数).substring(0, 100)})`);
          const execResult = await executeSkill(工具名, 参数, {
            DovesProxy,
            任务ID,
            根任务ID: 任务.根任务ID || 任务ID,
            用户ID: 任务.用户ID || 任务.userId,
          });
          return { tc, execResult };
        }));

        for (const { tc, execResult } of 并行结果) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: execResult.success ? execResult.result : `错误: ${execResult.error}`,
          });
        }

        // 副作用工具顺序执行
        for (const tc of 副作用调用) {
          const 工具名 = tc.function.name;
          let 参数;
          try {
            参数 = JSON.parse(tc.function.arguments);
          } catch (e) {
            logger.warn(`工具参数解析失败 (${工具名}): ${e.message}`);
            参数 = {};
          }

          logger.info(`  🔧 ${工具名}(${JSON.stringify(参数).substring(0, 100)})`);
          const execResult = await executeSkill(工具名, 参数, {
            DovesProxy,
            任务ID,
            根任务ID: 任务.根任务ID || 任务ID,
            用户ID: 任务.用户ID || 任务.userId,
          });

          // ★ 工具组加载：动态扩展 allTools，下轮 LLM 调用即可使用新工具
          if (工具名 === 'load_tool_group' && execResult.groupTools) {
            let 新增数 = 0;
            for (const tool of execResult.groupTools) {
              const name = tool.function?.name || tool.name;
              if (!allTools.find(t => (t.function?.name || t.name) === name)) {
                allTools.push(tool);
                新增数++;
              }
            }
            loadedGroups.add(参数.group);
            logger.info(`  📦 已加载工具组: ${参数.group} (+${新增数}个)，累计 ${allTools.length} 个工具`);
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: execResult.result,
            });
          }
          // 检测 __RESPOND__ 标记（request_upload 等需要 CLI 协助的工具返回）
          else if (execResult.success && execResult.result?.startsWith('__RESPOND__')) {
            needPause = true;
            pauseResponse = JSON.parse(execResult.result.substring(11));
            pauseToolCallId = tc.id;
            // 暂停时 tool result 标记为等待 CLI
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: '已发送请求给 CLI，等待回复...',
            });
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: execResult.success ? execResult.result : `错误: ${execResult.error}`,
            });
          }
        }

        // ★ 如果有工具需要 CLI 协助，保存对话状态并暂停
        if (needPause && DovesProxy) {
          await _保存对话状态(DovesProxy, 任务ID, messages, toolRounds, 用户消息, loadedGroups);
          await DovesProxy.respond(任务ID, pauseResponse);
          logger.info(`  ⏫ 已请求 CLI: ${JSON.stringify(pauseResponse)}`);
          logger.info(`任务暂停: ${任务ID}，等待 CLI 回复`);
          return { success: true, result: '已请求 CLI 协助，等待回复后继续处理。', awaiting_cli: true };
        }

        continue;
      }

      // 没有工具调用，这是最终回复
      if (resp.内容) {
        finalResult = resp.内容;
      }
      break;
    }

    if (toolRounds >= MAX_TOOL_ROUNDS && !finalResult) {
      finalResult = '达到最大工具调用轮数，任务终止。';
    }

    // ★ 写入对话轮次（多轮对话持久化）—— 必须在提交结果前，否则任务变"已完成"后 dove 失去对话写权限
    await _写入对话轮次(conversationTools, 对话ID, 任务ID, 用户消息, finalResult);

    // 提交结果
    await _提交成功(任务队列, 任务ID, finalResult);

    logger.info(`任务完成: ${任务ID} (${toolRounds} 轮)`);
    return { success: true, result: finalResult };
  } catch (e) {
    logger.error(`任务异常: ${任务ID} | ${e.message}`);
    await _提交失败(任务队列, 任务ID, e.message);
    return { success: false, result: '', error: e.message };
  }
}

// ==================== 对话状态持久化 ====================

/**
 * 保存对话状态到任务元数据（__RESPOND__ 暂停时调用）
 * 恢复时 KISS执行器会从保存的 messages 继续，而非从头开始
 */
async function _保存对话状态(DovesProxy, 任务ID, messages, toolRounds, 原始消息 = '', loadedGroups = new Set()) {
  try {
    await DovesProxy.dbOperation('任务', 'updateOne', {
      query: { 任务ID },
      update: { $set: { 对话状态: { messages, toolRounds, loadedGroups: [...loadedGroups], 原始消息, 保存时间: new Date().toISOString() } } },
    });
    logger.info(`  💾 对话状态已保存: ${messages.length} 条消息, ${toolRounds} 轮, ${loadedGroups.size} 个工具组`);
  } catch (e) {
    logger.warn(`  保存对话状态失败: ${e.message}（任务恢复时将从头开始）`);
  }
}

// ==================== 用户近期活动感知 ====================

function _格式化相对时间(isoStr) {
  try {
    const diff = Date.now() - new Date(isoStr).getTime();
    const 分钟 = Math.floor(diff / 60000);
    if (分钟 < 1) return '刚刚';
    if (分钟 < 60) return `${分钟}分钟前`;
    const 小时 = Math.floor(分钟 / 60);
    if (小时 < 24) return `${小时}小时前`;
    const 天 = Math.floor(小时 / 24);
    return `${天}天前`;
  } catch { return ''; }
}

async function _获取近期活动(用户ID) {
  if (!用户ID) return null;
  try {
    const adapter = 获取记忆适配器();
    const available = await adapter.checkAvailable();
    if (!available) return null;

    const result = await Promise.race([
      adapter.search('用户活动', 用户ID, { limit: 5 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ]);

    if (!result.成功) return null;
    const memories = result.data?.memories || result.data || [];
    const activities = memories.filter(m =>
      (m.类别 || m.元数据?.category) === '用户活动'
    );
    if (!activities.length) return null;

    const lines = activities.map(m => {
      const content = m.内容 || m.content || m.消息列表?.[0]?.content || '';
      const time = m.元数据?.时间 || '';
      const timeStr = time ? ` (${_格式化相对时间(time)})` : '';
      return `- ${content.replace(/^\[用户活动\]\[.+?\]\s*/, '')}${timeStr}`;
    });

    logger.info(`  📋 加载近期活动: ${activities.length} 条`);
    return `以下是用户的近期活动，你可以自然地参考这些信息，但不必每次都主动提起：\n${lines.join('\n')}`;
  } catch (e) {
    logger.debug(`近期活动获取失败: ${e.message}`);
    return null;
  }
}

// ==================== 对话轮次读写 ====================

/**
 * 加载历史对话轮次，转换为 LLM messages 格式
 * @returns {Array<{role: string, content: string}>} 历史 user/assistant 消息对
 */
async function _加载历史对话(conversationTools, 对话ID) {
  if (!conversationTools || !对话ID) return [];

  try {
    const history = await conversationTools.getHistory(对话ID, 10);
    if (!history || history.length === 0) return [];

    const messages = [];
    for (const turn of history) {
      if (turn.用户消息) {
        messages.push({ role: 'user', content: turn.用户消息 });
      }
      if (turn.分支摘要) {
        messages.push({ role: 'assistant', content: turn.分支摘要 });
      }
    }

    logger.info(`  📜 加载历史对话: ${history.length} 轮, ${messages.length} 条消息`);
    return messages;
  } catch (e) {
    logger.warn(`  加载历史对话失败: ${e.message}`);
    return [];
  }
}

/**
 * 写入本轮对话到对话轮次数组
 */
async function _写入对话轮次(conversationTools, 对话ID, 任务ID, 用户消息, 助手回复) {
  if (!conversationTools || !对话ID) return;

  try {
    const turn = {
      轮次ID: new ObjectId().toString(),
      turnId: new ObjectId().toString(),
      用户消息,
      分支摘要: 助手回复,
      任务ID,
      routing: { 分类: 'routing' },
      创建时间: new Date().toISOString(),
    };
    const result = await conversationTools.addTurn(对话ID, turn);
    if (result.成功) {
      logger.info(`  📝 对话轮次已写入: 对话=${对话ID}, 轮次=${turn.轮次ID}`);
    } else {
      logger.warn(`  对话轮次写入未匹配: 对话=${对话ID}`);
    }
  } catch (e) {
    logger.warn(`  写入对话轮次失败: ${e.message}`);
  }
}

// ==================== 结果提交 ====================

async function _提交成功(任务队列, 任务ID, result) {
  // 包装结果为 CLI 能识别的结构
  const 结果对象 = {
    回复: result,
    数据: { 内容: result },
    content: result,
  };
  await 任务队列.写入结果(任务ID, 结果对象);
  const { 任务状态 } = await import('./常量.js');
  await 任务队列.更新状态(任务ID, 任务状态.COMPLETED);
}

async function _提交失败(任务队列, 任务ID, error) {
  try {
    const { 任务状态 } = await import('./常量.js');
    await 任务队列.更新状态(任务ID, 任务状态.FAILED, { error });
  } catch (e) {
    logger.error(`提交失败状态异常: ${任务ID} | ${e.message}`);
  }
}

export default { KISS执行 };
