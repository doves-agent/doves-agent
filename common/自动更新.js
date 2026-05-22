/**
 * @file 自动更新
 * @description 白鸽自动更新模块
 *
 * 更新策略：
 * - Doves（静默）：启动时检查 → 已下载完则替换重启 / 未下载完则启动当前版并后台下载
 * - CLI（交互）：启动时检查 → 提示用户确认 → 下载并替换重启
 * - 新版本启动成功后才删除旧版本 .old 文件
 *
 * OSS 版本清单格式（{OSS_PREFIX}/releases/version.json）：
 * {
 *   "version": "0.0.31",
 *   "platforms": {
 *     "win32":       { "doves": { "url": "...", "size": N, "sha256": "..." }, "cli": {...} },
 *     "linux":       { ... },
 *     "darwin":       { ... },
 *     "darwin-arm64": { ... }
 *   }
 * }
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';
import { 当前版本, 获取组件名 } from '@dove/common/版本信息.js';
import {
  createWriteStream, existsSync, renameSync, unlinkSync,
  writeFileSync, readFileSync, statSync,
} from 'fs';
import { join, dirname } from 'path';
import { platform, arch, tmpdir } from 'os';
import { spawn, execFileSync } from 'child_process';
import { createHash } from 'crypto';

const logger = 创建日志器('自动更新', { 前缀: '[更新]', 级别: 'debug', 显示调用位置: true });

// ==================== 配置 ====================

const UPDATE_BASE_URL = process.env.UPDATE_BASE_URL
  || `https://${process.env.OSS_BUCKET || 'pai-cxx-oss'}.${process.env.OSS_REGION || 'oss-cn-beijing'}.aliyuncs.com`;

const OSS_PREFIX = process.env.OSS_PREFIX || 'dove';
const VERSION_MANIFEST_PATH = process.env.UPDATE_MANIFEST_PATH || `${OSS_PREFIX}/releases/version.json`;
const CHECK_TIMEOUT = 5000;
const DOWNLOAD_TIMEOUT = 600000; // 10 分钟

// ==================== 工具函数 ====================

function 获取平台() {
  const p = platform();
  const a = arch();
  if (p === 'win32') return 'win32';
  if (p === 'darwin') return a === 'arm64' ? 'darwin-arm64' : 'darwin';
  return 'linux';
}

function 获取更新组件名() {
  const 组件 = 获取组件名();
  // 组件名映射：cli → cli，doves → doves
  return 组件 === 'cli' ? 'cli' : 'doves';
}

function 是否编译二进制() {
  const basename = process.execPath.split(/[/\\]/).pop().toLowerCase();
  // node/bun 解释器不是编译二进制，跳过更新
  if (/^node(\.exe)?$/.test(basename) || /^bun(\.exe)?$/.test(basename)) return false;
  return true;
}

function 获取当前路径() { return process.execPath; }
function 获取新版本路径() { return 获取当前路径() + '.new'; }
function 获取旧版本路径() { return 获取当前路径() + '.old'; }
function 获取元数据路径() { return 获取当前路径() + '.new.meta'; }
function 获取临时下载路径() { return 获取当前路径() + '.downloading'; }

/** 语义化版本比较：a > b 正数，a < b 负数，a == b 零 */
function 比较版本(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

// ==================== 核心逻辑 ====================

/**
 * 从 OSS 拉取版本清单
 * @returns {Object|null}
 */
async function 拉取版本清单() {
  const url = `${UPDATE_BASE_URL}/${VERSION_MANIFEST_PATH}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      logger.warn(`版本清单获取失败: HTTP ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.debug('版本清单获取超时，跳过更新检查');
    } else {
      logger.warn(`版本清单获取失败: ${error.message}`);
    }
    return null;
  }
}

/**
 * 从版本清单中获取当前平台的更新信息
 */
function 获取平台更新信息(清单) {
  const 平台标识 = 获取平台();
  const 组件名 = 获取更新组件名();
  const 平台信息 = 清单.platforms?.[平台标识];
  if (!平台信息) {
    logger.debug(`版本清单中无 ${平台标识} 平台信息`);
    return null;
  }
  const 组件信息 = 平台信息[组件名];
  if (!组件信息) {
    logger.debug(`版本清单中无 ${组件名} 组件信息`);
    return null;
  }
  return {
    version: 清单.version,
    url: 组件信息.url.startsWith('http') ? 组件信息.url : `${UPDATE_BASE_URL}/${组件信息.url}`,
    size: 组件信息.size,
    sha256: 组件信息.sha256,
  };
}

/**
 * 检查是否有更新
 * @returns {Object|null} 更新信息或 null
 */
export async function 检查更新() {
  const 清单 = await 拉取版本清单();
  if (!清单) return null;

  const 最新版本 = 清单.version;
  if (比较版本(最新版本, 当前版本) <= 0) {
    logger.debug(`当前已是最新版本 ${当前版本}`);
    return null;
  }

  const 更新信息 = 获取平台更新信息(清单);
  if (!更新信息) return null;

  logger.info(`发现新版本: ${最新版本}（当前: ${当前版本}）`);
  return 更新信息;
}

/**
 * 验证文件完整性（大小 + SHA256）
 */
function 验证文件(文件路径, 信息) {
  try {
    const stat = statSync(文件路径);
    if (信息.size && stat.size !== 信息.size) {
      logger.warn(`文件大小不匹配: 期望 ${信息.size}, 实际 ${stat.size}`);
      return false;
    }
    if (信息.sha256) {
      const hash = createHash('sha256');
      const data = readFileSync(文件路径);
      if (hash.update(data).digest('hex') !== 信息.sha256) {
        logger.warn('文件校验失败: SHA256 不匹配');
        return false;
      }
    }
    return true;
  } catch (error) {
    logger.warn(`文件验证失败: ${error.message}`);
    return false;
  }
}

/**
 * 流式下载文件（Web API 兼容 Node.js/Bun）
 */
async function 流式下载(response, 目标路径, onProgress) {
  const totalSize = parseInt(response.headers.get('content-length') || '0');
  let downloaded = 0;
  const fileStream = createWriteStream(目标路径);
  const reader = response.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(Buffer.from(value));
      downloaded += value.length;
      if (onProgress) onProgress(downloaded, totalSize);
    }
    fileStream.end();
    await new Promise((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });
  } catch (error) {
    fileStream.destroy();
    throw error;
  }
}

/**
 * 下载更新文件
 * @param {Object} 更新信息 - { url, size, sha256 }
 * @param {Function} [onProgress] - (downloaded, total)
 * @returns {string} 下载完成后的文件路径
 */
export async function 下载更新(更新信息, onProgress = null) {
  const 目标路径 = 获取新版本路径();
  const 临时路径 = 获取临时下载路径();

  logger.info(`开始下载: ${更新信息.url}`);

  // 清理上次中断的临时文件
  try { unlinkSync(临时路径); } catch (e) { logger.debug(`清理临时文件失败: ${e.message}`); }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);

  try {
    const response = await fetch(更新信息.url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) throw new Error(`下载失败: HTTP ${response.status}`);

    await 流式下载(response, 临时路径, onProgress);

    // 验证下载文件
    if (更新信息.sha256 || 更新信息.size) {
      if (!验证文件(临时路径, 更新信息)) {
        unlinkSync(临时路径);
        throw new Error('下载文件校验失败');
      }
    }

    // 下载完成，重命名为 .new
    renameSync(临时路径, 目标路径);

    // 写元数据文件
    writeFileSync(获取元数据路径(), JSON.stringify({
      version: 更新信息.version,
      sha256: 更新信息.sha256,
      size: 更新信息.size,
      下载时间: new Date().toISOString(),
    }));

    logger.info(`下载完成: ${目标路径}`);
    return 目标路径;
  } catch (error) {
    clearTimeout(timer);
    try { unlinkSync(临时路径); } catch (e) { logger.debug(`清理下载临时文件失败: ${e.message}`); }
    throw error;
  }
}

/**
 * 检查是否有已下载完成的新版本
 */
function 存在已下载新版本() {
  const newPath = 获取新版本路径();
  const metaPath = 获取元数据路径();
  if (!existsSync(newPath) || !existsSync(metaPath)) return false;

  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    if (meta.sha256 || meta.size) {
      return 验证文件(newPath, meta);
    }
    return true;
  } catch (e) {
    logger.debug(`检查已下载版本失败: ${e.message}`);
    return false;
  }
}

/**
 * 写跨平台重启脚本
 */
function 写重启脚本(当前路径, 新路径) {
  const isWin = platform() === 'win32';
  const 脚本路径 = join(tmpdir(), `dove-update-${Date.now()}${isWin ? '.bat' : '.sh'}`);
  const 当前目录 = dirname(当前路径);
  const 参数 = process.argv.slice(1).map(a => a.includes(' ') ? `"${a}"` : a).join(' ');
  const 旧路径 = 获取旧版本路径();

  let 脚本内容;
  if (isWin) {
    脚本内容 = `@echo off
chcp 65001 >nul 2>&1
echo [白鸽更新] 等待当前进程退出...
timeout /t 2 /nobreak >nul
echo [白鸽更新] 替换文件...
move /y "${当前路径}" "${旧路径}" 2>nul
move /y "${新路径}" "${当前路径}"
echo [白鸽更新] 启动新版本...
cd /d "${当前目录}"
start "" "${当前路径}" ${参数}
del "${脚本路径}" 2>nul
exit
`;
  } else {
    脚本内容 = `#!/bin/bash
echo "[白鸽更新] 等待当前进程退出..." >&2
sleep 2
echo "[白鸽更新] 替换文件..." >&2
mv -f "${当前路径}" "${旧路径}" 2>/dev/null
mv -f "${新路径}" "${当前路径}"
chmod +x "${当前路径}"
echo "[白鸽更新] 启动新版本..." >&2
cd "${当前目录}"
"${当前路径}" ${参数} &
rm -f "${脚本路径}"
exit 0
`;
  }

  writeFileSync(脚本路径, 脚本内容, 'utf-8');
  if (!isWin) {
    try { execFileSync('chmod', ['+x', 脚本路径]); } catch (e) { logger.debug(`chmod 失败: ${e.message}`); }
  }

  logger.debug(`重启脚本已写入: ${脚本路径}`);
  return 脚本路径;
}

/**
 * 执行更新：替换当前二进制并重启
 * 此函数不会返回——进程会退出
 */
export async function 执行更新并重启() {
  const 当前路径 = 获取当前路径();
  const 新路径 = 获取新版本路径();

  if (!existsSync(新路径)) {
    throw new Error(`新版本文件不存在: ${新路径}`);
  }

  logger.info('正在执行更新替换...');

  const 重启脚本路径 = 写重启脚本(当前路径, 新路径);

  const isWin = platform() === 'win32';
  const 命令 = isWin ? 'cmd' : '/bin/sh';
  const 参数 = isWin ? ['/c', 重启脚本路径] : [重启脚本路径];

  const child = spawn(命令, 参数, { detached: true, stdio: 'ignore' });
  child.unref();

  logger.info('重启脚本已启动，当前进程退出...');
  process.exit(0);
}

/**
 * 清理旧版本文件（新版本启动成功后调用）
 */
export function 清理旧版本() {
  const 旧路径 = 获取旧版本路径();
  const 元数据路径 = 获取元数据路径();

  if (existsSync(旧路径)) {
    try {
      unlinkSync(旧路径);
      logger.info('已清理旧版本文件');
    } catch (error) {
      logger.warn(`清理旧版本失败: ${error.message}`);
    }
  }

  if (existsSync(元数据路径)) {
    try { unlinkSync(元数据路径); } catch (e) { logger.debug(`清理元数据文件失败: ${e.message}`); }
  }
}

/**
 * 清理中断的下载临时文件
 */
function 清理下载临时文件() {
  const 临时路径 = 获取临时下载路径();
  if (existsSync(临时路径)) {
    try { unlinkSync(临时路径); } catch (e) { logger.debug(`清理下载临时文件失败: ${e.message}`); }
  }
}

// ==================== Doves 静默更新入口 ====================

/**
 * Doves 静默自动更新
 * - 已下载完的新版本 → 替换重启
 * - 未下载完 → 启动当前版本，后台继续下载
 * - 新版启动成功后自动清理旧版
 */
export async function doves静默更新() {
  // 非编译二进制（node 开发模式）跳过更新
  if (!是否编译二进制()) {
    logger.debug('开发模式，跳过自动更新');
    return;
  }

  try {
    // 1. 清理上次残留
    清理旧版本();
    清理下载临时文件();

    // 2. 已下载完的新版本 → 直接替换重启
    if (存在已下载新版本()) {
      logger.info('检测到已下载的新版本，准备替换重启...');
      await 执行更新并重启();
      return; // 不会执行到这里
    }

    // 3. 检查远端更新
    const 更新信息 = await 检查更新();
    if (!更新信息) return; // 无更新

    // 4. 后台下载（不阻塞当前启动）
    logger.info('后台开始下载新版本...');
    下载更新(更新信息).then(() => {
      logger.info('新版本后台下载完成，下次重启将自动更新');
    }).catch(error => {
      logger.warn(`后台下载失败: ${error.message}`);
    });
  } catch (error) {
    logger.warn(`自动更新检查失败: ${error.message}`);
  }
}

// ==================== CLI 交互式更新入口 ====================

/**
 * CLI 交互式更新检查
 * - 提示用户确认 → 下载 → 替换重启
 * - 新版启动成功后自动清理旧版
 */
export async function cli检查更新() {
  // 非编译二进制跳过更新
  if (!是否编译二进制()) return;

  try {
    // 1. 清理残留
    清理旧版本();
    清理下载临时文件();

    // 2. 已下载完的新版本 → 直接替换重启
    if (存在已下载新版本()) {
      console.log('检测到已下载的新版本，准备更新重启...');
      await 执行更新并重启();
      return;
    }

    // 3. 检查远端更新
    const 更新信息 = await 检查更新();
    if (!更新信息) return;

    // 4. 提示用户
    console.log(`\n🔄 发现新版本: ${更新信息.version}（当前: ${当前版本}）`);

    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => {
      rl.question('是否立即更新? [Y/n] ', resolve);
    });
    rl.close();

    if (answer.toLowerCase() === 'n') {
      console.log('已跳过本次更新');
      return;
    }

    // 5. 下载并替换
    console.log('正在下载更新...');
    await 下载更新(更新信息, (downloaded, total) => {
      if (total > 0) {
        const percent = Math.floor(downloaded / total * 100);
        const dMB = (downloaded / 1024 / 1024).toFixed(1);
        const tMB = (total / 1024 / 1024).toFixed(1);
        process.stdout.write(`\r下载进度: ${percent}% (${dMB}MB / ${tMB}MB)`);
      }
    });
    console.log('\n下载完成，准备更新重启...');
    await 执行更新并重启();
  } catch (error) {
    console.error(`更新失败: ${error.message}`);
  }
}
