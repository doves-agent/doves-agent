/**
 * 浏览器连接管理
 * 从 browser_agent/index.js 提取
 * - Puppeteer/Playwright 连接建立
 * - 浏览器生命周期操作（检测、启动、连接、关闭、重启）
 * - 状态诊断与进程管理
 */

import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

import { 创建日志器 } from '@dove/common/日志管理器.js';
const logger = 创建日志器('浏览器连接', { 前缀: '[浏览器连接]', 级别: 'debug' });

import {
  BROWSER_PATHS, BROWSER_PROCESS_NAMES, DEFAULT_DEBUG_PORT,
  browserInstances, isPortInUse, checkDebugPort,
  findBrowserPath, autoDetectBrowser, getBrowserProcesses,
  killProcessByPid, killBrowserProcesses, startBrowserWithDebug
} from './浏览器进程管理.js';

// ============================================================================
// Playwright 上下文缓存
// ============================================================================

export const playwrightContexts = new Map();

// ============================================================================
// Puppeteer 连接管理
// ============================================================================

/**
 * 获取 Puppeteer 浏览器连接
 */
async function getPuppeteerConnection(debugPort, host = '127.0.0.1') {
  const key = `puppeteer:${host}:${debugPort}`;
  
  if (browserInstances.has(key)) {
    const cached = browserInstances.get(key);
    try {
      if (cached.isConnected()) {
        return { browser: cached, type: 'puppeteer' };
      }
    } catch (e) {
      logger.debug(`Puppeteer缓存连接已失效: ${e.message}`);
    }
    browserInstances.delete(key);
  }
  
  let puppeteer;
  try {
    puppeteer = await import('puppeteer-core');
  } catch (error) {
    throw new Error('puppeteer-core 未安装，请运行: npm install puppeteer-core');
  }
  
  const browser = await puppeteer.connect({
    browserURL: `http://${host}:${debugPort}`,
    defaultViewport: null
  });
  
  browserInstances.set(key, browser);
  return { browser, type: 'puppeteer' };
}

/**
 * 获取或创建页面
 */
async function getPage(debugPort, host = '127.0.0.1') {
  const { browser } = await getPuppeteerConnection(debugPort, host);
  const pages = await browser.pages();
  return pages.length > 0 ? pages[0] : await browser.newPage();
}

// ============================================================================
// Playwright 管理
// ============================================================================

/**
 * 启动 Playwright 浏览器
 */
async function launchPlaywright(browserType = 'chromium', options = {}) {
  const key = `playwright:${browserType}:${options.port || 'default'}`;
  
  if (playwrightContexts.has(key)) {
    const cached = playwrightContexts.get(key);
    try {
      const pages = cached.context.pages();
      if (pages.length >= 0) {
        return { context: cached.context, browser: cached.browser, browserType, type: 'playwright' };
      }
    } catch (e) {
      logger.debug(`Playwright缓存连接已失效: ${e.message}`);
    }
    playwrightContexts.delete(key);
  }
  
  let playwright;
  try {
    playwright = await import('playwright');
  } catch (error) {
    throw new Error('playwright 未安装，请运行: npm install playwright');
  }
  
  const browser = await playwright[browserType].launch({
    headless: options.headless !== false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      ...(options.args || [])
    ],
    ...options.launchOptions
  });
  
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1920, height: 1080 },
    userAgent: options.userAgent,
    locale: options.locale || 'zh-CN',
    timezoneId: options.timezoneId || 'Asia/Shanghai',
    ...options.contextOptions
  });
  
  playwrightContexts.set(key, { browser, context });
  
  return { context, browser, browserType, type: 'playwright' };
}

/**
 * 获取 Playwright 页面
 */
async function getPlaywrightPage(browserType = 'chromium', options = {}) {
  const { context, browser } = await launchPlaywright(browserType, options);
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  return { page, context, browser };
}

// ============================================================================
// 操作处理函数
// ============================================================================

/**
 * 检测浏览器
 */
export async function handleDetect(params) {
  const { browser = 'auto' } = params;
  
  if (browser === 'auto') {
    const detected = autoDetectBrowser();
    if (detected) {
      return {
        success: true,
        browser: detected.type,
        path: detected.path,
        platform: process.platform,
        availableEngines: ['puppeteer', 'playwright']
      };
    }
    return { success: false, error: '未找到可用的浏览器', platform: process.platform };
  }
  
  const browserPath = findBrowserPath(browser);
  if (browserPath) {
    return {
      success: true, browser, path: browserPath,
      platform: process.platform, availableEngines: ['puppeteer', 'playwright']
    };
  }
  
  return {
    success: false,
    error: `未找到 ${browser} 浏览器`,
    platform: process.platform,
    searchedPaths: BROWSER_PATHS[browser]?.[process.platform] || []
  };
}

/**
 * 启动浏览器
 */
export async function handleLaunch(params) {
  const { browser: browserType = 'auto', engine = 'puppeteer', debugPort = DEFAULT_DEBUG_PORT,
    headless = false, url, userDataDir, args = [], viewport, userAgent } = params;
  
  if (engine === 'playwright') {
    const browserTypeMap = { edge: 'chromium', chrome: 'chromium', firefox: 'firefox', safari: 'webkit', webkit: 'webkit', chromium: 'chromium' };
    const pwBrowserType = browserTypeMap[browserType] || 'chromium';
    
    try {
      const { context, browser: pwBrowser } = await launchPlaywright(pwBrowserType, {
        headless, viewport: viewport || { width: 1920, height: 1080 }, userAgent, args
      });
      const page = await context.newPage();
      if (url) {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      }
      return { success: true, engine: 'playwright', browserType: pwBrowserType, message: 'Playwright 浏览器已启动', headless };
    } catch (error) {
      return { success: false, error: `Playwright 启动失败: ${error.message}` };
    }
  }
  
  let browser;
  if (browserType === 'auto') {
    browser = autoDetectBrowser();
    if (!browser) return { success: false, error: '未找到可用的浏览器' };
  } else {
    const browserPath = findBrowserPath(browserType);
    if (!browserPath) return { success: false, error: `未找到 ${browserType} 浏览器` };
    browser = { type: browserType, path: browserPath };
  }
  
  const launchArgs = [
    `--remote-debugging-port=${debugPort}`, '--no-first-run',
    '--no-default-browser-check', '--disable-blink-features=AutomationControlled'
  ];
  if (headless) launchArgs.push('--headless=new');
  if (userDataDir) launchArgs.push(`--user-data-dir=${userDataDir}`);
  launchArgs.push(...args);
  if (url) launchArgs.push(url);
  
  let launchCommand;
  if (process.platform === 'win32') {
    launchCommand = `start "" "${browser.path}" ${launchArgs.join(' ')}`;
  } else {
    launchCommand = `"${browser.path}" ${launchArgs.join(' ')} &`;
  }
  
  await execAsync(launchCommand, { timeout: 10000 });
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  return { success: true, engine: 'puppeteer', browser: browser.type, path: browser.path, debugPort, args: launchArgs };
}

/**
 * 连接浏览器
 */
export async function handleConnect(params) {
  const { engine = 'puppeteer', browserType = 'chromium', debugPort = DEFAULT_DEBUG_PORT, host = '127.0.0.1' } = params;
  
  try {
    if (engine === 'playwright') {
      const { context, browser } = await launchPlaywright(browserType, params);
      return { success: true, engine: 'playwright', browserType, version: browser.version(), message: 'Playwright 浏览器已连接' };
    }
    
    const { browser } = await getPuppeteerConnection(debugPort, host);
    const version = await browser.version();
    const pages = await browser.pages();
    return { success: true, engine: 'puppeteer', host, debugPort, version, pagesCount: pages.length };
  } catch (error) {
    return { success: false, error: `连接失败: ${error.message}` };
  }
}

/**
 * 关闭浏览器
 */
export async function handleClose(params) {
  const { pid, debugPort, force, browser: browserType = 'auto', engine = 'puppeteer' } = params;
  
  if (engine === 'playwright') {
    for (const [key, cached] of playwrightContexts.entries()) {
      try { await cached.browser.close(); } catch (e) { logger.warn(`关闭Playwright浏览器失败: ${e.message}`); }
    }
    playwrightContexts.clear();
    return { success: true, message: 'Playwright 浏览器已关闭' };
  }
  
  if (pid) return await killProcessByPid(pid, true);
  
  if (debugPort) {
    const key = `puppeteer:127.0.0.1:${debugPort}`;
    if (browserInstances.has(key)) {
      const browser = browserInstances.get(key);
      await browser.close();
      browserInstances.delete(key);
      return { success: true, message: `已关闭调试端口 ${debugPort} 的浏览器连接` };
    }
  }
  
  if (force) {
    let processName;
    if (browserType === 'auto') {
      const detected = autoDetectBrowser();
      processName = detected ? BROWSER_PROCESS_NAMES[detected.type]?.[process.platform] : null;
    } else {
      processName = BROWSER_PROCESS_NAMES[browserType]?.[process.platform];
    }
    if (!processName) return { success: false, error: '无法确定浏览器进程名' };
    
    let killCommand;
    if (process.platform === 'win32') {
      killCommand = `taskkill /F /IM ${processName}`;
    } else {
      killCommand = `pkill -9 -f "${processName}"`;
    }
    await execAsync(killCommand);
    browserInstances.clear();
    return { success: true, message: `已强制关闭所有 ${browserType || '浏览器'} 进程` };
  }
  
  return { success: false, error: '请指定 pid、debugPort 或 force=true' };
}

/**
 * 获取状态
 */
export async function handleStatus(params) {
  const { debugPort = DEFAULT_DEBUG_PORT } = params;
  const key = `puppeteer:127.0.0.1:${debugPort}`;
  
  const status = { debugPort, connected: false, cached: browserInstances.has(key), playwrightContexts: playwrightContexts.size };
  
  if (browserInstances.has(key)) {
    const browser = browserInstances.get(key);
    try {
      status.connected = browser.isConnected();
      if (status.connected) {
        status.version = await browser.version();
        status.pagesCount = (await browser.pages()).length;
      }
    } catch (e) { status.error = e.message; }
  }
  
  return { success: true, ...status };
}

/**
 * 列出浏览器进程
 */
export async function handleListProcesses(params) {
  const { browserType, debugPort } = params;
  const processes = await getBrowserProcesses({ browserType, debugPort });
  
  return {
    success: true, count: processes.length, platform: process.platform,
    processes: processes.map(p => ({
      pid: p.pid, type: p.type, debugPort: p.debugPort, hasDebugPort: p.hasDebugPort,
      commandLine: p.commandLine?.substring(0, 200)
    }))
  };
}

/**
 * 检查端口状态
 */
export async function handleCheckPort(params) {
  const { port, host = '127.0.0.1', checkDebug = false } = params;
  const inUse = await isPortInUse(port, host);
  const result = { port, host, inUse };
  
  if (checkDebug && inUse) {
    const debugInfo = await checkDebugPort(port, host);
    result.debugAvailable = debugInfo.available;
    result.browserInfo = debugInfo.browserInfo;
  }
  
  return { success: true, ...result };
}

/**
 * 关闭进程
 */
export async function handleKillProcess(params) {
  const { pid, browserType, debugPort, force = true } = params;
  
  if (pid) return await killProcessByPid(pid, force);
  
  if (browserType) return await killBrowserProcesses(browserType, force);
  
  if (debugPort) {
    const processes = await getBrowserProcesses({ debugPort });
    if (processes.length === 0) return { success: false, error: `没有找到使用调试端口 ${debugPort} 的进程` };
    const results = [];
    for (const proc of processes) {
      const result = await killProcessByPid(proc.pid, true);
      results.push({ pid: proc.pid, ...result });
    }
    return { success: results.every(r => r.success), message: `已关闭 ${results.length} 个使用端口 ${debugPort} 的进程`, details: results };
  }
  
  return { success: false, error: '请指定 pid、browserType 或 debugPort' };
}

/**
 * 重启浏览器
 */
export async function handleRestart(params) {
  const { browser = 'auto', debugPort = DEFAULT_DEBUG_PORT, force = true } = params;
  
  const closeResult = await killBrowserProcesses(browser, force);
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  const startResult = await startBrowserWithDebug(browser, { debugPort, ...params });
  
  return {
    success: startResult.success,
    message: startResult.success ? `${browser} 浏览器已重启，调试端口: ${startResult.debugPort}` : `重启失败: ${startResult.error}`,
    closeResult, startResult
  };
}

// Re-export connection helpers used by 页面操作.js
export { getPuppeteerConnection, getPage, launchPlaywright, getPlaywrightPage };
