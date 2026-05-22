/**
 * @file 工具执行/Node执行器
 * @description 进程内直接执行工具（复用现有 tools/index.js 的 处理工具调用）
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('Node执行器', { 前缀: '[NodeExec]', 级别: 'debug' });

/**
 * 在进程内执行工具
 * @param {string} 工具名
 * @param {Object} 参数
 * @param {Object} 上下文 - { onProgress, ... }
 * @returns {Promise<{success: boolean, result: string, error?: string}>}
 */
export async function 执行(工具名, 参数, 上下文 = {}) {
  try {
    const { 处理工具调用 } = await import('../tools/index.js');
    const onProgress = 上下文.onProgress || null;

    const 结果 = await 处理工具调用(工具名, 参数, onProgress);

    // 处理工具调用返回格式：{ content: [{ type: 'text', text: '...' }], isError?: true }
    if (结果.isError) {
      const 错误文本 = 结果.content?.[0]?.text || `工具执行失败: ${工具名}`;
      return { success: false, error: 错误文本, result: 错误文本 };
    }

    const 文本 = 结果.content?.[0]?.text || JSON.stringify(结果);
    return { success: true, result: 文本 };
  } catch (e) {
    logger.error(`Node执行器异常: ${工具名} | ${e.message}`);
    return { success: false, error: e.message, result: `执行失败: ${e.message}` };
  }
}

export const Node执行器 = { 执行 };

export default { Node执行器, 执行 };
