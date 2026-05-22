/**
 * 白鸽加密通讯 - 密钥管理
 * 
 * 使用 tweetnacl 实现：
 * - Ed25519: 签名密钥对
 * - X25519: DH 密钥交换
 * - ChaCha20-Poly1305: 对称加密
 * 
 * 使用 blakejs 实现：
 * - BLAKE2b: 密钥派生
 */

import nacl from 'tweetnacl';
import { blake2b } from 'blakejs';
import { KEY_LENGTH } from './protocol.js';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { toLocalISOString } from '../时间工具.js';

// ==================== 密钥生成 ====================

/**
 * 生成 Ed25519 签名密钥对
 * 用于长期身份验证
 * @returns {{ publicKey: Uint8Array, secretKey: Uint8Array }}
 */
export function generateSigningKeyPair() {
  const keyPair = nacl.sign.keyPair();
  return {
    publicKey: keyPair.publicKey,
    secretKey: keyPair.secretKey
  };
}

/**
 * 生成 X25519 临时密钥对
 * 用于 DH 密钥交换
 * @returns {{ publicKey: Uint8Array, secretKey: Uint8Array }}
 */
export function generateEphemeralKeyPair() {
  const keyPair = nacl.box.keyPair();
  return {
    publicKey: keyPair.publicKey,
    secretKey: keyPair.secretKey
  };
}

/**
 * 从 Ed25519 密钥对转换到 X25519 密钥对
 * 这样可以用一个密钥对同时用于签名和加密
 * @param {Uint8Array} ed25519Public 
 * @param {Uint8Array} ed25519Secret 
 * @returns {{ publicKey: Uint8Array, secretKey: Uint8Array }}
 */
export function convertEd25519ToX25519(ed25519Public, ed25519Secret) {
  const publicKey = nacl.sign.convertPublicKey(ed25519Public);
  const secretKey = nacl.sign.convertSecretKey(ed25519Secret);
  return { publicKey, secretKey };
}

// ==================== DH 密钥交换 ====================

/**
 * X25519 DH 计算共享密钥
 * @param {Uint8Array} mySecretKey - 我的 X25519 私钥
 * @param {Uint8Array} theirPublicKey - 对方的 X25519 公钥
 * @returns {Uint8Array} 共享密钥
 */
export function computeSharedSecret(mySecretKey, theirPublicKey) {
  return nacl.scalarMult(mySecretKey, theirPublicKey);
}

// ==================== 密钥派生 ====================

/**
 * 使用 BLAKE2b 派生会话密钥
 * @param {Uint8Array} sharedSecret - DH 共享密钥
 * @param {object} context - 派生上下文
 * @param {Uint8Array} context.clientEphemeralPub - 客户端临时公钥
 * @param {Uint8Array} context.serverEphemeralPub - 服务端临时公钥
 * @param {string} context.purpose - 用途标识
 * @returns {{ encryptionKey: Uint8Array, decryptionKey: Uint8Array, noncePrefix: Uint8Array }}
 */
export function deriveSessionKeys(sharedSecret, context) {
  // 构建派生信息
  const info = Buffer.concat([
    context.clientEphemeralPub,
    context.serverEphemeralPub,
    Buffer.from(context.purpose, 'utf-8')
  ]);
  
  // 派生发送密钥
  const encryptionKey = blake2b(
    Buffer.concat([sharedSecret, info, Buffer.from('encrypt', 'utf-8')]),
    null, // key
    KEY_LENGTH.SESSION_KEY
  );
  
  // 派生接收密钥
  const decryptionKey = blake2b(
    Buffer.concat([sharedSecret, info, Buffer.from('decrypt', 'utf-8')]),
    null,
    KEY_LENGTH.SESSION_KEY
  );
  
  // 派生 nonce 前缀（双方必须相同，从共享密钥确定性派生）
  const noncePrefix = new Uint8Array(blake2b(
    Buffer.concat([sharedSecret, info, Buffer.from('nonce', 'utf-8')]),
    null,
    8
  ));
  
  return { encryptionKey, decryptionKey, noncePrefix };
}

/**
 * 派生多个密钥
 * @param {Uint8Array} sharedSecret 
 * @param {Uint8Array[]} contextData 
 * @param {number} numKeys 
 * @returns {Uint8Array[]}
 */
export function deriveMultipleKeys(sharedSecret, contextData, numKeys) {
  const keys = [];
  for (let i = 0; i < numKeys; i++) {
    const key = blake2b(
      Buffer.concat([sharedSecret, ...contextData, Buffer.from([i])]),
      null,
      KEY_LENGTH.SESSION_KEY
    );
    keys.push(key);
  }
  return keys;
}

// ==================== 签名与验证 ====================

/**
 * Ed25519 签名
 * @param {Uint8Array} message - 待签名消息
 * @param {Uint8Array} secretKey - Ed25519 私钥
 * @returns {Uint8Array} 签名
 */
export function sign(message, secretKey) {
  return nacl.sign.detached(message, secretKey);
}

/**
 * Ed25519 签名验证
 * @param {Uint8Array} message - 消息
 * @param {Uint8Array} signature - 签名
 * @param {Uint8Array} publicKey - Ed25519 公钥
 * @returns {boolean}
 */
export function verifySignature(message, signature, publicKey) {
  return nacl.sign.detached.verify(message, signature, publicKey);
}

// ==================== 密钥存储 ====================

const DOVE_DIR = join(homedir(), '.dove');

/**
 * 确保目录存在
 */
async function ensureDir() {
  await fs.mkdir(DOVE_DIR, { recursive: true });
}

/**
 * 获取密钥文件路径
 * @param {string} name - 密钥名称
 * @returns {string}
 */
export function getKeyPath(name) {
  return join(DOVE_DIR, `${name}_keys.json`);
}

/**
 * 保存密钥对到文件
 * @param {string} name - 密钥名称 (server/cli/dove_xxx)
 * @param {object} keyPair - 密钥对
 * @param {Uint8Array} keyPair.publicKey
 * @param {Uint8Array} keyPair.secretKey
 */
export async function saveKeyPair(name, keyPair) {
  await ensureDir();
  const data = {
    publicKey: Buffer.from(keyPair.publicKey).toString('base64'),
    secretKey: Buffer.from(keyPair.secretKey).toString('base64'),
    createdAt: toLocalISOString()
  };
  await fs.writeFile(getKeyPath(name), JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 从文件加载密钥对
 * @param {string} name - 密钥名称
 * @returns {Promise<{ publicKey: Uint8Array, secretKey: Uint8Array, createdAt: string } | null>}
 */
export async function loadKeyPair(name) {
  try {
    const content = await fs.readFile(getKeyPath(name), 'utf-8');
    const data = JSON.parse(content);
    return {
      publicKey: Buffer.from(data.publicKey, 'base64'),
      secretKey: Buffer.from(data.secretKey, 'base64'),
      createdAt: data.createdAt
    };
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    console.error(`[密钥管理] 加载密钥文件失败 (${name}):`, e.message);
    throw e;
  }
}

/**
 * 获取或创建密钥对
 * @param {string} name - 密钥名称
 * @returns {Promise<{ publicKey: Uint8Array, secretKey: Uint8Array, isNew: boolean }>}
 */
export async function getOrCreateKeyPair(name) {
  const existing = await loadKeyPair(name);
  if (existing) {
    return { ...existing, isNew: false };
  }
  
  const keyPair = generateSigningKeyPair();
  await saveKeyPair(name, keyPair);
  return { ...keyPair, isNew: true };
}

// ==================== 已知主机管理 ====================

const KNOWN_HOSTS_PATH = join(DOVE_DIR, 'known_hosts');

/**
 * 获取预置 known_hosts 文件路径
 * 优先级：
 *   1. 环境变量 DOVE_KNOWN_HOSTS_FILE
 *   2. 发布包内默认路径（与 doves 入口同目录的 known_hosts）
 * 
 * 官方发布包在构建时将官方 Server 公钥指纹写入此文件，
 * 用户连接官方服务器时无需 TOFU，直接比对指纹。
 * @returns {string|null} 预置文件路径，不存在则返回 null
 */
function getBundledKnownHostsPath() {
  // 环境变量优先
  if (process.env.DOVE_KNOWN_HOSTS_FILE) {
    return process.env.DOVE_KNOWN_HOSTS_FILE;
  }
  // 尝试发布包默认路径
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    // common/crypto/keys.js → 回到白鸽系统根目录
    const dovesRoot = join(moduleDir, '..', '..');
    return join(dovesRoot, 'known_hosts');
  } catch {
    return null;
  }
}

/**
 * 加载预置 known_hosts（发布包内嵌的官方服务器公钥指纹）
 * @returns {Promise<Map<string, string>>} hostname -> fingerprint
 */
export async function loadBundledKnownHosts() {
  const path = getBundledKnownHostsPath();
  if (!path) return new Map();
  try {
    const content = await fs.readFile(path, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    const map = new Map();
    for (const line of lines) {
      const [host, fingerprint] = line.split(' ');
      if (host && fingerprint) {
        map.set(host, fingerprint);
      }
    }
    return map;
  } catch (e) {
    if (e.code === 'ENOENT') return new Map();
    console.error('[密钥管理] 加载预置 known_hosts 失败:', e.message);
    return new Map();
  }
}

/**
 * 获取服务端公钥指纹
 * @param {Uint8Array} publicKey 
 * @returns {string} SHA256 指纹
 */
export function getPublicKeyFingerprint(publicKey) {
  const hash = nacl.hash(publicKey);
  return Buffer.from(hash.slice(0, 32)).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * 加载已知主机
 * @returns {Promise<Map<string, string>>} hostname -> fingerprint
 */
export async function loadKnownHosts() {
  try {
    const content = await fs.readFile(KNOWN_HOSTS_PATH, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    const map = new Map();
    for (const line of lines) {
      const [host, fingerprint] = line.split(' ');
      if (host && fingerprint) {
        map.set(host, fingerprint);
      }
    }
    return map;
  } catch (e) {
    if (e.code === 'ENOENT') return new Map();
    console.error('[密钥管理] 加载 known_hosts 失败:', e.message);
    throw e;
  }
}

/**
 * 保存已知主机
 * @param {Map<string, string>} knownHosts 
 */
export async function saveKnownHosts(knownHosts) {
  await ensureDir();
  const lines = ['# Dove known hosts', '# format: hostname fingerprint'];
  for (const [host, fingerprint] of knownHosts) {
    lines.push(`${host} ${fingerprint}`);
  }
  await fs.writeFile(KNOWN_HOSTS_PATH, lines.join('\n') + '\n', 'utf-8');
}

/**
 * 添加已知主机
 * @param {string} hostname 
 * @param {Uint8Array} publicKey 
 */
export async function addKnownHost(hostname, publicKey) {
  const knownHosts = await loadKnownHosts();
  const fingerprint = getPublicKeyFingerprint(publicKey);
  knownHosts.set(hostname, fingerprint);
  await saveKnownHosts(knownHosts);
}

/**
 * 验证已知主机
 * 先查用户本地 known_hosts，再查预置（官方打包）known_hosts
 * 预置中的主机首次匹配时自动写入本地 known_hosts，后续不再检查预置文件
 * @param {string} hostname 
 * @param {Uint8Array} publicKey 
 * @returns {Promise<'known'|'new'|'mismatch'>}
 */
export async function verifyKnownHost(hostname, publicKey) {
  const knownHosts = await loadKnownHosts();
  const fingerprint = getPublicKeyFingerprint(publicKey);
  
  const existing = knownHosts.get(hostname);
  if (existing) {
    return existing === fingerprint ? 'known' : 'mismatch';
  }

  // 本地无记录，检查预置 known_hosts（官方发布包内嵌的指纹）
  const bundled = await loadBundledKnownHosts();
  const bundledFingerprint = bundled.get(hostname);
  if (bundledFingerprint) {
    if (bundledFingerprint === fingerprint) {
      // 预置指纹匹配，自动写入本地 known_hosts，后续无需再检查预置文件
      await addKnownHost(hostname, publicKey);
      return 'known';
    }
    // 预置指纹不匹配 → 可能存在中间人攻击
    return 'mismatch';
  }
  
  return 'new';
}
