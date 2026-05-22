/**
 * 页面交互操作
 * 从 browser_agent/index.js 提取
 * - 导航、截图、点击、输入、按键
 * - 等待、执行脚本、内容获取
 * - 标签页管理、Cookie 操作
 */

import { DEFAULT_DEBUG_PORT } from './浏览器进程管理.js';
import { getPage, getPuppeteerConnection } from './浏览器连接.js';

/**
 * 导航
 */
export async function handleNavigate(params) {
  const { url, debugPort = DEFAULT_DEBUG_PORT, waitUntil = 'networkidle2', timeout = 30000 } = params;
  
  const page = await getPage(debugPort);
  await page.goto(url, { waitUntil, timeout });
  
  return { success: true, url, title: await page.title() };
}

/**
 * 截图
 */
export async function handleScreenshot(params) {
  const { debugPort = DEFAULT_DEBUG_PORT, selector, fullPage = false, format = 'png', quality, clip } = params;
  
  const page = await getPage(debugPort);
  
  const options = { type: format, fullPage };
  if (quality) options.quality = quality;
  if (clip) options.clip = clip;
  
  let screenshot;
  if (selector) {
    const element = await page.$(selector);
    if (!element) return { success: false, error: `未找到元素: ${selector}` };
    screenshot = await element.screenshot({ encoding: 'base64', ...options });
  } else {
    screenshot = await page.screenshot({ encoding: 'base64', ...options });
  }
  
  const buffer = Buffer.from(screenshot, 'base64');
  return { success: true, size: buffer.length, base64Length: screenshot.length, base64: screenshot.substring(0, 100) + '...' };
}

/**
 * 点击
 */
export async function handleClick(params) {
  const { selector, debugPort = DEFAULT_DEBUG_PORT, button = 'left', clickCount = 1, delay = 0 } = params;
  
  const page = await getPage(debugPort);
  await page.click(selector, { button, clickCount, delay });
  
  return { success: true, message: `已点击元素: ${selector}` };
}

/**
 * 输入文本
 */
export async function handleType(params) {
  const { selector, text, delay = 0, debugPort = DEFAULT_DEBUG_PORT, clear = false } = params;
  
  const page = await getPage(debugPort);
  
  if (clear) {
    await page.click(selector, { clickCount: 3 });
    await page.keyboard.press('Backspace');
  }
  
  await page.type(selector, text, { delay });
  
  return { success: true, message: `已在 ${selector} 中输入文本` };
}

/**
 * 按键
 */
export async function handlePress(params) {
  const { key, debugPort = DEFAULT_DEBUG_PORT, modifiers = [] } = params;
  
  const page = await getPage(debugPort);
  
  for (const mod of modifiers) await page.keyboard.down(mod);
  await page.keyboard.press(key);
  for (const mod of modifiers) await page.keyboard.up(mod);
  
  return { success: true, message: `已按键: ${modifiers.join('+')}${key}` };
}

/**
 * 等待
 */
export async function handleWait(params) {
  const { type = 'selector', selector, timeout = 30000, debugPort = DEFAULT_DEBUG_PORT } = params;
  
  const page = await getPage(debugPort);
  
  switch (type) {
    case 'selector':
      if (!selector) return { success: false, error: '等待 selector 类型需要提供 selector 参数' };
      await page.waitForSelector(selector, { timeout });
      return { success: true, message: `元素已出现: ${selector}` };
      
    case 'navigation':
      await page.waitForNavigation({ timeout, waitUntil: 'networkidle2' });
      return { success: true, message: '导航完成' };
      
    case 'timeout':
      await new Promise(resolve => setTimeout(resolve, timeout));
      return { success: true, message: `等待 ${timeout}ms 完成` };
      
    case 'function':
      if (!params.function) return { success: false, error: '等待 function 类型需要提供 function 参数' };
      await page.waitForFunction(params.function, { timeout }, params.args);
      return { success: true, message: '函数条件满足' };
      
    default:
      return { success: false, error: `未知的等待类型: ${type}` };
  }
}

/**
 * 执行 JavaScript
 */
export async function handleEvaluate(params) {
  const { script, debugPort = DEFAULT_DEBUG_PORT, args = [] } = params;
  
  const page = await getPage(debugPort);
  const result = await page.evaluate(script, ...args);
  
  return { success: true, result };
}

/**
 * 获取页面内容
 */
export async function handleGetContent(params) {
  const { selector, type = 'html', debugPort = DEFAULT_DEBUG_PORT } = params;
  
  const page = await getPage(debugPort);
  
  let content;
  if (selector) {
    const element = await page.$(selector);
    if (!element) return { success: false, error: `未找到元素: ${selector}` };
    content = type === 'text' ? await element.evaluate(el => el.textContent) : await element.evaluate(el => el.innerHTML);
  } else {
    content = type === 'text' ? await page.evaluate(() => document.body.innerText) : await page.content();
  }
  
  return {
    success: true, type,
    content: content.substring(0, 5000) + (content.length > 5000 ? '...(已截断)' : ''),
    fullLength: content.length
  };
}

/**
 * 列出标签页
 */
export async function handleListTabs(params) {
  const { debugPort = DEFAULT_DEBUG_PORT } = params;
  
  const { browser } = await getPuppeteerConnection(debugPort);
  const pages = await browser.pages();
  
  const tabs = await Promise.all(pages.map(async (page, index) => ({
    index, url: page.url(), title: await page.title().catch(() => '')
  })));
  
  return { success: true, count: tabs.length, tabs };
}

/**
 * 切换标签页
 */
export async function handleSwitchTab(params) {
  const { index, url, debugPort = DEFAULT_DEBUG_PORT } = params;
  
  const { browser } = await getPuppeteerConnection(debugPort);
  const pages = await browser.pages();
  
  let targetPage = null;
  if (index !== undefined) {
    targetPage = pages[index];
  } else if (url) {
    targetPage = pages.find(p => p.url().includes(url));
  }
  
  if (!targetPage) return { success: false, error: '未找到指定的标签页' };
  
  await targetPage.bringToFront();
  return { success: true, message: '已切换标签页', url: targetPage.url() };
}

/**
 * Cookie 操作
 */
export async function handleCookies(params) {
  const { action = 'get', debugPort = DEFAULT_DEBUG_PORT, ...cookieParams } = params;
  
  const page = await getPage(debugPort);
  const context = page.context || page.browserContext;
  
  switch (action) {
    case 'get': {
      let cookies = await context.cookies();
      if (cookieParams.domain) cookies = cookies.filter(c => c.domain.includes(cookieParams.domain));
      if (cookieParams.name) cookies = cookies.filter(c => c.name.includes(cookieParams.name));
      return { success: true, cookies };
    }
    case 'set':
      await context.addCookies(cookieParams.cookies);
      return { success: true, count: cookieParams.cookies.length };
      
    case 'delete':
      if (cookieParams.all) {
        await context.clearCookies();
        return { success: true, message: '所有 Cookie 已清除' };
      }
      await context.clearCookies();
      return { success: true, message: 'Cookie 已清除' };
      
    default:
      return { success: false, error: `未知的 Cookie 操作: ${action}` };
  }
}
