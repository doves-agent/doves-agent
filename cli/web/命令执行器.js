/**
 * 命令执行器
 * 所有 Web 端命令统一通过加密通道发送到 Server
 * 每次执行自动记录到执行日志
 */

import { CryptoClient } from '@dove/common/crypto/加密客户端.js';
import { loadConfig } from '../lib/config.js';
import { 记录执行, 更新执行 } from './执行日志.js';

let cryptoClient = null;
let clientId = null;

export async function 初始化(options = {}) {
  if (cryptoClient?.connected) return;

  const config = loadConfig();
  const url = new URL(config.gateway || 'http://localhost:3003');

  const { 获取或生成机器标识, 生成分组标识 } = await import('../lib/machine-id.js');
  const machineId = 获取或生成机器标识();
  clientId = 生成分组标识(machineId, 'cli', 0);

  cryptoClient = new CryptoClient({
    hostname: url.hostname,
    clientId
  });

  await cryptoClient.connect();
}

export function 已连接() {
  return cryptoClient?.connected === true;
}

export async function 断开() {
  if (cryptoClient?.connected) {
    cryptoClient.close('web_shutdown');
    cryptoClient = null;
  }
}

/**
 * 执行命令（统一入口）
 * @param {string} method - HTTP 方法
 * @param {string} path - API 路径
 * @param {object} body - 请求体
 * @param {object} meta - 元信息 { source, command }
 * @returns {Promise<object>} - { success, data, error? }
 */
export async function 执行(method, path, body = null, meta = {}) {
  if (!cryptoClient?.connected) {
    throw new Error('加密通道未连接，请先调用 初始化()');
  }

  const config = loadConfig();
  const enrichedBody = body ? { ...body } : {};
  if (config.token) enrichedBody.apiKey = config.token;

  const isLocal = /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(
    config.gateway || ''
  );
  enrichedBody.channel = isLocal ? 'local' : 'remote';

  const logEntry = 记录执行({
    command: meta.command || `${method} ${path}`,
    source: meta.source || 'unknown',
    request: { method, path, body }
  });

  const startTime = Date.now();

  try {
    const result = await cryptoClient.request(method, path, enrichedBody);
    const duration = Date.now() - startTime;

    if (result.error || result.success === false) {
      更新执行(logEntry.id, {
        duration,
        success: false,
        response: { error: result.error || '请求失败' }
      });
      return { success: false, error: result.error || '请求失败', data: null };
    }

    更新执行(logEntry.id, {
      duration,
      success: true,
      response: { data: 截断响应(result.data) }
    });

    return { success: true, data: result.data, error: null };
  } catch (err) {
    const duration = Date.now() - startTime;
    更新执行(logEntry.id, {
      duration,
      success: false,
      response: { error: err.message }
    });
    return { success: false, error: err.message, data: null };
  }
}

/**
 * 便捷方法
 */
export async function get(path, params = {}, meta = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  }
  const queryStr = query.toString();
  const fullPath = `${path}${queryStr ? '?' + queryStr : ''}`;
  return 执行('GET', fullPath, null, meta);
}

export async function post(path, body = {}, meta = {}) {
  return 执行('POST', path, body, meta);
}

export async function put(path, body = {}, meta = {}) {
  return 执行('PUT', path, body, meta);
}

export async function del(path, body = null, meta = {}) {
  return 执行('DELETE', path, body, meta);
}

function 截断响应(data) {
  if (!data) return data;
  const str = JSON.stringify(data);
  if (str.length > 2000) {
    return { _truncated: true, _preview: str.slice(0, 500) + '...' };
  }
  return data;
}
