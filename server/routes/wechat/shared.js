/**
 * 微信共享模块
 * 全局单例：wechatListenerManager / sessionCache / 启动停止函数
 */

import crypto from 'crypto';
import { WeChatListenerManager } from './微信监听管理器.js';

// iLink base URL
export const ILINK_BASE = 'https://ilinkai.weixin.qq.com';

// 会话令牌有效期（2小时）
export const SESSION_TOKEN_TTL = 2 * 60 * 60 * 1000;

// 内存中的会话令牌缓存 { token: { userId, botToken, botBaseUrl, botUserId, expiresAt } }
const sessionCache = new Map();

// 定期清理过期会话
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of sessionCache) {
    if (val.expiresAt < now) sessionCache.delete(key);
  }
}, 5 * 60 * 1000);

export { sessionCache };

// 全局监听器单例
const wechatListenerManager = new WeChatListenerManager();

export { wechatListenerManager };

export function startWeChatListeners() {
  return wechatListenerManager.startAll();
}

export function startWeChatListenerForUser(userId, botToken, botBaseUrl, botUserId) {
  wechatListenerManager.startListener(userId, botToken, botBaseUrl, botUserId);
}

export function stopWeChatListenerForUser(userId) {
  wechatListenerManager.stopListener(userId);
}
