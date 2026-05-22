/**
 * API 密钥管理 - API Key 的增删查改
 */

import { display } from '../../display.js';
import { DoveClient } from '../../client.js';
import { AdminClient } from '../../lib/admin.js';
import { loadConfig, saveConfig } from '../../lib/config.js';
import { select, input, PROVIDER_CHOICES } from '../../lib/interactive.js';

// ==================== API Key 管理 ====================

/**
 * 列出所有 API Key 状态
 */
export async function listApiKeys() {
  const client = new DoveClient();
  
  console.log('');
  display.title('API Key 状态');
  console.log('');
  
  try {
    const data = await client.getUserKeys();
    
    // 官方 Key
    console.log('─'.repeat(50));
    console.log(' 官方 API Key');
    console.log('─'.repeat(50));
    
    for (const [provider, cfg] of Object.entries(data.officialKeys || {})) {
      const status = cfg.configured ? '✓ 已配置' : '✗ 未配置';
      const enabled = cfg.enabled ? '' : ' (禁用)';
      console.log(`  ${provider.padEnd(12)} ${status}${enabled}`);
      if (cfg.models && cfg.models.length > 0) {
        console.log(`               模型: ${cfg.models.slice(0, 3).join(', ')}${cfg.models.length > 3 ? '...' : ''}`);
      }
    }
    
    // 用户 Key
    console.log('');
    console.log('─'.repeat(50));
    console.log(' 用户自定义 API Key');
    console.log('─'.repeat(50));
    
    const userKeys = Object.entries(data.userKeys || {});
    if (userKeys.length === 0) {
      console.log('  (无自定义 Key，将使用官方 Key)');
    } else {
      for (const [provider, cfg] of userKeys) {
        console.log(`  ${provider.padEnd(12)} ✓ 已配置`);
        console.log(`               Key: ${cfg.maskedKey}`);
      }
    }
    
    console.log('');
    display.info('用户自定义 Key 优先级高于官方 Key');
    
  } catch (err) {
    display.error(`获取 API Key 状态失败: ${err.message}`);
  }
}

/**
 * 设置用户 API Key
 */
export async function setApiKey(provider, apiKey) {
  const client = new DoveClient();
  
  // 如果没有提供参数，交互式输入
  if (!provider) {
    provider = await select('选择提供商', PROVIDER_CHOICES);
    const answers = await inquirer.prompt([
      {
        type: 'password',
        name: 'apiKey',
        message: '输入 API Key',
        mask: '*'
      }
    ]);
    apiKey = answers.apiKey;
  }
  
  if (!apiKey) {
    display.error('请提供 API Key: dove config set-key --provider <名称> --key <key>');
    return;
  }
  
  try {
    const result = await client.setUserKey(provider, apiKey);
    display.success(result.message);
    display.info('使用 dove config test-key --provider ' + provider + ' 测试 Key 有效性');
  } catch (err) {
    display.error(`设置 API Key 失败: ${err.message}`);
  }
}

/**
 * 获取指定提供商的 Key 状态
 */
export async function getApiKey(provider) {
  const client = new DoveClient();
  
  if (!provider) {
    display.error('请指定提供商: dove config get-key --provider <名称>');
    display.info('支持的提供商: bailian, deepseek, glm');
    return;
  }
  
  try {
    const data = await client.getUserKeys();
    
    // 检查用户 Key
    const userKey = data.userKeys?.[provider];
    if (userKey) {
      console.log('');
      display.title(`${provider} API Key 状态`);
      console.log('');
      console.log(`  类型:     用户自定义`);
      console.log(`  Key:      ${userKey.maskedKey}`);
      console.log(`  创建时间: ${userKey.createdAt || '-'}`);
      console.log('');
      return;
    }
    
    // 检查官方 Key
    const officialKey = data.officialKeys?.[provider];
    if (officialKey) {
      console.log('');
      display.title(`${provider} API Key 状态`);
      console.log('');
      console.log(`  类型:     官方 Key`);
      console.log(`  状态:     ${officialKey.configured ? '已配置' : '未配置'}`);
      if (officialKey.models) {
        console.log(`  模型:     ${officialKey.models.join(', ')}`);
      }
      console.log('');
      return;
    }
    
    display.warn(`未找到 ${provider} 的 API Key 配置`);
    
  } catch (err) {
    display.error(`获取 API Key 状态失败: ${err.message}`);
  }
}

/**
 * 测试 API Key
 */
export async function testApiKey(provider, testKey) {
  const client = new DoveClient();
  
  if (!provider) {
    // 如果没有指定提供商，测试所有
    const providers = ['bailian', 'deepseek', 'glm'];
    console.log('');
    display.title('测试所有 API Key');
    console.log('');
    
    for (const p of providers) {
      try {
        const result = await client.testKey(p);
        const status = result.success ? '✓ 有效' : '✗ 无效';
        console.log(`  ${p.padEnd(12)} ${status}`);
        if (!result.success && result.message) {
          console.log(`               ${result.message}`);
        }
      } catch (err) {
        console.log(`  ${p.padEnd(12)} ✗ 测试失败: ${err.message}`);
      }
    }
    console.log('');
    return;
  }
  
  try {
    display.info(`正在测试 ${provider} API Key...`);
    const result = await client.testKey(provider, testKey);
    
    if (result.success) {
      display.success(result.message);
    } else {
      display.error(result.message);
    }
  } catch (err) {
    display.error(`测试失败: ${err.message}`);
  }
}

/**
 * 删除用户 API Key
 */
export async function deleteApiKey(provider) {
  const client = new DoveClient();
  
  if (!provider) {
    provider = await select('选择要删除的提供商', PROVIDER_CHOICES);
    const { confirmDel } = await inquirer.prompt([
      {
        type: 'list',
        name: 'confirmDel',
        message: '确认删除该 API Key？',
        choices: [
          { name: '✗ 否', value: false },
          { name: '✓ 是', value: true },
        ],
        default: 0
      }
    ]);
    
    if (!confirmDel) {
      display.info('已取消');
      return;
    }
  }
  
  try {
    const result = await client.deleteUserKey(provider);
    display.success(result.message);
    display.info('删除后将使用官方 API Key');
  } catch (err) {
    display.error(`删除失败: ${err.message}`);
  }
}

