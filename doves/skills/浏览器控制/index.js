/**
 * 浏览器控制技能 - browser_agent
 * 
 * 完整的浏览器自动化能力：
 * - Puppeteer (Chrome/Edge) 和 Playwright (Chrome/Firefox/Safari)
 * - 由子模块组成：浏览器进程管理、浏览器连接、页面操作
 */

import {
  handleDetect, handleLaunch, handleConnect, handleClose,
  handleStatus, handleListProcesses, handleCheckPort,
  handleKillProcess, handleRestart
} from './浏览器连接.js';

import {
  handleNavigate, handleScreenshot, handleClick, handleType,
  handlePress, handleWait, handleEvaluate, handleGetContent,
  handleListTabs, handleSwitchTab, handleCookies
} from './页面操作.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('浏览器控制', { 前缀: '[浏览器控制]', 级别: 'debug', 显示调用位置: true });

// ============================================================================
// 网络钩子（预留）
// ============================================================================

const networkHooks = new Map();

// ============================================================================
// Skill 主执行函数
// ============================================================================

async function execute(params, context) {
  const { action } = params;
  
  const handlers = {
    detect: handleDetect,
    launch: handleLaunch,
    connect: handleConnect,
    close: handleClose,
    navigate: handleNavigate,
    screenshot: handleScreenshot,
    click: handleClick,
    type: handleType,
    press: handlePress,
    wait: handleWait,
    evaluate: handleEvaluate,
    get_content: handleGetContent,
    list_tabs: handleListTabs,
    switch_tab: handleSwitchTab,
    cookies: handleCookies,
    status: handleStatus,
    list_processes: handleListProcesses,
    check_port: handleCheckPort,
    kill_process: handleKillProcess,
    restart: handleRestart
  };
  
  const handler = handlers[action];
  if (!handler) {
    return { success: false, error: `未知操作: ${action}` };
  }
  
  try {
    return await handler(params);
  } catch (error) {
    logger.error(`执行 ${action} 失败:`, error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// 导出
// ============================================================================

export default {
  name: '浏览器控制',
  description: '浏览器控制技能 - 完整的浏览器自动化能力：Puppeteer/Playwright、网络拦截、Cookie管理、截图PDF、高级交互',
  
  abilities: ['浏览器控制', '网页交互', 'GUI自动化', '截图', '自动化'],

  需要拥有权: false,

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['detect', 'launch', 'connect', 'close', 'navigate', 'screenshot', 'click', 'type', 'press', 'wait', 'evaluate', 'get_content', 'list_tabs', 'switch_tab', 'cookies', 'status', 'list_processes', 'check_port', 'kill_process', 'restart'],
        description: '操作类型'
      },
      browser: { type: 'string', enum: ['edge', 'chrome', 'firefox', 'auto'], default: 'auto', description: '浏览器类型' },
      engine: { type: 'string', enum: ['puppeteer', 'playwright'], default: 'puppeteer', description: '浏览器引擎' },
      debugPort: { type: 'integer', default: 9222, description: '调试端口' },
      url: { type: 'string', description: '导航URL' },
      selector: { type: 'string', description: 'CSS选择器' },
      text: { type: 'string', description: '输入文本' },
      headless: { type: 'boolean', default: false, description: '无头模式' }
    },
    required: ['action']
  },
  execute
};
