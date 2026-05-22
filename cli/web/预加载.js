/**
 * 预加载模块
 * 启动 Web 服务前，将核心页面 + 已安装扩展页面统一收集到 ~/.dove/web-root/
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig } from '../lib/config.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEB_ROOT = path.join(os.homedir(), '.dove', 'web-root');
const PUBLIC_DIR = path.join(__dirname, 'public');
const EXTENSIONS_DIR = path.resolve(__dirname, '../../doves/extensions');

export function 获取WebRoot() {
  return WEB_ROOT;
}

/**
 * 执行预加载
 * @param {object} options
 * @param {boolean} options.force - 强制全量复制（忽略版本检测）
 * @param {Function} options.onProgress - 进度回调 (message: string)
 * @returns {Promise<{ coreFiles: number, extensions: string[] }>}
 */
export async function 预加载(options = {}) {
  const { force = false, onProgress = () => {} } = options;

  onProgress('准备 web-root 目录...');
  确保目录存在(WEB_ROOT);

  onProgress('复制核心页面...');
  const coreFiles = 复制核心页面(force);

  onProgress('扫描已安装扩展...');
  const extensions = await 加载扩展页面(options);

  onProgress('生成扩展注册表...');
  生成注册表(extensions);

  onProgress(`预加载完成: ${coreFiles} 核心文件, ${extensions.length} 个扩展`);

  return { coreFiles, extensions: extensions.map(e => e.name) };
}

/**
 * 复制核心页面到 web-root
 */
function 复制核心页面(force) {
  if (!fs.existsSync(PUBLIC_DIR)) {
    throw new Error(`核心页面目录不存在: ${PUBLIC_DIR}`);
  }
  return 递归复制(PUBLIC_DIR, WEB_ROOT, force);
}

/**
 * 加载所有已安装扩展的 web 页面
 */
async function 加载扩展页面(options) {
  const { force = false, onProgress = () => {} } = options;
  const extDir = path.join(WEB_ROOT, 'ext');
  确保目录存在(extDir);

  const config = loadConfig();
  const installed = config.installedExtensions || [];

  const results = [];

  for (const extName of installed) {
    const manifest = 读取扩展Manifest(extName);
    if (!manifest?.web) continue;

    onProgress(`加载扩展: ${extName}`);
    const extWebSrc = path.join(EXTENSIONS_DIR, extName, manifest.web.root || 'web');
    const extWebDest = path.join(extDir, extName);

    if (fs.existsSync(extWebSrc)) {
      确保目录存在(extWebDest);
      递归复制(extWebSrc, extWebDest, force);
      results.push({
        name: extName,
        nav: manifest.web.nav || {},
        pages: manifest.web.pages || {}
      });
    }
  }

  // 开发模式：扫描所有带 web/ 的扩展（无论是否安装）
  if (process.env.DOVE_DEV_MODE === 'true' || !installed.length) {
    const devExtensions = 扫描开发扩展(installed);
    for (const ext of devExtensions) {
      if (results.find(r => r.name === ext.name)) continue;
      onProgress(`加载开发扩展: ${ext.name}`);
      const extWebDest = path.join(extDir, ext.name);
      确保目录存在(extWebDest);
      递归复制(ext.webDir, extWebDest, force);
      results.push(ext);
    }
  }

  return results;
}

/**
 * 扫描开发目录中带 web/ 的扩展
 */
function 扫描开发扩展(excludeNames) {
  if (!fs.existsSync(EXTENSIONS_DIR)) return [];

  const results = [];
  const dirs = fs.readdirSync(EXTENSIONS_DIR, { withFileTypes: true });

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    if (dir.name.startsWith('_') || dir.name.startsWith('.')) continue;
    if (excludeNames.includes(dir.name)) continue;

    const webDir = path.join(EXTENSIONS_DIR, dir.name, 'web');
    if (!fs.existsSync(webDir)) continue;

    const manifest = 读取扩展Manifest(dir.name);
    if (!manifest?.web) continue;

    results.push({
      name: dir.name,
      nav: manifest.web.nav || {},
      pages: manifest.web.pages || {},
      webDir
    });
  }

  return results;
}

/**
 * 读取扩展 manifest.js 中的 web 配置
 * 使用正则解析避免执行 manifest 代码
 */
function 读取扩展Manifest(extName) {
  const manifestPath = path.join(EXTENSIONS_DIR, extName, 'manifest.js');
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    return 解析Manifest(content);
  } catch {
    return null;
  }
}

/**
 * 从 manifest.js 文本中提取 web 配置
 */
function 解析Manifest(content) {
  const result = { web: null };

  // 提取 name
  const nameMatch = content.match(/name:\s*['"`]([^'"`]+)['"`]/);
  if (nameMatch) result.name = nameMatch[1];

  // 检测是否包含 web 字段
  const webIdx = content.indexOf('web:');
  if (webIdx === -1) return result;

  // 提取 web 块（花括号匹配）
  const webBlock = 提取花括号块(content, webIdx);
  if (!webBlock) return result;

  const web = {};

  // root
  const rootMatch = webBlock.match(/root:\s*['"`]([^'"`]+)['"`]/);
  web.root = rootMatch ? rootMatch[1] : 'web';

  // nav
  const navBlock = 提取花括号块(webBlock, webBlock.indexOf('nav:'));
  if (navBlock) {
    const iconMatch = navBlock.match(/icon:\s*['"`]([^'"`]+)['"`]/);
    const labelMatch = navBlock.match(/label:\s*['"`]([^'"`]+)['"`]/);
    web.nav = { icon: iconMatch?.[1] || '', label: labelMatch?.[1] || '' };
  }

  // pages
  const pagesBlock = 提取花括号块(webBlock, webBlock.indexOf('pages:'));
  if (pagesBlock) {
    web.pages = {};
    const pagePattern = /['"`]?(\S+?)['"`]?\s*:\s*\{([^}]+)\}/g;
    let match;
    while ((match = pagePattern.exec(pagesBlock))) {
      const slug = match[1];
      const block = match[2];
      const titleMatch = block.match(/title:\s*['"`]([^'"`]+)['"`]/);
      const entryMatch = block.match(/entry:\s*['"`]([^'"`]+)['"`]/);
      if (titleMatch && entryMatch) {
        web.pages[slug] = { title: titleMatch[1], entry: entryMatch[1] };
      }
    }
  }

  result.web = web;
  return result;
}

/**
 * 从指定位置开始提取第一个完整的花括号块
 */
function 提取花括号块(str, startIdx) {
  if (startIdx === -1 || startIdx === undefined) return null;
  const openIdx = str.indexOf('{', startIdx);
  if (openIdx === -1) return null;

  let depth = 0;
  for (let i = openIdx; i < str.length; i++) {
    if (str[i] === '{') depth++;
    if (str[i] === '}') depth--;
    if (depth === 0) return str.slice(openIdx, i + 1);
  }
  return null;
}

/**
 * 生成扩展注册表 _registry.json
 */
function 生成注册表(extensions) {
  const registry = extensions.map(ext => ({
    name: ext.name,
    nav: ext.nav,
    pages: ext.pages
  }));

  const registryPath = path.join(WEB_ROOT, 'ext', '_registry.json');
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}

/**
 * 单个扩展热加载（新安装时调用）
 */
export function 加载单个扩展(extName) {
  const manifest = 读取扩展Manifest(extName);
  if (!manifest?.web) return null;

  const extWebSrc = path.join(EXTENSIONS_DIR, extName, manifest.web.root || 'web');
  const extWebDest = path.join(WEB_ROOT, 'ext', extName);

  if (!fs.existsSync(extWebSrc)) return null;

  确保目录存在(extWebDest);
  递归复制(extWebSrc, extWebDest, true);

  // 更新注册表
  const registryPath = path.join(WEB_ROOT, 'ext', '_registry.json');
  let registry = [];
  if (fs.existsSync(registryPath)) {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  }

  registry = registry.filter(e => e.name !== extName);
  registry.push({
    name: extName,
    nav: manifest.web.nav || {},
    pages: manifest.web.pages || {}
  });

  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));

  return { name: extName, nav: manifest.web.nav, pages: manifest.web.pages };
}

/**
 * 移除扩展（卸载时调用）
 */
export function 移除扩展(extName) {
  const extWebDest = path.join(WEB_ROOT, 'ext', extName);
  if (fs.existsSync(extWebDest)) {
    fs.rmSync(extWebDest, { recursive: true, force: true });
  }

  const registryPath = path.join(WEB_ROOT, 'ext', '_registry.json');
  if (fs.existsSync(registryPath)) {
    let registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    registry = registry.filter(e => e.name !== extName);
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  }
}

// ==================== 工具函数 ====================

function 确保目录存在(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function 递归复制(src, dest, force = false) {
  let count = 0;
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      确保目录存在(destPath);
      count += 递归复制(srcPath, destPath, force);
    } else {
      if (!force && fs.existsSync(destPath)) {
        const srcStat = fs.statSync(srcPath);
        const destStat = fs.statSync(destPath);
        if (srcStat.mtimeMs <= destStat.mtimeMs) continue;
      }
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }

  return count;
}
