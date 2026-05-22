/**
 * 白鸽加密通讯协议常量
 * 
 * 类似 SSH/Noise Protocol 的加密通讯
 */

// 协议版本
export const PROTOCOL_VERSION = 'DOVE-1.0';

// 协议魔数（用于识别加密协议）
export const PROTOCOL_MAGIC = Buffer.from('DOVE', 'utf-8');

// 密钥长度（字节）
export const KEY_LENGTH = {
  ED25519_PUBLIC: 32,
  ED25519_SECRET: 64,  // 32 字节种子 + 32 字节公钥
  X25519_PUBLIC: 32,
  X25519_SECRET: 32,
  SHARED_SECRET: 32,
  SESSION_KEY: 32,
  NONCE: 24,
  MAC: 16  // Poly1305 认证码
};

// 握手阶段
export const HANDSHAKE_PHASE = {
  INIT: 'init',           // 客户端初始化
  SERVER_RESPONSE: 'server_response',  // 服务端响应
  CLIENT_AUTH: 'client_auth',  // 客户端认证
  ESTABLISHED: 'established'   // 握手完成
};

// 消息类型
export const MESSAGE_TYPE = {
  HANDSHAKE_INIT: 0x01,
  HANDSHAKE_RESPONSE: 0x02,
  HANDSHAKE_AUTH: 0x03,
  HANDSHAKE_DONE: 0x04,
  DATA: 0x10,
  PING: 0x20,
  PONG: 0x21,
  CLOSE: 0x30,
  ERROR: 0xFF
};

// 错误码
export const ERROR_CODE = {
  INVALID_PROTOCOL: 1,
  HANDSHAKE_FAILED: 2,
  AUTH_FAILED: 3,
  DECRYPT_FAILED: 4,
  TIMEOUT: 5,
  UNKNOWN_HOST: 6,
  HOST_KEY_MISMATCH: 7
};

// 默认超时（毫秒）
export const DEFAULT_TIMEOUT = {
  HANDSHAKE: 30000,  // 握手超时
  REQUEST: 60000,    // 请求超时
  IDLE: 300000       // 空闲超时
};

// 默认端口（唯一对外端口，Noise NX 加密 TCP）
export const DEFAULT_PORT = {
  ENCRYPTED: 3003
};
