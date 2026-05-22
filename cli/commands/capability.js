/**
 * 能力管理命令
 * 提供能力发现、刷新、查看等功能
 */

import { Command } from 'commander';
import { display } from '../display.js';
import { DoveClient } from '../client.js';
import { select } from '../lib/interactive.js';
import chalk from 'chalk';

const CAP_ACTION_CHOICES = [
  { name: 'refresh - 刷新能力发现', value: 'refresh' },
  { name: 'list    - 列出所有能力', value: 'list' },
  { name: 'info    - 查看能力详情', value: 'info' },
  { name: 'report  - 报告能力', value: 'report' },
];

export const capabilityCommand = new Command('capability')
  .alias('cap')
  .description('能力管理')
  .argument('[action]', '操作类型 (refresh/list/info)')
  .argument('[args...]', '操作参数')
  .option('-d, --dove <doveId>', '指定白鸽ID（管理员可指定官方鸽子）')
  .option('-a, --all', '显示所有能力（包括其他鸽子）')
  .option('--json', 'JSON 格式输出')
  .action(async (action, args, options) => {
    const client = new DoveClient();
    const authed = await client.ensureAuth();
    if (!authed) {
      display.error('登录已过期，请重新执行 dove login');
      process.exit(1);
    }
    await client.connectEncrypted();

    try {
      // 无 action 时交互式选择
      if (!action) {
        action = await select('选择操作', CAP_ACTION_CHOICES, 'list');
      }
      
      switch (action) {
        case 'refresh':
          await handleRefresh(client, options);
          break;
        case 'list':
        case 'ls':
          await handleList(client, options);
          break;
        case 'info':
          await handleInfo(client, args[0], options);
          break;
        case 'report':
          await handleReport(client, options);
          break;
        case 'help':
        case '--help':
        case '-h':
          showHelp();
          break;
        default:
          // 如果 action 看起来像能力名称，则显示详情
          if (action && !['refresh', 'list', 'ls', 'info', 'report', 'help'].includes(action)) {
            await handleInfo(client, action, options);
          } else {
            display.error(`未知操作: ${action}`);
            showHelp();
          }
      }
    } catch (err) {
      display.error(err.message);
      process.exit(1);
    }
  });

/**
 * 刷新能力发现
 */
async function handleRefresh(client, options) {
  const doveId = options.dove;
  
  display.info('开始能力发现...');
  console.log();
  
  const spinner = display.spinner('扫描能力...').start();
  
  try {
    // 调用服务端 API 触发能力刷新
    const result = await client.post('/api/capability/refresh', {
      doveId: doveId || process.env.DOVE_ID
    });
    spinner.stop();
    
    if (result.success) {
      display.success('能力发现完成!');
      console.log();
      
      const data = result.data || {};
      console.log(`  发现时间: ${data.发现时间 || new Date().toLocaleString('zh-CN')}`);
      console.log(`  能力总数: ${chalk.cyan(data.能力总数 || 0)}`);
      
      if (data.分类统计) {
        console.log();
        display.title('分类统计');
        for (const [分类, 数量] of Object.entries(data.分类统计)) {
          console.log(`  ${分类}: ${数量} 项`);
        }
      }
      
      if (data.来源统计) {
        console.log();
        display.title('来源统计');
        for (const [来源, 数量] of Object.entries(data.来源统计)) {
          console.log(`  ${来源}: ${数量} 项`);
        }
      }
    } else {
      display.error(`刷新失败: ${result.error || '未知错误'}`);
    }
  } catch (err) {
    spinner.stop();
    display.error(`刷新失败: ${err.message}`);
  }
}

/**
 * 列出能力
 */
async function handleList(client, options) {
  const spinner = display.spinner('获取能力列表...').start();
  
  try {
    const result = await client.get('/api/capability/list', {
      doveId: options.dove,
      all: options.all
    });
    spinner.stop();
    
    if (!result.success || !result.data) {
      display.error(`获取失败: ${result.error || '无数据'}`);
      return;
    }
    
    const capabilities = result.data.能力列表 || result.data || [];
    
    if (options.json) {
      console.log(JSON.stringify(capabilities, null, 2));
      return;
    }
    
    if (capabilities.length === 0) {
      display.info('暂无能力数据');
      display.info('使用 "dove capability refresh" 发现能力');
      return;
    }
    
    display.title(`能力列表 (${capabilities.length} 项)`);
    console.log();
    
    // 按分类分组显示
    const grouped = {};
    for (const cap of capabilities) {
      const 分类 = cap.分类 || '其他';
      if (!grouped[分类]) grouped[分类] = [];
      grouped[分类].push(cap);
    }
    
    for (const [分类, 能力列表] of Object.entries(grouped)) {
      console.log(`[${分类}]`);
      for (const cap of 能力列表) {
        const 图标 = cap.图标 || '•';
        const 来源 = cap.来源 ? `(${cap.来源}` + (cap.提供商 ? `/${cap.提供商}` : '') + ')' : '';
        console.log(`  ${图标} ${chalk.cyan(cap.名称)}: ${cap.描述 || '-'} ${chalk.gray(来源)}`);
      }
      console.log();
    }
  } catch (err) {
    spinner.stop();
    display.error(`获取失败: ${err.message}`);
  }
}

/**
 * 查看能力详情
 */
async function handleInfo(client, capabilityName, options) {
  if (!capabilityName) {
    display.error('请指定能力名称');
    display.info('用法: dove capability info <能力名称>');
    return;
  }
  
  const spinner = display.spinner(`获取能力详情: ${capabilityName}...`).start();
  
  try {
    const result = await client.get(`/api/capability/info/${encodeURIComponent(capabilityName)}`);
    spinner.stop();
    
    if (!result.success || !result.data) {
      display.error(`能力 "${capabilityName}" 不存在`);
      return;
    }
    
    const cap = result.data;
    
    if (options.json) {
      console.log(JSON.stringify(cap, null, 2));
      return;
    }
    
    display.title(`能力详情: ${cap.名称}`);
    console.log();
    console.log(`  ID: ${chalk.gray(cap.id || '-')}`);
    console.log(`  分类: ${cap.分类 || '-'}`);
    console.log(`  描述: ${cap.描述 || '-'}`);
    console.log();
    
    display.title('来源信息');
    console.log(`  来源: ${cap.来源 || '-'}`);
    if (cap.提供商) console.log(`  提供商: ${cap.提供商}`);
    if (cap.技能) console.log(`  技能: ${cap.技能}`);
    if (cap.工具) console.log(`  工具: ${cap.工具}`);
    if (cap.平台) console.log(`  平台: ${cap.平台}`);
    console.log();
    
    if (cap.模型映射) {
      display.title('模型映射');
      console.log(`  主模型: ${cap.模型映射.primary || '-'}`);
      if (cap.模型映射.alternatives?.length > 0) {
        console.log(`  备选: ${cap.模型映射.alternatives.join(', ')}`);
      }
      console.log();
    }
    
    display.title('版本信息');
    console.log(`  版本: ${cap.版本 || '-'}`);
    console.log(`  发现时间: ${cap.发现时间 || '-'}`);
    console.log(`  更新时间: ${cap.更新时间 || '-'}`);
  } catch (err) {
    spinner.stop();
    display.error(`获取失败: ${err.message}`);
  }
}

/**
 * 向管理库报告能力
 */
async function handleReport(client, options) {
  const doveId = options.dove || process.env.DOVE_ID;
  
  if (!doveId) {
    display.error('请指定白鸽 ID (--dove 或 DOVE_ID 环境变量)');
    return;
  }
  
  display.info(`向管理库报告能力 (鸽子: ${doveId})...`);
  
  const spinner = display.spinner('报告能力...').start();
  
  try {
    const result = await client.post('/api/capability/report', { doveId });
    spinner.stop();
    
    if (result.success) {
      display.success('能力报告成功!');
      console.log();
      const data = result.data || {};
      console.log(`  报告的能力数: ${data.报告数量 || data.能力总数 || 0}`);
    } else {
      display.error(`报告失败: ${result.error || '未知错误'}`);
    }
  } catch (err) {
    spinner.stop();
    display.error(`报告失败: ${err.message}`);
  }
}

function showHelp() {
  console.log('');
  display.title('能力管理命令');
  console.log('  refresh     刷新能力发现（扫描模型、技能、工具、平台）');
  console.log('  list, ls    列出所有能力');
  console.log('  info        查看能力详情 <能力名称>');
  console.log('  report      向管理库报告能力');
  console.log('');
  display.title('选项');
  console.log('  -d, --dove <doveId>   指定白鸽ID');
  console.log('  -a, --all             显示所有能力');
  console.log('  --json                JSON 格式输出');
  console.log('');
  display.title('示例');
  console.log('  dove capability refresh              # 刷新当前鸽子的能力');
  console.log('  dove capability refresh -d dove_xxx  # 刷新指定鸽子的能力');
  console.log('  dove capability list                 # 列出所有能力');
  console.log('  dove capability list --json          # JSON 格式输出');
  console.log('  dove capability info 推理            # 查看能力详情');
  console.log('  dove capability 推理                 # 简写：查看能力详情');
  console.log('');
  display.title('能力分类');
  console.log('  推理  - 逻辑推理、编程、数学');
  console.log('  感知  - 视觉、语音、OCR');
  console.log('  执行  - 工具调用、浏览器控制、GUI自动化');
  console.log('  内容  - 图片生成、语音合成、翻译');
  console.log('  特性  - 快速、长文本、低成本');
  console.log('  扩展  - 用户自定义能力');
}
