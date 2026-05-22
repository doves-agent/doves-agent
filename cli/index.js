#!/usr/bin/env node

/**
 * 白鸽 CLI 客户端 (KISS 版)
 * 
 * 命令结构 (扁平化):
 *   dove login / dove ping / dove info / dove storage ...
 * 
 * 两种模式：
 * 1. 命令行模式：dove chat "你好" 等，执行完直接退出
 * 2. 交互模式：dove（无参数），循环执行命令，exit 或 Ctrl+C 退出
 */

// 设置 UTF-8 编码（解决 Windows 乱码问题）
if (process.platform === 'win32') {
  try {
    process.stdout.setDefaultEncoding('utf8');
    process.stderr.setDefaultEncoding('utf8');
  } catch (e) {
    console.warn('[CLI] 设置UTF-8编码失败:', e.message);
  }
}

// ===== 全局异常兜底 =====
process.on('unhandledRejection', (reason, promise) => {
  console.error('[全局兜底] 未捕获的 Promise 异常:', reason);
  // 非调试模式下立即退出（未知异常意味着程序状态不可信）
  if (process.env.LOG_LEVEL !== 'DEBUG' && process.env.DOVE_DEBUG !== '1') {
    process.exit(1);
  }
});
process.on('uncaughtException', (error) => {
  console.error('[全局兜底] 未捕获的同步异常:', error.message, error.stack);
  // 同步异常意味着进程状态已损坏，必须立即退出
  process.exit(1);
});

// ===== 终端时间戳拦截器（为所有 console 输出添加时间戳，与 Server/Doves 日志格式统一） =====
import { formatLocalTime } from '@dove/common/时间工具.js';
import { 获取调用位置 } from '@dove/common/日志管理器.js';

const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;

function _ts() {
  return formatLocalTime(new Date(), 'log');
}

function _debugPos() {
  // skipInternal=true: 动态跳过所有内部帧（日志管理器/终端输出管理器/display），
  // 无论调用链经过多少中间层，都能定位到真实调用者
  return 获取调用位置(0, true);
}

console.log = (...args) => {
  const ts = _ts();
  const pos = _debugPos();
  if (pos) _origLog(ts, pos, ...args);
  else _origLog(ts, ...args);
};
console.warn = (...args) => {
  const ts = _ts();
  const pos = _debugPos();
  if (pos) _origWarn(ts, pos, ...args);
  else _origWarn(ts, ...args);
};
console.error = (...args) => {
  const ts = _ts();
  const pos = _debugPos();
  if (pos) _origError(ts, pos, ...args);
  else _origError(ts, ...args);
};

import { Command } from 'commander';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ==================== 扁平化顶层命令 ====================
import { chatCommand } from './commands/chat.js';
import { loginCommand, logoutCommand } from './commands/login.js';
import { setupCommand } from './commands/setup.js';
import { initCommand } from './commands/init.js';
import { statusCommand } from './commands/status.js';
import { pingCommand } from './commands/ping.js';
import { infoCommand } from './commands/info.js';
import { showCommand } from './commands/show.js';
import { testCommand } from './commands/test.js';
import { taskCommand } from './commands/task.js';
import { configCommand } from './commands/config.js';
import { modelCommand } from './commands/model.js';
import { profileCommand } from './commands/profile.js';
import { doveCommand } from './commands/dove.js';
import { capabilityCommand } from './commands/capability.js';
import { skillCommand } from './commands/skill.js';
import { fileCommand } from './commands/file.js';
import { storageCommand } from './commands/storage.js';
import { memoryCommand } from './commands/memory.js';
import { serviceCommand } from './commands/service.js';
import { webCommand } from './commands/web.js';
import { eventCommand } from './commands/event.js';
import { notifyCommand } from './commands/notify.js';
import { wechatCommand } from './commands/wechat.js';
import { sessionCommand } from './commands/session.js';
import { convCommand } from './commands/conv.js';
import { logCommand } from './commands/log.js';
import { statsCommand } from './commands/stats.js';
import { appCommand } from './commands/app.js';
import { teamCommand } from './commands/team.js';

import { display } from './display.js';
import { DoveClient } from './client.js';
import { loadConfig } from './lib/config.js';
import { waitForServer } from '@dove/common/服务器等待工具.js';

// ==================== 命令注册 ====================

const program = new Command();
program
  .name('dove')
  .description('白鸽 - 分布式国产大模型 Agent 框架 CLI 客户端')
  .version('1.0.0')
  .option('--wait', '等待服务端上线（定时重试，不退出）')
  .option('--debug', '调试模式（不清屏、保留所有输出、日志附带可点击的调用位置链接）')
  .exitOverride(); // 防止 commander 调用 process.exit

// 扁平化顶层命令（直接使用）
program.addCommand(chatCommand);
program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(setupCommand);
program.addCommand(initCommand);
program.addCommand(statusCommand);
program.addCommand(pingCommand);
program.addCommand(infoCommand);
program.addCommand(showCommand);
program.addCommand(testCommand);
program.addCommand(taskCommand);
program.addCommand(configCommand);
program.addCommand(modelCommand);
program.addCommand(profileCommand);
program.addCommand(doveCommand);
program.addCommand(capabilityCommand);
program.addCommand(skillCommand);
program.addCommand(fileCommand);
program.addCommand(storageCommand);
program.addCommand(memoryCommand);
program.addCommand(serviceCommand);
program.addCommand(webCommand);
program.addCommand(eventCommand);
program.addCommand(notifyCommand);
program.addCommand(wechatCommand);
program.addCommand(sessionCommand);
program.addCommand(convCommand);
program.addCommand(logCommand);
program.addCommand(statsCommand);
program.addCommand(appCommand);
program.addCommand(teamCommand);

// ==================== 交互模式 ====================

const HISTORY_DIR = path.join(os.homedir(), '.dove');
const HISTORY_FILE = path.join(HISTORY_DIR, 'cli_history');
const MAX_HISTORY = 500;

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return fs.readFileSync(HISTORY_FILE, 'utf-8').split('\n').filter(l => l.trim()).slice(-MAX_HISTORY);
    }
  } catch (e) {
    console.warn('[CLI] 读取命令历史失败:', e.message);
  }
  return [];
}

function saveHistory(history) {
  try {
    if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, history.slice(-MAX_HISTORY).join('\n') + '\n', 'utf-8');
  } catch (e) {
    console.warn('[CLI] 保存命令历史失败:', e.message);
  }
}

async function interactiveMode(等待服务端 = false) {
  console.log('');
  display.title('白鸽 CLI - 分布式国产大模型 Agent 框架');
  console.log('');
  
  // 测试连通性
  const 连接测试 = async () => {
    try {
      const client = new DoveClient();
      const pingResult = await client.ping();
      if (pingResult.success && pingResult.pong) {
        display.success(`网关已连接 [${pingResult.latency}ms]`);
        return true;
      } else {
        display.error(`网关未响应: ${pingResult.error || '未知错误'}`);
        return false;
      }
    } catch (e) {
      display.error(`网关连接失败: ${e.message}`);
      return false;
    }
  };

  if (等待服务端) {
    await waitForServer(连接测试, {
      日志前缀: '[CLI]',
      重试间隔: 5000,
    });
  } else {
    const 已连接 = await 连接测试();
    if (!已连接) {
      display.info('请确保网关服务已启动: dove service start');
      display.info('或使用 --wait 参数等待服务端上线: dove --wait');
      process.exit(1);
    }
  }
  
  // 建立加密通道（Noise NX）
  try {
    const client = new DoveClient();
    const encryptedOk = await client.connectEncrypted();
    if (encryptedOk) {
      display.success('加密通道已建立 [端到端加密]');
    }
  } catch (e) {
    display.error(`加密通道连接失败: ${e.message}`);
    display.info('加密通道不可用，大部分操作将无法执行（不降级明文 HTTP）');
    display.info('排查：Server 加密端口(默认3003)是否可达、DOVE_TRUST_ON_FIRST_USE 是否正确');
  }
  
  // 显示登录状态
  try {
    const config = loadConfig();
    const token = config.token || process.env.DOVE_TOKEN;
    if (token) {
      const username = config.username || config.userId || '';
      const role = config.role === 'admin' ? ' (管理员)' : '';
      display.success(`已登录: ${username}${role}`);
    } else {
      display.warn('当前未登录，部分命令不可用，请执行 dove login');
    }
  } catch (e) {
    console.warn('[CLI] 显示登录状态失败:', e.message);
  }
  
  // 微信通道状态
  try {
    const config = loadConfig();
    if (config.wechat?.enabled && config.wechat?.botToken) {
      display.info('微信通道: 已绑定 (dove wechat status 查看详情)');
    }
  } catch (e) {
    console.warn('[CLI] 显示微信通道状态失败:', e.message);
  }

  // 拉取通知摘要
  try {
    const config = loadConfig();
    if (config.token) {
      const client = new DoveClient();
      const res = await client.request('GET', '/api/notify/summary');
      if (res?.success && res.data?.未读总数 > 0) {
        const d = res.data;
        const 标签 = { event: '事件', task: '任务', system: '系统' };
        const parts = Object.entries(d.按来源 || {}).map(([k, v]) => `${标签[k] || k}(${v})`);
        display.warn(`有 ${d.未读总数} 条未读通知`);
        display.info(`  ${parts.join(' | ')}  — dove notify 查看详情`);
      }
    }
  } catch (e) {
    // 非关键，静默
  }
  
  console.log('');
  display.info('常用命令:');
  const commands = [
    ['chat',          '对话'],
    ['login/logout',  '登录/登出'],
    ['status',        '系统概览'],
    ['ping',          '连通测试'],
    ['task',          '任务管理'],
    ['dove',          '白鸽管理'],
    ['config',        '配置管理'],
    ['service',       '服务管理'],
  ];
  commands.forEach(([cmd, desc]) => {
    console.log(`  ${cmd.padEnd(16)} ${desc}`);
  });
  console.log('');
  display.info('更多命令:');
  const moreCmds = [
    ['info/show/test', '资源/配置/诊断'],
    ['model/profile',  '模型/档案'],
    ['capability/skill','能力/技能 (cap/skill)'],
    ['file/storage/memory','文件/存储/记忆 (mem)'],
    ['web/event/wechat', 'Web/事件/微信 (wx)'],
    ['setup/session/conv','初始化/长连接/对话'],
    ['log',            '查看服务日志'],

  ];
  moreCmds.forEach(([cmd, desc]) => {
    console.log(`  ${cmd.padEnd(22)} ${desc}`);
  });
  console.log('');
  display.info('Ctrl+C 或 exit 退出  |  上下键切换历史');
  display.divider();
  
  // 创建 readline
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    historySize: MAX_HISTORY,
    removeHistoryDuplicates: true,
  });
  rl.history = loadHistory();
  rl.on('close', () => saveHistory(rl.history));
  
  // 交互循环（直接复用 program，无需重建命令树）
  const askQuestion = () => new Promise(resolve => {
    if (rl.closed) {
      resolve(null);
      return;
    }
    rl.question('\ndove> ', resolve);
  });
  
  while (true) {
    let input;
    try {
      input = await askQuestion();
    } catch (e) {
      break; // Ctrl+C 等
    }
    
    const trimmed = (input || '').trim();
    if (!trimmed) continue;
    if (['exit', 'quit', ':q'].includes(trimmed)) break;
    
    try {
      // 暂停外层 readline，避免与 inquirer 争抢 stdin
      rl.pause();
      // 拦截 process.exit，防止命令中的 process.exit(1) 杀掉交互模式
      const origExit = process.exit;
      process.exit = (code) => {
        throw new Error(`__COMMAND_EXIT_${code || 0}__`);
      };
      try {
        await program.parseAsync(trimmed.split(/\s+/), { from: 'user' });
      } finally {
        process.exit = origExit;
        rl.resume();
      }
    } catch (e) {
      // 认证拦截：preAction 抛出的未登录错误
      if (e.message === '__AUTH_REQUIRED__') continue;
      // commander 的 exitOverride 会抛出 CommanderError，忽略即可
      if (e.code !== 'commander.help' && e.code !== 'commander.version' && e.code !== 'commander.helpDisplayed') {
        if (!e.message?.includes('__COMMAND_EXIT__')) {
          display.error(e.message);
        }
      }
    }
  }
  
  rl.close();
  console.log('');
  display.info('再见！');
  process.exit(0);
}

// ==================== 认证白名单 ====================
// 这些命令不需要登录即可使用
const NO_AUTH_COMMANDS = new Set([
  'login', 'logout', 'setup', 'init', 'ping', 'info', 'log', 'service', 'test', 'app',
]);

// ==================== 主入口 ====================

program.hook('preAction', (thisCommand, actionCommand) => {
  // 递归找到最底层的 action command（处理 subcommand 如 auth login）
  let cmd = actionCommand;
  while (cmd.parent && cmd.parent !== program) {
    cmd = cmd.parent;
  }
  const cmdName = cmd.name();

  // 白名单命令不需要登录
  if (NO_AUTH_COMMANDS.has(cmdName)) return;

  // 检查 token
  const config = loadConfig();
  const token = config.token || process.env.DOVE_TOKEN;
  if (!token) {
    display.error('当前未登录，请先执行 dove login');
    throw new Error('__AUTH_REQUIRED__');
  }

  // 所有命令对超管和普通用户都开放
  // 超管通过 --all 选项管理全局数据，默认只管理自己的数据
  // 普通用户只能管理自己的数据
});

// 提取 --wait / --debug 参数（在 commander 解析前处理，兼容无参数交互模式）
const 等待模式 = process.argv.includes('--wait');
const 调试模式 = process.argv.includes('--debug');
if (调试模式) {
  process.env.DOVE_DEBUG = '1';
  process.env.DEBUG_CHAT = '1';
}
const args = process.argv.slice(2).filter(a => a !== '--wait' && a !== '--debug');

// ===== 自动更新（交互模式，dotenv 加载后、命令执行前） =====
import { cli检查更新 } from '@dove/common/自动更新.js';

if (args.length === 0) {
  // 无参数：进入交互模式（先检查更新）
  cli检查更新().then(() => interactiveMode(等待模式)).catch(() => interactiveMode(等待模式));
} else {
  // 有参数：执行一次就退出（命令模式不检查更新，避免阻塞自动化脚本）
  program.parseAsync(args, { from: 'user' }).catch(e => {
    if (e.message === '__AUTH_REQUIRED__') {
      process.exit(1);
    }
    if (e.code !== 'commander.help' && e.code !== 'commander.version' && e.code !== 'commander.helpDisplayed') {
      console.error(e.message);
    }
    process.exit(e.exitCode || 1);
  });
}
