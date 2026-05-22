/**
 * 认证命令（KISS 合并版）
 * 合并: login + logout + setup
 * 
 * 用法:
 *   dove auth login          # 登录（交互式）
 *   dove auth login -a       # 匿名登录
 *   dove auth login --admin  # 管理员登录
 *   dove auth login -r       # 注册新用户
 *   dove auth logout         # 登出
 *   dove auth verify         # 验证当前Token
 *   dove auth setup          # 初始化环境
 */

import { Command } from 'commander';
import { display } from '../display.js';
import { DoveClient, AdminClient, syncWechatOnAccountSwitch } from '../client.js';
import { loadConfig, saveConfig } from '../lib/config.js';
import { select, confirm, input } from '../lib/interactive.js';
import inquirer from 'inquirer';

// ==================== 子命令实现 ====================

async function handleLogin(options) {
  const client = new DoveClient();
  if (options.gateway) client.baseUrl = options.gateway.replace(/\/$/, '');

  try {
    // 验证
    if (options.verify) {
      const result = await client.verifyToken();
      if (result.valid) {
        display.success(`Token 有效 - 用户: ${result.username || result.userId}, 过期: ${result.expiresAt}`);
      } else {
        display.error('Token 无效或已过期');
      }
      return;
    }

    // 刷新
    if (options.refresh) {
      const result = await client.refreshToken();
      if (result.success) { display.success('Token 已刷新'); }
      else { display.error(result.error || '刷新失败'); }
      return;
    }

    // 匿名
    if (options.anonymous) {
      const spinner = display.spinner('匿名登录...').start();
      const result = await client.anonymousLogin();
      spinner.stop();
      if (result.success) {
        display.success(`登录成功 - 用户ID: ${client.config.userId}`);
      } else {
        display.error(`登录失败: ${result.error}`);
      }
      return;
    }

    // 管理员
    if (options.admin) {
      const adminClient = new AdminClient();
      const { username, password } = await inquirer.prompt([
        { type: 'input', name: 'username', message: '管理员用户名:' },
        { type: 'password', name: 'password', message: '密码:', mask: '*' }
      ]);
      const spinner = display.spinner('管理员登录...').start();
      const result = await adminClient.adminLogin(username, password);
      spinner.stop();
      if (result.success) { display.success('管理员登录成功'); }
      else { display.error(result.error || '登录失败'); }
      return;
    }

    // 注册
    if (options.register) {
      const { username, password, email } = await inquirer.prompt([
        { type: 'input', name: 'username', message: '用户名:' },
        { type: 'password', name: 'password', message: '密码:', mask: '*' },
        { type: 'input', name: 'email', message: '邮箱 (可选):' }
      ]);
      const spinner = display.spinner('注册中...').start();
      const result = await client.register(username, password, email);
      spinner.stop();
      if (result.success) { display.success(`注册成功 - 用户ID: ${client.config.userId}`); }
      else { display.error(result.error || '注册失败'); }
      return;
    }

    // 非交互模式：提供了 --username 和 --password 参数
    if (options.username && options.password) {
      const spinner = display.spinner('登录中...').start();
      const result = await client.login(options.username, options.password);
      spinner.stop();
      if (result.success) { display.success(`登录成功 - 用户ID: ${client.config.userId}`); }
      else { display.error(result.error || '登录失败'); }
      return;
    }
    
    // 默认: 交互式登录
    const loginType = await select('选择登录方式', [
      { name: '匿名登录 (快速体验)', value: 'anonymous' },
      { name: '账号登录', value: 'account' },
      { name: '注册新账号', value: 'register' },
    ], 'anonymous');

    if (loginType === 'anonymous') {
      const spinner = display.spinner('匿名登录...').start();
      const result = await client.anonymousLogin();
      spinner.stop();
      if (result.success) { display.success(`登录成功 - 用户ID: ${client.config.userId}`); }
      else { display.error(`登录失败: ${result.error}`); }
    } else if (loginType === 'register') {
      const { username, password } = await inquirer.prompt([
        { type: 'input', name: 'username', message: '用户名:' },
        { type: 'password', name: 'password', message: '密码:', mask: '*' }
      ]);
      const result = await client.register(username, password);
      if (result.success) { display.success(`注册成功`); }
      else { display.error(result.error || '注册失败'); }
    } else {
      const { username, password } = await inquirer.prompt([
        { type: 'input', name: 'username', message: '用户名:' },
        { type: 'password', name: 'password', message: '密码:', mask: '*' }
      ]);
      const result = await client.login(username, password);
      if (result.success) { display.success(`登录成功`); }
      else { display.error(result.error || '登录失败'); }
    }
  } catch (err) {
    display.error(err.message);
    process.exit(1);
  }
  
  // 登录/注册后，同步当前用户的微信绑定
  try {
    const config = loadConfig();
    if (config.userId) {
      const binding = syncWechatOnAccountSwitch(config.userId);
      if (binding) {
        display.info(`微信通道: 已绑定此账号 (dove wechat status 查看详情)`);
      }
    }
  } catch (e) {
    console.warn('[Auth] 微信通道状态检测失败:', e.message);
  }
}

async function handleLogout() {
  const config = loadConfig();
  if (!config.token) {
    display.info('当前未登录');
    return;
  }
  config.token = '';
  config.userId = '';
  config.username = '';
  config.authType = '';
  config.anonymous = false;
  config.expiresAt = '';
  saveConfig(config);
  display.success('已登出');
}

async function handleVerify() {
  const client = new DoveClient();
  try {
    const result = await client.verifyToken();
    if (result.valid) {
      display.success(`Token 有效`);
      console.log(`  用户: ${result.username || result.userId}`);
      console.log(`  类型: ${result.authType}`);
      console.log(`  过期: ${result.expiresAt}`);
    } else {
      display.error('Token 无效或已过期');
      display.info('请重新登录: dove auth login');
    }
  } catch (e) {
    display.error(`验证失败: ${e.message}`);
  }
}

async function handleSetup() {
  // 复用 setup.js 的核心逻辑
  display.title('白鸽环境初始化');
  try {
    const { execSync } = await import('child_process');
    const isWin = process.platform === 'win32';
    
    // 检查 Node.js
    console.log('▶ 检查 Node.js...');
    try {
      const version = execSync('node --version', { encoding: 'utf-8' }).trim();
      display.success(`Node.js ${version}`);
    } catch (e) {
      display.error('Node.js 未安装，请先安装 Node.js >= 18');
      process.exit(1);
    }

    // 检查 MongoDB
    console.log('▶ 检查 MongoDB 连接...');
    const client = new DoveClient();
    try {
      const result = await client.ping();
      if (result.success) { display.success('服务端可达'); }
      else { display.warn('服务端不可达，请确保服务已启动'); }
    } catch (e) {
      display.warn('服务端不可达');
    }

    // 配置网关
    console.log('');
    const setGatewayAnswer = await confirm('是否配置网关地址?', false);
    if (setGatewayAnswer) {
      const gateway = await input('网关地址', 'http://localhost:3003');
      const config = loadConfig();
      config.gateway = gateway;
      saveConfig(config);
      display.success(`网关已设置: ${gateway}`);
    }

    // 自动登录
    console.log('');
    const autoLogin = await confirm('是否匿名登录?', true);
    if (autoLogin) {
      const result = await client.anonymousLogin();
      if (result.success) { display.success('登录成功'); }
      else { display.error(`登录失败: ${result.error}`); }
    }

    console.log('');
    display.success('初始化完成！');
  } catch (err) {
    display.error(err.message);
  }
}

// ==================== 命令注册 ====================

const authCommand = new Command('auth')
  .description('认证管理 (login/logout/verify/setup)');

authCommand
  .command('login')
  .description('登录白鸽')
  .option('-a, --anonymous', '匿名登录')
  .option('-r, --register', '注册新用户')
  .option('--admin', '超级管理员登录')
  .option('-v, --verify', '验证当前 Token')
  .option('--refresh', '刷新 Token')
  .option('-g, --gateway <url>', '指定网关地址')
  .option('-u, --username <name>', '用户名（非交互模式）')
  .option('-p, --password <pwd>', '密码（非交互模式）')
  .action(handleLogin);

authCommand
  .command('logout')
  .description('登出')
  .action(handleLogout);

authCommand
  .command('verify')
  .description('验证当前 Token')
  .action(handleVerify);

authCommand
  .command('setup')
  .description('初始化环境')
  .action(handleSetup);

export { authCommand };
export default authCommand;
