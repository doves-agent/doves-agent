/**
 * 执行配置 Profile 命令
 * 用法: dove profile [action] [options]
 * 
 * 管理执行配置预设，控制任务拆分/并行/能力/工具等行为边界
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { display } from '../display.js';
import { DoveClient, AdminClient } from '../client.js';
import { loadConfig } from '../lib/config.js';
import { select, confirm, input, multiSelect, TOOL_LEVEL_CHOICES, PROFILE_TAG_CHOICES, ABILITY_CHOICES, MAX_CONCURRENCY_CHOICES, MAX_DEPTH_CHOICES } from '../lib/interactive.js';

const PROFILE_ACTION_CHOICES = [
  { name: 'list   - 列出所有配置', value: 'list' },
  { name: 'show   - 查看配置详情', value: 'show' },
  { name: 'create - 创建配置', value: 'create' },
  { name: 'delete - 删除配置', value: 'delete' },
  { name: 'tags   - 列出标签', value: 'tags' },
];

export const profileCommand = new Command('profile')
  .description('管理执行配置 Profile')
  .argument('[action]', '操作: list|show|create|delete|tags')
  .argument('[name]', '配置标识')
  .option('-t, --tag <tag>', '按标签筛选')
  .option('-k, --keyword <keyword>', '按关键词搜索')
  .option('-a, --all', '查看所有用户的配置（仅超级管理员可用）')
  .option('--uid <userId>', '查看指定用户的配置（仅超级管理员可用）')
  .action(async (action, name, options) => {
    const config = loadConfig();
    const client = config.role === 'admin' ? new AdminClient() : new DoveClient();
    
    try {
      await client.ensureAuth();
      
      // 超管 --all 权限检查
      if (options.all) {
        if (!client.isAdmin()) {
          display.error('--all 选项仅超级管理员可用，请使用 dove login --admin 登录');
          process.exit(1);
        }
        client.setAdminAll(true);
      }
      
      // 超管 --uid 权限检查
      if (options.uid) {
        if (!client.isAdmin()) {
            display.error('--uid 选项仅超级管理员可用，请使用 dove login --admin 登录');
            process.exit(1);
        }
        client.setTargetUserId(options.uid);
      }
      
      // 无 action 时交互式选择
      if (!action) {
        action = await select('选择操作', PROFILE_ACTION_CHOICES, 'list');
      }
      
      switch (action) {
        case 'list':
        case 'ls':
          await listProfiles(client, options);
          break;
        case 'show':
        case 'get':
        case 'info':
          if (!name) {
            // 交互式选择配置
            name = await selectProfile(client);
            if (!name) return;
          }
          await showProfile(client, name);
          break;
        case 'create':
        case 'new':
          await createProfile(client, name);
          break;
        case 'delete':
        case 'rm':
          if (!name) {
            name = await selectProfile(client);
            if (!name) return;
          }
          await deleteProfile(client, name);
          break;
        case 'tags':
          await listTags(client);
          break;
        default:
          // 尝试作为标识查看
          await showProfile(client, action);
      }
    } catch (err) {
      display.error(err.message);
      process.exit(1);
    }
  });

// 列出所有配置
async function listProfiles(client, options = {}) {
  const spinner = display.spinner('获取执行配置列表...').start();
  
  try {
    const 筛选 = {
      tag: options.tag || null,
      keyword: options.keyword || null,
    };
    const profiles = await client.listProfiles(筛选);
    spinner.stop();
    
    if (!profiles || profiles.length === 0) {
      display.info('暂无执行配置');
      return;
    }
    
    display.title('执行配置 Profile 列表');
    console.log('');
    
    // 分组显示：内置 + 自定义
    const 内置 = profiles.filter(p => p.是否内置);
    const 自定义 = profiles.filter(p => !p.是否内置);
    
    if (内置.length > 0) {
      console.log(chalk.cyan('  [内置配置]'));
      内置.forEach(p => {
        const 标签显示 = p.标签?.length > 0 ? chalk.gray(` [${p.标签.join(', ')}]`) : '';
        console.log(`  ${chalk.green(p.标识.padEnd(16))} ${chalk.white(p.名称)}${标签显示}`);
        if (p.描述) console.log(`  ${''.padEnd(18)}${chalk.gray(p.描述)}`);
      });
    }
    
    if (自定义.length > 0) {
      console.log('');
      console.log(chalk.cyan('  [自定义配置]'));
      自定义.forEach(p => {
        const 标签显示 = p.标签?.length > 0 ? chalk.gray(` [${p.标签.join(', ')}]`) : '';
        console.log(`  ${chalk.yellow(p.标识.padEnd(16))} ${chalk.white(p.名称)}${标签显示}`);
        if (p.描述) console.log(`  ${''.padEnd(18)}${chalk.gray(p.描述)}`);
      });
    }
    
    console.log('');
    display.info(`共 ${profiles.length} 个配置 (${内置.length} 内置 + ${自定义.length} 自定义)`);
    display.info('使用 dove profile show <标识> 查看详情');
    display.info('使用 dove chat --profile <标识> 加载配置');
    
  } catch (err) {
    spinner.stop();
    display.error(`获取配置列表失败: ${err.message}`);
  }
}

// 查看配置详情
async function showProfile(client, 标识) {
  const spinner = display.spinner(`获取配置 "${标识}" 详情...`).start();
  
  try {
    const profile = await client.getProfile(标识);
    spinner.stop();
    
    if (!profile) {
      display.error(`配置 "${标识}" 不存在`);
      return;
    }
    
    display.title(`执行配置: ${profile.名称}`);
    console.log('');
    
    console.log(`  标识:     ${chalk.cyan(profile.标识)}`);
    console.log(`  描述:     ${profile.描述 || '无'}`);
    console.log(`  标签:     ${profile.标签?.join(', ') || '无'}`);
    console.log(`  类型:     ${profile.是否内置 ? '内置' : '自定义'}`);
    console.log('');
    
    // 执行约束
    if (profile.执行约束) {
      display.title('  执行约束');
      const e = profile.执行约束;
      console.log(`    禁止拆分:     ${formatBool(e.禁止拆分)}`);
      console.log(`    禁止并行:     ${formatBool(e.禁止并行)}`);
      console.log(`    禁止递归:     ${formatBool(e.禁止递归)}`);
      console.log(`    最大并发数:   ${e.最大并发数 ?? '不限制'}`);
      console.log(`    最大拆分深度: ${e.最大拆分深度 ?? '不限制'}`);
      console.log(`    建议拆分:     ${formatBool(e.建议拆分)}`);
      console.log(`    建议规划再执行: ${formatBool(e.建议规划再执行)}`);
      console.log(`    执行模式覆盖: ${e.执行模式覆盖 || '不覆盖'}`);
      console.log('');
    }
    
    // 能力约束
    if (profile.能力约束) {
      display.title('  能力约束');
      const a = profile.能力约束;
      console.log(`    可用能力: ${a.可用能力?.length > 0 ? a.可用能力.join(', ') : '不限制'}`);
      console.log(`    禁用能力: ${a.禁用能力?.length > 0 ? chalk.red(a.禁用能力.join(', ')) : '无'}`);
      console.log(`    建议能力: ${a.建议能力?.length > 0 ? chalk.green(a.建议能力.join(', ')) : '无'}`);
      console.log('');
    }
    
    // 工具约束
    if (profile.工具约束) {
      display.title('  工具约束');
      const t = profile.工具约束;
      console.log(`    安全级别上限: ${t.工具安全级别上限 || '不限制'}`);
      console.log(`    可用工具:     ${t.可用工具?.length > 0 ? t.可用工具.join(', ') : '不限制'}`);
      console.log(`    禁用工具:     ${t.禁用工具?.length > 0 ? chalk.red(t.禁用工具.join(', ')) : '无'}`);
      console.log('');
    }
    
    // 技能约束
    if (profile.技能约束) {
      display.title('  技能约束');
      const s = profile.技能约束;
      console.log(`    可用技能: ${s.可用技能?.length > 0 ? s.可用技能.join(', ') : '不限制'}`);
      console.log(`    禁用技能: ${s.禁用技能?.length > 0 ? chalk.red(s.禁用技能.join(', ')) : '无'}`);
      console.log('');
    }
    
    // 意图约束
    if (profile.意图约束) {
      display.title('  意图约束');
      const i = profile.意图约束;
      console.log(`    强制意图: ${i.强制意图 || '不覆盖'}`);
      console.log(`    禁止意图: ${i.禁止意图?.length > 0 ? chalk.red(i.禁止意图.join(', ')) : '无'}`);
      console.log(`    禁止闪回: ${formatBool(i.禁止闪回)}`);
      console.log('');
    }
    
    display.info(`使用: dove chat --profile ${profile.标识}`);
    
  } catch (err) {
    spinner.stop();
    display.error(`获取配置详情失败: ${err.message}`);
  }
}

/**
 * 交互式选择配置
 */
async function selectProfile(client) {
  try {
    const profiles = await client.listProfiles({});
    if (!profiles || profiles.length === 0) {
      display.info('暂无执行配置');
      return null;
    }
    const choices = profiles.map(p => ({
      name: `${p.标识} - ${p.名称}${p.是否内置 ? ' (内置)' : ''}`,
      value: p.标识,
    }));
    return await select('选择配置', choices);
  } catch (err) {
    display.error(`获取配置列表失败: ${err.message}`);
    return null;
  }
}

// 创建配置
async function createProfile(client, 标识) {
  const ans标识 = await input('配置标识', 标识 || '');
  if (!ans标识) { display.error('标识不能为空'); return; }
  const ans名称 = await input('配置名称', ans标识);
  const ans描述 = await input('描述');
  const ans标签 = await multiSelect('选择标签（空格勾选，回车确认）', PROFILE_TAG_CHOICES);
  const ans禁止拆分 = await confirm('禁止拆分?', false);
  const ans禁止并行 = await confirm('禁止并行?', false);
  const ans最大并发数 = (await select('最大并发数', MAX_CONCURRENCY_CHOICES, '5'));
  const ans最大拆分深度 = (await select('最大拆分深度', MAX_DEPTH_CHOICES, '3'));
  const TOOL_LEVEL_WITH_UNLIMITED = [
    { name: '不限制', value: '不限制' },
    ...TOOL_LEVEL_CHOICES,
  ];
  const ans工具安全级别 = await select('工具安全级别上限', TOOL_LEVEL_WITH_UNLIMITED, '不限制');
  
  const 配置数据 = {
    标识: ans标识,
    名称: ans名称 || ans标识,
    描述: ans描述 || '',
    标签: ans标签.length > 0 ? ans标签 : [],
    执行约束: {
      禁止拆分: ans禁止拆分,
      禁止并行: ans禁止并行,
      最大并发数: ans最大并发数 ? parseInt(ans最大并发数) || null : null,
      最大拆分深度: ans最大拆分深度 ? parseInt(ans最大拆分深度) || null : null,
    },
    工具约束: {
      工具安全级别上限: ans工具安全级别 === '不限制' ? null : ans工具安全级别,
    },
  };
  
  try {
    const result = await client.createProfile(配置数据);
    display.success(`执行配置 "${result.标识}" 创建成功`);
    display.info(`使用: dove chat --profile ${result.标识}`);
  } catch (err) {
    display.error(`创建配置失败: ${err.message}`);
  }
}

// 删除配置
async function deleteProfile(client, 标识) {
  const ok = await confirm(`确认删除配置 "${标识}"?`, false);
  
  if (!ok) {
    display.info('已取消');
    return;
  }
  
  try {
    await client.deleteProfile(标识);
    display.success(`配置 "${标识}" 已删除`);
  } catch (err) {
    display.error(`删除配置失败: ${err.message}`);
  }
}

// 列出标签
async function listTags(client) {
  try {
    const tags = await client.listProfileTags();
    display.title('执行配置标签');
    console.log('');
    if (tags.length === 0) {
      display.info('暂无标签');
    } else {
      tags.forEach(tag => console.log(`  ${chalk.cyan(tag)}`));
      console.log('');
      display.info(`共 ${tags.length} 个标签`);
    }
  } catch (err) {
    display.error(`获取标签失败: ${err.message}`);
  }
}

// 格式化布尔值
function formatBool(value) {
  if (value) return chalk.green('是');
  return chalk.gray('否');
}
