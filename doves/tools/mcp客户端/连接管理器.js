/**
 * @file tools/mcp客户端/连接管理器
 * @description MCP 连接管理器，管理多个 MCP 服务器的连接生命周期
 */

import { EventEmitter } from 'events';
import { 创建日志器 } from '@dove/common/日志管理器.js';
import { toLocalISOString } from '@dove/common/时间工具.js';
import { StdioTransport } from './Stdio传输.js';
import { HTTPTransport } from './HTTP传输.js';

const logger = 创建日志器('MCP连接', { 前缀: '[MCP]', 级别: 'debug', 显示调用位置: true });

export class MCPConnectionManager extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map(); // name -> { transport, tools, connected, ... }
    this.maxReconnectAttempts = 3;
    this.reconnectDelay = 1000;
  }
  
  /**
   * 连接到 MCP 服务器
   */
  async connect(name, config) {
    if (this.connections.has(name)) {
      const existing = this.connections.get(name);
      if (existing.connected) {
        logger.info(`连接已存在: ${name}`);
        return existing;
      }
      // 旧连接未成功，先清理
      await this._cleanupConnection(name);
    }
    
    let transport;
    
    try {
      // 根据传输类型创建连接
      if (config.type === 'stdio') {
        transport = await this._createStdioTransport(name, config);
      } else if (config.type === 'http' || config.type === 'sse') {
        transport = await this._createHTTPTransport(name, config);
      } else {
        throw new Error(`不支持的传输类型: ${config.type}`);
      }
      
      // 获取可用工具
      const toolsResult = await transport.sendRequest({ method: 'tools/list' });
      const tools = toolsResult?.tools || [];
      
      const connection = {
        name,
        config,
        transport,
        tools,
        connected: true,
        connectedAt: toLocalISOString(),
        reconnectAttempts: 0
      };
      
      this.connections.set(name, connection);
      this.emit('connected', { name, toolCount: tools.length });
      
      logger.info(`连接成功: ${name} (${tools.length} 个工具)`);
      
      return connection;
    } catch (error) {
      logger.debug(`连接失败: ${name}`, error.message);
      throw error;
    }
  }
  
  /**
   * 创建 stdio 传输
   */
  async _createStdioTransport(name, config) {
    const { command, args = [], env = {}, cwd } = config;
    
    if (!command) {
      throw new Error('stdio 连接需要指定 command');
    }
    
    const transport = new StdioTransport(name, {
      command,
      args,
      env: { ...process.env, ...env },
      cwd: cwd || process.cwd()
    });
    
    await transport.connect();
    return transport;
  }
  
  /**
   * 创建 HTTP 传输
   */
  async _createHTTPTransport(name, config) {
    const { url, headers = {} } = config;
    
    if (!url) {
      throw new Error('HTTP 连接需要指定 url');
    }
    
    const transport = new HTTPTransport(name, { url, headers });
    await transport.connect();
    return transport;
  }
  
  /**
   * 断开连接
   */
  async disconnect(name) {
    const connection = this.connections.get(name);
    if (!connection) {
      return false;
    }
    
    await this._cleanupConnection(name);
    this.emit('disconnected', { name });
    logger.info(`连接已断开: ${name}`);
    return true;
  }
  
  /**
   * 清理连接
   */
  async _cleanupConnection(name) {
    const connection = this.connections.get(name);
    if (connection?.transport) {
      try {
        await connection.transport.close();
      } catch (e) {
        logger.error(`关闭传输失败: ${name}`, e.message);
      }
    }
    this.connections.delete(name);
  }
  
  /**
   * 获取连接
   */
  getConnection(name) {
    return this.connections.get(name);
  }
  
  /**
   * 列出所有连接
   */
  listConnections() {
    return Array.from(this.connections.entries()).map(([name, conn]) => ({
      name,
      type: conn.config.type,
      tools: conn.tools.length,
      connected: conn.connected,
      connectedAt: conn.connectedAt
    }));
  }
  
  /**
   * 获取所有工具
   */
  getAllTools() {
    const allTools = [];
    
    for (const [connName, conn] of this.connections.entries()) {
      for (const tool of conn.tools) {
        allTools.push({
          ...tool,
          _connection: connName,
          // 添加连接前缀避免冲突
          fullName: `${connName}_${tool.name}`
        });
      }
    }
    
    return allTools;
  }
  
  /**
   * 调用工具
   */
  async callTool(connectionName, toolName, args) {
    const connection = this.connections.get(connectionName);
    if (!connection) {
      throw new Error(`MCP 连接不存在: ${connectionName}`);
    }
    
    if (!connection.connected) {
      throw new Error(`MCP 连接已断开: ${connectionName}`);
    }
    
    try {
      const result = await connection.transport.sendRequest({
        method: 'tools/call',
        params: { name: toolName, arguments: args || {} }
      });
      
      return result;
    } catch (error) {
      logger.error(`工具调用失败: ${connectionName}/${toolName}`, error.message);
      
      // 检查是否需要重连
      if (connection.config.type === 'stdio' && connection.reconnectAttempts < this.maxReconnectAttempts) {
        logger.info(`尝试重连: ${connectionName}`);
        connection.reconnectAttempts++;
        
        try {
          await this.connect(connectionName, connection.config);
          // 重试调用
          const retryResult = await connection.transport.sendRequest({
            method: 'tools/call',
            params: { name: toolName, arguments: args || {} }
          });
          connection.reconnectAttempts = 0;
          return retryResult;
        } catch (reconnectError) {
          logger.error(`重连失败: ${connectionName}`, reconnectError.message);
        }
      }
      
      throw error;
    }
  }
  
  /**
   * 断开所有连接
   */
  async disconnectAll() {
    const promises = [];
    for (const name of this.connections.keys()) {
      promises.push(this.disconnect(name));
    }
    await Promise.all(promises);
  }
}
