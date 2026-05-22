/**
 * @file providers/Token统计
 * @description Token 统计器、fetch 重试工具、创建客户端工厂函数
 * @generated 由 providers/index.js 拆分，KISS 原则
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('Token统计', { 前缀: '[Token统计]', 级别: 'debug', 显示调用位置: true });

/**
 * 带指数退避的 fetch 重试
 * 遇到 429/503/502/网络错误时自动重试，最多 maxRetries 次
 * @param {string} url - 请求 URL
 * @param {Object} fetchOptions - fetch 参数
 * @param {Object} 选项 - { maxRetries=3, baseDelay=1000, logContext='' }
 * @returns {Promise<Response>} fetch Response
 */
export async function fetchWithRetry(url, fetchOptions, 选项 = {}) {
  const { maxRetries = 3, baseDelay = 1000, logContext = '', signal } = 选项;
  let lastError = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // 检查中止信号：如果已中止则不再重试
    if (signal?.aborted) {
      const abortError = new Error('请求已被中止');
      abortError.name = 'AbortError';
      throw abortError;
    }
    
    try {
      // 将 signal 传递给 fetch，让它可以在等待响应时被中断
      const 响应 = await fetch(url, { ...fetchOptions, signal });
      
      // 可重试的 HTTP 状态码
      // 500: 百炼有时用 HTTP 500 封装 503 InternalError，body 含 <503> 字样
      if (响应.status === 429 || 响应.status === 500 || 响应.status === 502 || 响应.status === 503 || 响应.status === 504) {
        const 错误文本 = await 响应.text();
        lastError = new Error(`HTTP ${响应.status}: ${错误文本.slice(0, 200)}`);
        lastError.status = 响应.status;
        lastError.body = 错误文本;
        
        if (attempt < maxRetries) {
          // 指数退避 + 随机抖动：1s, 2s, 4s...
          const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
          logger.warn(`LLM重试 ${logContext} HTTP ${响应.status}，第${attempt + 1}/${maxRetries}次重试，等待${Math.round(delay)}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        // 重试用完，返回最后一次的响应信息（通过 lastError 传递）
        const errorResp = {
          ok: false,
          status: 响应.status,
          text: () => Promise.resolve(错误文本),
          json: () => Promise.resolve({}),
          _retryExhausted: true
        };
        return errorResp;
      }
      
      // 成功或其他错误，直接返回
      return 响应;
      
    } catch (网络错误) {
      lastError = 网络错误;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 500;
        logger.warn(`LLM重试 ${logContext} 网络错误: ${网络错误.message}，第${attempt + 1}/${maxRetries}次重试，等待${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw 网络错误; // 重试用完，抛出
    }
  }
  throw lastError;
}

/**
 * Token 统计器
 */
export class Token统计器 {
  constructor() {
    this.统计 = new Map();
  }

  /**
   * 记录 Token 使用
   * @param {string} 任务ID - 任务ID
   * @param {string} 提供商 - 提供商名称
   * @param {string} 模型 - 模型名称
   * @param {Object} token数 - { 输入, 输出 }
   */
  记录(任务ID, 提供商, 模型, token数) {
    logger.debug(`任务 ${任务ID}: 输入 ${token数.输入}, 输出 ${token数.输出}`);

    if (!this.统计.has(任务ID)) {
      this.统计.set(任务ID, {
        总输入: 0,
        总输出: 0,
        调用次数: 0,
        明细: []
      });
    }

    const 记录 = this.统计.get(任务ID);
    记录.总输入 += token数.输入;
    记录.总输出 += token数.输出;
    记录.调用次数++;
    记录.明细.push({ 提供商, 模型, ...token数, 时间: new Date() });
  }

  /**
   * 获取任务 Token 统计
   * @param {string} 任务ID - 任务ID
   * @returns {Object} Token 统计
   */
  获取统计(任务ID) {
    return this.统计.get(任务ID) || { 总输入: 0, 总输出: 0, 调用次数: 0 };
  }

  /**
   * 获取全局统计
   * @returns {Object} 全局统计
   */
  获取全局统计() {
    let 总输入 = 0;
    let 总输出 = 0;
    let 总调用次数 = 0;

    for (const 记录 of this.统计.values()) {
      总输入 += 记录.总输入;
      总输出 += 记录.总输出;
      总调用次数 += 记录.调用次数;
    }

    return { 总输入, 总输出, 总调用次数 };
  }
}
