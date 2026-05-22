/**
 * 白鸽服务端加密监听器（唯一对外端口）
 *
 * Noise NX 加密 TCP 服务，所有 CLI/Doves 通信经此通道
 *
 * 使用方法：
 * ```javascript
 * import { startEncryptedServer } from './加密服务端.js';
 *
 * const server = await startEncryptedServer({
 *   port: 3003,
 *   host: '0.0.0.0',
 *   onConnection: async (session, clientInfo) => {
 *     // 处理加密连接
 *   }
 * });
 * ```
 */

import { createServer } from 'net';
import { EventEmitter } from 'events';
import { 
  ServerHandshake, 
  EncryptedSession,
  PROTOCOL_MAGIC,
  MESSAGE_TYPE,
  ERROR_CODE,
  DEFAULT_PORT,
  DEFAULT_TIMEOUT,
  HANDSHAKE_PHASE
} from '../common/crypto/index.js';
import { getPublicKeyFingerprint } from '../common/crypto/keys.js';
import { logger } from './core.js';

// ==================== 加密连接类 ====================

/**
 * 加密连接封装
 */
class EncryptedConnection extends EventEmitter {
  constructor(socket, session, clientInfo) {
    super();
    this.socket = socket;
    this.session = session;
    this.clientInfo = clientInfo;
    this.connected = true;
    this.lastActivity = Date.now();
    
    this._setupSocketHandlers();
  }
  
  _setupSocketHandlers() {
    let buffer = Buffer.alloc(0);
    
    this.socket.on('data', (data) => {
      this.lastActivity = Date.now();
      buffer = Buffer.concat([buffer, data]);
      buffer = this._processBuffer(buffer);
    });
    
    this.socket.on('close', () => {
      this.connected = false;
      this.emit('close', this._lastError?.message || '连接关闭');
    });
    
    this.socket.on('error', (err) => {
      this._lastError = err;
      this.emit('error', err);
    });
  }
  
  /**
   * 处理缓冲区中的数据帧
   * @param {Buffer} buffer - 输入缓冲区
   * @returns {Buffer} 剩余未处理的数据
   */
  _processBuffer(buffer) {
    // 消息帧格式: [length:4][encrypted_data:N]
    while (buffer.length >= 4) {
      const msgLen = buffer.readUInt32BE(0);
      
      if (buffer.length < 4 + msgLen) {
        break;  // 等待更多数据
      }
      
      const frame = buffer.slice(4, 4 + msgLen);
      buffer = buffer.slice(4 + msgLen);
      
      try {
        const { type, payload } = this.session.decryptMessage(frame);
        this._handleMessage(type, payload);
      } catch (err) {
        this.emit('error', new Error(`解密消息失败: ${err.message}`));
      }
    }
    return buffer;
  }
  
  _handleMessage(type, payload) {
    switch (type) {
      case MESSAGE_TYPE.DATA:
        this.emit('data', payload);
        break;
        
      case MESSAGE_TYPE.PING:
        this.sendPong(payload.timestamp);
        break;
        
      case MESSAGE_TYPE.PONG:
        // 可用于延迟测量
        this.emit('pong', payload);
        break;
        
      case MESSAGE_TYPE.CLOSE:
        this.emit('close', payload.reason);
        this.close();
        break;
        
      case MESSAGE_TYPE.ERROR:
        this.emit('error', new Error(`远程错误: ${payload.code} - ${payload.message}`));
        break;
        
      default:
        this.emit('error', new Error(`未知消息类型: ${type}`));
    }
  }
  
  /**
   * 发送数据
   * @param {object} data 
   */
  send(data) {
    if (!this.connected) {
      throw new Error('连接已关闭');
    }
    
    const frame = this.session.data(data);
    const packet = Buffer.alloc(4 + frame.length);
    packet.writeUInt32BE(frame.length, 0);
    frame.copy(packet, 4);
    
    this.socket.write(packet);
  }
  
  /**
   * 发送 PONG
   * @param {number} pingTimestamp 
   */
  sendPong(pingTimestamp) {
    if (!this.connected) return;
    const frame = this.session.pong(pingTimestamp);
    const packet = Buffer.alloc(4 + frame.length);
    packet.writeUInt32BE(frame.length, 0);
    frame.copy(packet, 4);
    this.socket.write(packet);
  }
  
  /**
   * 发送错误
   * @param {number} code 
   * @param {string} message 
   */
  sendError(code, message) {
    if (!this.connected) return;
    const frame = this.session.error(code, message);
    const packet = Buffer.alloc(4 + frame.length);
    packet.writeUInt32BE(frame.length, 0);
    frame.copy(packet, 4);
    this.socket.write(packet);
  }
  
  /**
   * 关闭连接
   * @param {string} reason 
   */
  close(reason = 'normal') {
    if (!this.connected) return;
    
    try {
      const frame = this.session.close(reason);
      const packet = Buffer.alloc(4 + frame.length);
      packet.writeUInt32BE(frame.length, 0);
      frame.copy(packet, 4);
      this.socket.write(packet);
    } catch (e) {
      logger.warn('加密连接关闭帧发送失败:', e.message);
    }
    
    this.connected = false;
    this.socket.end();
  }
}

// ==================== 加密服务端 ====================

/**
 * 启动加密服务端
 * @param {object} options
 * @param {number} options.port - 监听端口（默认 3003）
 * @param {string} options.host - 绑定地址（默认 0.0.0.0）
 * @param {function} options.onConnection - 连接回调 (connection, clientInfo) => void
 * @param {function} options.onAuth - 认证回调 (clientPub, payload) => boolean|object
 * @returns {Promise<object>}
 */
export async function startEncryptedServer(options = {}) {
  const port = options.port || DEFAULT_PORT.ENCRYPTED;
  const host = options.host || '0.0.0.0';
  const onConnection = options.onConnection || (() => {});
  const onAuth = options.onAuth || (() => true);
  
  const server = createServer();
  const connections = new Set();
  
  // 处理新连接
  server.on('connection', async (socket) => {
    const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
    logger.info(`加密连接请求: ${clientAddr}`);
    
    const handshake = new ServerHandshake({ keyName: 'server' });
    let buffer = Buffer.alloc(0);
    let currentPhase = HANDSHAKE_PHASE.INIT;
    let connection = null;
    
    const cleanup = () => {
      if (connection) {
        connections.delete(connection);
      }
      socket.destroy();
    };
    
    // 握手超时
    const handshakeTimeout = setTimeout(() => {
      logger.warn(`握手超时: ${clientAddr}`);
      cleanup();
    }, DEFAULT_TIMEOUT.HANDSHAKE);
    
    socket.on('data', async (data) => {
      try {
        buffer = Buffer.concat([buffer, data]);
        
        // 阶段1: 接收客户端初始化
        if (currentPhase === HANDSHAKE_PHASE.INIT) {
          // 检查是否有足够的魔数数据
          if (buffer.length < PROTOCOL_MAGIC.length) return;
          
          // 验证魔数
          const magic = buffer.slice(0, PROTOCOL_MAGIC.length);
          if (!magic.equals(PROTOCOL_MAGIC)) {
            logger.warn(`无效协议: ${clientAddr}`);
            socket.destroy();
            return;
          }
          
          // 尝试解析握手初始化
          try {
            const result = await handshake.handleClientInit(buffer);
            
            // 发送服务端响应
            socket.write(result.message);
            
            buffer = Buffer.alloc(0);
            currentPhase = HANDSHAKE_PHASE.SERVER_RESPONSE;
            
            logger.info(`握手响应已发送: ${clientAddr}, clientId: ${result.clientId}`);
          } catch (e) {
            // 数据不完整，等待更多数据
            if (e.message.includes('slice') || e.message.includes('length')) {
              return;
            }
            throw e;
          }
        }
        
        // 阶段2: 接收客户端认证
        else if (currentPhase === HANDSHAKE_PHASE.SERVER_RESPONSE) {
          try {
            const result = await handshake.handleClientAuth(buffer);
            
            // 调用认证回调
            const authResult = await onAuth(result.clientPub, result.payload);
            if (!authResult) {
              logger.warn(`认证失败: ${clientAddr}`);
              socket.destroy();
              return;
            }
            
            // 发送握手完成
            socket.write(result.message);
            
            clearTimeout(handshakeTimeout);
            currentPhase = HANDSHAKE_PHASE.ESTABLISHED;
            
            // 创建加密连接对象
            connection = new EncryptedConnection(socket, result.session, {
              clientAddr,
              clientId: result.payload.clientId,
              clientPub: result.clientPub,
              fingerprint: getPublicKeyFingerprint(result.clientPub)
            });
            
            connections.add(connection);
            
            logger.info(`握手完成: ${clientAddr}, fingerprint: ${connection.clientInfo.fingerprint}`);
            
            // 调用连接回调
            onConnection(connection, connection.clientInfo);
            
          } catch (e) {
            logger.error(`客户端认证失败: ${clientAddr}, ${e.message}`);
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
      if (connection) {
        connections.delete(connection);
      }
    });
  });
  
  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      logger.info(`加密服务端已启动: ${host}:${port}`);
      
      resolve({
        server,
        port,
        connections,
        close: () => {
          return new Promise((res) => {
            // 关闭所有连接
            for (const conn of connections) {
              conn.close('server_shutdown');
            }
            connections.clear();
            
            server.close(() => {
              logger.info('加密服务端已关闭');
              res();
            });
          });
        }
      });
    });
    
    server.on('error', (err) => {
      logger.error(`加密服务端启动失败: ${err.message}`);
      reject(err);
    });
  });
}

export default { startEncryptedServer };
