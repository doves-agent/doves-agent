/**
 * @file 工具执行/HTTP执行器
 * @description 通过 HTTP POST 调用外部服务执行工具（如远程浏览器、Python 环境等）
 * 
 * 工具定义需包含：
 * - 运行时: 'http'
 * - http端点: 外部服务的完整 URL
 * - http超时: 超时毫秒数（可选，默认 30000）
 * - http头: 额外请求头（可选）
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('HTTP执行器', { 前缀: '[HTTPExec]', 级别: 'debug' });

/**
 * 通过 HTTP 调用外部工具服务
 * @param {string} 工具名 - 工具名称
 * @param {Object} 参数 - 工具参数
 * @param {Object} 工具定义 - 需包含 http端点 字段
 * @param {Object} 上下文 - 执行上下文（DovesProxy 等）
 * @returns {Promise<{success: boolean, result: string, error?: string}>}
 */
export async function 执行(工具名, 参数, 工具定义 = {}, 上下文 = {}) {
  const 端点 = 工具定义.http端点;
  if (!端点) {
    return { success: false, error: `工具「${工具名}」缺少 http端点 配置`, result: '' };
  }

  logger.debug(`HTTP调用: ${工具名} → ${端点}`);

  try {
    const 超时 = 工具定义.http超时 || 30000;
    const 响应 = await fetch(端点, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Dove/3.0',
        ...(工具定义.http头 || {}),
      },
      body: JSON.stringify({
        工具名,
        参数,
        上下文: {
          任务ID: 上下文.任务ID,
          // 不传递 DovesProxy 实例，外部服务通过自己的方式通信
        },
      }),
      signal: AbortSignal.timeout(超时),
    });

    if (!响应.ok) {
      const 错误文本 = await 响应.text();
      logger.warn(`HTTP ${响应.status}: ${错误文本.substring(0, 200)}`);
      return { success: false, error: `HTTP ${响应.status}: ${错误文本.substring(0, 500)}`, result: '' };
    }

    const 数据 = await 响应.json();

    // 兼容外部服务返回的标准格式
    if (数据.success !== undefined) {
      return { success: 数据.success, result: 数据.result || '', error: 数据.error };
    }

    // 非标准格式，将整个响应作为结果
    return { success: true, result: JSON.stringify(数据) };
  } catch (e) {
    logger.error(`HTTP执行器异常: ${工具名} → ${e.message}`);
    return { success: false, error: e.message, result: '' };
  }
}

export const HTTP执行器 = { 执行 };

export default { HTTP执行器, 执行 };
