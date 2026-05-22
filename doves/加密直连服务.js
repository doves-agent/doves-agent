/**
 * @file 加密直连服务
 * @description Noise NX 加密 TCP 服务端，供 CLI 通过加密通道直连鸽子
 * 
 * === 设计 ===
 * - 复用 common/crypto 的 ServerHandshake 实现 Noise NX 握手
 * - 握手阶段验证 CLI 的 JWT（账号隔离：只允许饲养员连接）
 * - 消息路由到现有的 chat/control 回调（与 WebSocket 直连复用同一 handler）
 * - 加密帧格式：4字节大端长度 + ChaCha20-Poly1305 AEAD 密文
 */

import { createServer } from 'net';
import { hostname } from 'os';
import jwt from 'jsonwebtoken';
import {
  ServerHandshake,
  MESSAGE_TYPE,
  PROTOCOL_MAGIC,
  DEFAULT_TIMEOUT,
  HANDSHAKE_PHASE
} from '../common/crypto/index.js';
import { getPublicKeyFingerprint } from '../common/crypto/keys.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('加密直连', { 前缀: '[加密直连]', 级别: 'debug', 显示调用位置: true });

// ==================== 加密连接类 ====================

class EncryptedDirectConnection {
  constructor(socket, session, clientInfo) {
    this.socket = socket;
    this.session = session;
    this.clientInfo = clientInfo; // { clientAddr, userId, username }
    this.connected = true;

    let buffer = Buffer.alloc(0);

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 4) {
        const msgLen = buffer.readUInt32BE(0);
        if (buffer.length < 4 + msgLen) break;
        const frame = buffer.slice(4, 4 + msgLen);
        buffer = buffer.slice(4 + msgLen);
        try {
          const { type, payload } = session.decryptMessage(frame);
          if (type === MESSAGE_TYPE.DATA) {
            this.emit('message', payload);
          } else if (type === MESSAGE_TYPE.PING) {
            this._sendPong(payload.timestamp);
          } else if (type === MESSAGE_TYPE.CLOSE) {
            this.close();
          }
        } catch (err) {
          logger.error(`解密失败: ${err.message}`);
        }
      }
    });

    socket.on('error', (err) => {
      logger.warn(`连接错误: ${clientInfo?.clientAddr}, ${err.message}`);
    });

    socket.on('close', () => {
      this.connected = false;
      this.emit('close');
    });
  }

  /** 发送加密响应 */
  send(data) {
    if (!this.connected) return;
    try {
      const frame = this.session.data(data);
      const packet = Buffer.alloc(4 + frame.length);
      packet.writeUInt32BE(frame.length, 0);
      frame.copy(packet, 4);
      this.socket.write(packet);
    } catch (err) {
      logger.error(`发送失败: ${err.message}`);
      throw err;
    }
  }

  /** 发送错误 */
  sendError(code, message) {
    if (!this.connected) return;
    const frame = this.session.error(code, message);
    const packet = Buffer.alloc(4 + frame.length);
    packet.writeUInt32BE(frame.length, 0);
    frame.copy(packet, 4);
    this.socket.write(packet);
  }

  _sendPong(timestamp) {
    const frame = this.session.pong(timestamp);
    const packet = Buffer.alloc(4 + frame.length);
    packet.writeUInt32BE(frame.length, 0);
    frame.copy(packet, 4);
    this.socket.write(packet);
  }

  close() {
    if (!this.connected) return;
    this.connected = false;
    const frame = this.session.close('normal');
    const packet = Buffer.alloc(4 + frame.length);
    packet.writeUInt32BE(frame.length, 0);
    frame.copy(packet, 4);
    this.socket.write(packet);
    this.socket.end();
  }
}

// 简单的事件发射器
const _events = Symbol('events');
EncryptedDirectConnection.prototype[_events] = null;
EncryptedDirectConnection.prototype.on = function(event, handler) {
  if (!this[_events]) this[_events] = new Map();
  if (!this[_events].has(event)) this[_events].set(event, []);
  this[_events].get(event).push(handler);
};
EncryptedDirectConnection.prototype.emit = function(event, ...args) {
  if (!this[_events]) return;
  const handlers = this[_events].get(event);
  if (handlers) for (const h of handlers) h(...args);
};

// ==================== 加密直连服务类 ====================

export class 加密直连服务 {
  /**
   * @param {Object} 配置
   * @param {string} 配置.doveId - 鸽子ID
   * @param {string} 配置.饲养员ID - 饲养员用户ID
   * @param {string} 配置.jwtSecret - JWT 密钥
   * @param {number} [配置.port=0] - 监听端口（0=自动分配）
   * @param {string} [配置.host='0.0.0.0'] - 监听地址
   * @param {Function} 配置.onChatMessage - 对话消息回调
   * @param {Function} 配置.onControlMessage - 控制指令回调
   * @param {Function} [配置.onAudit] - 审计日志回调
   */
  constructor(配置) {
    this.doveId = 配置.doveId;
    this.饲养员ID = 配置.饲养员ID;
    this.jwtSecret = 配置.jwtSecret;
    this.port = 配置.port || 0;
    this.host = 配置.host || '0.0.0.0';
    this.onChatMessage = 配置.onChatMessage;
    this.onControlMessage = 配置.onControlMessage;
    this.onAudit = 配置.onAudit || null;

    /** @type {import('net').Server|null} */
    this.server = null;
    /** @type {Set<EncryptedDirectConnection>} */
    this.connections = new Set();
    this.actualPort = null;
  }

  /**
   * 启动加密直连服务
   * @returns {Promise<number>} 实际监听端口
   */
  async start() {
    return new Promise((resolve, reject) => {
      this.server = createServer();

      this.server.on('connection', (socket) => {
        this._handleConnection(socket);
      });

      this.server.on('error', (err) => {
        logger.error(`启动失败: ${err.message}`);
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        this.actualPort = this.server.address().port;
        logger.info(`加密直连已启动: tcp://${this.host}:${this.actualPort} (鸽子: ${this.doveId})`);
        resolve(this.actualPort);
      });
    });
  }

  /**
   * 停止加密直连服务
   */
  async stop() {
    for (const conn of this.connections) {
      try { conn.close(); } catch (e) { logger.warn(`关闭连接失败: ${e.message}`); }
    }
    this.connections.clear();

    if (this.server) {
      await new Promise(resolve => this.server.close(resolve));
      this.server = null;
    }
    this.actualPort = null;
    logger.info('加密直连已停止');
  }

  /**
   * 获取加密直连端点
   * @returns {Object|null} { host, port, protocol }
   */
  getEndpoint() {
    if (!this.actualPort) return null;
    return {
      host: process.env.DOVE_DIRECT_HOST || process.env.DOVE_EXTERNAL_HOST || hostname() || '127.0.0.1',
      port: this.actualPort,
      protocol: 'tcp+noise'
    };
  }

  // ==================== 内部方法 ====================

  _handleConnection(socket) {
    const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
    logger.info(`加密直连请求: ${clientAddr}`);

    const handshake = new ServerHandshake({ keyName: `dove_${this.doveId}` });
    let buffer = Buffer.alloc(0);
    let currentPhase = HANDSHAKE_PHASE.INIT;
    let connection = null;

    const cleanup = () => {
      if (connection) this.connections.delete(connection);
      socket.destroy();
    };

    const handshakeTimeout = setTimeout(() => {
      logger.warn(`握手超时: ${clientAddr}`);
      cleanup();
    }, DEFAULT_TIMEOUT.HANDSHAKE);

    socket.on('data', async (data) => {
      try {
        buffer = Buffer.concat([buffer, data]);

        // 阶段1: 接收客户端初始化
        if (currentPhase === HANDSHAKE_PHASE.INIT) {
          if (buffer.length < PROTOCOL_MAGIC.length) return;
          const magic = buffer.slice(0, PROTOCOL_MAGIC.length);
          if (!magic.equals(PROTOCOL_MAGIC)) {
            logger.warn(`无效协议魔数: ${clientAddr}`);
            socket.destroy();
            return;
          }
          try {
            const result = await handshake.handleClientInit(buffer);
            socket.write(result.message);
            buffer = Buffer.alloc(0);
            currentPhase = HANDSHAKE_PHASE.SERVER_RESPONSE;
            logger.info(`握手阶段1完成: ${clientAddr}, clientId: ${result.clientId}`);
          } catch (e) {
            if (e.message?.includes('slice') || e.message?.includes('length')) return;
            throw e;
          }
        }

        // 阶段2: 接收客户端认证（含JWT）
        else if (currentPhase === HANDSHAKE_PHASE.SERVER_RESPONSE) {
          try {
            const result = await handshake.handleClientAuth(buffer);

            // 验证 JWT
            const payload = result.payload || {};
            const token = payload.token || payload.apiKey;
            if (!token) {
              logger.warn(`未提供认证令牌: ${clientAddr}`);
              socket.destroy();
              return;
            }

            let decoded;
            try {
              decoded = jwt.verify(token, this.jwtSecret, {
                clockTimestamp: Math.floor(Date.now() / 1000),
                clockTolerance: 30
              });
            } catch (e) {
              logger.warn(`JWT验证失败: ${clientAddr}, ${e.message}`);
              socket.destroy();
              return;
            }

            const userId = decoded.userId || decoded.sub || decoded._id;

            // 账号隔离：只允许饲养员连接
            if (userId !== this.饲养员ID) {
              logger.warn(`账号隔离拒绝: ${userId} → 鸽子${this.doveId} (饲养员: ${this.饲养员ID})`);
              socket.destroy();
              return;
            }

            // 发送握手完成
            socket.write(result.message);
            clearTimeout(handshakeTimeout);
            currentPhase = HANDSHAKE_PHASE.ESTABLISHED;

            // 创建加密连接
            connection = new EncryptedDirectConnection(socket, result.session, {
              clientAddr,
              userId,
              username: decoded.username || '',
              fingerprint: getPublicKeyFingerprint(result.clientPub)
            });
            this.connections.add(connection);

            logger.info(`加密直连建立: ${clientAddr}, user: ${userId}`);

            // 路由消息
            connection.on('message', (msg) => {
              this._routeMessage(connection, msg);
            });

            connection.on('close', () => {
              this.connections.delete(connection);
              logger.info(`加密直连关闭: ${clientAddr}`);
            });

          } catch (e) {
            logger.error(`认证失败: ${clientAddr}, ${e.message}`);
            socket.destroy();
          }
        }

      } catch (err) {
        logger.error(`握手错误: ${clientAddr}, ${err.message}`);
        cleanup();
      }
    });

    socket.on('error', (err) => {
      logger.error(`连接错误: ${clientAddr}, ${err.message}`);
      cleanup();
    });

    socket.on('close', () => {
      clearTimeout(handshakeTimeout);
      if (connection) this.connections.delete(connection);
    });
  }

  /**
   * 路由消息到对应处理器
   * CryptoClient发送格式: { requestId, method, path, body }
   * body中包含实际的 chat/control 消息
   */
  async _routeMessage(conn, message) {
    // 解包 CryptoClient 格式
    const requestId = message.requestId;
    const msg = message.body || message;

    switch (msg.type) {
      case 'chat':
        await this._handleChat(conn, msg, requestId);
        break;
      case 'control':
        await this._handleControl(conn, msg, requestId);
        break;
      default:
        conn.send({ requestId, type: 'error', error: `未知消息类型: ${msg.type}` });
    }
  }

  async _handleChat(conn, message, requestId) {
    const { seq, conversationId, content, profile, constraints, attachments } = message;
    if (!content) {
      conn.send({ requestId, type: 'chat_error', seq, error: '消息内容不能为空' });
      return;
    }
    try {
      const result = await this.onChatMessage({
        userId: conn.clientInfo.userId,
        conversationId: conversationId || null,
        content,
        profile: profile || null,
        constraints: constraints || null,
        attachments: attachments || [],
        channel: 'local'
      });
      conn.send({ requestId, type: 'chat_response', seq, data: result });
    } catch (e) {
      logger.error(`处理对话消息失败: ${e.message}`);
      conn.send({ requestId, type: 'chat_error', seq, error: e.message });
    }
  }

  async _handleControl(conn, message, requestId) {
    const { seq, action, params } = message;
    if (!this.onControlMessage) {
      conn.send({ requestId, type: 'control_error', seq, error: '控制指令不支持' });
      return;
    }
    try {
      const result = await this.onControlMessage({
        userId: conn.clientInfo.userId,
        action,
        params: params || {}
      });
      conn.send({ requestId, type: 'control_response', seq, data: result });
    } catch (e) {
      conn.send({ requestId, type: 'control_error', seq, error: e.message });
    }
  }
}

export default 加密直连服务;
