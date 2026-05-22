/**
 * WebSocket 共享状态模块
 * 职责：客户端管理、保活检测、广播推送
 */

import { logger } from '../core.js';

// WebSocket 客户端管理
const wsClients = new Map();

// 用户连接计数（用于挂载管理）
const userConnections = new Map(); // userId -> Set<clientId>

// ==================== WebSocket 保活检测 ====================
// 每 30 秒检测僵尸连接（网络断开但 TCP 未及时关闭的连接）
let _wsKeepAliveInterval = null;

function startWsKeepAlive() {
  if (_wsKeepAliveInterval) return;
  _wsKeepAliveInterval = setInterval(() => {
    for (const [clientId, client] of wsClients) {
      if (!client.ws || client.ws.readyState !== client.ws.OPEN) {
        wsClients.delete(clientId);
        continue;
      }
      // 检查上次 pong 响应时间，超过 60 秒无响应视为僵尸连接
      if (client.lastPong && Date.now() - client.lastPong > 60000) {
        logger.warn(`[WS] 僵尸连接检测: ${clientId} (${client.userId}), 强制关闭`);
        client.ws.terminate();
        wsClients.delete(clientId);
        continue;
      }
      // 发送 ping
      client.ws.ping();
    }
  }, 30000);
  // 允许定时器不阻止进程退出
  _wsKeepAliveInterval.unref();
}

/**
 * 向用户的所有 WebSocket 连接推送消息
 */
function broadcastToUser(userId, message) {
  const msg = JSON.stringify({ ...message, timestamp: Date.now() });
  
  for (const [clientId, client] of wsClients) {
    if (client.userId === userId) {
      try {
        client.ws.send(msg);
      } catch (e) {
        logger.warn(`[WebSocket] 推送消息到客户端 ${clientId} 失败: ${e.message}`);
      }
    }
  }
}

export {
  wsClients,
  userConnections,
  startWsKeepAlive,
  broadcastToUser,
};
