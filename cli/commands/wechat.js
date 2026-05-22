/**
 * 微信通道管理命令
 * 
 * 用法:
 *   dove wechat bind       扫码绑定微信
 *   dove wechat unbind     解除绑定
 *   dove wechat status     查看绑定状态
 *   dove wechat test       发送测试消息
 *   dove wechat enable     启用微信通道
 *   dove wechat disable    禁用微信通道
 * 
 * 安全模型：所有管理操作走服务端 API，botToken 不存本地
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { display } from '../display.js';
import { WeChatChannel } from '../lib/wechat-channel.js';
import { DoveClient } from '../client.js';
import { loadConfig, saveConfig } from '../lib/config.js';

/**
 * 获取当前白鸽用户 ID 和网关地址
 */
function getCurrentContext() {
  const config = loadConfig();
  return {
    userId: config.userId || null,
    gateway: config.gateway || 'http://localhost:3003',
  };
}

export const wechatCommand = new Command('wechat')
  .alias('wx')
  .description('微信通道管理 (绑定/解绑/状态/测试)')
  .argument('[action]', '操作: bind|unbind|status|test|enable|disable', 'status')
  .option('--json', 'JSON 格式输出')
  .action(async (action, options) => {
    const { userId, gateway } = getCurrentContext();

    // 确保登录状态有效（含 token 刷新）
    const client = new DoveClient();
    await client.connectEncrypted();
    const authed = await client.ensureAuth();
    if (!authed) {
      display.error('登录已过期，请重新执行 dove login');
      process.exit(1);
    }

    const channel = new WeChatChannel(userId, gateway);

    try {
      switch (action) {
        case 'bind':
        case 'login':
          await handleBind(channel);
          break;
        case 'unbind':
        case 'logout':
          await handleUnbind(channel);
          break;
        case 'status':
        case 'info':
          await handleStatus(channel, options);
          break;
        case 'test':
          await handleTest(channel);
          break;
        case 'listen':
          await handleListenStatus(channel);
          break;
        case 'enable':
        case 'on':
          await handleEnable(channel);
          break;
        case 'disable':
        case 'off':
          await handleDisable(channel);
          break;
        default:
          display.error(`未知操作: ${action}`);
          showHelp();
      }
    } catch (err) {
      display.error(err.message);
      process.exit(1);
    }
  });

// ==================== 命令处理函数 ====================

async function handleBind(channel) {
  // 先同步服务端状态
  await channel.syncStatus();
  
  if (channel.bound) {
    const { rebind } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'rebind',
        message: '已绑定微信，是否重新绑定？（将清除现有绑定）',
        default: false,
      },
    ]);
    if (!rebind) {
      display.info('已取消');
      return;
    }
    await channel.unbind();
  }

  try {
    await channel.bind();
    display.success('微信通道已就绪');
    display.info('对话时白鸽回复将同步推送到微信');
    display.info('微信发来的消息也会触发白鸽对话');
    display.info('botToken 已加密存储在服务端，本地不保存');
  } catch (err) {
    display.error(`绑定失败: ${err.message}`);
  }
}

async function handleUnbind(channel) {
  await channel.syncStatus();
  
  if (!channel.bound) {
    display.info('当前未绑定微信');
    return;
  }

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: '确认解除微信绑定？（服务端绑定记录将删除）',
      default: false,
    },
  ]);

  if (!confirm) {
    display.info('已取消');
    return;
  }

  await channel.unbind();
  display.success('微信绑定已解除');
  display.info('服务端绑定记录已清除');
}

async function handleStatus(channel, options) {
  await channel.syncStatus();
  const status = channel.getStatus();

  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║           微信 iLink 通道状态                        ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  if (status.bound) {
    console.log(`  绑定状态: ${chalk.green('✓ 已绑定')}`);
    console.log(`  通道开关: ${status.enabled ? chalk.green('✓ 已启用') : chalk.yellow('✗ 已禁用')}`);
    console.log(`  Bot Token: ${status.botToken || chalk.gray('(未获取)')}`);
    if (status.botUserId) {
      console.log(`  Bot 用户: ${status.botUserId}`);
    }
    if (status.botBaseUrl) {
      console.log(`  Base URL: ${status.botBaseUrl}`);
    }
    console.log(`  监听状态: ${status.listening ? chalk.green('✓ 监听中') : chalk.gray('○ 未监听')}`);
    console.log(`  会话令牌: ${status.sessionActive ? chalk.green('✓ 有效') : chalk.gray('○ 未获取')}`);
    console.log(`  安全模式: ${chalk.cyan('服务端加密存储')}`);
  } else {
    console.log(`  绑定状态: ${chalk.gray('✗ 未绑定')}`);
    console.log('');
    display.info('执行 dove wechat bind 扫码绑定微信');
  }

  console.log('');
  display.info('命令:');
  console.log('  dove wechat bind      扫码绑定微信');
  console.log('  dove wechat enable    启用微信通道');
  console.log('  dove wechat disable   禁用微信通道');
  console.log('  dove wechat test      发送测试消息');
  console.log('');
}

async function handleTest(channel) {
  await channel.syncStatus();
  
  if (!channel.isReady()) {
    display.error('微信通道未就绪，请先执行 dove wechat bind');
    return;
  }

  const { message } = await inquirer.prompt([
    {
      type: 'input',
      name: 'message',
      message: '输入测试消息:',
      default: '白鸽微信通道测试',
    },
  ]);

  display.info('正在获取会话令牌...');

  try {
    await channel._ensureSession();
    
    if (!channel._lastFromUserId) {
      display.warn('尚无微信对话记录，请先在微信中给 ClawBot 发送一条消息');
      display.info('发送后重新执行 dove wechat test');
      return;
    }

    await channel.pushMessage(message);
    display.success('测试消息已发送');
    display.info('请在微信中查看是否收到');
  } catch (err) {
    display.error(`发送失败: ${err.message}`);
  }
}

async function handleEnable(channel) {
  try {
    await channel._serverApi('POST', '/enable');
    channel.enabled = true;
    display.success('微信通道已启用');
    display.info('对话时白鸽回复将同步推送到微信');
  } catch (err) {
    display.error(err.message);
  }
}

async function handleDisable(channel) {
  try {
    await channel._serverApi('POST', '/disable');
    channel.enabled = false;
    channel.clearSession();
    display.success('微信通道已禁用');
    display.info('微信推送和接收已暂停（绑定保留）');
    display.info('使用 dove wechat enable 重新启用');
  } catch (err) {
    display.error(err.message);
  }
}

async function handleListenStatus(channel) {
  display.info('正在检查服务端微信监听器状态...');
  
  try {
    const data = await channel._serverApi('GET', '/listener/status');
    
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║        微信监听器诊断                                ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`  绑定记录: ${data.bindingExists ? chalk.green('✓ 存在') : chalk.red('✗ 不存在')}`);
    console.log(`  绑定状态: ${data.bindingStatus}`);
    console.log(`  通道开关: ${data.bindingEnabled ? chalk.green('✓ 已启用') : chalk.yellow('✗ 已禁用')}`);
    console.log(`  botToken: ${data.botTokenExists ? chalk.green('✓ 已加密存储') : chalk.red('✗ 无')}`);
    console.log(`  botUserId: ${data.botUserId || '(无)'}`);
    console.log(`  botBaseUrl: ${data.botBaseUrl || '(默认)'}`);
    console.log(`  监听器: ${data.listenerRunning ? chalk.green('✓ 运行中') : chalk.red('✗ 未运行')}`);
    console.log(`  全部监听数: ${data.allListenerCount}`);
    console.log(`  检查时间: ${data.timestamp}`);
    console.log('');
    
    if (!data.listenerRunning && data.bindingExists && data.bindingEnabled) {
      display.warn('绑定存在且已启用，但监听器未运行！');
      display.info('请重启服务端，或检查服务端日志中 [微信监听] 相关输出');
    }
  } catch (err) {
    display.error(`检查失败: ${err.message}`);
    display.info('请确认服务端已启动且可连接');
  }
}

function showHelp() {
  console.log(`
微信 iLink 通道管理命令:

  dove wechat bind        扫码绑定微信（显示终端二维码）
  dove wechat unbind      解除绑定，清除服务端记录
  dove wechat status      查看绑定状态
  dove wechat test        发送测试消息
  dove wechat enable      启用微信通道
  dove wechat disable     禁用微信通道（保留绑定）

快捷方式:
  dove wx bind            扫码绑定
  dove wx status          查看状态

安全模型:
  - botToken 加密存储在服务端 MongoDB
  - 本地不保存 botToken 明文
  - 实时操作使用临时会话令牌（2小时有效）
  - 所有管理操作需 JWT 认证 + 所有权验证
  - 完整审计日志记录

流程:
  1. dove wechat bind     → 终端显示二维码
  2. 微信扫码确认          → 绑定成功（token 存服务端）
  3. dove chat "你好"     → 回复自动推送微信
  4. 微信发消息给Bot      → 触发白鸽对话
`);
}

export default wechatCommand;
