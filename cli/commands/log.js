#!/usr/bin/env node

/**
 * 日志查看命令
 * 用法: dove log [module] [options]
 * 
 * 示例：
 *   dove log                # 查看日志概览
 *   dove log server         # 查看 Server 日志（最近100行）
 *   dove log doves          # 查看 Doves 日志
 *   dove log llm            # 查看 LLM 调用日志
 *   dove log server -f      # 实时跟踪 Server 日志
 *   dove log server -n 500  # 最近500行
 *   dove log server --error # 只看错误日志
 *   dove log clean --days 7 # 清理7天前的归档日志
 */

import { Command } from 'commander';
import { join } from 'path';
import { homedir } from 'os';
import { display } from '../display.js';
import { select } from '../lib/interactive.js';
import {
  获取日志概览,
  获取日志文件列表,
  读取日志尾部,
  跟踪日志文件,
  清理旧日志
} from '@dove/common/日志管理器.js';

// 支持的日志模块
const 模块列表 = ['server', 'doves', 'llm'];

const LOG_MODULE_CHOICES = [
  { name: 'server - 服务端日志', value: 'server' },
  { name: 'doves  - 鸽群日志', value: 'doves' },
  { name: 'llm    - LLM调用日志', value: 'llm' },
];

// 创建主命令
export const logCommand = new Command('log')
  .description('查看服务日志')
  .argument('[module]', '日志模块: server | doves | llm')
  .option('-n, --lines <n>', '显示行数', '100')
  .option('-f, --follow', '实时跟踪日志（类似 tail -f）')
  .option('-e, --error', '只看错误日志')
  .option('--json', 'JSON 格式输出')
  .action(async (module, options) => {
    if (!module) {
      // 交互式选择模块
      module = await select('选择日志模块', LOG_MODULE_CHOICES);
    }
    if (!模块列表.includes(module)) {
      display.error(`未知日志模块: ${module}`);
      display.info(`可用模块: ${模块列表.join(', ')}`);
      process.exit(1);
    } else if (options.follow) {
      await 实时跟踪(module, options);
    } else {
      await 查看日志(module, options);
    }
  });

// 子命令：clean
logCommand
  .command('clean')
  .description('清理旧日志文件')
  .option('-d, --days <n>', '保留天数', '30')
  .action(async (options) => {
    const 天数 = parseInt(options.days) || 30;
    display.info(`清理 ${天数} 天前的归档日志...`);
    
    const 清理数 = await 清理旧日志(天数);
    
    if (清理数 > 0) {
      display.success(`已清理 ${清理数} 个旧日志文件`);
    } else {
      display.info('没有需要清理的旧日志文件');
    }
  });

/**
 * 显示日志概览
 */
async function 显示概览(options) {
  const 概览 = await 获取日志概览();
  
  if (!概览.存在) {
    display.info('日志目录不存在，服务尚未启动过');
    display.info('日志目录: ~/.dove/logs/');
    return;
  }

  if (概览.模块.length === 0) {
    display.info('暂无日志文件');
    return;
  }

  console.log('');
  display.title('日志概览');
  console.log(`  目录: ~/.dove/logs/`);
  console.log('');
  
  // 表头
  console.log(`  ${'模块'.padEnd(12)} ${'文件数'.padEnd(10)} ${'大小'.padEnd(12)} ${'最新时间'}`);
  console.log(`  ${'─'.repeat(50)}`);
  
  for (const 模块 of 概览.模块) {
    const 模块名 = 模块.模块名.padEnd(12);
    const 文件数 = String(模块.文件数).padEnd(10);
    const 大小 = `${模块.总大小MB} MB`.padEnd(12);
    console.log(`  ${模块名} ${文件数} ${大小} ${模块.最新时间}`);
  }
  
  console.log('');
  display.info('使用 dove log <module> 查看具体日志');
  display.info(`可用模块: ${概览.模块.map(m => m.模块名).join(', ')}`);
}

/**
 * 查看指定模块日志
 */
async function 查看日志(模块名, options) {
  const 行数 = parseInt(options.lines) || 100;
  
  const 文件列表 = 获取日志文件列表(模块名, { 仅错误: options.error });
  
  if (文件列表.length === 0) {
    if (options.error) {
      display.info(`没有 ${模块名} 的错误日志`);
    } else {
      display.info(`没有 ${模块名} 的日志文件`);
      display.info(`请确保服务已启动: dove service start`);
    }
    return;
  }

  // 读取最新的日志文件
  const 最新文件 = 文件列表[0];
  const 日志行 = await 读取日志尾部(最新文件, 行数);

  if (日志行.length === 0) {
    display.info(`日志文件为空: ${最新文件}`);
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(日志行, null, 2));
    return;
  }

  // 显示文件信息
  const 短路径 = 最新文件.replace(join(homedir(), '.dove', 'logs'), '~/.dove/logs');
  console.log('');
  display.info(`日志文件: ${短路径} (${日志行.length} 行)`);
  console.log('─'.repeat(80));

  for (const 行 of 日志行) {
    // 错误行高亮
    if (行.includes('ERROR') || 行.includes('error')) {
      console.log(`\x1b[31m${行}\x1b[0m`);
    } else if (行.includes('WARN') || 行.includes('warn')) {
      console.log(`\x1b[33m${行}\x1b[0m`);
    } else {
      console.log(行);
    }
  }
  
  console.log('─'.repeat(80));
  display.info(`显示最近 ${日志行.length} 行 | dove log ${模块名} -n <行数> 调整 | dove log ${模块名} -f 实时跟踪`);
}

/**
 * 实时跟踪日志
 */
async function 实时跟踪(模块名, options) {
  const 文件列表 = 获取日志文件列表(模块名, { 仅错误: options.error });
  
  if (文件列表.length === 0) {
    display.info(`没有 ${模块名} 的日志文件可跟踪`);
    return;
  }

  const 最新文件 = 文件列表[0];
  const 短路径 = 最新文件.replace(join(homedir(), '.dove', 'logs'), '~/.dove/logs');
  
  console.log('');
  display.info(`跟踪日志: ${短路径}`);
  display.info('Ctrl+C 退出');
  console.log('─'.repeat(80));

  // 先输出最新的20行
  const 最近行 = await 读取日志尾部(最新文件, 20);
  for (const 行 of 最近行) {
    console.log(行);
  }

  // 跟踪新日志
  const 控制器 = 跟踪日志文件(最新文件, (行) => {
    if (行.includes('ERROR') || 行.includes('error')) {
      console.log(`\x1b[31m${行}\x1b[0m`);
    } else if (行.includes('WARN') || 行.includes('warn')) {
      console.log(`\x1b[33m${行}\x1b[0m`);
    } else {
      console.log(行);
    }
  });

  // Ctrl+C 退出
  process.on('SIGINT', () => {
    控制器.停止();
    console.log('');
    display.info('停止跟踪');
    process.exit(0);
  });
}

export default logCommand;
