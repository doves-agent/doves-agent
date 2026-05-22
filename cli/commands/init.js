/**
 * dove init - 首次配置向导
 *
 * 交互式引导新用户完成初始化配置：
 *   步骤1: 输入 Server 地址 → 测试连通性
 *   步骤2: 注册 / 登录 → 获取 JWT Token
 *   步骤3: 选择 LLM 提供商 → 输入 API Key → 测试连接
 *   步骤4: 创建第一只鸽子（可选）
 *
 * 所有配置写入 ~/.dove/config.json，不修改其他文件。
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import { display } from '../display.js';
import { loadConfig, saveConfig, CONFIG_DIR } from '../lib/config.js';
import { DoveClient } from '../client.js';
import { select, input, confirm, PROVIDER_CHOICES } from '../lib/interactive.js';
import { PROVIDER_TEST_ENDPOINTS, normalizeProvider } from '@dove/common/模型配置.js';

// ==================== 步骤1: 服务端地址 ====================

async function step1_ServerURL() {
  const config = loadConfig();
  const currentGateway = config.gateway || 'http://localhost:3003';

  console.log('');
  display.title('步骤 1/3: 连接服务端');
  console.log('');

  const { serverUrl } = await inquirer.prompt([
    {
      type: 'input',
      name: 'serverUrl',
      message: '白鸽服务端地址',
      default: currentGateway,
      validate: (val) => {
        try { new URL(val); return true; } catch { return '无效的 URL 格式'; }
      },
    },
  ]);

  const normalizedUrl = serverUrl.replace(/\/$/, '');

  // 测试连通性
  display.info('正在测试连通性...');
  const tempClient = new DoveClient();
  tempClient.baseUrl = normalizedUrl;
  const pingResult = await tempClient.ping();

  if (pingResult.success && pingResult.pong) {
    display.success(`服务端已连接 [${pingResult.latency}ms]`);
    saveConfig({ gateway: normalizedUrl });
    return { gateway: normalizedUrl, client: tempClient };
  }

  // 连接失败，询问是否继续
  display.error(`服务端未响应: ${pingResult.error || '未知错误'}`);
  const stillContinue = await confirm('无法连接服务端，是否仍然保存地址并继续？', false);
  if (stillContinue) {
    saveConfig({ gateway: normalizedUrl });
    return { gateway: normalizedUrl, client: tempClient };
  }

  display.info('请确保服务端已启动后重新运行 dove init');
  return null;
}

// ==================== 步骤2: 注册/登录 ====================

async function step2_Auth(client) {
  console.log('');
  display.title('步骤 2/3: 账号配置');
  console.log('');

  const config = loadConfig();

  // 已登录则跳过
  if (config.token && config.username) {
    display.success(`已登录: ${config.username}`);
    const keepLogin = await confirm('使用当前账号继续？', true);
    if (keepLogin) return true;

    // 选择切换
    const { authAction } = await inquirer.prompt([
      {
        type: 'list',
        name: 'authAction',
        message: '请选择操作',
        choices: [
          { name: '登录其他账号', value: 'login' },
          { name: '注册新账号', value: 'register' },
          { name: '跳过（稍后登录）', value: 'skip' },
        ],
      },
    ]);

    if (authAction === 'skip') return false;
    if (authAction === 'login') return await doLogin(client);
    if (authAction === 'register') return await doRegister(client);
  }

  // 未登录，提供选项
  const { authAction } = await inquirer.prompt([
    {
      type: 'list',
      name: 'authAction',
      message: '请选择操作',
      choices: [
        { name: '登录已有账号', value: 'login' },
        { name: '注册新账号', value: 'register' },
        { name: '匿名登录', value: 'anonymous' },
        { name: '跳过（稍后登录）', value: 'skip' },
      ],
    },
  ]);

  if (authAction === 'skip') return false;
  if (authAction === 'login') return await doLogin(client);
  if (authAction === 'register') return await doRegister(client);
  if (authAction === 'anonymous') return await doAnonymousLogin(client);

  return false;
}

async function doLogin(client) {
  const { username } = await inquirer.prompt([
    { type: 'input', name: 'username', message: '用户名', validate: (v) => v.trim().length > 0 || '请输入用户名' },
  ]);
  const { password } = await inquirer.prompt([
    { type: 'password', name: 'password', message: '密码', mask: '*' },
  ]);

  try {
    const result = await client.login(username, password);
    if (result.success) {
      display.success(`登录成功: ${username}`);
      return true;
    }
    display.error(result.error || '登录失败');
  } catch (err) {
    display.error(`登录失败: ${err.message}`);
  }

  const retry = await confirm('是否重试？', true);
  return retry ? doLogin(client) : false;
}

async function doRegister(client) {
  const answers = await inquirer.prompt([
    { type: 'input', name: 'username', message: '用户名', validate: (v) => v.trim().length >= 3 || '用户名至少3个字符' },
    { type: 'password', name: 'password', message: '密码', mask: '*', validate: (v) => v.length >= 8 || '密码至少8个字符' },
    { type: 'input', name: 'email', message: '邮箱（可选）' },
  ]);

  try {
    const result = await client.register(answers.username, answers.password, answers.email);
    if (result.success) {
      display.success(`注册成功: ${answers.username}`);
      return true;
    }
    display.error(result.error || '注册失败');
  } catch (err) {
    display.error(`注册失败: ${err.message}`);
  }

  const retry = await confirm('是否重试？', true);
  return retry ? doRegister(client) : false;
}

async function doAnonymousLogin(client) {
  try {
    const allowed = await client.isAnonymousAllowed();
    if (!allowed) {
      display.error('匿名登录已被服务端禁用');
      return false;
    }
    const result = await client.anonymousLogin();
    if (result.success) {
      display.success('匿名登录成功');
      return true;
    }
    display.error(result.error || '匿名登录失败');
  } catch (err) {
    display.error(`匿名登录失败: ${err.message}`);
  }
  return false;
}

// ==================== 步骤3: LLM 提供商 + API Key ====================

async function step3_LLMProvider() {
  console.log('');
  display.title('步骤 3/3: LLM 提供商配置');
  console.log('');
  display.info('默认使用百炼（阿里云），你也可以切换到其他提供商');
  console.log('');

  const provider = await select('选择 LLM 提供商', [
    { name: '阿里百炼（默认推荐）', value: '百炼' },
    { name: 'DeepSeek 官方', value: 'DeepSeek' },
    { name: '智谱 GLM', value: 'GLM' },
    { name: '暂不配置（稍后使用 dove config set-key）', value: '__skip__' },
  ], '百炼');

  if (provider === '__skip__') {
    display.info('稍后可通过 dove config set-key 配置 API Key');
    return false;
  }

  const { apiKey } = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: `输入 ${provider} API Key`,
      mask: '*',
      validate: (v) => v.trim().length > 0 || '请输入 API Key',
    },
  ]);

  // 测试 Key
  display.info(`正在测试 ${provider} API Key...`);
  const keyValid = await testProviderKey(provider, apiKey);

  if (keyValid) {
    display.success(`${provider} API Key 有效`);
  } else {
    display.warn(`${provider} API Key 测试未通过，将保存但可能无法正常使用`);
  }

  // 保存到服务端（需要已登录）
  try {
    const client = new DoveClient();
    if (client.token) {
      await client.setUserKey(provider, apiKey);
      display.success('API Key 已保存到服务端');
    } else {
      display.info('未登录，API Key 将仅保存在本地配置');
    }
  } catch (err) {
    display.warn(`保存到服务端失败: ${err.message}，Key 将仅保存在本地`);
  }

  return true;
}

/**
 * 测试提供商 API Key 是否有效
 * @param {string} provider - 标准提供商名
 * @param {string} apiKey - API Key 值
 * @returns {Promise<boolean>}
 */
async function testProviderKey(provider, apiKey) {
  const testUrl = PROVIDER_TEST_ENDPOINTS[provider];
  if (!testUrl) return true; // 未知提供商跳过测试

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

// ==================== 完成向导 ====================

async function showCompletion() {
  const config = loadConfig();

  console.log('');
  console.log('─'.repeat(50));
  display.success('初始化完成！');
  console.log('');
  console.log('  配置文件: ~/.dove/config.json');
  console.log(`  服务端:   ${config.gateway || '未配置'}`);
  console.log(`  用户:     ${config.username || '未登录'}`);
  console.log('');
  display.info('常用命令:');
  console.log('  dove chat          开始对话');
  console.log('  dove status        系统状态');
  console.log('  dove config list   查看所有配置');
  console.log('  dove config set-key 配置更多 API Key');
  console.log('');
}

// ==================== 命令注册 ====================

export const initCommand = new Command('init')
  .description('首次配置向导（服务端地址 + 账号 + LLM 提供商）')
  .action(async () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║           白鸽系统 首次配置向导                       ║');
    console.log('╚══════════════════════════════════════════════════════╝');

    try {
      // 步骤1: 服务端地址
      const step1Result = await step1_ServerURL();
      if (!step1Result) return;

      const { client } = step1Result;

      // 步骤2: 注册/登录
      await step2_Auth(client);

      // 步骤3: LLM 提供商
      await step3_LLMProvider();

      // 完成提示
      await showCompletion();

    } catch (err) {
      display.error(`初始化失败: ${err.message}`);
      display.info('可重新运行 dove init');
      process.exit(1);
    }
  });

export default initCommand;
