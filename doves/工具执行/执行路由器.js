/**
 * @file 工具执行/执行路由器
 * @description KISS 架构：根据工具的"运行时"字段将调用分发到对应执行适配器
 * 
 * 支持的运行时类型：
 * - node: 进程内直接调用（现有 tools/index.js 的 处理工具调用）
 * - http: POST 到外部 HTTP 服务
 * - docker: docker run --rm 执行容器命令（预留）
 * - mcp: 通过 MCP 协议连接外部工具服务（预留）
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('执行路由器', { 前缀: '[执行路由]', 级别: 'debug' });

/**
 * 执行路由器
 * @param {string} 工具名 - 工具名称
 * @param {Object} 参数 - 工具参数
 * @param {Object} 上下文 - 执行上下文（含工具定义、DovesProxy 等）
 * @returns {Promise<Object>} { success, result } 
 */
export async function 执行工具调用(工具名, 参数, 上下文 = {}) {
  const 工具定义 = 上下文.工具定义 || await _查找工具定义(工具名);
  const 运行时 = 工具定义?.运行时 || 'node';

  logger.debug(`执行: ${工具名} (运行时: ${运行时})`);

  switch (运行时) {
    case 'node': {
      const { Node执行器 } = await import('./Node执行器.js');
      return Node执行器.执行(工具名, 参数, 上下文);
    }
    case 'http': {
      const { HTTP执行器 } = await import('./HTTP执行器.js');
      return HTTP执行器.执行(工具名, 参数, 工具定义, 上下文);
    }
    case 'docker':
      // 预留：Docker 执行器
      throw new Error(`Docker 运行时暂未实现: ${工具名}`);
    case 'mcp':
      // 预留：MCP 执行器
      throw new Error(`MCP 运行时暂未实现: ${工具名}`);
    default:
      throw new Error(`未知运行时类型: ${运行时}，工具: ${工具名}`);
  }
}

/**
 * 从 tools/index.js 查找工具定义
 * @param {string} 工具名
 * @returns {Promise<Object|null>}
 */
async function _查找工具定义(工具名) {
  try {
    const { 获取所有工具定义 } = await import('../tools/index.js');
    const 所有工具 = 获取所有工具定义();
    return 所有工具.find(t => t.name === 工具名) || null;
  } catch (e) {
    logger.warn(`查找工具定义失败: ${e.message}`);
    return null;
  }
}

export default { 执行工具调用 };
