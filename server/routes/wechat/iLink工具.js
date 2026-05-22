/**
 * iLink API 通用工具
 */

const ILINK_BASE = 'https://ilinkai.weixin.qq.com';

/**
 * 生成随机 X-WECHAT-UIN
 */
export function generateUin() {
  const randomVal = Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;
  return Buffer.from(String(randomVal)).toString('base64');
}

/**
 * iLink API 请求（通用，不含 botToken）
 */
export async function ilinkRequest(path, method = 'GET', body = null) {
  const headers = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'X-WECHAT-UIN': generateUin(),
  };

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${ILINK_BASE}${path}`, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`iLink API 错误 (${response.status}): ${text}`);
  }
  return response.json();
}
