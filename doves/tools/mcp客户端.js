/**
 * @file tools/mcp客户端
 * @description 连接外部 MCP 服务器，支持 stdio/HTTP/SSE 传输
 * 
 * 使用 @modelcontextprotocol/sdk
 */

import { mcpTools } from './mcp客户端/工具定义.js';
import { MCPConnectionManager } from './mcp客户端/连接管理器.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('MCP', { 前缀: '[MCP]', 级别: 'debug', 显示调用位置: true });

// 单例连接管理器
export const mcpConnectionManager = new MCPConnectionManager();

/**
 * 处理 MCP 工具调用
 */
export async function handleMcpTool(name, args) {
  const text = (content) => ({
    content: [{
      type: 'text',
      text: typeof content === 'string' ? content : JSON.stringify(content, null, 2)
    }]
  });
  
  try {
    switch (name) {
      case 'MCP连接': {
        const { name: connName, url, headers } = args;
        
        if (!url) {
          return text({ success: false, error: '缺少 url 参数' });
        }
        
        // 强制使用 HTTP 模式
        const config = { 
          type: 'http',
          url,
          headers: headers || {}
        };
        
        const connection = await mcpConnectionManager.connect(connName, config);
        
        return text({
          success: true,
          message: `MCP 服务器 "${connName}" 连接成功`,
          tools: connection.tools.map(t => t.name),
          toolCount: connection.tools.length
        });
      }
      
      case 'MCP断开': {
        const disconnected = await mcpConnectionManager.disconnect(args.name);
        return text({
          success: disconnected,
          message: disconnected
            ? `MCP 连接 "${args.name}" 已断开`
            : `MCP 连接 "${args.name}" 不存在`
        });
      }
      
      case 'MCP列表': {
        const connections = mcpConnectionManager.listConnections();
        return text({
          success: true,
          connections,
          total: connections.length
        });
      }
      
      case 'MCP工具列表': {
        if (args.name) {
          const conn = mcpConnectionManager.getConnection(args.name);
          if (!conn) {
            return text({ success: false, error: `MCP 连接不存在: ${args.name}` });
          }
          return text({
            success: true,
            connection: args.name,
            tools: conn.tools
          });
        } else {
          const allTools = mcpConnectionManager.getAllTools();
          return text({
            success: true,
            tools: allTools,
            total: allTools.length
          });
        }
      }
      
      case 'MCP调用': {
        const { connection, tool, args: toolArgs } = args;
        const result = await mcpConnectionManager.callTool(connection, tool, toolArgs || {});
        return text({
          success: true,
          connection,
          tool,
          result
        });
      }
      
      default:
        return {
          content: [{ type: 'text', text: `Unknown MCP tool: ${name}` }],
          isError: true
        };
    }
  } catch (error) {
    logger.error(`MCP错误: ${error.message || error}`);
    return text({ success: false, error: error.message });
  }
}

export { mcpTools };

export default { 
  mcpTools, 
  handleMcpTool, 
  MCPConnectionManager,
  mcpConnectionManager 
};
