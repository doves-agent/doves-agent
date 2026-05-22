#!/usr/bin/env node

/**
 * 服务管理命令
 * 用法: dove service <action> [options]
 * 
 * 前置条件：只需连接 MongoDB
 */

import { Command } from 'commander';
import { display } from '../display.js';
import * as serviceManager from '../lib/service-manager.js';
import { DoveClient } from '../client.js';
import { select, SERVICE_TYPE_CHOICES } from '../lib/interactive.js';

// 创建主命令
export const serviceCommand = new Command('service')
  .description('管理本地服务（服务端/鸽群）')
  .option('-t, --type <type>', '服务类型: server(服务端) | dove(鸽子)')
  .option('-p, --prod', '生产模式')
  .option('--lines <n>', '日志行数', '100')
  .option('--json', 'JSON 格式输出')

  // 默认动作：显示状态
  .action(async (options) => {
    await showStatus(options);
  });

// ==================== 启动选项说明 ====================
// Server 和 Doves 独立进程启动：
//   dove service start -t server    # 启动服务端
//   dove service start -t dove      # 启动鸽子
//   dove service start --all        # 启动所有

// 子命令：start
serviceCommand
  .command('start')
  .description('启动服务')
  .option('-t, --type <type>', '服务类型: server | dove', 'server')
  .option('-p, --prod', '生产模式')
  .option('-a, --all', '启动所有服务（Server + Doves）')
  .action(async (options) => {
    await handleStart(options);
  });

// 子命令：stop
serviceCommand
  .command('stop')
  .description('停止服务')
  .option('-t, --type <type>', '服务类型: server | dove', 'server')
  .option('-a, --all', '停止所有服务')
  .action(async (options) => {
    await handleStop(options);
  });

// 子命令：restart
serviceCommand
  .command('restart')
  .description('重启服务')
  .option('-t, --type <type>', '服务类型: server | dove', 'server')
  .option('-p, --prod', '生产模式')
  .action(async (options) => {
    await handleRestart(options);
  });

// 子命令：status
serviceCommand
  .command('status')
  .description('查看服务状态')
  .option('--json', 'JSON 格式输出')
  .action(async (options) => {
    await showStatus(options);
  });

// 子命令：logs
serviceCommand
  .command('logs')
  .description('查看服务日志')
  .option('-t, --type <type>', '服务类型: server | dove', 'server')
  .option('--lines <n>', '日志行数', '100')
  .action(async (options) => {
    await handleLogs(options);
  });

// 子命令：startup
serviceCommand
  .command('startup')
  .description('管理开机启动')
  .option('-e, --enable', '启用开机启动')
  .option('-d, --disable', '禁用开机启动')
  .option('-s, --status', '查看开机启动状态')
  .action(async (options) => {
    await handleStartup(options);
  });

// 子命令：check
serviceCommand
  .command('check')
  .description('检查前置条件')
  .action(async () => {
    await handleCheck();
  });

// 子命令：save
serviceCommand
  .command('save')
  .description('保存当前进程列表')
  .action(async () => {
    await handleSave();
  });

// ==================== 命令处理函数 ====================

/**
 * 显示服务状态
 */
async function showStatus(options) {
  display.title('服务状态');

  try {
    const summary = await serviceManager.getServiceSummary();

    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    // 平台信息
    console.log('');
    display.info(`平台: ${summary.platform.platform} (${summary.platform.arch})`);
    display.info(`PM2: ${summary.pm2.installed ? 'v' + summary.pm2.version : '未安装'}`);

    // MongoDB 状态
    console.log('');
    display.title('MongoDB');
    if (summary.mongo.connected) {
      display.success(`已连接 ${summary.mongo.uri} (${summary.mongo.latency}ms)`);
    } else {
      display.error('未连接');
    }

    // 服务状态
    console.log('');
    display.title('服务');

    const serviceTypes = ['server', 'dove'];
    const serviceNames = {
      'server': '服务端',
      'dove': '鸽子'
    };

    // 显示各服务状态
    for (const name of serviceTypes) {
      const svc = summary.services[name];
      if (svc && svc.running) {
        display.success(`${serviceNames[name]}: 运行中 (PID: ${svc.pid})`);
      } else if (svc && svc.errored) {
        display.error(`${serviceNames[name]}: 错误 (重启 ${svc.restarts} 次)`);
      } else if (svc && svc.stopped) {
        display.warn(`${serviceNames[name]}: 已停止`);
      } else if (svc) {
        display.info(`${serviceNames[name]}: ${svc.status}`);
      } else {
        display.info(`${serviceNames[name]}: 未启动`);
      }
    }

    // 开机启动
    console.log('');
    display.title('开机启动');
    if (summary.startup.enabled) {
      display.success(`已启用 (${summary.startup.method})`);
    } else {
      display.info('未启用');
    }

  } catch (err) {
    display.error(`获取状态失败: ${err.message}`);
  }
}

/**
 * 处理启动命令
 */
async function handleStart(options) {
  if (options.all) {
    display.title('启动所有服务');
    const results = await serviceManager.startAll({ prod: options.prod });

    for (const [svc, result] of Object.entries(results)) {
      if (result) {
        if (result.success) {
          display.success(`${svc}: ${result.message}`);
        } else {
          display.error(`${svc}: ${result.error}`);
        }
      }
    }

    display.info('查看状态: dove service status');
    display.info('查看日志: dove service logs');
    return;
  }

  let type = options.type;
  if (!type) {
    type = await select('选择服务类型', SERVICE_TYPE_CHOICES, 'server');
  }
  const typeName = serviceManager.ServiceNames[type] || type;

  display.title(`启动 ${typeName}`);

  // 检查前置条件
  const prereq = await serviceManager.checkPrerequisites();

  if (!prereq.ready) {
    display.error('前置条件不满足:');
    for (const [key, check] of Object.entries(prereq.checks)) {
      if (!check.passed) {
        display.error(`  ${key}: ${check.message}`);
      }
    }
    process.exit(1);
  }

  // 显示检查通过
  for (const [key, check] of Object.entries(prereq.checks)) {
    if (check.passed) {
      display.success(check.message);
    }
  }

  console.log('');

  // 启动服务
  const result = await serviceManager.startService(type, { prod: options.prod });

  if (result.success) {
    display.success(result.message);
    display.info('查看状态: dove service status');
    display.info('查看日志: dove service logs');
  } else {
    display.error(result.error || '启动失败');
    process.exit(1);
  }
}

/**
 * 处理停止命令
 */
async function handleStop(options) {
  if (options.all) {
    display.title('停止所有服务');
    const results = serviceManager.stopAll();

    for (const [type, result] of Object.entries(results)) {
      if (result.success) {
        display.success(`${type}: ${result.message}`);
      } else {
        display.error(`${type}: ${result.error}`);
      }
    }
    return;
  }

  let type = options.type;
  if (!type) {
    type = await select('选择服务类型', SERVICE_TYPE_CHOICES, 'server');
  }
  const typeName = serviceManager.ServiceNames[type] || type;

  display.title(`停止 ${typeName}`);

  const result = serviceManager.stopService(type);

  if (result.success) {
    display.success(result.message);
  } else {
    display.error(result.error || '停止失败');
    process.exit(1);
  }
}

/**
 * 处理重启命令
 */
async function handleRestart(options) {
  let type = options.type;
  if (!type) {
    type = await select('选择服务类型', SERVICE_TYPE_CHOICES, 'server');
  }
  const typeName = serviceManager.ServiceNames[type] || type;

  display.title(`重启 ${typeName}`);

  const result = serviceManager.restartService(type, { prod: options.prod });

  if (result.success) {
    display.success(result.message);
  } else {
    display.error(result.error || '重启失败');
    process.exit(1);
  }
}

/**
 * 处理日志命令
 */
async function handleLogs(options) {
  let type = options.type;
  if (!type) {
    type = await select('选择服务类型', SERVICE_TYPE_CHOICES, 'server');
  }
  const lines = parseInt(options.lines, 10) || 100;

  display.title(`查看日志 (${type})`);
  console.log('');

  await serviceManager.showLogs(type, { lines });
}

/**
 * 处理开机启动命令
 */
async function handleStartup(options) {
  // 默认显示状态
  if (!options.enable && !options.disable && !options.status) {
    options.status = true;
  }

  if (options.status) {
    display.title('开机启动状态');
    const status = serviceManager.getStartupStatus();

    console.log('');
    display.info(`平台: ${status.platform}`);

    if (status.enabled) {
      display.success(`状态: 已启用`);
      display.info(`方式: ${status.method}`);
    } else {
      display.info('状态: 未启用');
      console.log('');
      display.info('启用开机启动: dove service startup --enable');
    }

    return;
  }

  if (options.enable) {
    display.title('启用开机启动');
    const result = serviceManager.enableStartup();

    if (result.success) {
      display.success(result.message);

      if (result.needSudo) {
        console.log('');
        display.info('请执行上述命令完成配置');
      }
    } else {
      display.error(result.error);
      process.exit(1);
    }
    return;
  }

  if (options.disable) {
    display.title('禁用开机启动');
    const result = serviceManager.disableStartup();

    if (result.success) {
      display.success(result.message);
    } else {
      display.error(result.error);
      process.exit(1);
    }
    return;
  }
}

/**
 * 处理检查命令
 */
async function handleCheck() {
  display.title('检查前置条件');
  console.log('');

  const prereq = await serviceManager.checkPrerequisites();

  for (const [key, check] of Object.entries(prereq.checks)) {
    const icon = check.passed ? '✓' : '✗';
    const status = check.passed ? 'success' : 'error';

    console.log(`  ${icon} ${key}: ${check.message}`);
  }

  console.log('');

  if (prereq.ready) {
    display.success('所有前置条件满足，可以启动服务');
  } else {
    display.error('前置条件不满足，请先解决上述问题');
    process.exit(1);
  }
}

/**
 * 处理保存命令
 */
async function handleSave() {
  display.title('保存进程列表');

  const result = serviceManager.saveProcessList();

  if (result.success) {
    display.success(result.message);
  } else {
    display.error(result.error);
    process.exit(1);
  }
}

// 子命令：web
import { webCommand as _origWebCmd } from './web.js';

serviceCommand
  .command('web')
  .description('启动 Web 界面')
  .option('-p, --port <port>', '端口号', '5173')
  .option('--host <host>', '绑定地址', '127.0.0.1')
  .option('--no-open', '不自动打开浏览器')
  .action(async (options) => {
    // 委托给原 web 命令
    const args = ['web'];
    if (options.port) { args.push('-p', String(options.port)); }
    if (options.host) { args.push('-h', options.host); }
    if (options.open === false) args.push('--no-open');
    try {
      await _origWebCmd.parseAsync(args, { from: 'user' });
    } catch (e) {
      if (e.code !== 'commander.help' && e.code !== 'commander.version' && !e.message?.includes('__COMMAND_EXIT__')) {
        display.error(e.message);
      }
    }
  });

// 导出
export default serviceCommand;
