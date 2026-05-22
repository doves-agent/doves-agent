/**
 * @file 加密客户端（通用）
 * @description Noise NX 协议的客户端实现，CLI 和 Doves 共用
 * 
 * 提供 SSH/Noise Protocol 级别的加密通讯：
 * - Ed25519 长期身份签名
 * - X25519 临时 DH 密钥交换
 * - ChaCha20-Poly1305 AEAD 会话加密
 * 
 * 使用方法：
 * ```javascript
 * import { CryptoClient } from '@dove/common/crypto/加密客户端.js';
 * 
 * const client = new CryptoClient({
 *   hostname: 'doves.fast-agent.cn',
 *   clientId: 'cli_xxx',        // CLI: machine-based ID, Doves: doveId
 *   keyName: 'cli',             // 密钥文件名（cli / dove_xxx）
 *   autoAcceptNewHost: true
 * });
 * 
 * await client.connect();
 * const response = await client.request('POST', '/api/chat', { message: '...' });
 * ```
 */

import { createConnection } from 'net';
import { EventEmitter } from 'events';
import {
  ClientHandshake,
  MESSAGE_TYPE,
  DEFAULT_PORT,
  DEFAULT_TIMEOUT
} from './index.js';
import { getPublicKeyFingerprint } from './keys.js';

// ==================== 加密客户端类 ====================

/**
 * 加密客户端
 * 通过 Noise NX 握手建立加密 TCP 连接，所有请求通过 ChaCha20-Poly1305 加密
 */
export class CryptoClient extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.hostname - 服务端主机名
   * @param {number} options.port - 服务端端口（默认 3003）
   * @param {string} options.clientId - 客户端标识
   * @param {string} options.keyName - 密钥文件名（cli / dove_xxx）
   * @param {boolean} options.autoAcceptNewHost - 自动接受新主机（默认 true）
   * @param {object} [options.authData] - 附加认证数据（注入握手载荷，如 { token }）
   */
  constructor(options) {
    super();
    
    this.hostname = options.hostname || 'localhost';
    this.port = options.port || DEFAULT_PORT.ENCRYPTED;
    this.clientId = options.clientId || 'unknown_0';
    this.keyName = options.keyName || 'cli';

    // 信任策略：显式参数 > 环境变量 DOVE_TRUST_ON_FIRST_USE > 默认 true（自建部署兼容）
    // 官方发布包应设置 DOVE_TRUST_ON_FIRST_USE=false，防止 TOFU 中间人攻击
    const envTrust = process.env.DOVE_TRUST_ON_FIRST_USE;
    const defaultTrust = envTrust !== undefined ? envTrust === 'true' : true;
    this.autoAcceptNewHost = options.autoAcceptNewHost ?? defaultTrust;
    this.authData = options.authData || null;
    
    this.socket = null;
    this.session = null;
    this.connected = false;
    this.handshaking = false;
    
    // 请求管理
    this.requestId = 0;
    this.pendingRequests = new Map();
    
    // 接收缓冲区
    this.buffer = Buffer.alloc(0);

    // 防止无外部 error listener 时 emit('error') 变成 uncaughtException
    this.on('error', () => {});
  }
  
  /**
   * 连接服务端
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.connected || this.handshaking) {
      throw new Error('已经连接或正在连接');
    }
    
    this.handshaking = true;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('连接超时'));
        this.socket?.destroy();
      }, DEFAULT_TIMEOUT.HANDSHAKE);
      
      this.socket = createConnection(this.port, this.hostname, async () => {
        clearTimeout(timeout);
        
        try {
          await this._doHandshake();
          this.connected = true;
          this.handshaking = false;
          this._setupDataHandler();
          
          this.emit('connected');
          resolve();
        } catch (err) {
          this.handshaking = false;
          reject(err);
        }
      });
      
      this.socket.on('error', (err) => {
        clearTimeout(timeout);
        this.emit('error', err);
        reject(err);
      });
      
      this.socket.on('close', () => {
        this.connected = false;
        this.emit('close');
        
        // 拒绝所有待处理请求
        for (const [id, { reject }] of this.pendingRequests) {
          reject(new Error('连接已关闭'));
        }
        this.pendingRequests.clear();
      });
    });
  }
  
  /**
   * 执行握手
   */
  async _doHandshake() {
    const handshake = new ClientHandshake({
      clientId: this.clientId,
      keyName: this.keyName,
      hostname: this.hostname,
      autoAcceptNewHost: this.autoAcceptNewHost,
      authData: this.authData
    });
    
    // 阶段1: 发送初始化
    const init = await handshake.init();
    this.socket.write(init.message);
    
    // 阶段2: 接收服务端响应
    const response = await this._waitForData(DEFAULT_TIMEOUT.HANDSHAKE);
    const auth = await handshake.handleServerResponse(response);
    this.socket.write(auth.message);
    
    // 阶段3: 接收握手完成
    const done = await this._waitForData(DEFAULT_TIMEOUT.HANDSHAKE);
    const result = handshake.handleHandshakeDone(done);
    
    this.session = result.session;
    this.serverPub = handshake.serverPub;
    
    this.emit('handshake', {
      serverFingerprint: getPublicKeyFingerprint(this.serverPub)
    });
  }
  
  /**
   * 等待数据
   * @param {number} timeout 
   * @returns {Promise<Buffer>}
   */
  _waitForData(timeout) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        this.socket?.removeListener('data', handler);
        this.socket?.removeListener('close', onClose);
        this.socket?.removeListener('error', onError);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(new Error('等待数据超时'));
      }, timeout);

      const chunks = [];

      const handler = (data) => {
        if (settled) return;
        chunks.push(data);
        cleanup();
        // 短暂等待，避免分片数据被拆成多次回调
        setTimeout(() => {
          resolve(Buffer.concat(chunks));
        }, 100);
      };

      const onClose = () => {
        if (settled) return;
        cleanup();
        reject(new Error('连接已断开'));
      };

      const onError = (err) => {
        if (settled) return;
        cleanup();
        reject(new Error(`连接错误: ${err.message}`));
      };

      this.socket.once('data', handler);
      this.socket.once('close', onClose);
      this.socket.once('error', onError);
    });
  }
  
  /**
   * 设置数据处理
   */
  _setupDataHandler() {
    this.socket.on('data', (data) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      this._processBuffer();
    });
  }
  
  /**
   * 处理接收缓冲区
   */
  _processBuffer() {
    while (this.buffer.length >= 4) {
      const msgLen = this.buffer.readUInt32BE(0);
      
      if (this.buffer.length < 4 + msgLen) {
        break;
      }
      
      const frame = this.buffer.slice(4, 4 + msgLen);
      this.buffer = this.buffer.slice(4 + msgLen);
      
      try {
        const { type, payload } = this.session.decryptMessage(frame);
        this._handleMessage(type, payload);
      } catch (err) {
        this.emit('error', new Error(`解密失败: ${err.message}`));
      }
    }
  }
  
  /**
   * 处理消息
   */
  _handleMessage(type, payload) {
    switch (type) {
      case MESSAGE_TYPE.DATA:
        if (payload.requestId && this.pendingRequests.has(payload.requestId)) {
          const { resolve } = this.pendingRequests.get(payload.requestId);
          this.pendingRequests.delete(payload.requestId);
          resolve(payload);
        } else {
          this.emit('message', payload);
        }
        break;
        
      case MESSAGE_TYPE.PING:
        this._sendPong(payload.timestamp);
        break;
        
      case MESSAGE_TYPE.PONG:
        this.emit('pong', payload);
        break;
        
      case MESSAGE_TYPE.CLOSE:
        this.emit('close', payload.reason);
        this.close();
        break;
        
      case MESSAGE_TYPE.ERROR:
        if (payload.requestId && this.pendingRequests.has(payload.requestId)) {
          const { reject } = this.pendingRequests.get(payload.requestId);
          this.pendingRequests.delete(payload.requestId);
          reject(new Error(`${payload.code}: ${payload.message}`));
        } else {
          this.emit('error', new Error(`${payload.code}: ${payload.message}`));
        }
        break;
    }
  }
  
  /**
   * 发送消息帧
   * @param {Buffer} frame 
   */
  _sendFrame(frame) {
    if (!this.connected) {
      throw new Error('未连接');
    }
    
    const packet = Buffer.alloc(4 + frame.length);
    packet.writeUInt32BE(frame.length, 0);
    frame.copy(packet, 4);
    
    this.socket.write(packet);
  }
  
  /**
   * 发送 PONG
   */
  _sendPong(timestamp) {
    const frame = this.session.pong(timestamp);
    this._sendFrame(frame);
  }
  
  /**
   * 发送请求
   * @param {string} method - HTTP 方法
   * @param {string} path - 路径
   * @param {object} body - 请求体
   * @param {object} options - 选项
   * @param {number} options.timeout - 超时时间
   * @returns {Promise<object>}
   */
  request(method, path, body = null, options = {}) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('未连接'));
        return;
      }
      
      const requestId = ++this.requestId;
      const timeout = options.timeout || DEFAULT_TIMEOUT.REQUEST;
      
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('请求超时'));
      }, timeout);
      
      this.pendingRequests.set(requestId, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });
      
      const frame = this.session.data({
        requestId,
        method,
        path,
        body
      });
      
      this._sendFrame(frame);
    });
  }
  
  /**
   * GET 请求
   */
  async get(path) {
    return this.request('GET', path);
  }
  
  /**
   * POST 请求
   */
  async post(path, body) {
    return this.request('POST', path, body);
  }
  
  /**
   * PUT 请求
   */
  async put(path, body) {
    return this.request('PUT', path, body);
  }
  
  /**
   * DELETE 请求
   */
  async delete(path, body) {
    return this.request('DELETE', path, body);
  }
  
  /**
   * 发送 PING
   * @returns {Promise<object>}
   */
  ping() {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('未连接'));
        return;
      }
      
      const timestamp = Date.now();
      const frame = this.session.ping();
      this._sendFrame(frame);
      
      const timer = setTimeout(() => {
        this.removeListener('pong', handler);
        reject(new Error('PING 超时'));
      }, 10000);
      
      const handler = (payload) => {
        if (payload.pingTimestamp === timestamp) {
          clearTimeout(timer);
          this.removeListener('pong', handler);
          resolve({
            rtt: payload.pongTimestamp - payload.pingTimestamp,
            ...payload
          });
        }
      };
      
      this.on('pong', handler);
    });
  }
  
  /**
   * 关闭连接
   * @param {string} reason 
   */
  close(reason = 'client_close') {
    if (!this.connected) return;
    
    try {
      const frame = this.session.close(reason);
      this._sendFrame(frame);
    } catch (e) {
      this.emit('error', new Error(`发送关闭帧失败: ${e.message}`));
    }
    
    this.connected = false;
    this.socket?.end();
  }
}

export default CryptoClient;
