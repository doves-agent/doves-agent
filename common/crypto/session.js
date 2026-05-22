/**
 * 白鸽加密通讯 - 会话加密
 * 
 * 使用 ChaCha20-Poly1305 (AEAD) 进行加密
 * 提供消息级别的加密和解密
 */

import nacl from 'tweetnacl';
import { KEY_LENGTH, MESSAGE_TYPE } from './protocol.js';

// ==================== 加密/解密 ====================

/**
 * ChaCha20-Poly1305 加密
 * @param {Uint8Array} plaintext - 明文
 * @param {Uint8Array} key - 32字节密钥
 * @param {Uint8Array} nonce - 24字节随机数
 * @returns {Uint8Array} 密文 + 16字节 MAC
 */
export function encrypt(plaintext, key, nonce) {
  return nacl.secretbox(plaintext, nonce, key);
}

/**
 * ChaCha20-Poly1305 解密
 * @param {Uint8Array} ciphertext - 密文 + MAC
 * @param {Uint8Array} key - 32字节密钥
 * @param {Uint8Array} nonce - 24字节随机数
 * @returns {Uint8Array|null} 明文，失败返回 null
 */
export function decrypt(ciphertext, key, nonce) {
  return nacl.secretbox.open(ciphertext, nonce, key);
}

// ==================== Nonce 管理 ====================

/**
 * 生成随机 Nonce
 * @returns {Uint8Array} 24字节随机数
 */
export function generateNonce() {
  return nacl.randomBytes(KEY_LENGTH.NONCE);
}

/**
 * 递增 Nonce（用于计数器模式）
 * @param {Uint8Array} nonce 
 * @returns {Uint8Array} 新的 nonce
 */
export function incrementNonce(nonce) {
  const newNonce = new Uint8Array(nonce);
  for (let i = 0; i < newNonce.length; i++) {
    newNonce[i]++;
    if (newNonce[i] !== 0) break;  // 没有溢出，停止进位
  }
  return newNonce;
}

// ==================== 消息封装 ====================

/**
 * 加密会话类
 * 管理发送/接收计数器，提供自动 nonce 管理
 */
export class EncryptedSession {
  /**
   * @param {Uint8Array} encryptionKey - 发送加密密钥
   * @param {Uint8Array} decryptionKey - 接收解密密钥
   * @param {object} options - 可选参数
   * @param {Uint8Array} options.noncePrefix - 共享的 nonce 前缀（双方必须相同）
   */
  constructor(encryptionKey, decryptionKey, options = {}) {
    this.encryptionKey = encryptionKey;
    this.decryptionKey = decryptionKey;
    
    // 计数器作为 nonce 的一部分
    this.sendCounter = 0n;
    this.recvCounter = -1n;  // 初始为 -1，允许第一条消息 counter=0
    
    // 随机前缀（防止 nonce 重用）
    // 如果没有传入，则生成新的；否则使用传入的
    this.noncePrefix = options.noncePrefix || nacl.randomBytes(8);
  }
  
  /**
   * 获取 nonce 前缀，用于传递给对方
   * @returns {Uint8Array}
   */
  getNoncePrefix() {
    return this.noncePrefix;
  }
  
  /**
   * 从发送计数器生成 nonce
   * @returns {Uint8Array}
   */
  getSendNonce() {
    const nonce = new Uint8Array(KEY_LENGTH.NONCE);
    nonce.set(this.noncePrefix, 0);
    
    // 将计数器放入 nonce 的后 16 字节
    const counterBytes = Buffer.alloc(16);
    counterBytes.writeBigUInt64LE(this.sendCounter, 0);
    nonce.set(counterBytes, 8);
    
    return nonce;
  }
  
  /**
   * 从接收计数器生成 nonce
   * @returns {Uint8Array}
   */
  getRecvNonce() {
    const nonce = new Uint8Array(KEY_LENGTH.NONCE);
    nonce.set(this.noncePrefix, 0);
    
    const counterBytes = Buffer.alloc(16);
    counterBytes.writeBigUInt64LE(this.recvCounter, 0);
    nonce.set(counterBytes, 8);
    
    return nonce;
  }
  
  /**
   * 加密并发送消息
   * @param {number} type - 消息类型
   * @param {object} payload - 消息内容
   * @returns {Buffer} 加密后的消息帧
   */
  encryptMessage(type, payload) {
    const nonce = this.getSendNonce();
    this.sendCounter++;
    
    // 序列化 payload
    const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf-8');
    
    // 加密
    const encrypted = encrypt(payloadBytes, this.encryptionKey, nonce);
    if (!encrypted) {
      throw new Error('加密失败');
    }
    
    // 构建消息帧
    // 格式: [type:1][counter:8][nonce_prefix:8][length:4][encrypted_data:N]
    const frame = Buffer.alloc(1 + 8 + 8 + 4 + encrypted.length);
    frame.writeUInt8(type, 0);
    frame.writeBigUInt64LE(this.sendCounter - 1n, 1);
    frame.set(this.noncePrefix, 9);
    frame.writeUInt32BE(encrypted.length, 17);
    frame.set(encrypted, 21);
    
    return frame;
  }
  
  /**
   * 解密消息
   * @param {Buffer} frame - 消息帧
   * @returns {{ type: number, counter: bigint, payload: object }}
   */
  decryptMessage(frame) {
    if (frame.length < 21) {
      throw new Error('消息帧太短');
    }
    
    const type = frame.readUInt8(0);
    const counter = frame.readBigUInt64LE(1);
    const noncePrefix = frame.slice(9, 17);
    const encryptedLen = frame.readUInt32BE(17);
    const encrypted = frame.slice(21, 21 + encryptedLen);
    
    // 验证 nonce 前缀
    if (!noncePrefix.every((b, i) => b === this.noncePrefix[i])) {
      throw new Error('Nonce 前缀不匹配');
    }
    
    // 重建 nonce
    const nonce = new Uint8Array(KEY_LENGTH.NONCE);
    nonce.set(noncePrefix, 0);
    const counterBytes = Buffer.alloc(16);
    counterBytes.writeBigUInt64LE(counter, 0);
    nonce.set(counterBytes, 8);
    
    // 解密
    const decrypted = decrypt(encrypted, this.decryptionKey, nonce);
    if (!decrypted) {
      throw new Error('解密失败');
    }
    
    // 更新接收计数器（防重放）
    if (counter <= this.recvCounter) {
      throw new Error('可能的重放攻击');
    }
    this.recvCounter = counter;
    
    return {
      type,
      counter,
      payload: JSON.parse(Buffer.from(decrypted).toString('utf-8'))
    };
  }
  
  /**
   * 创建 PING 消息
   * @returns {Buffer}
   */
  ping() {
    return this.encryptMessage(MESSAGE_TYPE.PING, { timestamp: Date.now() });
  }
  
  /**
   * 创建 PONG 消息
   * @param {number} timestamp - PING 中的时间戳
   * @returns {Buffer}
   */
  pong(timestamp) {
    return this.encryptMessage(MESSAGE_TYPE.PONG, { 
      pingTimestamp: timestamp,
      pongTimestamp: Date.now()
    });
  }
  
  /**
   * 创建数据消息
   * @param {object} data - 数据内容
   * @returns {Buffer}
   */
  data(data) {
    return this.encryptMessage(MESSAGE_TYPE.DATA, data);
  }
  
  /**
   * 创建关闭消息
   * @param {string} reason - 关闭原因
   * @returns {Buffer}
   */
  close(reason) {
    return this.encryptMessage(MESSAGE_TYPE.CLOSE, { reason });
  }
  
  /**
   * 创建错误消息
   * @param {number} code - 错误码
   * @param {string} message - 错误信息
   * @returns {Buffer}
   */
  error(code, message) {
    return this.encryptMessage(MESSAGE_TYPE.ERROR, { code, message });
  }
}

// ==================== 工具函数 ====================

/**
 * 生成随机字节
 * @param {number} length 
 * @returns {Uint8Array}
 */
export function randomBytes(length) {
  return nacl.randomBytes(length);
}

/**
 * 常量时间比较
 * @param {Uint8Array} a 
 * @param {Uint8Array} b 
 * @returns {boolean}
 */
export function constantTimeCompare(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

// ==================== 流式加密支持 ====================

/**
 * 流式加密器 - 用于大文件分块加密
 * 
 * 使用方法：
 * ```javascript
 * const stream = new StreamEncryptor(encryptionKey, chunkSize);
 * 
 * // 分块加密
 * const chunk1 = stream.encryptChunk(fileSlice1);
 * const chunk2 = stream.encryptChunk(fileSlice2);
 * // ...
 * 
 * // 完成
 * const finalChunk = stream.finalize();
 * ```
 */
export class StreamEncryptor {
  /**
   * @param {Uint8Array} key - 加密密钥
   * @param {number} chunkSize - 分块大小（默认 64KB）
   */
  constructor(key, chunkSize = 64 * 1024) {
    this.key = key;
    this.chunkSize = chunkSize;
    this.chunkIndex = 0;
    this.totalBytes = 0;
    this.finalized = false;
  }
  
  /**
   * 加密一个数据块
   * @param {Uint8Array} data - 数据块
   * @returns {Buffer} 加密后的数据块
   */
  encryptChunk(data) {
    if (this.finalized) {
      throw new Error('加密器已关闭');
    }
    
    // 生成 nonce：使用块索引
    const nonce = new Uint8Array(KEY_LENGTH.NONCE);
    const indexBytes = Buffer.alloc(16);
    indexBytes.writeBigUInt64LE(BigInt(this.chunkIndex), 0);
    nonce.set(indexBytes, 8);
    
    // 加密
    const encrypted = encrypt(data, this.key, nonce);
    
    // 构建块格式：[index:8][length:4][encrypted:N]
    const chunk = Buffer.alloc(8 + 4 + encrypted.length);
    chunk.writeBigUInt64LE(BigInt(this.chunkIndex), 0);
    chunk.writeUInt32BE(encrypted.length, 8);
    chunk.set(encrypted, 12);
    
    this.chunkIndex++;
    this.totalBytes += data.length;
    
    return chunk;
  }
  
  /**
   * 完成加密，返回元数据
   * @returns {{ totalChunks: number, totalBytes: number }}
   */
  finalize() {
    this.finalized = true;
    return {
      totalChunks: this.chunkIndex,
      totalBytes: this.totalBytes
    };
  }
}

/**
 * 流式解密器 - 用于大文件分块解密
 */
export class StreamDecryptor {
  /**
   * @param {Uint8Array} key - 解密密钥
   */
  constructor(key) {
    this.key = key;
    this.nextIndex = 0;
    this.totalBytes = 0;
  }
  
  /**
   * 解密一个数据块
   * @param {Buffer} chunk - 加密的数据块
   * @returns {Uint8Array} 解密后的数据
   */
  decryptChunk(chunk) {
    if (chunk.length < 12) {
      throw new Error('数据块太小');
    }
    
    // 解析块格式
    const index = Number(chunk.readBigUInt64LE(0));
    const encryptedLen = chunk.readUInt32BE(8);
    const encrypted = chunk.slice(12, 12 + encryptedLen);
    
    // 检查块顺序
    if (index !== this.nextIndex) {
      throw new Error(`块顺序错误: 期望 ${this.nextIndex}, 实际 ${index}`);
    }
    
    // 重建 nonce
    const nonce = new Uint8Array(KEY_LENGTH.NONCE);
    const indexBytes = Buffer.alloc(16);
    indexBytes.writeBigUInt64LE(BigInt(index), 0);
    nonce.set(indexBytes, 8);
    
    // 解密
    const decrypted = decrypt(encrypted, this.key, nonce);
    if (!decrypted) {
      throw new Error('解密失败');
    }
    
    this.nextIndex++;
    this.totalBytes += decrypted.length;
    
    return decrypted;
  }
  
  /**
   * 获取已解密的统计
   */
  getStats() {
    return {
      decryptedChunks: this.nextIndex,
      totalBytes: this.totalBytes
    };
  }
}

// ==================== 文件传输消息类型 ====================

/**
 * 文件传输消息类型
 */
export const FILE_MESSAGE_TYPE = {
  FILE_START: 0xF0,     // 文件开始
  FILE_CHUNK: 0xF1,     // 文件分块
  FILE_END: 0xF2,       // 文件结束
  FILE_ABORT: 0xF3      // 文件中止
};
