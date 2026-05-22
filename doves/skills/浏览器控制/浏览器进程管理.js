/**
 * 浏览器进程管理
 * 从 browser_agent/index.js 提取
 * 
 * 功能：浏览器路径配置、端口检测、进程查找/关闭、浏览器启动
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import fs from 'fs';
import net from 'net';
import http from 'http';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const execAsync = promisify(exec);

// ============================================================================
// 浏览器配置
// ============================================================================

/**
 * 浏览器可执行文件路径配置
 */
export const BROWSER_PATHS = {
  edge: {
    win32: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      path.join(os.homedir(), 'AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe')
    ],
    darwin: [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    ],
    linux: [
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable'
    ]
  },
  chrome: {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ]
  },
  firefox: {
    win32: [
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
      path.join(os.homedir(), 'AppData\\Local\\Mozilla Firefox\\firefox.exe')
    ],
    darwin: [
      '/Applications/Firefox.app/Contents/MacOS/firefox'
    ],
    linux: [
      '/usr/bin/firefox',
      '/usr/bin/firefox-esr'
    ]
  },
  safari: {
    darwin: [
      '/Applications/Safari.app/Contents/MacOS/Safari'
    ]
  }
};

/**
 * 浏览器进程名配置
 */
export const BROWSER_PROCESS_NAMES = {
  edge: { win32: 'msedge.exe', darwin: 'Microsoft Edge', linux: 'microsoft-edge' },
  chrome: { win32: 'chrome.exe', darwin: 'Google Chrome', linux: 'chrome' },
  firefox: { win32: 'firefox.exe', darwin: 'Firefox', linux: 'firefox' },
  safari: { darwin: 'Safari' }
};

/**
 * 默认调试端口
 */
export const DEFAULT_DEBUG_PORT = 9222;

// ============================================================================
// 浏览器实例缓存
// ============================================================================

export const browserInstances = new Map();  // Puppeteer 实例

// ============================================================================
// 日志器（本地）
// ============================================================================

const logger = 创建日志器('浏览器控制', { 前缀: '[浏览器控制]', 级别: 'debug', 显示调用位置: true });

// ============================================================================
// 跨平台进程管理
// ============================================================================

/**
 * 检查端口是否被占用
 */
export async function isPortInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    
    socket.on('error', () => {
      resolve(false);
    });
    
    socket.connect(port, host);
  });
}

/**
 * 检查调试端口是否可用
 */
export async function checkDebugPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/json/version`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          resolve({
            available: true,
            browserInfo: {
              browser: info.Browser,
              protocolVersion: info['Protocol-Version'],
              webSocketUrl: info.webSocketDebuggerUrl,
              userAgent: info['User-Agent']
            }
          });
        } catch (e) {
          resolve({ available: false });
        }
      });
    });
    
    req.on('error', () => {
      resolve({ available: false });
    });
    
    req.setTimeout(3000, () => {
      req.destroy();
      resolve({ available: false });
    });
  });
}

/**
 * 查找浏览器可执行文件路径
 */
export function findBrowserPath(browserType) {
  const paths = BROWSER_PATHS[browserType]?.[process.platform] || [];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

/**
 * 自动检测可用的浏览器
 */
export function autoDetectBrowser() {
  const order = process.platform === 'darwin' 
    ? ['chrome', 'edge', 'firefox']
    : ['edge', 'chrome', 'firefox'];
  
  for (const type of order) {
    const browserPath = findBrowserPath(type);
    if (browserPath) {
      return { type, path: browserPath };
    }
  }
  return null;
}

/**
 * 获取所有浏览器进程
 */
export async function getBrowserProcesses(options = {}) {
  const { browserType, debugPort } = options;
  const processes = [];
  
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(
        'wmic process where "name=\'msedge.exe\' or name=\'chrome.exe\' or name=\'firefox.exe\'" get ProcessId,CommandLine /format:list',
        { timeout: 10000 }
      );
      
      const lines = stdout.split('\n');
      let currentProcess = {};
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('CommandLine=')) {
          currentProcess.commandLine = trimmed.substring('CommandLine='.length);
        } else if (trimmed.startsWith('ProcessId=')) {
          currentProcess.pid = parseInt(trimmed.substring('ProcessId='.length));
          
          if (currentProcess.pid && currentProcess.commandLine) {
            let type = 'unknown';
            if (currentProcess.commandLine.includes('msedge')) type = 'edge';
            else if (currentProcess.commandLine.includes('chrome') || currentProcess.commandLine.includes('chromium')) type = 'chrome';
            else if (currentProcess.commandLine.includes('firefox')) type = 'firefox';
            
            const portMatch = currentProcess.commandLine.match(/--remote-debugging-port=(\d+)/);
            const port = portMatch ? parseInt(portMatch[1]) : null;
            
            processes.push({
              pid: currentProcess.pid,
              type,
              commandLine: currentProcess.commandLine,
              debugPort: port,
              hasDebugPort: !!port
            });
          }
          currentProcess = {};
        }
      }
    } else {
      const { stdout } = await execAsync(
        'ps aux | grep -E "(msedge|chrome|chromium|firefox|safari)" | grep -v grep',
        { timeout: 10000 }
      );
      
      const lines = stdout.trim().split('\n').filter(l => l.trim());
      
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[1]);
        const command = parts.slice(10).join(' ');
        
        let type = 'unknown';
        const cmdLower = command.toLowerCase();
        if (cmdLower.includes('msedge') || cmdLower.includes('microsoft edge')) type = 'edge';
        else if (cmdLower.includes('chrome') || cmdLower.includes('chromium')) type = 'chrome';
        else if (cmdLower.includes('firefox')) type = 'firefox';
        else if (cmdLower.includes('safari')) type = 'safari';
        
        const portMatch = command.match(/--remote-debugging-port=(\d+)/);
        const port = portMatch ? parseInt(portMatch[1]) : null;
        
        processes.push({
          pid,
          type,
          commandLine: command,
          debugPort: port,
          hasDebugPort: !!port,
          user: parts[0]
        });
      }
    }
    
    let filtered = processes;
    if (browserType) {
      filtered = filtered.filter(p => p.type === browserType);
    }
    if (debugPort) {
      filtered = filtered.filter(p => p.debugPort === debugPort);
    }
    
    return filtered;
    
  } catch (error) {
    logger.error('获取浏览器进程失败:', error.message);
    return [];
  }
}

/**
 * 通过 PID 关闭进程
 */
export async function killProcessByPid(pid, force = false) {
  try {
    let command;
    if (process.platform === 'win32') {
      command = force ? `taskkill /F /PID ${pid}` : `taskkill /PID ${pid}`;
    } else {
      command = force ? `kill -9 ${pid}` : `kill ${pid}`;
    }
    
    await execAsync(command, { timeout: 5000 });
    return { success: true, message: `进程 ${pid} 已关闭` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 通过浏览器类型关闭所有进程
 */
export async function killBrowserProcesses(browserType, force = false) {
  try {
    const processName = BROWSER_PROCESS_NAMES[browserType]?.[process.platform];
    
    if (!processName) {
      return { success: false, error: `不支持的浏览器类型: ${browserType}` };
    }
    
    let command;
    if (process.platform === 'win32') {
      command = force ? `taskkill /F /IM ${processName}` : `taskkill /IM ${processName}`;
    } else {
      command = force ? `pkill -9 -f "${processName}"` : `pkill -f "${processName}"`;
    }
    
    await execAsync(command, { timeout: 10000 });
    browserInstances.clear();
    
    return { success: true, message: `所有 ${browserType} 进程已关闭` };
  } catch (error) {
    if (error.message.includes('没有找到') || error.message.includes('no process found')) {
      return { success: true, message: `没有找到 ${browserType} 进程` };
    }
    return { success: false, error: error.message };
  }
}

/**
 * 启动浏览器（调试模式）
 */
export async function startBrowserWithDebug(browserType, options = {}) {
  const {
    debugPort = DEFAULT_DEBUG_PORT,
    url,
    headless = false,
    userDataDir,
    autoPort = false,
    args = []
  } = options;
  
  const browserPath = findBrowserPath(browserType);
  if (!browserPath) {
    return { success: false, error: `未找到 ${browserType} 浏览器` };
  }
  
  let actualPort = debugPort;
  if (await isPortInUse(debugPort)) {
    if (autoPort) {
      for (let p = debugPort + 1; p < debugPort + 100; p++) {
        if (!(await isPortInUse(p))) {
          actualPort = p;
          break;
        }
      }
    } else {
      return { success: false, error: `端口 ${debugPort} 已被占用` };
    }
  }
  
  const launchArgs = [
    `--remote-debugging-port=${actualPort}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled'
  ];
  
  if (headless) {
    launchArgs.push('--headless=new');
  }
  
  if (userDataDir) {
    launchArgs.push(`--user-data-dir=${userDataDir}`);
  }
  
  launchArgs.push(...args);
  
  if (url) {
    launchArgs.push(url);
  }
  
  let command;
  if (process.platform === 'win32') {
    command = `start "" "${browserPath}" ${launchArgs.join(' ')}`;
  } else {
    command = `"${browserPath}" ${launchArgs.join(' ')} &`;
  }
  
  try {
    await execAsync(command, { timeout: 10000 });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const checkResult = await checkDebugPort(actualPort);
    
    logger.info(`浏览器已启动: ${browserType}, 调试端口: ${actualPort}`);
    
    return {
      success: true,
      browser: browserType,
      path: browserPath,
      debugPort: actualPort,
      browserInfo: checkResult.browserInfo
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
