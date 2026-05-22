/**
 * 电脑操作工具
 * 通过白鸽MCP (os_mcp) 实现 GUI 自动化：截图、键鼠、窗口、进程、系统命令
 * 不再依赖 Node.js 原生模块
 */

import { mcpConnectionManager } from '../../../tools/mcp客户端.js';
import { systemTools, handleSystemTool } from '../../../tools/系统工具.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readdir, readFile, writeFile } from 'fs/promises';

const execAsync = promisify(exec);

const text = (content) => ({
  content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }]
});
const error = (msg) => ({
  content: [{ type: 'text', text: msg }],
  isError: true
});

async function callMCP(toolName, args = {}) {
  const conn = mcpConnectionManager.getConnection('os_mcp');
  if (!conn?.connected) {
    throw new Error('白鸽MCP (os_mcp) 未连接，GUI自动化不可用');
  }
  return await mcpConnectionManager.callTool('os_mcp', toolName, args);
}

// ==================== 工具定义 ====================

export const extTools = [
  {
    name: 'computer_screenshot',
    description: '全屏/窗口/区域截图。不传参数=全屏截图到临时目录，传path=指定路径，传x/y/width/height=区域截图',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '保存路径（绝对路径，可选。不传则保存到临时目录）' },
        x: { type: 'number', description: '区域截图：左上角X' },
        y: { type: 'number', description: '区域截图：左上角Y' },
        width: { type: 'number', description: '区域截图：宽度' },
        height: { type: 'number', description: '区域截图：高度' },
        windowId: { type: 'string', description: '窗口截图：窗口句柄（从 computer_window_list 获取）' },
      },
    },
  },
  {
    name: 'computer_type',
    description: '输入文本（支持中文和 Unicode）',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要输入的文本' },
      },
      required: ['text'],
    },
  },
  {
    name: 'computer_hotkey',
    description: '发送组合键（如 Ctrl+C, Alt+Tab, Win+R）',
    inputSchema: {
      type: 'object',
      properties: {
        modifiers: { type: 'string', description: '修饰键（多个用逗号分隔）: ctrl, alt, shift' },
        key: { type: 'string', description: '主键' },
      },
      required: ['key'],
    },
  },
  {
    name: 'computer_key_press',
    description: '按下并释放单个按键',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '按键名称: enter, tab, space, backspace, delete, escape, up, down, left, right' },
      },
      required: ['key'],
    },
  },
  {
    name: 'computer_mouse_move',
    description: '移动鼠标到指定坐标',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X 坐标' },
        y: { type: 'number', description: 'Y 坐标' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'computer_mouse_click',
    description: '鼠标点击',
    inputSchema: {
      type: 'object',
      properties: {
        button: { type: 'string', description: '按钮: left, right, middle（默认 left）' },
        x: { type: 'number', description: '可选 X 坐标' },
        y: { type: 'number', description: '可选 Y 坐标' },
        double: { type: 'boolean', description: '是否双击' },
      },
    },
  },
  {
    name: 'computer_mouse_drag',
    description: '鼠标拖拽',
    inputSchema: {
      type: 'object',
      properties: {
        from_x: { type: 'number' }, from_y: { type: 'number' },
        to_x: { type: 'number' }, to_y: { type: 'number' },
      },
      required: ['from_x', 'from_y', 'to_x', 'to_y'],
    },
  },
  {
    name: 'computer_mouse_scroll',
    description: '鼠标滚轮（正数向上，负数向下）',
    inputSchema: {
      type: 'object',
      properties: { delta: { type: 'number', description: '滚动量' } },
      required: ['delta'],
    },
  },
  {
    name: 'computer_window_list',
    description: '列出所有可见窗口',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'computer_window_find',
    description: '按标题查找窗口',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    },
  },
  {
    name: 'computer_window_activate',
    description: '激活窗口',
    inputSchema: {
      type: 'object',
      properties: { windowId: { type: 'string' } },
      required: ['windowId'],
    },
  },
  {
    name: 'computer_window_close',
    description: '关闭窗口',
    inputSchema: {
      type: 'object',
      properties: { windowId: { type: 'string' } },
      required: ['windowId'],
    },
  },
  {
    name: 'computer_process_find',
    description: '按名称查找进程',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'computer_process_start',
    description: '启动进程',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string' }, cwd: { type: 'string' } },
      required: ['command'],
    },
  },
  {
    name: 'computer_process_terminate',
    description: '终止进程',
    inputSchema: {
      type: 'object',
      properties: { pid: { type: 'number' } },
      required: ['pid'],
    },
  },
  {
    name: 'computer_exec',
    description: '执行系统命令',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string' },
        timeout: { type: 'number' },
      },
      required: ['command'],
    },
  },
  {
    name: 'computer_system_info',
    description: '获取系统信息',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'computer_file_list',
    description: '列出目录内容',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'computer_file_read',
    description: '读取文件内容',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, encoding: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'computer_file_write',
    description: '写入文件内容',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
];

// ==================== 安全分级 ====================

export const extToolSafetyLevels = {
  computer_screenshot: '安全',
  computer_window_list: '安全',
  computer_window_find: '安全',
  computer_process_find: '安全',
  computer_system_info: '安全',
  computer_file_list: '安全',
  computer_file_read: '安全',
  computer_type: '谨慎',
  computer_hotkey: '谨慎',
  computer_key_press: '谨慎',
  computer_mouse_move: '谨慎',
  computer_mouse_click: '谨慎',
  computer_mouse_drag: '谨慎',
  computer_mouse_scroll: '谨慎',
  computer_window_activate: '谨慎',
  computer_process_start: '谨慎',
  computer_file_write: '谨慎',
  computer_window_close: '危险',
  computer_process_terminate: '危险',
  computer_exec: '危险',
};

// ==================== 能力映射 ====================

export const extToolAbilityMap = {
  computer_screenshot: ['截图', 'GUI', '自动化'],
  computer_type: ['键盘', '输入', 'GUI', '自动化'],
  computer_hotkey: ['键盘', '快捷键', 'GUI', '自动化'],
  computer_key_press: ['键盘', '按键', 'GUI', '自动化'],
  computer_mouse_move: ['鼠标', '移动', 'GUI', '自动化'],
  computer_mouse_click: ['鼠标', '点击', 'GUI', '自动化'],
  computer_mouse_drag: ['鼠标', '拖拽', 'GUI', '自动化'],
  computer_mouse_scroll: ['鼠标', '滚轮', 'GUI', '自动化'],
  computer_window_list: ['窗口', '列表', 'GUI', '自动化'],
  computer_window_find: ['窗口', '查找', 'GUI', '自动化'],
  computer_window_activate: ['窗口', '激活', 'GUI', '自动化'],
  computer_window_close: ['窗口', '关闭', 'GUI', '自动化'],
  computer_process_find: ['进程', '查找', 'GUI', '自动化'],
  computer_process_start: ['进程', '启动', 'GUI', '自动化'],
  computer_process_terminate: ['进程', '终止', 'GUI', '自动化'],
  computer_exec: ['系统', '命令', '执行'],
  computer_system_info: ['系统', '信息'],
  computer_file_list: ['文件', '列表'],
  computer_file_read: ['文件', '读取'],
  computer_file_write: ['文件', '写入'],
};

// ==================== 工具分类 ====================

export const extToolCategories = {
  截图: ['computer_screenshot'],
  键鼠控制: ['computer_type', 'computer_hotkey', 'computer_key_press', 'computer_mouse_move', 'computer_mouse_click', 'computer_mouse_drag', 'computer_mouse_scroll'],
  窗口管理: ['computer_window_list', 'computer_window_find', 'computer_window_activate', 'computer_window_close'],
  进程控制: ['computer_process_find', 'computer_process_start', 'computer_process_terminate'],
  系统操作: ['computer_exec', 'computer_system_info'],
  文件管理: ['computer_file_list', 'computer_file_read', 'computer_file_write'],
};

// ==================== 工具执行器 ====================

export async function handleExtTool(toolName, args) {
  try {
    switch (toolName) {
      case 'computer_screenshot': return await computerScreenshot(args);
      case 'computer_type': return await callMCP('keyboard_type', { text: args.text });
      case 'computer_hotkey': return await callMCP('keyboard_hotkey', { modifier: args.modifiers, key: args.key });
      case 'computer_key_press': return await callMCP('keyboard_press', { key: args.key });
      case 'computer_mouse_move': return await callMCP('mouse_move', { x: args.x, y: args.y });
      case 'computer_mouse_click': {
        if (args.double) return await callMCP('mouse_double_click', { x: args.x, y: args.y, button: args.button });
        return await callMCP('mouse_click', { x: args.x, y: args.y, button: args.button });
      }
      case 'computer_mouse_drag': return await callMCP('mouse_drag', args);
      case 'computer_mouse_scroll': return await callMCP('mouse_scroll', { amount: args.delta });
      case 'computer_window_list': return await callMCP('window_list', {});
      case 'computer_window_find': return await callMCP('window_find', { title: args.title });
      case 'computer_window_activate': return await callMCP('window_activate', { handle: args.windowId });
      case 'computer_window_close': return await callMCP('window_close', { handle: args.windowId });
      case 'computer_process_find': return await callMCP('process_find', { name: args.name });
      case 'computer_process_start': return await callMCP('process_start', { command: args.command, working_dir: args.cwd });
      case 'computer_process_terminate': return await callMCP('process_terminate', { pid: args.pid });
      case 'computer_exec': return await computerExec(args);
      case 'computer_system_info': return await handleSystemTool('system_info', {});
      case 'computer_file_list': return await computerFileList(args);
      case 'computer_file_read': return await computerFileRead(args);
      case 'computer_file_write': return await computerFileWrite(args);
      default:
        return error(`未知的电脑操作工具: ${toolName}`);
    }
  } catch (err) {
    return error(`执行 ${toolName} 失败: ${err.message}`);
  }
}

// ==================== 自定义实现 ====================

async function computerScreenshot(args) {
  const { path, x, y, width, height, windowId } = args;

  if (x !== undefined && y !== undefined && width && height) {
    return await callMCP('screenshot_region', { x, y, width, height, save_path: path });
  }
  if (windowId) {
    return await callMCP('screenshot_window', { handle: windowId, save_path: path });
  }
  return await callMCP('screenshot_full', { save_path: path });
}

async function computerExec(args) {
  const { command, cwd, timeout = 30000 } = args;

  const blockedPatterns = [
    /rm\s+-rf\s+\//, /del\s+\/f\s+\/s\s+[A-Z]:\\/i,
    /format\s+[a-z]:/i, /shutdown\s+\/s/, /shutdown\s+\/r/,
    /taskkill\s+\/f\s+\/im\s+(explorer|winlogon|csrss|smss|lsass|services)/i,
  ];

  for (const pattern of blockedPatterns) {
    if (pattern.test(command)) {
      return error(`安全阻止: 命令 "${command}" 包含毁灭性操作，已拦截。`);
    }
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: cwd || process.cwd(),
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    return text({ success: true, command, stdout: stdout.slice(0, 5000), stderr: stderr ? stderr.slice(0, 1000) : null });
  } catch (err) {
    return text({ success: false, command, error: err.message, stdout: err.stdout?.slice(0, 2000) || '', stderr: err.stderr?.slice(0, 2000) || '' });
  }
}

async function computerFileList(args) {
  try {
    const entries = await readdir(args.path, { withFileTypes: true });
    const items = entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }));
    return text({ path: args.path, count: items.length, items });
  } catch (err) {
    return error(`列出目录失败: ${err.message}`);
  }
}

async function computerFileRead(args) {
  try {
    const content = await readFile(args.path, args.encoding || 'utf-8');
    return text({ path: args.path, size: content.length, content: content.slice(0, 10000), truncated: content.length > 10000 });
  } catch (err) {
    return error(`读取文件失败: ${err.message}`);
  }
}

async function computerFileWrite(args) {
  try {
    await writeFile(args.path, args.content, args.encoding || 'utf-8');
    return text({ success: true, path: args.path, size: args.content.length });
  } catch (err) {
    return error(`写入文件失败: ${err.message}`);
  }
}
