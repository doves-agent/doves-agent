/**
 * @file 鸽子直连服务
 * @description 鸽子进程的 WebSocket 直连服务端，供 CLI 直接连接
 * 
 * === 安全模型 ===
 * 1. 账号隔离：鸽子只服务自己账号的用户，拒绝跨账号连接
 * 2. 双向认证：CLI 连接时，鸽子验证 JWT 身份，CLI 验证鸽子 doveId
 * 3. 会话绑定：每个 WS 连接绑定 userId，所有操作强制走该 userId
 * 4. 速率限制：单 IP 每分钟最多 10 次连接尝试
 * 5. 连接数限制：单鸽子最多 5 个并发 CLI 连接
 */

import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import { URL } from 'url';
import { hostname } from 'os';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('直连服务', { 前缀: '[直连服务]', 级别: 'debug', 显示调用位置: true });

// ==================== 安全常量 ====================

/** 单 IP 每分钟最大连接尝试次数 */
const RATE_LIMIT_PER_MINUTE = 10;

/** 单鸽子最大并发 CLI 连接数 */
const MAX_CONCURRENT_CONNECTIONS = 5;

/** JWT 验证容差时钟偏移（秒） */
const JWT_CLOCK_TOLERANCE = 30;

// ==================== 速率限制器 ====================

class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    /** @type {Map<string, number[]>} ip -> timestamp[] */
    this.attempts = new Map();
  }

  /**
   * 检查是否允许连接
   * @param {string} key - 限制键（IP 地址等）
   * @returns {boolean} 是否允许
   */
  allow(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    let timestamps = this.attempts.get(key) || [];
    // 清理过期记录
    timestamps = timestamps.filter(t => t > windowStart);
    
    if (timestamps.length >= this.limit) {
      this.attempts.set(key, timestamps);
      return false;
    }
    
    timestamps.push(now);
    this.attempts.set(key, timestamps);
    return true;
  }

  /** 清理过期数据（定期调用） */
  cleanup() {
    const windowStart = Date.now() - this.windowMs;
    for (const [key, timestamps] of this.attempts) {
      const filtered = timestamps.filter(t => t > windowStart);
      if (filtered.length === 0) {
        this.attempts.delete(key);
      } else {
        this.attempts.set(key, filtered);
      }
    }
  }
}

// ==================== 直连服务类 ====================

export class 鸽子直连服务 {
  /**
   * @param {Object} 配置
   * @param {string} 配置.doveId - 鸽子ID
   * @param {string} 配置.饲养员ID - 饲养员用户ID
   * @param {string} 配置.jwtSecret - JWT 密钥（与 Server 共享）
   * @param {number} [配置.port=0] - 监听端口（0=自动分配）
   * @param {string} [配置.host='0.0.0.0'] - 监听地址
   * @param {Function} 配置.onChatMessage - 收到对话消息的回调
   * @param {Function} [配置.onControlMessage] - 收到控制指令的回调
   * @param {Function} [配置.onAudit] - 审计日志回调
   */
  constructor(配置) {
    this.doveId = 配置.doveId;
    this.饲养员ID = 配置.饲养员ID;
    this.jwtSecret = 配置.jwtSecret;
    this.port = 配置.port || 0;
    this.host = 配置.host || '0.0.0.0';
    this.onChatMessage = 配置.onChatMessage;
    this.onControlMessage = 配置.onControlMessage || null;
    this.onAudit = 配置.onAudit || null;

    /** @type {import('http').Server|null} */
    this.httpServer = null;
    /** @type {WebSocketServer|null} */
    this.wss = null;
    /** @type {Map<string, Object>} clientId -> 连接信息 */
    this.connections = new Map();
    /** 实际监听端口（自动分配时与配置不同） */
    this.actualPort = null;

    // 安全组件
    this.rateLimiter = new RateLimiter(RATE_LIMIT_PER_MINUTE, 60000);
    this._cleanupInterval = null;
  }

  /**
   * 启动直连服务
   * @returns {Promise<number>} 实际监听端口
   */
  async start() {
    if (this.wss) {
      logger.warn('已在运行中，跳过启动');
      return this.actualPort;
    }

    // 创建 HTTP 服务器（仅用于 WS 升级，拒绝裸 HTTP）
    this.httpServer = createServer((req, res) => {
      // 安全：拒绝所有裸 HTTP 请求，只接受 WS 升级
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: WebSocket upgrade only');
    });

    // WebSocket 服务器
    this.wss = new WebSocketServer({ server: this.httpServer, path: '/connect' });

    this.wss.on('connection', (ws, req) => {
      this._handleConnection(ws, req);
    });

    // 定期清理速率限制器
    this._cleanupInterval = setInterval(() => {
      this.rateLimiter.cleanup();
    }, 60000);
    if (this._cleanupInterval.unref) this._cleanupInterval.unref();

    return new Promise((resolve, reject) => {
      this.httpServer.listen(this.port, this.host, () => {
        this.actualPort = this.httpServer.address().port;
        logger.info(`WebSocket 已启动: ws://${this.host}:${this.actualPort}/connect (鸽子: ${this.doveId})`);
        resolve(this.actualPort);
      });

      this.httpServer.on('error', (err) => {
        logger.error(`启动失败: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * 停止直连服务
   */
  async stop() {
    // 关闭所有连接
    for (const [clientId, conn] of this.connections) {
      try { conn.ws.close(1001, '服务关闭'); } catch (e) { logger.warn(`关闭连接 ${clientId} 失败: ${e.message}`); }
    }
    this.connections.clear();

    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    if (this.httpServer) {
      await new Promise(resolve => this.httpServer.close(resolve));
      this.httpServer = null;
    }

    this.actualPort = null;
    logger.info('已停止');
  }

  /**
   * 向指定用户推送消息
   * @param {string} userId - 目标用户ID
   * @param {Object} message - 消息内容
   */
  sendToUser(userId, message) {
    const msg = JSON.stringify({ ...message, timestamp: Date.now() });
    for (const [, conn] of this.connections) {
      if (conn.userId === userId && conn.ws.readyState === 1) {
        try {
          conn.ws.send(msg);
        } catch (e) {
          logger.warn(`推送消息失败: ${e.message}`);
        }
      }
    }
  }

  /**
   * 获取直连端点信息（用于向 Server 注册）
   * @returns {Object|null} { host, port, protocol }
   */
  getEndpoint() {
    if (!this.actualPort) return null;
    return {
      host: this._getExternalHost(),
      port: this.actualPort,
      protocol: 'ws'
    };
  }

  // ==================== 内部方法 ====================

  /**
   * 处理新 WebSocket 连接
   */
  _handleConnection(ws, req) {
    const clientIp = this._getClientIp(req);

    // 安全检查 1：速率限制
    if (!this.rateLimiter.allow(clientIp)) {
      logger.warn(`速率限制: ${clientIp}`);
      ws.close(4429, 'Rate limit exceeded');
      this._audit('direct_rate_limited', null, { clientIp });
      return;
    }

    // 安全检查 2：连接数限制
    if (this.connections.size >= MAX_CONCURRENT_CONNECTIONS) {
      logger.warn(`连接数已满: ${this.connections.size}/${MAX_CONCURRENT_CONNECTIONS}`);
      ws.close(4429, 'Max connections reached');
      this._audit('direct_max_connections', null, { clientIp, currentCount: this.connections.size });
      return;
    }

    // 安全检查 3：提取并验证 JWT
    const token = this._extractToken(req);
    if (!token) {
      logger.warn(`未提供认证令牌: ${clientIp}`);
      ws.close(4401, 'Authentication required');
      this._audit('direct_no_token', null, { clientIp });
      return;
    }

    let decoded;
    try {
      decoded = jwt.verify(token, this.jwtSecret, {
        clockTimestamp: Math.floor(Date.now() / 1000),
        clockTolerance: JWT_CLOCK_TOLERANCE
      });
    } catch (e) {
      logger.warn(`JWT 验证失败: ${e.message}`);
      ws.close(4401, 'Invalid token');
      this._audit('direct_invalid_token', null, { clientIp, error: e.message });
      return;
    }

    const userId = decoded.userId || decoded.sub || decoded._id;

    // 安全检查 4：账号隔离 - 只允许饲养员连接
    if (userId !== this.饲养员ID) {
      logger.warn(`账号隔离拒绝: 用户 ${userId} 尝试连接鸽子 ${this.doveId} (饲养员: ${this.饲养员ID})`);
      ws.close(4403, 'Access denied: account isolation');
      this._audit('direct_access_denied', userId, { clientIp, 鸽子: this.doveId, 饲养员: this.饲养员ID });
      return;
    }

    // 认证通过，建立会话
    const clientId = `direct-${Date.now()}-${Math.random().toString(16).substr(2, 6)}`;
    const connInfo = {
      clientId,
      userId,
      username: decoded.username || '',
      ws,
      connectedAt: new Date(),
      clientIp,
      lastActivity: Date.now()
    };

    this.connections.set(clientId, connInfo);
    ws.clientId = clientId;
    ws.userId = userId;

    // 发送连接成功消息
    ws.send(JSON.stringify({
      type: 'connected',
      clientId,
      doveId: this.doveId,
      userId,
      timestamp: Date.now()
    }));

    logger.info(`连接建立: ${clientId} (用户: ${userId}, IP: ${clientIp})`);
    this._audit('direct_connected', userId, { clientId, clientIp });

    // 设置消息处理
    ws.on('message', (data) => {
      this._handleMessage(clientId, data);
    });

    ws.on('close', (code, reason) => {
      this.connections.delete(clientId);
      logger.info(`连接关闭: ${clientId} (用户: ${userId}, 代码: ${code})`);
      this._audit('direct_disconnected', userId, { clientId, code, reason: reason?.toString() });
    });

    ws.on('error', (err) => {
      logger.warn(`连接错误: ${clientId}, ${err.message}`);
    });

    // 心跳保活
    ws.on('ping', () => {
      connInfo.lastActivity = Date.now();
      ws.pong();
    });
  }

  /**
   * 处理客户端消息
   */
  async _handleMessage(clientId, data) {
    const conn = this.connections.get(clientId);
    if (!conn) return;

    conn.lastActivity = Date.now();

    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (e) {
      conn.ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON', timestamp: Date.now() }));
      return;
    }

    switch (message.type) {
      case 'chat':
        await this._handleChat(conn, message);
        break;

      case 'control':
        await this._handleControl(conn, message);
        break;

      case 'heartbeat':
        conn.ws.send(JSON.stringify({ type: 'heartbeat_ack', timestamp: Date.now() }));
        break;

      default:
        conn.ws.send(JSON.stringify({ type: 'error', error: `Unknown message type: ${message.type}`, timestamp: Date.now() }));
    }
  }

  /**
   * 处理对话消息
   */
  async _handleChat(conn, message) {
    const { conversationId, content, profile, constraints, attachments } = message;

    if (!content) {
      conn.ws.send(JSON.stringify({ type: 'error', error: 'Message content required', timestamp: Date.now() }));
      return;
    }

    // 安全：确保消息来自已认证的用户（会话绑定）
    const userId = conn.userId;

    try {
      if (this.onChatMessage) {
        const result = await this.onChatMessage({
          userId,
          conversationId: conversationId || null,
          content,
          profile: profile || null,
          constraints: constraints || null,
          attachments: attachments || [],
          // 来源渠道：直连 CLI 固定为 local（本机操作）
          channel: 'local'
        });

        // 将结果通过直连 WS 回传 CLI
        conn.ws.send(JSON.stringify({
          type: 'chat_response',
          data: result,
          timestamp: Date.now()
        }));
      }
    } catch (e) {
      logger.error(`处理对话消息失败: ${e.message}`);
      conn.ws.send(JSON.stringify({
        type: 'chat_error',
        error: e.message,
        timestamp: Date.now()
      }));
    }
  }

  /**
   * 处理控制指令
   */
  async _handleControl(conn, message) {
    if (!this.onControlMessage) {
      conn.ws.send(JSON.stringify({ type: 'error', error: 'Control not supported', timestamp: Date.now() }));
      return;
    }

    try {
      const result = await this.onControlMessage({
        userId: conn.userId,
        action: message.action,
        params: message.params || {}
      });

      conn.ws.send(JSON.stringify({
        type: 'control_response',
        data: result,
        timestamp: Date.now()
      }));
    } catch (e) {
      conn.ws.send(JSON.stringify({
        type: 'control_error',
        error: e.message,
        timestamp: Date.now()
      }));
    }
  }

  /**
   * 从请求中提取 JWT
   */
  _extractToken(req) {
    // 方式1：URL query 参数 ?token=xxx
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const queryToken = url.searchParams.get('token');
      if (queryToken) return queryToken;
    } catch (e) { logger.debug(`URL token提取失败: ${e.message}`); }

    // 方式2：Sec-WebSocket-Protocol 头（子协议传 token）
    const protocol = req.headers['sec-websocket-protocol'];
    if (protocol) {
      const parts = protocol.split(',').map(s => s.trim());
      for (const part of parts) {
        if (part.startsWith('dove-token-')) {
          return part.substring('dove-token-'.length);
        }
      }
    }

    // 方式3：自定义头 x-token
    return req.headers['x-token'] || null;
  }

  /**
   * 获取客户端 IP
   */
  _getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip']
      || req.socket?.remoteAddress
      || '未知';
  }

  /**
   * 获取对外可达的主机地址
   */
  _getExternalHost() {
    // 优先使用环境变量指定的地址
    return process.env.DOVE_DIRECT_HOST
      || process.env.DOVE_EXTERNAL_HOST
      || hostname()
      || '127.0.0.1';
  }

  /**
   * 记录审计日志
   */
  _audit(operation, userId, details = {}) {
    if (this.onAudit) {
      this.onAudit({
        操作者ID: userId || '未知',
        操作者类型: 'user',
        操作,
        目标ID: this.doveId,
        结果: 'success',
        详情: { ...details, 直连: true }
      });
    }
  }
}

export default 鸽子直连服务;
