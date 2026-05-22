/**
 * 技能管理命令
 * 提供技能禁用/启用、列表查看等功能
 * 
 * 功能：
 * - 列出所有技能（含状态）
 * - 按类别分组显示
 * - 禁用/启用单个技能
 * - 按类别批量禁用/启用
 * - 全部禁用/启用
 */

import { Command } from 'commander';
import { display } from '../display.js';
import { DoveClient } from '../client.js';
import { loadConfig, saveConfig } from '../lib/config.js';
import { select, multiSelect } from '../lib/interactive.js';
import chalk from 'chalk';

// 技能分类定义（与 skills/index.js 保持一致）
const 技能分类 = {
  文档处理: ['pdf', 'docx', 'xlsx', 'pptx', 'txt'],
  代码计算: ['code', 'calculator', 'math'],
  网络搜索: ['web_search', 'http_request', 'browser_agent'],
  多媒体: ['image', 'vision', 'audio', 'video'],
  记忆系统: ['memory', 'git_memory'],
  外部服务: ['mcp_client', 'docker_agent', 'ssh_agent'],
  解析器: ['archive', 'code', 'config', 'data', 'ebook'],
  系统任务: ['resource_allocation', 'cleanup', 'backup']
};

const SKILL_ACTION_CHOICES = [
  { name: 'list    - 列出所有技能', value: 'list' },
  { name: 'enable  - 启用技能', value: 'enable' },
  { name: 'disable - 禁用技能', value: 'disable' },
  { name: 'status  - 查看技能状态', value: 'status' },
];

const CATEGORY_CHOICES = Object.keys(技能分类).map(k => ({ name: k, value: k }));

export const skillCommand = new Command('skill')
  .alias('skills')
  .description('技能管理')
  .argument('[action]', '操作类型 (list/enable/disable/status)')
  .argument('[target]', '目标（技能名或类别名）')
  .option('-c, --category <category>', '按类别操作')
  .option('-a, --all', '操作所有技能')
  .option('--json', 'JSON 格式输出')
  .option('--remote', '操作远程服务端配置（需要管理员权限）')
  .action(async (action, target, options) => {
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
        action = await select('选择操作', SKILL_ACTION_CHOICES, 'list');
      }
      
      switch (action) {
        case 'list':
        case 'ls':
          await handleList(client, options);
          break;
        case 'enable':
          await handleEnable(client, target, options);
          break;
        case 'disable':
          await handleDisable(client, target, options);
          break;
        case 'status':
          await handleStatus(client, target, options);
          break;
        case 'help':
        case '--help':
        case '-h':
          showHelp();
          break;
        default:
          // 如果 action 看起来像技能名称，则显示状态
          if (action && !['list', 'ls', 'enable', 'disable', 'status', 'help'].includes(action)) {
            await handleStatus(client, action, options);
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
 * 列出技能
 */
async function handleList(client, options) {
  const spinner = display.spinner('获取技能列表...').start();
  
  try {
    // 尝试从服务端获取技能列表
    let remoteSkills = [];
    try {
      const result = await client.get('/api/skill/list');
      if (result.success && result.data) {
        remoteSkills = result.data.技能列表 || result.data || [];
      }
    } catch (e) {
      // 服务端不可用，使用本地分类
    }
    
    spinner.stop();
    
    // 获取本地禁用配置
    const config = loadConfig();
    const disabledSkills = config.disabledSkills || [];
    const disabledCategories = config.disabledCategories || [];
    
    // 如果没有远程数据，使用本地分类
    const skillsToShow = remoteSkills.length > 0 ? remoteSkills : getDefaultSkillList();
    
    if (options.json) {
      console.log(JSON.stringify({
        skills: skillsToShow,
        disabledSkills,
        disabledCategories
      }, null, 2));
      return;
    }
    
    display.title(`技能列表`);
    console.log();
    
    // 按分类分组显示
    const grouped = {};
    for (const skill of skillsToShow) {
      const 分类 = skill.分类 || getCategoryForSkill(skill.name || skill.名称) || '其他';
      if (!grouped[分类]) grouped[分类] = [];
      grouped[分类].push(skill);
    }
    
    for (const [分类, 技能列表] of Object.entries(grouped)) {
      const 分类禁用 = disabledCategories.includes(分类);
      const 分类标记 = 分类禁用 ? chalk.red(' [已禁用]') : '';
      console.log(`[${分类}]${分类标记}`);
      
      for (const skill of 技能列表) {
        const 名称 = skill.name || skill.名称 || skill;
        const 描述 = skill.description || skill.描述 || '-';
        const 来源 = skill.来源 || '';
        
        const 技能禁用 = disabledSkills.includes(名称) || 分类禁用;
        const 图标 = 技能禁用 ? chalk.red('○') : chalk.green('●');
        const 状态文本 = 技能禁用 ? chalk.gray(' (已禁用)') : '';
        const 来源文本 = 来源 ? chalk.gray(` (${来源})`) : '';
        
        console.log(`  ${图标} ${chalk.cyan(名称)}: ${描述}${状态文本}${来源文本}`);
      }
      console.log();
    }
    
    // 显示统计
    const totalSkills = skillsToShow.length;
    const enabledCount = skillsToShow.filter(s => {
      const name = s.name || s.名称 || s;
      const cat = s.分类 || getCategoryForSkill(name) || '其他';
      return !disabledSkills.includes(name) && !disabledCategories.includes(cat);
    }).length;
    
    console.log(chalk.gray(`统计: 总计 ${totalSkills} 个技能, 已启用 ${enabledCount} 个, 已禁用 ${totalSkills - enabledCount} 个`));
    
  } catch (err) {
    spinner.stop();
    display.error(`获取失败: ${err.message}`);
  }
}

/**
 * 启用技能
 */
async function handleEnable(client, target, options) {
  const config = loadConfig();
  let disabledSkills = [...(config.disabledSkills || [])];
  let disabledCategories = [...(config.disabledCategories || [])];
  let affectedSkills = [];
  
  if (options.all) {
    // 启用所有技能
    affectedSkills = [...disabledSkills];
    disabledSkills = [];
    disabledCategories = [];
    display.info('启用所有技能...');
  } else if (options.category) {
    // 按类别启用
    let category = options.category;
    if (!技能分类[category]) {
      // 交互式选择类别
      category = await select('选择要启用的类别', CATEGORY_CHOICES);
    }
    
    // 从禁用类别中移除
    disabledCategories = disabledCategories.filter(c => c !== category);
    // 从禁用技能中移除该类别的技能
    const categorySkills = 技能分类[category] || [];
    affectedSkills = disabledSkills.filter(s => categorySkills.includes(s));
    disabledSkills = disabledSkills.filter(s => !categorySkills.includes(s));
    
    display.info(`启用类别「${category}」的所有技能...`);
  } else if (target) {
    // 启用单个技能
    if (disabledSkills.includes(target)) {
      disabledSkills = disabledSkills.filter(s => s !== target);
      affectedSkills = [target];
    } else {
      display.info(`技能「${target}」已是启用状态`);
      return;
    }
    display.info(`启用技能「${target}」...`);
  } else {
    // 交互式：多选要启用的类别
    const disabledCatChoices = disabledCategories.map(c => ({ name: c, value: c, checked: false }));
    const disabledSkillChoices = disabledSkills.map(s => {
      const cat = getCategoryForSkill(s) || '其他';
      return { name: `${s} (${cat})`, value: s, checked: false };
    });
    
    if (disabledCatChoices.length === 0 && disabledSkillChoices.length === 0) {
      display.info('所有技能已启用');
      return;
    }
    
    const allChoices = [
      ...(disabledCatChoices.length > 0 ? [{ name: '── 按类别启用 ──', value: '__sep_cat__', disabled: true }, ...disabledCatChoices] : []),
      ...(disabledSkillChoices.length > 0 ? [{ name: '── 按技能启用 ──', value: '__sep_skill__', disabled: true }, ...disabledSkillChoices] : []),
    ];
    const selected = await multiSelect('选择要启用的项目（空格勾选，回车确认）', allChoices);
    
    for (const item of selected) {
      if (技能分类[item]) {
        // 是分类
        disabledCategories = disabledCategories.filter(c => c !== item);
        affectedSkills.push(...(技能分类[item] || []));
      } else {
        // 是技能
        disabledSkills = disabledSkills.filter(s => s !== item);
        affectedSkills.push(item);
      }
    }
    
    if (affectedSkills.length === 0) {
      display.info('未选择任何项目');
      return;
    }
  }
  
  // 保存配置
  saveConfig({ disabledSkills, disabledCategories });
  
  if (affectedSkills.length > 0) {
    display.success(`已启用 ${affectedSkills.length} 个技能`);
    affectedSkills.forEach(s => console.log(`  ${chalk.green('●')} ${s}`));
  }
  
  // 如果是远程模式，同步到服务端
  if (options.remote) {
    await syncToRemote(client, 'enable', affectedSkills, options);
  }
}

/**
 * 禁用技能
 */
async function handleDisable(client, target, options) {
  const config = loadConfig();
  let disabledSkills = [...(config.disabledSkills || [])];
  let disabledCategories = [...(config.disabledCategories || [])];
  let affectedSkills = [];
  
  if (options.all) {
    // 禁用所有技能 - 禁用所有类别
    display.info('禁用所有技能...');
    disabledCategories = Object.keys(技能分类);
    affectedSkills = getAllSkillNames();
  } else if (options.category) {
    // 按类别禁用
    let category = options.category;
    if (!技能分类[category]) {
      // 交互式选择类别
      category = await select('选择要禁用的类别', CATEGORY_CHOICES);
    }
    
    if (!disabledCategories.includes(category)) {
      disabledCategories.push(category);
    }
    affectedSkills = 技能分类[category] || [];
    
    display.info(`禁用类别「${category}」的所有技能...`);
  } else if (target) {
    // 禁用单个技能
    if (!disabledSkills.includes(target)) {
      disabledSkills.push(target);
      affectedSkills = [target];
    } else {
      display.info(`技能「${target}」已是禁用状态`);
      return;
    }
    display.info(`禁用技能「${target}」...`);
  } else {
    // 交互式：多选要禁用的项目（类别 + 单个技能）
    const enabledCatChoices = Object.keys(技能分类)
      .filter(c => !disabledCategories.includes(c))
      .map(c => ({ name: `── ${c} (${技能分类[c].length}个技能) ──`, value: `__cat__${c}`, checked: false }));
    
    const enabledSkillChoices = Object.entries(技能分类)
      .filter(([cat]) => !disabledCategories.includes(cat))
      .flatMap(([cat, skills]) =>
        skills
          .filter(s => !disabledSkills.includes(s))
          .map(s => ({ name: `  ${s} (${cat})`, value: s, checked: false }))
      );
    
    if (enabledCatChoices.length === 0 && enabledSkillChoices.length === 0) {
      display.info('所有技能已禁用');
      return;
    }
    
    const allChoices = [
      ...enabledCatChoices,
      ...(enabledSkillChoices.length > 0 ? [{ name: '── 单个技能 ──', value: '__sep_skill__', disabled: true }, ...enabledSkillChoices] : []),
    ];
    const selected = await multiSelect('选择要禁用的项目（空格勾选，回车确认）', allChoices);
    
    for (const item of selected) {
      if (item.startsWith('__cat__')) {
        const cat = item.replace('__cat__', '');
        if (!disabledCategories.includes(cat)) {
          disabledCategories.push(cat);
        }
        affectedSkills.push(...(技能分类[cat] || []));
      } else {
        if (!disabledSkills.includes(item)) {
          disabledSkills.push(item);
        }
        affectedSkills.push(item);
      }
    }
    
    if (affectedSkills.length === 0) {
      display.info('未选择任何类别');
      return;
    }
  }
  
  // 保存配置
  saveConfig({ disabledSkills, disabledCategories });
  
  if (affectedSkills.length > 0) {
    display.success(`已禁用 ${affectedSkills.length} 个技能`);
    affectedSkills.forEach(s => console.log(`  ${chalk.red('○')} ${s}`));
  }
  
  // 如果是远程模式，同步到服务端
  if (options.remote) {
    await syncToRemote(client, 'disable', affectedSkills, options);
  }
}

/**
 * 查看技能状态
 */
async function handleStatus(client, skillName, options) {
  if (!skillName) {
    // 交互式选择技能
    const allSkills = getAllSkillNames();
    if (allSkills.length === 0) {
      display.error('暂无技能');
      return;
    }
    const skillChoices = allSkills.map(s => {
      const cat = getCategoryForSkill(s) || '其他';
      return { name: `${s} (${cat})`, value: s };
    });
    skillName = await select('选择技能', skillChoices);
  }
  
  const config = loadConfig();
  const disabledSkills = config.disabledSkills || [];
  const disabledCategories = config.disabledCategories || [];
  
  // 获取技能分类
  const category = getCategoryForSkill(skillName);
  const isDisabled = disabledSkills.includes(skillName) || disabledCategories.includes(category);
  
  if (options.json) {
    console.log(JSON.stringify({
      name: skillName,
      category,
      enabled: !isDisabled,
      disabledBySkill: disabledSkills.includes(skillName),
      disabledByCategory: disabledCategories.includes(category)
    }, null, 2));
    return;
  }
  
  display.title(`技能状态: ${skillName}`);
  console.log();
  console.log(`  名称: ${chalk.cyan(skillName)}`);
  console.log(`  分类: ${category || '未知'}`);
  console.log(`  状态: ${isDisabled ? chalk.red('已禁用') : chalk.green('已启用')}`);
  
  if (disabledSkills.includes(skillName)) {
    console.log(`  禁用原因: 单独禁用`);
  } else if (disabledCategories.includes(category)) {
    console.log(`  禁用原因: 分类「${category}」已禁用`);
  }
  
  console.log();
  console.log(`操作命令:`);
  console.log(`  启用: ${chalk.gray(`dove skill enable ${skillName}`)}`);
  console.log(`  禁用: ${chalk.gray(`dove skill disable ${skillName}`)}`);
}

/**
 * 同步到远程服务端
 */
async function syncToRemote(client, action, skills, options) {
  if (skills.length === 0) return;
  
  const spinner = display.spinner('同步到服务端...').start();
  
  try {
    const result = await client.post('/api/skill/batch', {
      action,
      skills
    });
    
    spinner.stop();
    
    if (result.success) {
      display.success('已同步到服务端');
    } else {
      display.warn(`同步失败: ${result.error || '未知错误'}`);
    }
  } catch (err) {
    spinner.stop();
    display.warn(`同步失败: ${err.message}`);
  }
}

/**
 * 根据技能名获取分类
 */
function getCategoryForSkill(skillName) {
  for (const [分类, 技能列表] of Object.entries(技能分类)) {
    if (技能列表.includes(skillName)) {
      return 分类;
    }
  }
  return null;
}

/**
 * 获取所有技能名称
 */
function getAllSkillNames() {
  const names = [];
  for (const 技能列表 of Object.values(技能分类)) {
    names.push(...技能列表);
  }
  return names;
}

/**
 * 获取默认技能列表
 */
function getDefaultSkillList() {
  const list = [];
  for (const [分类, 技能列表] of Object.entries(技能分类)) {
    for (const 名称 of 技能列表) {
      list.push({ 名称, 分类, 来源: '目录' });
    }
  }
  return list;
}

/**
 * 显示帮助
 */
function showHelp() {
  console.log('');
  display.title('技能管理命令');
  console.log('  list, ls      列出所有技能');
  console.log('  enable        启用技能');
  console.log('  disable       禁用技能');
  console.log('  status        查看技能状态');
  console.log('');
  display.title('选项');
  console.log('  -c, --category <name>  按类别操作');
  console.log('  -a, --all              操作所有技能');
  console.log('  --json                 JSON 格式输出');
  console.log('  --remote               同步到远程服务端（需管理员权限）');
  console.log('');
  display.title('示例');
  console.log('  dove skill list                     # 列出所有技能');
  console.log('  dove skill list --json              # JSON 格式输出');
  console.log('  dove skill enable browser_agent     # 启用单个技能');
  console.log('  dove skill disable browser_agent    # 禁用单个技能');
  console.log('  dove skill enable -c 网络搜索       # 启用整个类别');
  console.log('  dove skill disable -c 外部服务      # 禁用整个类别');
  console.log('  dove skill enable --all             # 启用所有技能');
  console.log('  dove skill disable --all            # 禁用所有技能');
  console.log('  dove skill status browser_agent     # 查看技能状态');
  console.log('');
  display.title('技能分类');
  for (const [分类, 技能列表] of Object.entries(技能分类)) {
    console.log(`  ${分类}: ${技能列表.slice(0, 3).join(', ')}${技能列表.length > 3 ? '...' : ''}`);
  }
}
