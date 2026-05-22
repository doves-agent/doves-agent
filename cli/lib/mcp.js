/**
 * MCP 管理 API 客户端
 * 
 * 提供MCP配置管理的API调用方法：
 * - 列出/添加/删除MCP Server
 * - 启用/禁用MCP Server
 * - 测试连接
 * - 刷新能力发现
 */

import { UserClient } from './user.js';

/**
 * MCP管理客户端
 * 继承UserClient，添加MCP相关方法
 */
export class MCPClient extends UserClient {
  // ==================== MCP配置管理 ====================

  /**
   * 获取鸽子的MCP配置列表
   * @param {string} doveId - 鸽子ID
   * @returns {Object} MCP配置
   */
  async getMCPConfig(doveId) {
    await this.ensureAuth();
    return await this.get(`/api/dove/${doveId}/mcp`);
  }

  /**
   * 添加MCP Server
   * @param {string} doveId - 鸽子ID
   * @param {Object} 配置 - MCP Server配置
   * @param {string} 配置.名称 - 连接名称
   * @param {string} 配置.类型 - 类型: stdio | http | sse
   * @param {string} [配置.command] - stdio时：命令
   * @param {string[]} [配置.args] - stdio时：参数
   * @param {string} [配置.url] - http/sse时：URL
   * @param {Object} [配置.env] - 环境变量
   * @param {string} [配置.cwd] - 工作目录
   * @param {Object} [配置.headers] - HTTP头
   * @returns {Object} 添加结果
   */
  async addMCPServer(doveId, 配置) {
    await this.ensureAuth();
    return await this.post(`/api/dove/${doveId}/mcp`, 配置);
  }

  /**
   * 删除MCP Server
   * @param {string} doveId - 鸽子ID
   * @param {string} 名称 - MCP Server名称
   * @returns {Object} 删除结果
   */
  async removeMCPServer(doveId, 名称) {
    await this.ensureAuth();
    return await this._apiRequest('DELETE', `/api/dove/${doveId}/mcp/${encodeURIComponent(名称)}`);
  }

  /**
   * 启用MCP Server
   * @param {string} doveId - 鸽子ID
   * @param {string} 名称 - MCP Server名称
   * @returns {Object} 结果
   */
  async enableMCPServer(doveId, 名称) {
    await this.ensureAuth();
    return await this.post(`/api/dove/${doveId}/mcp/${encodeURIComponent(名称)}/enable`);
  }

  /**
   * 禁用MCP Server
   * @param {string} doveId - 鸽子ID
   * @param {string} 名称 - MCP Server名称
   * @returns {Object} 结果
   */
  async disableMCPServer(doveId, 名称) {
    await this.ensureAuth();
    return await this.post(`/api/dove/${doveId}/mcp/${encodeURIComponent(名称)}/disable`);
  }

  /**
   * 测试MCP Server连接
   * @param {string} doveId - 鸽子ID
   * @param {string} 名称 - MCP Server名称
   * @returns {Object} 测试结果 { success, tools, error }
   */
  async testMCPServer(doveId, 名称) {
    await this.ensureAuth();
    return await this.post(`/api/dove/${doveId}/mcp/${encodeURIComponent(名称)}/test`);
  }

  /**
   * 刷新MCP能力发现
   * @param {string} doveId - 鸽子ID
   * @returns {Object} 刷新结果
   */
  async refreshMCPCapabilities(doveId) {
    await this.ensureAuth();
    return await this.post(`/api/dove/${doveId}/mcp/refresh`);
  }

  /**
   * 获取MCP Server工具详情
   * @param {string} doveId - 鸽子ID
   * @param {string} 名称 - MCP Server名称
   * @returns {Object} 工具列表
   */
  async getMCPServerTools(doveId, 名称) {
    await this.ensureAuth();
    return await this.get(`/api/dove/${doveId}/mcp/${encodeURIComponent(名称)}/tools`);
  }

  // ==================== 当前鸽子管理 ====================

  /**
   * 设置当前操作的鸽子
   * @param {string} doveId - 鸽子ID
   */
  setCurrentDove(doveId) {
    this.config.currentDoveId = doveId;
    this.saveConfig();
  }

  /**
   * 获取当前鸽子ID
   * @returns {string|null}
   */
  getCurrentDove() {
    return this.config.currentDoveId || null;
  }

  /**
   * 清除当前鸽子选择
   */
  clearCurrentDove() {
    delete this.config.currentDoveId;
    this.saveConfig();
  }
}

export default MCPClient;
