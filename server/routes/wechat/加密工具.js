/**
 * 微信通道加密工具
 * botToken 加密/解密，使用 AES-256-GCM
 */

import crypto from 'crypto';
import { CONFIG, logger } from '../../core.js';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * 从 JWT_SECRET 派生加密密钥
 * 确保每次服务端重启使用同一密钥
 */
export function getEncryptionKey() {
  return crypto.scryptSync(CONFIG.jwtSecret, 'dove-wechat-salt', KEY_LENGTH);
}

/**
 * 加密 botToken
 * @param {string} plaintext - 明文 botToken
 * @returns {string} 加密后的字符串 (iv:authTag:ciphertext 的 hex)
 */
export function encryptToken(plaintext) {
  if (!plaintext) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  // 格式: iv:authTag:ciphertext (均为 hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * 解密 botToken
 * @param {string} encryptedStr - 加密字符串
 * @returns {string} 明文 botToken
 */
export function decryptToken(encryptedStr) {
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
    logger.error('解密 botToken 失败:', e.message);
    return '';
  }
}
