/**
 * @file MCP配置管理器
 * @description 管理 MCP Server 配置、连接测试与工具发现
 * 
 * 架构说明：
 * - 底层传输层复用 tools/mcp客户端.js 的 mcpConnectionManager
 * - 本模块专注于配置管理和能力推断业务逻辑
 * 
 * 数据结构：
 * MCP配置: {
 *   servers: [{
 *     名称: string,
 *     类型: 'stdio' | 'http' | 'sse',
 *     command: string,      // stdio时
 *     args: string[],       // stdio时
 *     url: string,          // http/sse时
 *     headers: object,      // http时可选
 *     env: object,          // 环境变量
 *     cwd: string,          // 工作目录
 *     启用: boolean,
 *     工具列表: array,
 *     连接状态: string,
 *     最后连接时间: string
 *   }]
 * }
 */

import { EventEmitter } from 'events';
import { createTimestampFields } from '@dove/common/时间工具.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';
// 复用底层 MCP 连接管理器
import { mcpConnectionManager } from './tools/mcp客户端.js';

const logger = 创建日志器('MCP配置', { 前缀: '[MCP配置管理器]', 级别: 'debug', 显示调用位置: true });

/**
 * MCP配置管理器类
 * 复用 mcpConnectionManager 的连接管理能力，专注于配置和业务逻辑
 */
export class MCP配置管理器 extends EventEmitter {
  constructor() {
    super();
    // 不再维护独立的 connections Map，直接使用 mcpConnectionManager
    // 这个 Map 仅用于缓存中文配置到英文配置的映射
    this._configCache = new Map();
    
    // 订阅底层连接事件
    this._setupEventForwarding();
  }

  /**
   * 设置事件转发：将底层连接事件转发到本模块
   * @private
   */
  _setupEventForwarding() {
    mcpConnectionManager.on('connected', ({ name, toolCount }) => {
      this.emit('connected', { 名称: name, toolCount });
    });
    
    mcpConnectionManager.on('disconnected', ({ name }) => {
      this.emit('disconnected', { 名称: name });
    });
  }

  /**
   * 将中文配置转换为 mcpConnectionManager 需要的英文配置格式
   * @private
   */
  _转换配置格式(配置) {
    const { url, headers = {} } = 配置;
      
    return {
      type: 'http',
      url,
      headers
    };
  }
  
  /**
   * 测试MCP Server连接
   * @param {Object} 配置 - MCP配置
   * @returns {Object} 测试结果 { success, tools, error }
   */
  async 测试连接(配置) {
    if (!配置.url) {
      return { success: false, error: '缺少 url 参数' };
    }
  
    try {
      // 生成临时连接名
      const tempName = `_test_${Date.now()}`;
      const 英文配置 = this._转换配置格式(配置);
        
      // 连接并获取工具列表
      const connection = await mcpConnectionManager.connect(tempName, 英文配置);
      const tools = connection.tools || [];
        
      // 断开测试连接
      await mcpConnectionManager.disconnect(tempName);
        
      return {
        success: true,
        tools,
        toolCount: tools.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 连接到MCP Server并保持连接
   * @param {string} 名称 - 连接名称
   * @param {Object} 配置 - MCP配置
   * @returns {Object} 连接结果
   */
  async 连接(名称, 配置) {
    // 如果已存在活跃连接，跳过重复连接（同一进程内多鸽子共享连接）
    const existing = mcpConnectionManager.getConnection(名称);
    if (existing?.connected) {
      logger.info(`连接已存在，跳过: ${名称} (${existing.tools.length} 个工具)`);
      // 缓存配置（确保新实例也能找到类型信息）
      this._configCache.set(名称, 配置);
      return {
        success: true,
        tools: existing.tools,
        toolCount: existing.tools.length
      };
    }
    
    // 如果存在但未连接，先断开旧连接
    if (existing) {
      await mcpConnectionManager.disconnect(名称);
    }
    
    try {
      const 英文配置 = this._转换配置格式(配置);
      
      // 委托给底层连接管理器
      const connection = await mcpConnectionManager.connect(名称, 英文配置);
      
      // 缓存原始中文配置（用于列出连接时显示类型）
      this._configCache.set(名称, 配置);
      
      logger.info(`连接成功: ${名称} (${connection.tools.length} 个工具)`);
      
      return {
        success: true,
        tools: connection.tools,
        toolCount: connection.tools.length
      };
    } catch (error) {
      logger.debug(`连接失败: ${名称}`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 断开MCP Server连接
   * @param {string} 名称 - 连接名称
   */
  async 断开(名称) {
    const result = await mcpConnectionManager.disconnect(名称);
    
    if (result) {
      this._configCache.delete(名称);
      logger.info(`已断开: ${名称}`);
    }
    
    return result;
  }

  /**
   * 获取连接
   * @param {string} 名称 - 连接名称
   */
  获取连接(名称) {
    return mcpConnectionManager.getConnection(名称);
  }

  /**
   * 列出所有连接
   */
  列出连接() {
    const connections = mcpConnectionManager.listConnections();
    
    // 转换为中文格式，补充原始配置中的类型信息
    return connections.map(conn => {
      const cachedConfig = this._configCache.get(conn.name);
      return {
        名称: conn.name,
        类型: cachedConfig?.类型 || conn.type,
        tools: conn.tools,
        connected: conn.connected,
        connectedAt: conn.connectedAt
      };
    });
  }

  /**
   * 获取所有工具（合并所有连接）
   */
  获取所有工具() {
    return mcpConnectionManager.getAllTools();
  }

  /**
   * 调用MCP工具
   * @param {string} 连接名 - 连接名称
   * @param {string} 工具名 - 工具名称
   * @param {Object} 参数 - 工具参数
   */
  async 调用工具(连接名, 工具名, 参数) {
    return await mcpConnectionManager.callTool(连接名, 工具名, 参数);
  }

  /**
   * 断开所有连接
   */
  async 断开所有() {
    await mcpConnectionManager.disconnectAll();
    this._configCache.clear();
  }

  /**
   * 从配置批量连接
   * @param {Object} MCP配置 - MCP配置对象 { servers: [...] }
   */
  async 从配置连接(MCP配置) {
    if (!MCP配置?.servers?.length) {
      return { 成功: 0, 失败: 0 };
    }

    let 成功 = 0;
    let 失败 = 0;

    for (const server of MCP配置.servers) {
      if (!server.启用) continue;
      
      const result = await this.连接(server.名称, server);
      if (result.success) {
        成功++;
      } else {
        失败++;
      }
    }

    return { 成功, 失败 };
  }

  /**
   * 将MCP工具转换为能力列表
   * @param {string} 连接名 - 连接名称
   * @returns {Array} 能力列表
   */
  转换为能力(连接名) {
    const connection = mcpConnectionManager.getConnection(连接名);
    if (!connection) return [];

    const 能力列表 = [];
    const ts = createTimestampFields();

    for (const tool of connection.tools) {
      // 从工具描述推断能力
      const 能力名 = this._推断能力名(tool);

      能力列表.push({
        名称: 能力名,
        来源: 'MCP',
        MCP连接: 连接名,
        MCP工具: tool.name,
        描述: tool.description || tool.name,
        参数模式: tool.inputSchema,
        发现时间: ts.localTime
      });
    }

    return 能力列表;
  }

  /**
   * 从工具信息推断能力名
   * @private
   */
  _推断能力名(tool) {
    const name = tool.name.toLowerCase();
    const desc = (tool.description || '').toLowerCase();

    // 键盘相关
    if (name.includes('keyboard') || name.includes('key') || desc.includes('键盘')) {
      return '键盘控制';
    }

    // 鼠标相关
    if (name.includes('mouse') || name.includes('click') || desc.includes('鼠标')) {
      return '鼠标控制';
    }

    // 截图相关
    if (name.includes('screenshot') || name.includes('capture') || desc.includes('截图')) {
      return '截图';
    }

    // 窗口相关
    if (name.includes('window') || desc.includes('窗口')) {
      return '窗口管理';
    }

    // 进程相关
    if (name.includes('process') || desc.includes('进程')) {
      return '进程管理';
    }

    // 文件相关
    if (name.includes('file') || name.includes('read') || name.includes('write') || desc.includes('文件')) {
      return '文件操作';
    }

    // 网络/HTTP相关
    if (name.includes('http') || name.includes('request') || name.includes('fetch') || desc.includes('网络')) {
      return '网络请求';
    }

    // 浏览器相关
    if (name.includes('browser') || name.includes('page') || desc.includes('浏览器')) {
      return '浏览器控制';
    }

    // 默认使用工具名
    return tool.name;
  }
}

// 单例
export const mcp配置管理器 = new MCP配置管理器();

/**
 * 自动发现本地白鸽MCP
 * 尝试连接本机 MCP 服务（默认 localhost:8080），成功则注册能力，失败则静默跳过
 * @returns {Promise<{success: boolean, tools?: number}>}
 */
export async function 发现本地MCP() {
  const url = process.env.DOVE_MCP_URL || 'http://localhost:8080/mcp';
  const 连接名 = 'os_mcp';

  // 已连接则跳过
  const existing = mcpConnectionManager.getConnection(连接名);
  if (existing?.connected) {
    logger.info(`本地MCP已连接: ${连接名} (${existing.tools.length} 个工具)`);
    return { success: true, tools: existing.tools.length };
  }

  try {
    const result = await mcp配置管理器.连接(连接名, { url, 类型: 'http' });
    if (result.success) {
      logger.info(`本地MCP发现成功: ${result.toolCount} 个工具`);
      return { success: true, tools: result.toolCount };
    }
    return { success: false };
  } catch {
    logger.debug(`本地MCP未运行 (${url})，跳过`);
    return { success: false };
  }
}

export default MCP配置管理器;
