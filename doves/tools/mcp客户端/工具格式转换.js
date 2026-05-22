/**
 * @file MCP 工具格式转换
 * @description 将 MCP 工具定义转换为 OpenAI function-calling 格式
 */

/**
 * 将单个 MCP 工具定义转为 OpenAI function-calling 格式
 * @param {{ name: string, description?: string, inputSchema?: object }} mcpTool
 * @returns {{ type: 'function', function: { name, description, parameters } }}
 */
export function mcpToolToOpenAI(mcpTool) {
  return {
    type: 'function',
    function: {
      name: mcpTool.name,
      description: mcpTool.description || '',
      parameters: mcpTool.inputSchema || { type: 'object', properties: {} },
    },
  };
}

/**
 * 批量转换 MCP 工具列表
 * @param {Array} mcpTools
 * @returns {Array}
 */
export function mcpToolsToOpenAI(mcpTools) {
  return mcpTools.map(mcpToolToOpenAI);
}

/**
 * 按能力类别筛选 MCP 工具
 * 从已连接的 MCP 服务中筛出匹配指定能力分组的工具
 * @param {import('./连接管理器.js').MCPConnectionManager} manager
 * @param {string} 分组名
 * @returns {Array} OpenAI function-calling 格式工具定义
 */
export function 获取MCP分组工具(manager, 分组名) {
  const 关键词映射 = {
    '电脑操作': ['keyboard', 'mouse', 'screenshot', 'window', 'process', 'win32'],
    '键盘控制': ['keyboard'],
    '鼠标控制': ['mouse'],
    '截图':     ['screenshot'],
    '窗口管理': ['window', 'win32_ShowWindow', 'win32_SetWindowPos', 'win32_MoveWindow', 'win32_GetWindowRect', 'win32_SetForegroundWindow', 'win32_BringWindowToTop'],
    '进程管理': ['process'],
    '文件操作': ['file'],
    'Win32系统': ['win32_Get', 'win32_System'],
  };

  const 关键词 = 关键词映射[分组名];
  if (!关键词) return [];

  const 结果 = [];
  for (const [, conn] of manager.connections.entries()) {
    if (!conn.connected) continue;
    for (const tool of conn.tools) {
      if (关键词.some(kw => tool.name.toLowerCase().includes(kw.toLowerCase()))) {
        结果.push(mcpToolToOpenAI(tool));
      }
    }
  }

  return 结果;
}
