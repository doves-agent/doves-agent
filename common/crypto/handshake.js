/**
 * 白鸽加密通讯 - 握手协议
 * 
 * 实现 Noise NX 模式握手：
 * - 客户端发送临时公钥
 * - 服务端响应临时公钥 + 长期公钥 + 签名
 * - 客户端发送长期公钥 + 签名
 * - 双方派生会话密钥
 */

import nacl from 'tweetnacl';
import { 
  generateSigningKeyPair,
  generateEphemeralKeyPair,
  computeSharedSecret,
  deriveSessionKeys,
  sign,
  verifySignature,
  getOrCreateKeyPair,
  getPublicKeyFingerprint,
  verifyKnownHost,
  addKnownHost
} from './keys.js';
import { EncryptedSession, randomBytes } from './session.js';
import { 
  PROTOCOL_VERSION, 
  PROTOCOL_MAGIC, 
  HANDSHAKE_PHASE,
  MESSAGE_TYPE,
  ERROR_CODE,
  KEY_LENGTH 
} from './protocol.js';

// ==================== 握手消息构建 ====================

/**
 * 构建握手初始化消息
 * @param {Uint8Array} clientEphemeralPub - 客户端临时公钥
 * @param {string} clientId - 客户端标识
 * @returns {Buffer}
 */
export function buildHandshakeInit(clientEphemeralPub, clientId) {
  const versionBytes = Buffer.from(PROTOCOL_VERSION, 'utf-8');
  const clientIdBytes = Buffer.from(clientId, 'utf-8');
  
  // 格式: [magic:4][version_len:1][version:N][ephemeral_pub:32][client_id_len:1][client_id:N]
  const frame = Buffer.concat([
    PROTOCOL_MAGIC,
    Buffer.from([versionBytes.length]),
    versionBytes,
    Buffer.from(clientEphemeralPub),
    Buffer.from([clientIdBytes.length]),
    clientIdBytes
  ]);
  
  return frame;
}

/**
 * 解析握手初始化消息
 * @param {Buffer} data 
 * @returns {{ clientEphemeralPub: Uint8Array, clientId: string, version: string }}
 */
export function parseHandshakeInit(data) {
  let offset = 0;
  
  // 验证魔数
  const magic = data.slice(0, PROTOCOL_MAGIC.length);
  if (!magic.equals(PROTOCOL_MAGIC)) {
    throw new Error('无效的协议魔数');
  }
  offset += PROTOCOL_MAGIC.length;
  
  // 版本
  const versionLen = data.readUInt8(offset++);
  const version = data.slice(offset, offset + versionLen).toString('utf-8');
  offset += versionLen;
  
  // 临时公钥
  const clientEphemeralPub = new Uint8Array(data.slice(offset, offset + KEY_LENGTH.X25519_PUBLIC));
  offset += KEY_LENGTH.X25519_PUBLIC;
  
  // 客户端ID
  const clientIdLen = data.readUInt8(offset++);
  const clientId = data.slice(offset, offset + clientIdLen).toString('utf-8');
  
  return { clientEphemeralPub, clientId, version };
}

/**
 * 构建服务端握手响应
 * @param {Uint8Array} serverEphemeralPub - 服务端临时公钥
 * @param {Uint8Array} serverPub - 服务端长期公钥
 * @param {Uint8Array} serverSig - 服务端签名
 * @param {Uint8Array} nonce - 随机数
 * @returns {Buffer}
 */
export function buildHandshakeResponse(serverEphemeralPub, serverPub, serverSig, nonce) {
  // 格式: [ephemeral_pub:32][server_pub:32][sig_len:2][sig:N][nonce:32]
  const frame = Buffer.concat([
    Buffer.from(serverEphemeralPub),
    Buffer.from(serverPub),
    Buffer.from([serverSig.length >> 8, serverSig.length & 0xFF]),
    Buffer.from(serverSig),
    Buffer.from(nonce)
  ]);
  
  return frame;
}

/**
 * 解析服务端握手响应
 * @param {Buffer} data 
 * @returns {{ serverEphemeralPub: Uint8Array, serverPub: Uint8Array, serverSig: Uint8Array, nonce: Uint8Array }}
 */
export function parseHandshakeResponse(data) {
  let offset = 0;
  
  const serverEphemeralPub = new Uint8Array(data.slice(0, KEY_LENGTH.X25519_PUBLIC));
  offset += KEY_LENGTH.X25519_PUBLIC;
  
  const serverPub = new Uint8Array(data.slice(offset, offset + KEY_LENGTH.ED25519_PUBLIC));
  offset += KEY_LENGTH.ED25519_PUBLIC;
  
  const sigLen = data.readUInt16BE(offset);
  offset += 2;
  
  const serverSig = new Uint8Array(data.slice(offset, offset + sigLen));
  offset += sigLen;
  
  const nonce = new Uint8Array(data.slice(offset, offset + 32));
  
  return { serverEphemeralPub, serverPub, serverSig, nonce };
}

/**
 * 构建客户端认证消息
 * @param {Uint8Array} clientPub - 客户端长期公钥
 * @param {Uint8Array} clientSig - 客户端签名
 * @param {object} payload - 认证载荷
 * @param {Uint8Array} encryptionKey - 加密密钥
 * @param {Uint8Array} nonce - 加密 nonce
 * @returns {Buffer}
 */
export async function buildHandshakeAuth(clientPub, clientSig, payload, encryptionKey, nonce) {
  // 加密 payload
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf-8');
  const { encrypt } = await import('./session.js');
  const encrypted = encrypt(payloadBytes, encryptionKey, nonce);
  
  // 格式: [client_pub:32][sig_len:2][sig:N][encrypted_len:4][encrypted:N]
  const frame = Buffer.concat([
    Buffer.from(clientPub),
    Buffer.from([clientSig.length >> 8, clientSig.length & 0xFF]),
    Buffer.from(clientSig),
    Buffer.from([encrypted.length >> 24, encrypted.length >> 16 & 0xFF, encrypted.length >> 8 & 0xFF, encrypted.length & 0xFF]),
    Buffer.from(encrypted)
  ]);
  
  return frame;
}

/**
 * 解析客户端认证消息
 * @param {Buffer} data 
 * @param {Uint8Array} decryptionKey - 解密密钥
 * @param {Uint8Array} nonce - 解密 nonce
 * @returns {{ clientPub: Uint8Array, clientSig: Uint8Array, payload: object }}
 */
export async function parseHandshakeAuth(data, decryptionKey, nonce) {
  let offset = 0;
  
  const clientPub = new Uint8Array(data.slice(0, KEY_LENGTH.ED25519_PUBLIC));
  offset += KEY_LENGTH.ED25519_PUBLIC;
  
  const sigLen = data.readUInt16BE(offset);
  offset += 2;
  
  const clientSig = new Uint8Array(data.slice(offset, offset + sigLen));
  offset += sigLen;
  
  const encryptedLen = data.readUInt32BE(offset);
  offset += 4;
  
  const encrypted = data.slice(offset, offset + encryptedLen);
  
  // 解密 payload
  const { decrypt } = await import('./session.js');
  const decrypted = decrypt(new Uint8Array(encrypted), decryptionKey, nonce);
  if (!decrypted) {
    throw new Error('解密认证载荷失败');
  }
  
  const payload = JSON.parse(Buffer.from(decrypted).toString('utf-8'));
  
  return { clientPub, clientSig, payload };
}

// ==================== 客户端握手器 ====================

/**
 * 客户端握手器
 */
export class ClientHandshake {
  /**
   * @param {object} options
   * @param {string} options.clientId - 客户端标识
   * @param {string} options.keyName - 密钥名称 (cli/dove_xxx)
   * @param {string} options.hostname - 服务端主机名
   * @param {boolean} options.autoAcceptNewHost - 是否自动接受新主机
   * @param {object} [options.authData] - 附加认证数据（注入到握手认证载荷）
   */
  constructor(options) {
    this.clientId = options.clientId;
    this.keyName = options.keyName;
    this.hostname = options.hostname;
    this.autoAcceptNewHost = options.autoAcceptNewHost ?? false;
    this.authData = options.authData || null;  // 附加认证数据
    
    this.phase = HANDSHAKE_PHASE.INIT;
    this.ephemeralKeyPair = null;
    this.longTermKeyPair = null;
    this.session = null;
    this.serverPub = null;
    this.serverNonce = null;
  }
  
  /**
   * 初始化握手
   * @returns {Promise<{ phase: string, message: Buffer }>}
   */
  async init() {
    // 加载/生成长期密钥
    this.longTermKeyPair = await getOrCreateKeyPair(this.keyName);
    
    // 生成临时密钥
    this.ephemeralKeyPair = generateEphemeralKeyPair();
    
    // 构建初始化消息
    const message = buildHandshakeInit(
      this.ephemeralKeyPair.publicKey,
      this.clientId
    );
    
    this.phase = HANDSHAKE_PHASE.INIT;
    return { phase: this.phase, message };
  }
  
  /**
   * 处理服务端响应
   * @param {Buffer} response 
   * @returns {Promise<{ phase: string, message: Buffer }>}
   */
  async handleServerResponse(response) {
    if (this.phase !== HANDSHAKE_PHASE.INIT) {
      throw new Error('握手阶段错误');
    }
    
    const { serverEphemeralPub, serverPub, serverSig, nonce } = parseHandshakeResponse(response);
    
    // 验证主机
    const hostStatus = await verifyKnownHost(this.hostname, serverPub);
    if (hostStatus === 'mismatch') {
      throw new Error('主机密钥不匹配！可能存在中间人攻击');
    }
    if (hostStatus === 'new') {
      if (!this.autoAcceptNewHost) {
        const fingerprint = getPublicKeyFingerprint(serverPub);
        throw new Error(`未知主机。指纹: ${fingerprint}`);
      }
      await addKnownHost(this.hostname, serverPub);
    }
    
    // 验证服务端签名
    // 签名内容: client_ephemeral_pub || server_ephemeral_pub || nonce
    const sigContent = Buffer.concat([
      Buffer.from(this.ephemeralKeyPair.publicKey),
      Buffer.from(serverEphemeralPub),
      Buffer.from(nonce)
    ]);
    
    if (!verifySignature(sigContent, serverSig, serverPub)) {
      throw new Error('服务端签名验证失败');
    }
    
    this.serverPub = serverPub;
    this.serverNonce = nonce;
    
    // 计算 DH 共享密钥
    const sharedSecret = computeSharedSecret(
      this.ephemeralKeyPair.secretKey,
      serverEphemeralPub
    );
    
    // 派生会话密钥
    const { encryptionKey, decryptionKey, noncePrefix } = deriveSessionKeys(sharedSecret, {
      clientEphemeralPub: this.ephemeralKeyPair.publicKey,
      serverEphemeralPub,
      purpose: 'handshake'
    });
    
    // 创建加密会话（传入确定性派生的 noncePrefix，确保双方一致）
    this.session = new EncryptedSession(encryptionKey, decryptionKey, { noncePrefix });
    
    // 构建认证消息
    const authPayload = {
      timestamp: Date.now(),
      clientId: this.clientId,
      ...(this.authData || {})
    };
    
    // 客户端签名内容: server_ephemeral_pub || client_ephemeral_pub || nonce || timestamp
    const clientSigContent = Buffer.concat([
      Buffer.from(serverEphemeralPub),
      Buffer.from(this.ephemeralKeyPair.publicKey),
      Buffer.from(nonce),
      Buffer.from(authPayload.timestamp.toString(), 'utf-8')
    ]);
    
    const clientSig = sign(clientSigContent, this.longTermKeyPair.secretKey);
    
    // 使用会话密钥加密认证载荷（nonce 使用服务端发送的 nonce 前24字节，确保双方一致）
    const authMessage = await buildHandshakeAuth(
      this.longTermKeyPair.publicKey,
      clientSig,
      authPayload,
      encryptionKey,
      this.serverNonce.slice(0, 24)
    );
    
    this.phase = HANDSHAKE_PHASE.CLIENT_AUTH;
    return { phase: this.phase, message: authMessage };
  }
  
  /**
   * 处理握手完成
   * @param {Buffer} response 
   * @returns {{ phase: string, session: EncryptedSession }}
   */
  handleHandshakeDone(response) {
    if (this.phase !== HANDSHAKE_PHASE.CLIENT_AUTH) {
      throw new Error('握手阶段错误');
    }
    
    // 解析握手完成消息
    const { type, payload } = this.session.decryptMessage(response);
    
    if (type !== MESSAGE_TYPE.HANDSHAKE_DONE) {
      throw new Error('期望握手完成消息');
    }
    
    this.phase = HANDSHAKE_PHASE.ESTABLISHED;
    return { phase: this.phase, session: this.session };
  }
}

// ==================== 服务端握手器 ====================

/**
 * 服务端握手器
 */
export class ServerHandshake {
  /**
   * @param {object} options
   * @param {string} options.keyName - 服务端密钥名称
   */
  constructor(options) {
    this.keyName = options.keyName || 'server';
    
    this.phase = HANDSHAKE_PHASE.INIT;
    this.ephemeralKeyPair = null;
    this.longTermKeyPair = null;
    this.session = null;
    this.clientPub = null;
    this.clientEphemeralPub = null;
    this.clientId = null;
    this.serverNonce = null;
  }
  
  /**
   * 处理客户端初始化
   * @param {Buffer} initMessage 
   * @returns {Promise<{ phase: string, message: Buffer, clientId: string }>}
   */
  async handleClientInit(initMessage) {
    // 加载/生成服务端长期密钥
    this.longTermKeyPair = await getOrCreateKeyPair(this.keyName);
    
    // 解析客户端初始化消息
    const { clientEphemeralPub, clientId, version } = parseHandshakeInit(initMessage);
    
    if (version !== PROTOCOL_VERSION) {
      throw new Error(`不支持的协议版本: ${version}`);
    }
    
    this.clientEphemeralPub = clientEphemeralPub;
    this.clientId = clientId;
    
    // 生成服务端临时密钥
    this.ephemeralKeyPair = generateEphemeralKeyPair();
    
    // 生成 nonce
    this.serverNonce = randomBytes(32);
    
    // 服务端签名内容: client_ephemeral_pub || server_ephemeral_pub || nonce
    const sigContent = Buffer.concat([
      Buffer.from(clientEphemeralPub),
      Buffer.from(this.ephemeralKeyPair.publicKey),
      Buffer.from(this.serverNonce)
    ]);
    
    const serverSig = sign(sigContent, this.longTermKeyPair.secretKey);
    
    // 构建响应消息
    const message = buildHandshakeResponse(
      this.ephemeralKeyPair.publicKey,
      this.longTermKeyPair.publicKey,
      serverSig,
      this.serverNonce
    );
    
    this.phase = HANDSHAKE_PHASE.SERVER_RESPONSE;
    return { phase: this.phase, message, clientId };
  }
  
  /**
   * 处理客户端认证
   * @param {Buffer} authMessage 
   * @returns {Promise<{ phase: string, message: Buffer, clientPub: Uint8Array, payload: object }>}
   */
  async handleClientAuth(authMessage) {
    if (this.phase !== HANDSHAKE_PHASE.SERVER_RESPONSE) {
      throw new Error('握手阶段错误');
    }
    
    // 计算 DH 共享密钥
    const sharedSecret = computeSharedSecret(
      this.ephemeralKeyPair.secretKey,
      this.clientEphemeralPub
    );
    
    // 派生会话密钥（注意：服务端的加密/解密密钥与客户端相反，需要交换解构映射）
    const { encryptionKey: decryptionKey, decryptionKey: encryptionKey, noncePrefix } = deriveSessionKeys(sharedSecret, {
      clientEphemeralPub: this.clientEphemeralPub,
      serverEphemeralPub: this.ephemeralKeyPair.publicKey,
      purpose: 'handshake'
    });
    
    // 创建加密会话（传入确定性派生的 noncePrefix，确保双方一致）
    this.session = new EncryptedSession(encryptionKey, decryptionKey, { noncePrefix });
    
    // 解析认证消息（使用 nonce 作为加密 nonce）
    const authNonce = new Uint8Array(24);
    authNonce.set(this.serverNonce.slice(0, 24));
    
    const { clientPub, clientSig, payload } = await parseHandshakeAuth(
      authMessage,
      decryptionKey,
      authNonce
    );
    
    // 验证客户端签名
    const clientSigContent = Buffer.concat([
      Buffer.from(this.ephemeralKeyPair.publicKey),
      Buffer.from(this.clientEphemeralPub),
      Buffer.from(this.serverNonce),
      Buffer.from(payload.timestamp.toString(), 'utf-8')
    ]);
    
    if (!verifySignature(clientSigContent, clientSig, clientPub)) {
      throw new Error('客户端签名验证失败');
    }
    
    this.clientPub = clientPub;
    
    // 构建握手完成消息
    const doneMessage = this.session.encryptMessage(MESSAGE_TYPE.HANDSHAKE_DONE, {
      serverId: 'server',
      timestamp: Date.now()
    });
    
    this.phase = HANDSHAKE_PHASE.ESTABLISHED;
    return { 
      phase: this.phase, 
      message: doneMessage, 
      clientPub, 
      payload,
      session: this.session 
    };
  }
}
