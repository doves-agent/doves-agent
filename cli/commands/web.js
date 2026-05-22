/**
 * Web 命令
 * 用法: dove web [options]
 *
 * 预加载所有页面 → 启动 Web 服务
 */

import { Command } from 'commander';
import { display } from '../display.js';
import os from 'os';

export const webCommand = new Command('web')
  .description('启动 Web 界面')
  .option('-p, --port <port>', '端口号', '5173')
  .option('--host <host>', '绑定地址', '127.0.0.1')
  .option('--no-open', '不自动打开浏览器')
  .option('--dev', '开发模式（监听文件变更）')
  .action(async (options) => {
    const port = parseInt(options.port, 10);
    const host = options.host;

    if (options.dev) {
      process.env.DOVE_DEV_MODE = 'true';
    }

    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║            白鸽 Web 平台                      ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');

    try {
      const { 启动Web服务 } = await import('../web/入口.js');

      const service = await 启动Web服务({
        port,
        host,
        onProgress: (msg) => console.log(`  ${msg}`)
      });

      console.log('');
      const localUrl = `http://localhost:${service.port}`;
      console.log(`  本地访问: ${localUrl}`);

      const addresses = 获取网络地址();
      for (const addr of addresses) {
        console.log(`  网络访问: http://${addr}:${service.port}`);
      }

      console.log('');
      console.log('─'.repeat(46));
      console.log('  按 Ctrl+C 停止服务');
      if (options.dev) {
        console.log('  开发模式：扩展文件变更自动热更新');
      }
      console.log('─'.repeat(46));
      console.log('');

      if (options.open !== false) {
        打开浏览器(localUrl);
      }

      let stopping = false;
      process.on('SIGINT', async () => {
        if (stopping) return;
        stopping = true;
        console.log('');
        display.info('正在停止 Web 服务...');
        await service.stop();
        display.success('Web 服务已停止');
        process.exit(0);
      });

    } catch (err) {
      if (err.message.includes('端口') && err.message.includes('占用')) {
        const localUrl = `http://localhost:${port}`;
        display.info(`服务已在运行: ${localUrl}`);
        if (options.open !== false) 打开浏览器(localUrl);
        return;
      }
      display.error(err.message);
      process.exit(1);
    }
  });

function 获取网络地址() {
  const addresses = [];
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        addresses.push(addr.address);
      }
    }
  }
  return addresses;
}

async function 打开浏览器(url) {
  try {
    const { exec } = await import('child_process');
    const cmds = { win32: `start "" "${url}"`, darwin: `open "${url}"`, linux: `xdg-open "${url}"` };
    exec(cmds[process.platform] || cmds.linux);
  } catch {}
}

export default webCommand;
