/**
 * @file utils/环境上下文
 * @description 提供运行环境上下文信息，注入到 LLM system prompt
 * 让 LLM 了解当前运行环境（操作系统、架构、用户、Shell等），
 * 避免因环境信息缺失导致错误的命令选择（如在 macOS 上使用 Windows 命令）
 */

import os from 'os';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('环境上下文', { 前缀: '[环境上下文]', 级别: 'debug' });

let _cachedContext = null;
let _cachedPlatformHints = null;

/**
 * 获取当前运行环境上下文（缓存，进程生命周期内不变）
 * 简洁格式，直接注入到 system prompt
 * @returns {string} 环境上下文描述
 */
export function 获取环境上下文() {
  if (_cachedContext) return _cachedContext;

  const platform = os.platform();
  const arch = os.arch();
  const username = os.userInfo().username;
  const homedir = os.homedir();
  const shell = os.userInfo().shell || (platform === 'win32' ? 'cmd.exe' : '/bin/sh');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // 平台名称与版本
  let platformName;
  let osVersion = os.release();
  if (platform === 'darwin') {
    platformName = 'macOS';
    try { osVersion = execSync('sw_vers -productVersion', { encoding: 'utf-8', timeout: 3000 }).trim(); } catch (e) { logger.debug(`获取macOS版本失败: ${e.message}`); }
  } else if (platform === 'win32') {
    platformName = 'Windows';
  } else if (platform === 'linux') {
    platformName = 'Linux';
    try {
      if (existsSync('/etc/os-release')) {
        const content = readFileSync('/etc/os-release', 'utf-8');
        const nameMatch = content.match(/^PRETTY_NAME="(.+?)"/m);
        if (nameMatch) osVersion = nameMatch[1];
      }
    } catch (e) { logger.debug(`获取Linux发行版信息失败: ${e.message}`); }
  } else {
    platformName = os.type();
  }

  // 环境类型（简洁检测，完整检测由 环境检测.js 负责）
  let envType = '物理机';
  try {
    if (existsSync('/.dockerenv') || existsSync('/.dockerinit')) {
      envType = 'Docker';
    }
  } catch (e) { logger.debug(`Docker环境检测失败: ${e.message}`); }

  // 包管理器（快速检测，只查最常见的前3个）
  let packageManager = '';
  const pkgCandidates = platform === 'darwin' ? [['brew', 'Homebrew']]
    : platform === 'win32' ? [['winget', 'winget'], ['choco', 'Chocolatey']]
    : [['apt-get', 'apt'], ['yum', 'yum'], ['dnf', 'dnf']];
  const foundPkg = [];
  for (const [cmd, name] of pkgCandidates) {
    try {
      execSync(platform === 'win32' ? `where ${cmd} 2>nul` : `which ${cmd} 2>/dev/null`, { encoding: 'utf-8', timeout: 3000 });
      foundPkg.push(name);
    } catch (e) { logger.debug(`包管理器 ${name} 检测失败: ${e.message}`); }
  }
  if (foundPkg.length > 0) packageManager = foundPkg.join('/');

  // 构建简洁上下文（控制 token 消耗，核心信息一行搞定）
  const parts = [`平台: ${platformName} ${osVersion}(${arch})`];
  parts.push(`用户: ${username} | 家: ${homedir}`);
  parts.push(`Shell: ${shell} | 时区: ${timezone}`);
  if (envType !== '物理机') parts.push(`环境: ${envType}`);
  if (packageManager) parts.push(`包管理: ${packageManager}`);

  _cachedContext = parts.join('\n');
  return _cachedContext;
}

/**
 * 获取平台特定的操作提示（注入到系统提示词的执行规则中）
 * 让 LLM 一眼知道该用什么命令打开应用、查找进程等
 * @returns {string} 平台操作提示（2-3 行，极简）
 */
export function 获取平台操作提示() {
  if (_cachedPlatformHints) return _cachedPlatformHints;

  const platform = os.platform();

  if (platform === 'darwin') {
    _cachedPlatformHints = `- macOS: 打开应用用 open -a 应用名 (如 open -a Calculator); 进程查找用 pgrep -l 名称`;
  } else if (platform === 'win32') {
    _cachedPlatformHints = `- Windows: 打开应用直接运行应用名 (如 calc, notepad); 进程查找用 tasklist`;
  } else if (platform === 'linux') {
    _cachedPlatformHints = `- Linux: 打开应用用 gtk-launch 或直接运行; 进程查找用 pgrep -l 名称`;
  } else {
    _cachedPlatformHints = '';
  }

  return _cachedPlatformHints;
}
