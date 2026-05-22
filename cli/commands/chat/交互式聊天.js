/**
 * 交互式聊天 - 消息发送与交互式对话
 * 
 * 拆分结构：
 * - 交互式聊天.js: interactiveChat 主循环 + 输入工具函数
 * - 聊天消息发送.js: sendMessage 完整逻辑（多gateway/容灾/SSE/流式/问题队列）
 */

import chalk from 'chalk';
import readline from 'readline';
import { display } from '../../display.js';
import { select } from '../../lib/interactive.js';
import { selectConversation } from './对话管理.js';
import { 对话日志 } from '../../lib/chat-logger.js';
import { getWeChatChannel } from './辅助函数.js';
import { sendMessage } from './聊天消息发送.js';
import { registerCapabilities, unregisterCapabilities } from '../../lib/cli-capability.js';

/**
 * 简易输入提示（替代 inquirer.prompt 用于主循环）
 * 
 * inquirer v8 的 UI.close() 会调用 MuteStream.end()，
 * MuteStream 通过 pipe(process.stdout, {end:true}) 连接 stdout，
 * 导致 process.stdout 被结束，后续 prompt 无法正常渲染。
 * 用原生 readline 直接读写 stdin/stdout，绕开此问题。
 */
function askInputReusable(rl, promptText) {
  return new Promise((resolve) => {
    let resolved = false;
    const onClose = () => {
      if (!resolved) { resolved = true; resolve(''); }  // stdin 关闭时回退为空字符串，主循环 continue 跳过
    };
    rl.on('close', onClose);
    rl.question(chalk.green('?') + ' ' + chalk.bold(promptText) + chalk.reset(' '), (answer) => {
      if (!resolved) { resolved = true; rl.removeListener('close', onClose); resolve(answer); }
    });
  });
}

export async function interactiveChat(client, conversationId, options) {
  // debug 模式：设置环境变量，TUI 禁用在 sendMessage 中处理
  const isDebug = options?.debug || process.env.DOVE_DEBUG;
  if (isDebug) {
    process.env.DOVE_DEBUG = '1';
    process.env.DEBUG_CHAT = '1';
  }
  
  // 未指定对话ID时，让用户选择是否继续之前的对话
  if (!conversationId) {
    try {
      const choice = await select('开始对话', [
        { name: '1. 🆕 开始新对话', value: 'new' },
        { name: '2. 📋 选择历史对话继续', value: 'select' },
      ], 'new');
      if (choice === 'select') {
        conversationId = await selectConversation(client);
        // 选择 "开始新对话" 或无对话记录时 conversationId 为 null
      }
    } catch (e) {
      console.warn('[Chat] 选择对话模式失败，默认新对话:', e.message);
    }
  }
  
  display.title('🕊️ 白鸽对话 (输入 :q 退出)');
  if (isDebug) {
    display.info('🔍 调试模式：不清屏、保留所有输出、日志强制写入');
  }
  display.info('任何对话都会创建任务，可使用白鸽全部能力');
  if (对话日志.isEnabled()) {
    display.info(`对话日志已开启，记录到: ${对话日志.getTodayLogFile()}`);
  }
  
  // 微信通道状态提示（消息收发已由服务端常驻进程接管）
  const wechat = getWeChatChannel();
  try {
    await wechat.syncStatus();
  } catch (e) {
    console.warn('[Chat] 微信通道状态同步失败:', e.message);
  }
  const wechatReady = wechat.isReady();
  
  if (wechatReady) {
    display.info('微信通道: 已绑定 (微信消息自动触发对话，结果自动推送)');
  }
  
  // 注册 CLI 能力到 Server（让 Doves/LLM 感知 CLI 可执行的操作）
  try {
    const regResult = await registerCapabilities(client);
    if (regResult.success) {
      display.info('CLI能力已注册');
    }
  } catch (e) {
    console.warn('[Chat] CLI能力注册失败，不阻塞聊天:', e.message);
  }

  display.divider();
  
  let currentConvId = conversationId;
  
  // 清除 inquirer select 后可能残留的 stdin 监听器（导致字符重复输入）
  // 只清理 keypress 监听器（readline 会重新添加），不动 data 监听器（emityKeypressEvents 依赖它）
  process.stdin.removeAllListeners('keypress');
  // 暂停 stdin 丢弃缓冲数据，readline.createInterface 会自己 resume 从干净状态开始
  process.stdin.pause();
  
  // 复用同一个 readline 实例，避免反复 createInterface 导致 stdin 监听器叠加
  let rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  try {
  while (true) {
    // 【关键修复】每次循环都重建 readline
    // 原因：sendMessage 内部 inquirer 使用自己的 readline，
    // 关闭时会 pause stdin 并移除 keypress 监听器，
    // 但不会关闭我们的 rl → rl.closed 仍为 false，
    // stdin 却已不可读 → askInputReusable 挂死 → 事件循环无活跃 I/O → 进程退出
    // 解法：不依赖 rl.closed 检测，每次循环强制重建，确保 stdin 可读
    if (!rl.closed) rl.close();
    if (!process.stdin.destroyed) process.stdin.resume();
    process.stdin.removeAllListeners('keypress');
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    const message = await askInputReusable(rl, '👤 输入消息 (:q 退出):');

    // 检查退出命令
    if (message === ':q' || message === ':quit' || message === ':exit') {
      display.info('已退出对话模式');
      break;
    }

    // 所有输入都作为对话内容，空行则跳过
    if (!message.trim()) continue;
    
    // 记录用户消息
    try { 对话日志.用户消息(currentConvId, message); } catch (_) { console.warn('[Chat] 记录用户消息日志失败'); }
    
    // 发送消息并更新对话ID（支持多轮对话）
    // sendMessage 内部已有 try-catch，正常不会抛出，但防御性包裹避免极端情况崩溃
    try {
      currentConvId = await sendMessage(client, currentConvId, message, options, null, false);
    } catch (err) {
      display.error(`发送失败: ${err.message}`);
      // 继续循环，不退出对话
    }
  }
  } finally {
    rl.close();
    // 注销 CLI 能力
    try { await unregisterCapabilities(client); } catch (e) { console.warn('[Chat] CLI能力注销失败:', e.message); }
  }
  
  // 退出对话
  display.info('已退出对话模式');
}
