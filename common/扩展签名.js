/**
 * @file common/扩展签名
 * @description 扩展包签名机制（Server + Doves 共用）
 *
 * === 签名方案 ===
 * 算法: HMAC-SHA256
 * 签名内容: name + version + JSON.stringify(permissions) 拼接
 * 签名密钥: 开发者注册时获得的 signingKey (dvsk_dev_xxx_secret)
 * 签名格式: hmac-sha256:<hex>
 *
 * === 用途 ===
 * 1. 防篡改：签名覆盖 manifest 的核心声明，任何修改都会导致签名验证失败
 * 2. 来源追溯：签名只能由持有 signingKey 的开发者生成
 * 3. Server 端：验证开发者签名时使用 CONFIG.officialDevSigningKey 验签
 * 4. Doves 端/CLI：生成签名、本地验签
 *
 * 详见: 白鸽文档/dove_apps/接口底座规范.md
 */

import { createHmac } from 'crypto';

// ==================== 核心函数 ====================

/**
 * 计算待签名的 payload
 * 将 manifest 的核心声明字段拼接为确定性字符串
 *
 * @param {Object} manifest - 扩展包 manifest 对象
 * @returns {string} 待签名的字符串
 */
export function computeSignaturePayload(manifest) {
  const name = manifest.name || '';
  const version = manifest.version || '';

  // permissions 需要 deterministic 序列化
  // 先排序 key 再 JSON.stringify，确保签名一致性
  const permissions = deterministicStringify(manifest.permissions || {});

  return `${name}\n${version}\n${permissions}`;
}

/**
 * 对 manifest 进行签名
 *
 * @param {Object} manifest - 扩展包 manifest 对象
 * @param {string} signingKey - 开发者签名密钥 (dvsk_dev_xxx_secret)
 * @returns {string} 签名值，格式: hmac-sha256:<hex>
 */
export function signManifest(manifest, signingKey) {
  const payload = computeSignaturePayload(manifest);
  const hmac = createHmac('sha256', signingKey);
  hmac.update(payload);
  const hex = hmac.digest('hex');
  return `hmac-sha256:${hex}`;
}

/**
 * 验证 manifest 签名
 *
 * @param {Object} manifest - 扩展包 manifest 对象
 * @param {string} signature - 签名值，格式: hmac-sha256:<hex>
 * @param {string} signingKey - 开发者签名密钥
 * @returns {{ valid: boolean, reason?: string }}
 */
export function verifySignature(manifest, signature, signingKey) {
  if (!signature || typeof signature !== 'string') {
    return { valid: false, reason: '签名为空或格式无效' };
  }

  const sigMatch = signature.match(/^hmac-sha256:([a-f0-9]+)$/);
  if (!sigMatch) {
    return { valid: false, reason: '签名格式无效，应为 hmac-sha256:<hex>' };
  }

  if (!signingKey) {
    return { valid: false, reason: '缺少签名密钥' };
  }

  const expectedSignature = signManifest(manifest, signingKey);
  const expectedHex = expectedSignature.replace('hmac-sha256:', '');

  if (sigMatch[1] === expectedHex) {
    return { valid: true };
  }

  return { valid: false, reason: '签名验证失败，manifest 可能已被修改' };
}

// ==================== 内部工具 ====================

/**
 * 确定性 JSON 序列化
 * 按 key 排序，确保相同对象总是生成相同字符串
 *
 * @param {*} obj - 待序列化的对象
 * @param {number} depth - 递归深度限制
 * @returns {string}
 */
function deterministicStringify(obj, depth = 0) {
  if (depth > 10) return '...';
  if (obj === null) return 'null';
  if (obj === undefined) return 'undefined';

  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    const items = obj.map(item => deterministicStringify(item, depth + 1));
    return `[${items.join(',')}]`;
  }

  // 按 key 排序后拼接
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(key => {
    const value = deterministicStringify(obj[key], depth + 1);
    return `${JSON.stringify(key)}:${value}`;
  });
  return `{${pairs.join(',')}}`;
}
