/**
 * 飞书共享模块
 * 全局单例：feishuListenerManager + 启动/停止函数
 */

import { FeishuListenerManager } from './消息监听器.js';

// 全局单例
const feishuListenerManager = new FeishuListenerManager();

export { feishuListenerManager };

export function startFeishuListeners() {
  return feishuListenerManager.startAll();
}

export function startFeishuListenerForUser(userId, appId, appSecret, verificationToken, encryptKey) {
  feishuListenerManager.startListener(userId, appId, appSecret, verificationToken, encryptKey);
}

export function stopFeishuListenerForUser(userId) {
  feishuListenerManager.stopListener(userId);
}
