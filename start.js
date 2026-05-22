#!/usr/bin/env node
/**
 * 白鸽跨平台发布启动脚本
 * 
 * Server 和 Doves 完全独立进程启动，通过 HTTP 通信。
 * 
 * 使用方法：
 *   node start.js                    # 默认：服务端 + 3个鸽子
 *   node start.js --doves=1          # 服务端 + 1个鸽子
 *   node start.js --doves=5          # 服务端 + 5个鸽子
 *   node start.js --server-only      # 只启动服务端
 *   node start.js --doves-only       # 只启动鸽子（3个）
 *   node start.js --doves-only=5     # 只启动鸽子（5个）
 *   node start.js --port=3003        # 自定义加密TCP端口
 * 
 * npm scripts：
 *   npm run prod:server       # 只启动服务端
 *   npm run prod:doves        # 只启动3鸽子
 *   npm run prod:doves:1      # 只启动1鸽子
 *   npm run prod:doves:5      # 只启动5鸽子
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 检查必要文件是否存在
const requiredFiles = [
  'server/index.js',
  'doves/入口.js',
  'node_modules/dotenv'
];

const missingFiles = requiredFiles.filter(f => !existsSync(join(__dirname, f)));
if (missingFiles.length > 0) {
  console.error('');
  console.error('❌ 错误：缺少必要文件或依赖：');
  missingFiles.forEach(f => console.error(`   - ${f}`));
  console.error('');
  console.error('请确保：');
  console.error('  1. 在 白鸽系统 目录下运行此脚本');
  console.error('  2. 已执行 npm install 安装依赖');
  console.error('');
  console.error('安装依赖：');
  console.error('  npm run install:all');
  console.error('');
  process.exit(1);
}

// 解析命令行参数
const args = process.argv.slice(2);
let doves = 3;
let server = true;
let port = null;
let debug = false;

for (const arg of args) {
  if (arg === '--server-only') {
    server = true;
    doves = 0;
  } else if (arg === '--doves-only') {
    server = false;
    doves = 3;
  } else if (arg.startsWith('--doves-only=')) {
    server = false;
    doves = parseInt(arg.split('=')[1], 10) || 3;
  } else if (arg.startsWith('--doves=')) {
    doves = parseInt(arg.split('=')[1], 10) || 3;
  } else if (arg.startsWith('--port=')) {
    port = parseInt(arg.split('=')[1], 10);
  } else if (arg === '--debug') {
    debug = true;
    process.env.DOVE_DEBUG = '1';
  }
}

console.log('===========================================');
console.log('白鸽发布启动（独立进程模式）');
console.log('===========================================');
console.log(`服务端: ${server ? '开启' : '关闭'}`);
console.log(`鸽子数: ${doves}`);
if (port) console.log(`端口: ${port}`);
if (debug) console.log('调试模式: 开启');
console.log('===========================================');
console.log('');

const children = [];

// 启动 Server 独立进程
if (server) {
  const serverArgs = [];
  if (port) serverArgs.push(`--port=${port}`);
  if (debug) serverArgs.push('--debug');
  
  console.log('[启动] 启动 Server 进程...');
  const serverChild = spawn(process.execPath, [join(__dirname, 'server', 'index.js'), ...serverArgs], {
    stdio: 'inherit',
    env: { ...process.env },
    cwd: __dirname
  });
  children.push({ name: 'Server', child: serverChild });
}

// 启动 Doves 独立进程
if (doves > 0) {
  const dovesArgs = [`--doves=${doves}`];
  if (debug) dovesArgs.push('--debug');
  
  console.log(`[启动] 启动 Doves 进程 (${doves}只)...`);
  const dovesChild = spawn(process.execPath, [join(__dirname, 'doves', '入口.js'), ...dovesArgs], {
    stdio: 'inherit',
    env: { ...process.env },
    cwd: __dirname
  });
  children.push({ name: 'Doves', child: dovesChild });
}

if (children.length === 0) {
  console.error('[启动] 没有服务需要启动');
  process.exit(1);
}

// 信号转发
process.on('SIGTERM', () => {
  children.forEach(({ child }) => child.kill('SIGTERM'));
});
process.on('SIGINT', () => {
  children.forEach(({ child }) => child.kill('SIGINT'));
});

// 任意子进程退出，通知其他子进程退出
children.forEach(({ name, child }) => {
  child.on('exit', (code) => {
    console.log(`[启动] ${name} 进程退出 (code: ${code})`);
    // 通知其他子进程退出
    children.forEach(({ name: n, child: c }) => {
      if (n !== name && !c.killed) {
        c.kill('SIGTERM');
      }
    });
  });
});

// 所有子进程退出后主进程退出
let exitedCount = 0;
children.forEach(({ child }) => {
  child.on('exit', () => {
    exitedCount++;
    if (exitedCount >= children.length) {
      console.log('[启动] 所有服务已停止');
      process.exit(0);
    }
  });
});
