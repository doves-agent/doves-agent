#!/usr/bin/env node

/**
 * 跨平台环境配置命令
 * 支持 Windows、Linux、macOS 一键部署
 */

import { program } from 'commander';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, existsSync, chmodSync, unlinkSync, readdirSync, readFileSync, appendFileSync } from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 检测是否为打包后的可执行文件
// 打包后: __filename 类似 .../release/dove.exe 或 .../release/dove-macos-x64
// 开发模式: __filename 类似 .../cli/commands/setup.js
const IS_PACKAGED = __filename.includes('release') || 
                    __filename.endsWith('.exe') || 
                    !__filename.includes('commands');

// 获取 CLI 目录
// 打包后: exe 所在的 release 目录
// 开发模式: CLI 目录
const CLI_DIR = IS_PACKAGED ? dirname(__filename) : dirname(dirname(__filename));

const PLATFORM = os.platform();
const IS_WINDOWS = PLATFORM === 'win32';
const IS_MACOS = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';

// 脚本内容模板
const BAT_CONTENT = `@echo off
node "%~dp0index.js" %*
`;

const SH_CONTENT = `#!/bin/sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/index.js" "$@"
`;

// RC 文件配置
const RC_CONFIG = `
# 白鸽系统 CLI
export PATH="$PATH:${CLI_DIR}"
`;

/**
 * 获取当前用户 PATH 环境变量
 */
function getUserPath() {
  if (IS_WINDOWS) {
    try {
      const result = execSync(
        'powershell -Command "[Environment]::GetEnvironmentVariable(\'Path\', \'User\')"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      return result.trim();
    } catch {
      try {
        const result = execSync('reg query "HKCU\\Environment" /v Path', { encoding: 'utf-8' });
        const match = result.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/);
        return match ? match[1].trim() : '';
      } catch {
        return '';
      }
    }
  } else {
    // Linux/macOS: 返回当前进程的 PATH
    return process.env.PATH || '';
  }
}

/**
 * 检查是否已注册
 */
function isRegistered() {
  if (IS_WINDOWS) {
    const userPath = getUserPath();
    return userPath.toLowerCase().includes(CLI_DIR.toLowerCase());
  } else {
    // Linux/macOS: 检查 rc 文件
    const homeDir = os.homedir();
    const rcFiles = ['.bashrc', '.zshrc', '.bash_profile', '.profile'];
    
    for (const rcFile of rcFiles) {
      const rcPath = join(homeDir, rcFile);
      if (existsSync(rcPath)) {
        try {
          const content = readFileSync(rcPath, 'utf-8');
          if (content.includes(CLI_DIR)) {
            return true;
          }
        } catch {}
      }
    }
    return false;
  }
}

/**
 * 创建脚本文件
 */
function createScripts() {
  console.log('创建脚本文件...');
  
  if (IS_WINDOWS) {
    // Windows: 创建 .bat 文件
    const batPath = join(CLI_DIR, 'dove.bat');
    writeFileSync(batPath, BAT_CONTENT, 'utf-8');
    console.log(`  ✓ 创建 ${batPath}`);
  }
  
  // Linux/macOS/Windows Git Bash: 创建 shell 脚本
  const shPath = join(CLI_DIR, 'dove');
  writeFileSync(shPath, SH_CONTENT, 'utf-8');
  chmodSync(shPath, 0o755);
  console.log(`  ✓ 创建 ${shPath}`);
}

/**
 * 删除脚本文件
 */
function removeScripts() {
  console.log('删除脚本文件...');
  
  const batPath = join(CLI_DIR, 'dove.bat');
  const shPath = join(CLI_DIR, 'dove');
  
  if (existsSync(batPath)) {
    unlinkSync(batPath);
    console.log(`  ✓ 删除 ${batPath}`);
  }
  
  if (existsSync(shPath)) {
    unlinkSync(shPath);
    console.log(`  ✓ 删除 ${shPath}`);
  }
}

/**
 * Windows: 注册到环境变量
 */
function registerWindows() {
  const userPath = getUserPath();
  
  if (userPath.toLowerCase().includes(CLI_DIR.toLowerCase())) {
    console.log('  ✓ PATH 已包含 CLI 目录');
    return true;
  }
  
  const newPath = userPath ? `${userPath};${CLI_DIR}` : CLI_DIR;
  const escapedPath = newPath.replace(/'/g, "''");
  
  try {
    execSync(
      `powershell -Command "[Environment]::SetEnvironmentVariable('Path', '${escapedPath}', 'User')"`,
      { encoding: 'utf-8', stdio: 'inherit' }
    );
    console.log('  ✓ 已添加到用户环境变量');
    return true;
  } catch (error) {
    console.error('  ✗ 注册失败:', error.message);
    return false;
  }
}

/**
 * Windows: 从环境变量移除
 */
function unregisterWindows() {
  const userPath = getUserPath();
  
  if (!userPath.toLowerCase().includes(CLI_DIR.toLowerCase())) {
    console.log('  ✓ PATH 不包含 CLI 目录');
    return true;
  }
  
  const pathParts = userPath.split(';').filter(
    p => p.toLowerCase() !== CLI_DIR.toLowerCase()
  );
  const newPath = pathParts.join(';');
  
  try {
    execSync(
      `powershell -Command "[Environment]::SetEnvironmentVariable('Path', '${newPath}', 'User')"`,
      { encoding: 'utf-8', stdio: 'inherit' }
    );
    console.log('  ✓ 已从用户环境变量移除');
    return true;
  } catch (error) {
    console.error('  ✗ 移除失败:', error.message);
    return false;
  }
}

/**
 * Linux/macOS: 获取当前使用的 shell
 */
function getCurrentShell() {
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('bash')) return 'bash';
  return 'bash'; // 默认
}

/**
 * Linux/macOS: 获取 RC 文件路径
 */
function getRcFilePath() {
  const homeDir = os.homedir();
  const shell = getCurrentShell();
  
  if (shell === 'zsh') {
    return join(homeDir, '.zshrc');
  } else {
    return join(homeDir, '.bashrc');
  }
}

/**
 * Linux/macOS: 注册到 RC 文件
 */
function registerUnix() {
  const rcPath = getRcFilePath();
  
  // 检查是否已存在
  if (existsSync(rcPath)) {
    const content = readFileSync(rcPath, 'utf-8');
    if (content.includes(CLI_DIR)) {
      console.log('  ✓ RC 文件已包含 CLI 路径');
      return true;
    }
  }
  
  // 追加配置
  try {
    const appendContent = `\n# 白鸽系统 CLI (added by dove setup)
export PATH="$PATH:${CLI_DIR}"
`;
    appendFileSync(rcPath, appendContent, 'utf-8');
    console.log(`  ✓ 已添加到 ${rcPath}`);
    return true;
  } catch (error) {
    console.error('  ✗ 写入失败:', error.message);
    return false;
  }
}

/**
 * Linux/macOS: 从 RC 文件移除
 */
function unregisterUnix() {
  const homeDir = os.homedir();
  const rcFiles = ['.bashrc', '.zshrc', '.bash_profile', '.profile'];
  
  for (const rcFile of rcFiles) {
    const rcPath = join(homeDir, rcFile);
    
    if (!existsSync(rcPath)) continue;
    
    try {
      let content = readFileSync(rcPath, 'utf-8');
      
      if (!content.includes(CLI_DIR)) continue;
      
      // 移除包含 CLI_DIR 的行
      const lines = content.split('\n');
      const filteredLines = lines.filter(line => {
        const trimmed = line.trim();
        return !trimmed.includes(CLI_DIR) && 
               !(trimmed.startsWith('# 白鸽系统 CLI') || trimmed.startsWith('#白鸽系统 CLI') || trimmed.startsWith('# Dove CLI') || trimmed.startsWith('#Dove CLI'));
      });
      
      // 移除末尾多余空行
      while (filteredLines.length > 0 && filteredLines[filteredLines.length - 1] === '') {
        filteredLines.pop();
      }
      
      writeFileSync(rcPath, filteredLines.join('\n') + '\n', 'utf-8');
      console.log(`  ✓ 已从 ${rcPath} 移除`);
    } catch (error) {
      console.error(`  ✗ 处理 ${rcPath} 失败:`, error.message);
    }
  }
  
  return true;
}

/**
 * 执行完整安装
 */
function setup() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║          白鸽系统 CLI 跨平台环境配置                    ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`平台: ${PLATFORM}`);
  console.log(`运行模式: ${IS_PACKAGED ? '打包后 (exe)' : '开发模式 (node)'}`);
  console.log(`CLI 目录: ${CLI_DIR}`);
  console.log('');
  
  // 打包模式: 直接注册目录到 PATH（不需要创建脚本）
  // 开发模式: 创建 dove.bat/dove 脚本，然后注册目录
  if (!IS_PACKAGED) {
    // 1. 创建脚本文件
    createScripts();
    console.log('');
  }
  
  // 2. 注册环境变量
  console.log('注册环境变量...');
  let success = false;
  
  if (IS_WINDOWS) {
    success = registerWindows();
  } else {
    success = registerUnix();
  }
  
  console.log('');
  
  if (success) {
    console.log('✅ 安装完成！');
    console.log('');
    console.log('─'.repeat(50));
    console.log('生效方式:');
    
    if (IS_WINDOWS) {
      console.log('  PowerShell: $env:Path = [Environment]::GetEnvironmentVariable("Path", "User")');
      console.log('  CMD/Git Bash: 重新打开终端窗口');
    } else {
      console.log(`  source ${getRcFilePath()}`);
      console.log('  或重新打开终端窗口');
    }
    
    console.log('');
    console.log('可用命令:');
    console.log('  dove --help        查看帮助');
    console.log('  dove login -a      匿名登录');
    console.log('  dove chat          开始对话');
    console.log('  dove status        系统状态');
    console.log('  dove setup -s      查看安装状态');
    console.log('  dove setup -u      卸载');
  } else {
    console.log('❌ 安装失败，请手动配置');
    console.log(`  手动添加到 PATH: ${CLI_DIR}`);
  }
}

/**
 * 卸载
 */
function uninstall() {
  console.log('');
  console.log('卸载 白鸽系统 CLI 环境配置...');
  console.log('');
  
  // 打包模式: 不需要删除脚本（exe 就是程序本身）
  // 开发模式: 删除 dove.bat/dove 脚本
  if (!IS_PACKAGED) {
    removeScripts();
  }
  
  // 移除环境变量
  console.log('移除环境变量...');
  
  if (IS_WINDOWS) {
    unregisterWindows();
  } else {
    unregisterUnix();
  }
  
  console.log('');
  console.log('✅ 卸载完成！');
}

/**
 * 查看状态
 */
function showStatus() {
  console.log('');
  console.log('白鸽系统 CLI 环境配置状态:');
  console.log('─'.repeat(50));
  console.log(`平台: ${PLATFORM}`);
  console.log(`运行模式: ${IS_PACKAGED ? '打包后 (exe)' : '开发模式 (node)'}`);
  console.log(`CLI 目录: ${CLI_DIR}`);
  console.log(`注册状态: ${isRegistered() ? '✓ 已注册' : '✗ 未注册'}`);
  console.log('');
  
  // 打包模式: 显示 exe 文件
  // 开发模式: 显示脚本文件
  if (IS_PACKAGED) {
    const exeName = IS_WINDOWS ? 'dove.exe' : 'dove';
    const exePath = join(CLI_DIR, exeName);
    console.log(`可执行文件: ${existsSync(exePath) ? '✓ 存在' : '✗ 不存在'}`);
    console.log(`  ${exePath}`);
  } else {
    const batPath = join(CLI_DIR, 'dove.bat');
    const shPath = join(CLI_DIR, 'dove');
    
    console.log('脚本文件:');
    if (IS_WINDOWS) {
      console.log(`  dove.bat: ${existsSync(batPath) ? '✓ 存在' : '✗ 不存在'}`);
    }
    console.log(`  dove (sh): ${existsSync(shPath) ? '✓ 存在' : '✗ 不存在'}`);
  }
  
  if (isRegistered()) {
    console.log('');
    console.log('可用命令:');
    console.log('  dove --help        查看帮助');
    console.log('  dove login -a      匿名登录');
    console.log('  dove chat          开始对话');
  } else {
    console.log('');
    console.log('运行以下命令安装:');
    console.log('  dove setup');
  }
}

// 命令定义
export const setupCommand = program
  .command('setup')
  .description('安装/卸载 白鸽系统 CLI 到系统环境（跨平台）')
  .option('-u, --uninstall', '卸载环境配置')
  .option('-s, --status', '查看安装状态')
  .action((options) => {
    if (options.uninstall) {
      uninstall();
    } else if (options.status) {
      showStatus();
    } else {
      setup();
    }
  });
