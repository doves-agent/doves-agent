/**
 * 辅助函数 - 时间格式化、配置提取、语义检查
 */

import { WeChatChannel } from '../../lib/wechat-channel.js';
import { loadConfig as loadChatConfig } from '../../lib/config.js';
export { loadChatConfig };
import { display } from '../../display.js';

// 微信 iLink 通道单例
let _wechatChannel = null;
export function getWeChatChannel() {
  if (!_wechatChannel) {
    const cfg = loadChatConfig();
    _wechatChannel = new WeChatChannel(cfg.userId || null, cfg.gateway || 'http://localhost:3003');
  }
  return _wechatChannel;
}

export function formatRelativeTime(timestamp) {
  if (!timestamp) return '未知';
  
  const now = Date.now();
  const ts = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  const diff = now - ts;
  
  if (diff < 60000) return '刚刚';           // 1分钟内
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;  // 1小时内
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`; // 24小时内
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`; // 7天内
  
  return new Date(ts).toLocaleDateString('zh-CN');
}

// 显示对话列表

export function 提取执行配置(options) {
  let profile = options.profile || null;
  const constraints = {};

  // 如果未指定 profile，且也未指定任何执行约束，则交互式询问
  // （仅在无消息时交互，避免每次发消息都询问）

  // 执行约束（Commander --no-X 选项生成 options.X=false，非 options.noX=true）
  if (options.split === false) constraints.禁止拆分 = true;
  if (options.parallel === false) constraints.禁止并行 = true;
  if (options.flash === false) constraints.禁止闪回 = true;
  if (options.maxConcurrency) constraints.最大并发数 = options.maxConcurrency;
  if (options.maxDepth) constraints.最大拆分深度 = options.maxDepth;
  if (options.planFirst) constraints.建议规划再执行 = true;

  // 工具约束
  if (options.toolLevel) constraints.工具安全级别上限 = options.toolLevel;
  if (options.enableAbility) constraints.建议能力 = options.enableAbility;
  if (options.disableAbility) constraints.禁用能力 = options.disableAbility;
  if (options.disableTool) constraints.禁用工具 = options.disableTool;

  // 执行模式覆盖
  if (options.executionMode) constraints.执行模式覆盖 = options.executionMode;

  return { profile, constraints };
}

/**
 * 异步检查语义事件触发（不阻塞主流程）
 * @param {DoveClient} client - Dove客户端
 * @param {string} message - 用户消息
 */
export async function _检查语义事件(client, message) {
  if (!message || !client.token) return;

  try {
    const data = await client.post('/api/event/check', { message });

    if (data?.触发结果?.length > 0) {
      for (const 触发 of data.触发结果) {
        display.info(`[语义事件] ${触发.事件名称} 已触发 → 任务 ${触发.任务ID}`);
      }
    }
  } catch (e) {
    // 语义事件检查失败不影响主流程
    console.warn('[Chat] 语义事件检查失败:', e.message);
  }
}

