/**
 * 白鸽加密通讯模块入口
 * 
 * 提供 SSH/Noise Protocol 级别的加密通讯
 * 
 * 使用方法：
 * ```javascript
 * // 客户端
 * import { ClientHandshake, CryptoClient } from './common/crypto/index.js';
 * 
 * // 服务端
 * import { ServerHandshake, startEncryptedServer } from './common/crypto/index.js';
 * ```
 */

// 协议常量
export * from './protocol.js';

// 密钥管理
export {
  generateSigningKeyPair,
  generateEphemeralKeyPair,
  convertEd25519ToX25519,
  computeSharedSecret,
  deriveSessionKeys,
  sign,
  verifySignature,
  saveKeyPair,
  loadKeyPair,
  getOrCreateKeyPair,
  getKeyPath,
  getPublicKeyFingerprint,
  loadKnownHosts,
  saveKnownHosts,
  addKnownHost,
  verifyKnownHost,
  loadBundledKnownHosts
} from './keys.js';

// 会话加密
export {
  encrypt,
  decrypt,
  generateNonce,
  incrementNonce,
  EncryptedSession,
  StreamEncryptor,
  StreamDecryptor,
  FILE_MESSAGE_TYPE,
  randomBytes,
  constantTimeCompare
} from './session.js';

// 握手协议
export {
  buildHandshakeInit,
  parseHandshakeInit,
  buildHandshakeResponse,
  parseHandshakeResponse,
  buildHandshakeAuth,
  parseHandshakeAuth,
  ClientHandshake,
  ServerHandshake
} from './handshake.js';
