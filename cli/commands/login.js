/**
 * 登录命令
 * 用法: dove login [options]
 *       dove logout
 */

import { Command } from 'commander';
import { display } from '../display.js';
import { DoveClient, AdminClient } from '../client.js';
import { loadConfig, saveConfig } from './config.js';

function 独占stdin() {
  const stdin = process.stdin;
  const 已有监听器 = stdin.rawListeners('data').slice();
  stdin.removeAllListeners('data');
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();

  const 恢复 = () => {
    stdin.setRawMode(wasRaw);
    for (const fn of 已有监听器) stdin.on('data', fn);
  };
  return { stdin, 恢复 };
}

function askInput(promptText) {
  return new Promise(resolve => {
    const stdout = process.stdout;
    stdout.write(`  ${promptText}: `);
    const { stdin, 恢复 } = 独占stdin();
    let input = '';
    const onData = (ch) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r') {
        stdin.removeListener('data', onData);
        恢复();
        stdout.write('\n');
        resolve(input);
      } else if (c === '\x03') {
        stdin.removeListener('data', onData);
        恢复();
        stdout.write('\n');
        resolve('');
      } else if (c === '\x7f' || c === '\b') {
        if (input.length > 0) {
          input = input.slice(0, -1);
          stdout.write('\b \b');
        }
      } else {
        input += c;
        stdout.write(c);
      }
    };
    stdin.on('data', onData);
  });
}

function askPassword(promptText) {
  return new Promise(resolve => {
    const stdout = process.stdout;
    stdout.write(`  ${promptText}: `);
    const { stdin, 恢复 } = 独占stdin();
    let password = '';
    const onData = (ch) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r') {
        stdin.removeListener('data', onData);
        恢复();
        stdout.write('\n');
        resolve(password);
      } else if (c === '\x03') {
        stdin.removeListener('data', onData);
        恢复();
        stdout.write('\n');
        resolve('');
      } else if (c === '\x7f' || c === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          stdout.write('\b \b');
        }
      } else {
        password += c;
        stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

export const loginCommand = new Command('login')
  .description('登录白鸽')
  .option('-a, --anonymous', '匿名登录')
  .option('-r, --register', '注册新用户')
  .option('--admin', '超级管理员登录')
  .option('-v, --verify', '验证当前 Token')
  .option('--refresh', '刷新 Token')
  .option('-g, --gateway <url>', '指定网关地址')
  .option('-u, --username <name>', '用户名（非交互模式）')
  .option('-p, --password <pwd>', '密码（非交互模式）')
  .action(async (options) => {
    const client = new DoveClient();

    if (options.gateway) {
      client.baseUrl = options.gateway.replace(/\/$/, '');
    }

    try {
      if (options.verify) {
        await verifyToken(client);
        return;
      }

      if (options.refresh) {
        await refreshToken(client);
        return;
      }

      if (options.anonymous) {
        await anonymousLogin(client);
        return;
      }

      if (options.admin) {
        const adminClient = new AdminClient();
        await adminLogin(adminClient);
        return;
      }

      if (options.register) {
        await register(client);
        return;
      }

      await normalLogin(client, options);

    } catch (err) {
      display.error(err.message);
      process.exit(1);
    }
  });

export const logoutCommand = new Command('logout')
  .description('登出当前账号')
  .option('-f, --force', '强制清除所有本地配置')
  .action(async (options) => {
    try {
      const config = loadConfig();

      if (!config.token && !options.force) {
        display.info('当前未登录');
        return;
      }

      if (options.force) {
        saveConfig({});
        display.success('已清除所有本地配置');
      } else {
        const newConfig = { ...config };
        delete newConfig.token;
        delete newConfig.userId;
        delete newConfig.username;
        delete newConfig.authType;
        delete newConfig.anonymous;
        delete newConfig.expiresAt;
        saveConfig(newConfig);
        display.success('已登出');
      }
    } catch (err) {
      display.error(err.message);
      process.exit(1);
    }
  });

async function verifyToken(client) {
  const result = await client.verifyToken();

  console.log('');
  display.title('Token 验证');

  if (result.valid) {
    display.success('Token 有效');
    console.log('');
    console.log(` 用户ID:   ${result.userId}`);
    console.log(` 用户名:   ${result.username || 'anonymous'}`);
    console.log(` 认证类型: ${result.authType === 'permanent' ? '长期认证 (7天)' : '临时认证 (24h)'}`);
    console.log(` 匿名:     ${result.anonymous ? '是' : '否'}`);
    console.log(` 过期时间: ${result.expiresAt}`);
    console.log(` 剩余时间: ${formatSeconds(result.expiresIn)}`);
  } else {
    display.error(result.error || 'Token 无效或已过期');
    display.info('使用 dove login 重新登录');
  }
}

async function refreshToken(client) {
  const result = await client.refreshToken();

  if (result.success) {
    display.success('Token 已刷新');
    console.log('');
    console.log(` 认证类型: ${result.data.authType === 'permanent' ? '长期认证 (7天)' : '临时认证 (24h)'}`);
    console.log(` 过期时间: ${result.data.expiresAt}`);
  } else {
    display.error(result.error || '刷新失败');
    display.info('使用 dove login 重新登录');
  }
}

async function anonymousLogin(client) {
  const allowed = await client.isAnonymousAllowed();
  if (!allowed) {
    console.log('');
    display.title('匿名登录');
    display.error('匿名登录已被服务端禁用');
    console.log('');
    display.info('请注册账号后登录:');
    display.info('  dove login --register  注册新用户');
    display.info('  dove login              登录已有账号');
    return;
  }

  const result = await client.anonymousLogin();

  console.log('');
  display.title('匿名登录');

  if (result.success) {
    display.success('登录成功');
    console.log('');
    console.log(` 用户ID:   ${result.data.userId}`);
    console.log(` 有效期:   24小时`);
    console.log('');
    display.info('匿名用户为临时认证，数据不保留');
  } else {
    display.error(result.error || '登录失败');
  }
}

async function register(client) {
  console.log('');
  display.title('注册新用户');

  const username = await askInput('用户名 (至少3字符)');
  if (!username || username.length < 3) {
    display.error('用户名至少3个字符');
    return;
  }
  const password = await askPassword('密码 (至少6字符)');
  if (!password || password.length < 6) {
    display.error('密码至少6个字符');
    return;
  }
  const email = await askInput('邮箱（可选，直接回车跳过）');

  const result = await client.register(username, password, email);

  console.log('');

  if (result.success) {
    display.success('注册成功');
    console.log('');
    console.log(` 用户ID:   ${result.data.userId}`);
    console.log(` 用户名:   ${username}`);
    console.log(` 有效期:   7天`);

    if (result.data.resourceTaskId) {
      console.log('');
      display.info('资源正在分配中，使用以下命令查看进度:');
      console.log(`  dove status`);
    }
  } else {
    display.error(result.error || '注册失败');
  }
}

async function normalLogin(client, cliOptions = {}) {
  console.log('');
  display.title('登录白鸽');

  if (cliOptions.username && cliOptions.password) {
    const result = await client.login(cliOptions.username, cliOptions.password);
    console.log('');
    if (result.success) {
      display.success('登录成功');
      console.log('');
      console.log(` 用户ID:   ${result.data.userId}`);
      console.log(` 用户名:   ${cliOptions.username}`);
      console.log(` 有效期:   7天`);
      if (result.data.resourceStatus) {
        console.log(` 资源状态: ${result.data.resourceStatus}`);
      }
    } else {
      display.error(result.error || '登录失败');
    }
    return;
  }

  if (client.token) {
    console.log(` 当前已登录: ${client.config.username || '匿名用户'}`);
    console.log('');
    console.log('  1. 切换账号');
    console.log('  2. 查看当前登录状态');
    console.log('  3. 取消');
    console.log('');

    const choice = await askInput('请选择 (1/2/3)');

    if (choice === '3' || !choice) {
      return;
    }
    if (choice === '2') {
      await verifyToken(client);
      return;
    }
  }

  const username = await askInput('用户名');
  const password = await askPassword('密码');

  const result = await client.login(username, password);

  console.log('');

  if (result.success) {
    display.success('登录成功');
    console.log('');
    console.log(` 用户ID:   ${result.data.userId}`);
    console.log(` 用户名:   ${username}`);
    console.log(` 有效期:   7天`);

    if (result.data.resourceStatus) {
      console.log(` 资源状态: ${result.data.resourceStatus}`);
    }
  } else {
    display.error(result.error || '登录失败');
  }
}

function formatSeconds(seconds) {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时`;
  return `${Math.floor(seconds / 86400)} 天`;
}

async function adminLogin(client) {
  console.log('');
  display.title('超级管理员登录');
  console.log('');
  console.log(' 超级管理员使用 MongoDB 凭证认证');
  console.log(' 请输入 MongoDB 管理员账号密码');
  console.log('');

  const username = await askInput('MongoDB 用户名');
  if (!username) {
    display.error('请输入用户名');
    return;
  }
  const password = await askPassword('MongoDB 密码');

  const result = await client.adminLogin(username, password);

  console.log('');

  if (result.success) {
    display.success('超级管理员登录成功');
    console.log('');
    console.log(` 用户ID:   ${result.data.userId}`);
    console.log(` 用户名:   ${username}`);
    console.log(` 角色:     超级管理员`);
    console.log(` 有效期:   24小时`);
    console.log('');
    display.info('使用 dove info 查看系统状态');
  } else {
    display.error(result.error || '登录失败');
    console.log('');
    display.info('请检查 MongoDB 凭证是否正确');
  }
}

export default loginCommand;
