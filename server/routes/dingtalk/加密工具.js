/**
 * 钉钉加密工具
 * 从 dingtalk.js 提取
 */

import crypto from 'crypto';
import { CONFIG, logger } from '../../core.js';

// ==================== 常量 ====================

export const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
export const KEY_LENGTH = 32;
export const IV_LENGTH = 16;
export const AUTH_TAG_LENGTH = 16;
export const SESSION_TOKEN_TTL = 2 * 60 * 60 * 1000;

// 内存中的会话令牌缓存
export const sessionCache = new Map();

// 定期清理过期会话
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of sessionCache) {
    if (val.expiresAt < now) sessionCache.delete(key);
  }
}, 5 * 60 * 1000);

// ==================== 加密函数 ====================

export function getEncryptionKey() {
  return crypto.scryptSync(CONFIG.jwtSecret, 'dove-dingtalk-salt', KEY_LENGTH);
}

export function encryptSecret(plaintext) {
  if (!plaintext) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decryptSecret(encryptedStr) {
  if (!encryptedStr) return '';
  try {
    const key = getEncryptionKey();
    const parts = encryptedStr.split(':');
    if (parts.length !== 3) throw new Error('加密格式无效');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    logger.error('解密钉钉 appSecret 失败:', e.message);
    return '';
  }
}
