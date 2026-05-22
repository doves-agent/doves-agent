/**
 * @file tools/mcp客户端/工具定义
 * @description MCP 工具定义数组
 */

export const mcpTools = [
  {
    name: 'MCP连接',
    description: '连接到 MCP 服务器。⚠️ 只能连接已配置的 MCP 服务器，禁止猜测 URL。请先使用 MCP列表 查看已有连接，或使用 MCP工具列表 查看已连接服务器的工具。如无已配置服务器，不要调用此工具。',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '连接名称（自定义标识，如 os_mcp）'
        },
        url: {
          type: 'string',
          description: 'MCP 服务器 URL（如 http://127.0.0.1:8080/mcp）'
        },
        headers: {
          type: 'object',
          description: '自定义请求头（可选）'
        }
      },
      required: ['name', 'url']
    }
  },
  {
    name: 'MCP断开',
    description: '断开 MCP 服务器连接',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '连接名称'
        }
      },
      required: ['name']
    }
  },
  {
    name: 'MCP列表',
    description: '列出所有 MCP 连接',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'MCP工具列表',
    description: '列出 MCP 服务器提供的工具',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '连接名称（可选，不填则列出所有连接的工具）'
        }
      }
    }
  },
  {
    name: 'MCP调用',
    description: '调用 MCP 服务器的工具',
    inputSchema: {
      type: 'object',
      properties: {
        connection: {
          type: 'string',
          description: '连接名称'
        },
        tool: {
          type: 'string',
          description: '工具名称'
        },
        args: {
          type: 'object',
          description: '工具参数'
        }
      },
      required: ['connection', 'tool']
    }
  }
];
