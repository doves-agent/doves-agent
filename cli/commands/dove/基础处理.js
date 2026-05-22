/**
 * 白鸽基础操作处理
 * 职责：register, list, info, delete, key, config, use, current, capability
 */

import { display } from '../../display.js';
import { loadConfig, saveConfig } from '../../lib/config.js';
import { select, multiSelect, confirm, DOVE_TYPE_CHOICES, ABILITY_CHOICES } from '../../lib/interactive.js';
import chalk from 'chalk';

const CAPABILITY_CHOICES = ABILITY_CHOICES;

/**
 * 注册白鸽
 */
async function handleRegister(client, options, args) {
  const name = options.name || args[0];
  const capabilities = options.capabilities;

  if (!name) {
    display.error('请指定白鸽名称 (--name 或 -n)');
    return;
  }

  // 交互式选择类型
  let type = options.type;
  if (!type || type === 'private') {
    type = await select('选择白鸽类型', DOVE_TYPE_CHOICES, 'private');
  }

  // 交互式多选能力
  let 能力列表 = capabilities ? capabilities.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (!capabilities) {
    能力列表 = await multiSelect('选择能力（空格勾选，回车确认）', CAPABILITY_CHOICES);
  }

  const spinner = display.spinner('注册白鸽...').start();
  const result = await client.registerDove({
    名称: name,
    类型: type,
    能力列表
  });
  spinner.stop();

  if (result.success) {
    display.success('白鸽注册成功!');
    console.log();
    console.log(`  鸽子 ID: ${chalk.cyan(result.data.doveId)}`);
    console.log(`  名称: ${result.data.名称}`);
    console.log(`  类型: ${result.data.类型}`);
    console.log(`  API Key: ${chalk.yellow(result.data.apiKey)}`);
    console.log();
    display.warn('⚠️  请妥善保存 API Key，此密钥只显示一次!');
  } else {
    display.error(`注册失败: ${result.error}`);
  }
}

/**
 * 列出我的白鸽
 */
async function handleList(client) {
  const spinner = display.spinner('获取白鸽列表...').start();
  const doves = await client.listMyDoves();
  spinner.stop();

  if (!doves || doves.length === 0) {
    display.info('暂无白鸽账号');
    return;
  }

  display.title('我的白鸽');
  console.log();
  
  doves.forEach(d => {
    const id = d.doveId?.substring(0, 16) + '...';
    const caps = d.能力列表?.join(', ') || '-';
    const rep = d.信誉?.等级 || '-';
    
    console.log(`  ${chalk.cyan(id)}`);
    console.log(`    名称: ${d.名称}`);
    console.log(`    类型: ${d.类型} | 状态: ${d.状态 || '活跃'} | 信誉: ${rep}`);
    console.log(`    能力: ${caps}`);
    console.log();
  });
}

/**
 * 查看白鸽详情
 */
async function handleInfo(client, doveId) {
  if (!doveId) {
    display.error('请指定白鸽 ID');
    return;
  }

  const spinner = display.spinner('获取白鸽信息...').start();
  const info = await client.getDoveInfo(doveId);
  spinner.stop();

  display.title('白鸽详情');
  console.log(`  ID: ${chalk.cyan(info.doveId)}`);
  console.log(`  名称: ${info.名称}`);
  console.log(`  类型: ${info.类型}`);
  console.log(`  状态: ${info.状态 || '活跃'}`);
  console.log(`  创建: ${info.createdAt ? new Date(info.createdAt).toLocaleString('zh-CN') : '-'}`);
  
  if (info.能力列表?.length > 0) {
    console.log(`  能力: ${info.能力列表.join(', ')}`);
  }
  
  if (info.信誉) {
    console.log(`  信誉等级: ${info.信誉.等级 || '-'}`);
    console.log(`  信誉积分: ${info.信誉.积分 || 0}`);
  }
  
  if (info.配置) {
    console.log();
    display.title('配置');
    console.log(JSON.stringify(info.配置, null, 2));
  }
}

/**
 * 注销白鸽
 */
async function handleDelete(client, doveId, force) {
  if (!doveId) {
    display.error('请指定白鸽 ID');
    return;
  }

  if (!force) {
    console.log();
    display.warn(`即将注销白鸽: ${doveId}`);
    const ok = await confirm('此操作不可恢复，确认注销？', false);
    if (!ok) {
      display.info('已取消');
      return;
    }
  }

  const spinner = display.spinner('注销白鸽...').start();
  const result = await client.deleteDove(doveId);
  spinner.stop();

  if (result.success) {
    display.success('白鸽已注销');
  } else {
    display.error(`注销失败: ${result.error}`);
  }
}

/**
 * 重新生成 API 密钥
 */
async function handleKey(client, doveId) {
  if (!doveId) {
    display.error('请指定白鸽 ID');
    return;
  }

  const spinner = display.spinner('重新生成密钥...').start();
  const result = await client.regenerateDoveKey(doveId);
  spinner.stop();

  if (result.success) {
    display.success('API 密钥已重新生成!');
    console.log();
    console.log(`  鸽子 ID: ${result.data.doveId}`);
    console.log(`  新 API Key: ${chalk.yellow(result.data.apiKey)}`);
    console.log();
    display.warn('⚠️  请妥善保存新密钥，旧密钥已失效!');
  } else {
    display.error(`操作失败: ${result.error}`);
  }
}

/**
 * 查看配置默认值
 */
async function handleConfig(client) {
  const spinner = display.spinner('获取配置...').start();
  const defaults = await client.getDoveConfigDefaults();
  spinner.stop();

  display.title('白鸽配置默认值');
  console.log(JSON.stringify(defaults, null, 2));
}

/**
 * 设置当前鸽子
 */
async function handleUse(client, doveId) {
  if (!doveId) {
    display.error('请指定鸽子ID');
    return;
  }
  
  // 验证鸽子存在
  const spinner = display.spinner('验证鸽子...').start();
  try {
    const info = await client.getDoveInfo(doveId);
    spinner.stop();
    
    if (!info) {
      display.error('鸽子不存在或无权访问');
      return;
    }
    
    // 保存当前鸽子
    saveConfig({ currentDoveId: doveId });
    
    display.success(`当前鸽子已切换`);
    console.log();
    console.log(`  ID: ${chalk.cyan(doveId)}`);
    console.log(`  名称: ${info.名称}`);
    console.log(`  类型: ${info.类型}`);
    console.log();
  } catch (err) {
    spinner.stop();
    display.error(`切换失败: ${err.message}`);
  }
}

/**
 * 查看当前鸽子
 */
async function handleCurrent(client) {
  const config = loadConfig();
  const currentDoveId = config.currentDoveId;
  
  if (!currentDoveId) {
    display.info('未设置当前鸽子');
    console.log();
    console.log(`  使用 ${chalk.cyan('dove dove use <doveId>')} 设置当前鸽子`);
    return;
  }
  
  const spinner = display.spinner('获取鸽子信息...').start();
  try {
    const info = await client.getDoveInfo(currentDoveId);
    spinner.stop();
    
    display.title('当前鸽子');
    console.log();
    console.log(`  ID: ${chalk.cyan(currentDoveId)}`);
    console.log(`  名称: ${info.名称}`);
    console.log(`  类型: ${info.类型}`);
    console.log(`  状态: ${info.状态 || '活跃'}`);
    
    if (info.能力列表?.length > 0) {
      console.log(`  能力: ${info.能力列表.join(', ')}`);
    }
    console.log();
  } catch (err) {
    spinner.stop();
    display.error(`获取信息失败: ${err.message}`);
    console.log(`  当前ID: ${currentDoveId} (可能已被删除)`);
  }
}

/**
 * 查看鸽子能力（含MCP发现的能力）
 */
async function handleCapability(client, doveId) {
  const config = loadConfig();
  const targetDoveId = doveId || config.currentDoveId;
  
  if (!targetDoveId) {
    display.error('请指定鸽子ID，或先使用 dove dove use 设置当前鸽子');
    return;
  }
  
  const spinner = display.spinner('获取鸽子能力...').start();
  try {
    const info = await client.getDoveInfo(targetDoveId);
    spinner.stop();
    
    display.title(`鸽子能力 - ${info.名称}`);
    console.log();
    console.log(`  ID: ${targetDoveId}`);
    console.log();
    
    // 原生能力
    if (info.能力列表?.length > 0) {
      display.title('原生能力');
      for (const cap of info.能力列表) {
        console.log(`  - ${cap}`);
      }
      console.log();
    }
    
    // MCP发现的能力
    const mcpConfig = info.MCP配置;
    if (mcpConfig?.servers?.length > 0) {
      display.title('MCP能力');
      for (const server of mcpConfig.servers) {
        if (server.启用 && server.工具列表?.length > 0) {
          console.log(`  ${chalk.cyan(server.名称)} (${server.工具列表.length} 个工具)`);
          for (const tool of server.工具列表.slice(0, 5)) {
            console.log(`    - ${tool.name}`);
          }
          if (server.工具列表.length > 5) {
            console.log(`    ... 还有 ${server.工具列表.length - 5} 个`);
          }
        }
      }
    }
    console.log();
  } catch (err) {
    spinner.stop();
    display.error(`获取能力失败: ${err.message}`);
  }
}

export {
  handleRegister,
  handleList,
  handleInfo,
  handleDelete,
  handleKey,
  handleConfig,
  handleUse,
  handleCurrent,
  handleCapability,
};
