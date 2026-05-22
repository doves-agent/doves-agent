/**
 * 钉钉适配器 - 签名模块
 * 
 * 提供 Webhook 签名验证和签名 URL 生成功能
 */
import crypto from 'crypto';

/**
 * 验证钉钉回调签名
 * 用于验证 Webhook 回调是否来自钉钉
 * @param {string} timestamp - 时间戳
 * @param {string} sign - 签名
 * @param {string} secret - 签名密钥
 * @returns {boolean} 签名是否有效
 */
export function 验证回调签名(timestamp, sign, secret) {
  if (!secret) {
    console.warn('[钉钉适配器] 未配置secret，跳过签名验证');
    return true;
  }

  const stringToSign = `${timestamp}\n${secret}`;
  const computedSign = crypto.createHmac('sha256', secret)
    .update(stringToSign)
    .digest('base64');

  return computedSign === sign;
}

/**
 * 生成带签名的 Webhook URL
 * 钉钉机器人 Webhook 需要签名验证
 * @param {string} webhookUrl - Webhook 地址
 * @param {string} [secret] - 签名密钥（可选）
 * @returns {string} 带签名的 URL
 */
export function 签名URL(webhookUrl, secret) {
  if (!secret) {
    return webhookUrl;
  }

  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = crypto.createHmac('sha256', secret)
    .update(stringToSign)
    .digest('base64');

  // 处理 URL 中已有的参数
  const 分隔符 = webhookUrl.includes('?') ? '&' : '?';
  return `${webhookUrl}${分隔符}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
}
