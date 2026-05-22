/**
 * @file team.js
 * @description 多智能体团队管理命令
 * 用法: dove team [action] [options]
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { display } from '../display.js';
import { DoveClient } from '../client.js';
import { select, input, confirm } from '../lib/interactive.js';

const ACTION_CHOICES = [
  { name: 'show    - 查看当前团队配置', value: 'show' },
  { name: 'default - 查看系统默认配置模板', value: 'default' },
  { name: 'add     - 添加一个智能体', value: 'add' },
  { name: 'remove  - 删除一个智能体', value: 'remove' },
  { name: 'update  - 修改智能体配置', value: 'update' },
  { name: 'reset   - 恢复为系统默认配置', value: 'reset' },
];

const 提供商选项 = [
  { name: 'DeepSeek', value: 'DeepSeek' },
  { name: '百炼', value: '百炼' },
  { name: 'GLM (智谱)', value: 'GLM' },
  { name: '自定义', value: '自定义' },
];

export const teamCommand = new Command('team')
  .description('多智能体团队管理')
  .argument('[action]', '操作: show|default|add|remove|update|reset')
  .argument('[name]', '智能体角色名')
  .option('-m, --model <model>', '模型名')
  .option('-p, --provider <provider>', '模型提供商')
  .action(async (action, name, cmd) => {
    const options = typeof cmd.opts === 'function' ? cmd.opts() : cmd;
    const client = new DoveClient();

    try {
      await client.ensureAuth();

      if (!action) {
        action = await select('选择操作', ACTION_CHOICES, 'show');
      }

      switch (action) {
        case 'show':
        case 'ls':
        case 'list':
          await showTeam(client);
          break;
        case 'default':
          await showDefault(client);
          break;
        case 'add':
          await addAgent(client, name);
          break;
        case 'remove':
        case 'rm':
          await removeAgent(client, name);
          break;
        case 'update':
        case 'edit':
          await updateAgent(client, name, options);
          break;
        case 'reset':
          await resetTeam(client);
          break;
        default:
          display.error(`未知操作: ${action}`);
          display.info('可用操作: show, default, add, remove, update, reset');
      }
    } catch (err) {
      display.error(err.message);
    }
  });

/**
 * 显示当前团队配置
 */
async function showTeam(client) {
  const spinner = display.spinner('获取团队配置...').start();
  try {
    const config = await client.getTeamConfig();
    spinner.stop();

    display.title(`多智能体团队 (${config.来源})`);
    console.log('');

    const agents = config.智能体列表 || [];
    if (agents.length === 0) {
      display.info('未配置智能体');
      return;
    }

    agents.forEach((agent) => {
      const marker = agent.是否主智能体 ? chalk.yellow('★ ') : '  ';
      const nameStyle = agent.是否主智能体 ? chalk.yellow : chalk.white;
      console.log(`${marker}${nameStyle(agent.角色名.padEnd(12))} ${chalk.cyan(agent.模型提供商 + '/' + agent.模型名)}`);
      if (agent.系统提示词) {
        const preview = agent.系统提示词.substring(0, 80).replace(/\n/g, ' ');
        console.log(`  ${''.padEnd(12)}${chalk.gray(preview + (agent.系统提示词.length > 80 ? '...' : ''))}`);
      }
    });

    console.log('');
    display.info(`共 ${agents.length} 个智能体`);
  } catch (err) {
    spinner.stop();
    display.error(`获取失败: ${err.message}`);
  }
}

/**
 * 显示系统默认配置模板
 */
async function showDefault(client) {
  const spinner = display.spinner('获取系统默认配置...').start();
  try {
    const config = await client.getDefaultTeamConfig();
    spinner.stop();

    display.title('系统默认多智能体团队模板');
    if (config.说明) {
      console.log(chalk.gray(`  ${config.说明}`));
    }
    console.log('');

    const agents = config.智能体列表 || [];
    agents.forEach((agent) => {
      const marker = agent.是否主智能体 ? chalk.yellow('★ ') : '  ';
      console.log(`${marker}${chalk.white(agent.角色名.padEnd(12))} ${chalk.cyan(agent.模型提供商 + '/' + agent.模型名)}`);
    });

    console.log('');
    display.info(`共 ${agents.length} 个默认角色`);
    display.info('使用 dove team reset 恢复为默认配置');
  } catch (err) {
    spinner.stop();
    display.error(`获取失败: ${err.message}`);
  }
}

/**
 * 添加智能体
 */
async function addAgent(client, name) {
  const 角色名 = name || await input('角色名');
  if (!角色名) {
    display.error('角色名不能为空');
    return;
  }

  // 检查是否为主智能体
  const 是否主 = 角色名 === '主智能体' ? true : await confirm('设为主智能体?', false);

  const 模型提供商 = await select('选择模型提供商', 提供商选项, 'DeepSeek');

  const 模型名 = await input('模型名', 'deepseek-v4-pro');

  display.info('请输入系统提示词（可多行，输入空行结束）:');
  display.info('（或直接回车跳过，使用默认提示词）');
  const prompt = await input('系统提示词 (可选)');
  const 提示词 = prompt || '';

  const spinner = display.spinner('添加智能体...').start();
  try {
    await client.addTeamAgent({
      角色名,
      模型提供商,
      模型名,
      系统提示词: 提示词,
      是否主智能体: 是否主,
    });
    spinner.stop();
    display.success(`智能体"${角色名}"已添加`);
    await showTeam(client);
  } catch (err) {
    spinner.stop();
    display.error(`添加失败: ${err.message}`);
  }
}

/**
 * 删除智能体
 */
async function removeAgent(client, name) {
  try {
    // 先获取当前配置
    const config = await client.getTeamConfig();
    const agents = config.智能体列表 || [];

    let 角色名 = name;
    if (!角色名) {
      const choices = agents
        .filter(a => !a.是否主智能体)
        .map(a => ({ name: a.角色名, value: a.角色名 }));
      if (choices.length === 0) {
        display.info('没有可删除的智能体（主智能体不可删除）');
        return;
      }
      角色名 = await select('选择要删除的智能体', choices);
    }

    const target = agents.find(a => a.角色名 === 角色名);
    if (target?.是否主智能体) {
      display.error('主智能体不可删除');
      return;
    }

    const ok = await confirm(`确认删除"${角色名}"?`, false);
    if (!ok) {
      display.info('已取消');
      return;
    }

    const spinner = display.spinner(`删除"${角色名}"...`).start();
    await client.removeTeamAgent(角色名);
    spinner.stop();
    display.success(`智能体"${角色名}"已删除`);
    await showTeam(client);
  } catch (err) {
    display.error(`删除失败: ${err.message}`);
  }
}

/**
 * 修改智能体配置
 */
async function updateAgent(client, name, options) {
  try {
    const config = await client.getTeamConfig();
    const agents = config.智能体列表 || [];

    let 角色名 = name;
    if (!角色名) {
      const choices = agents.map(a => ({
        name: `${a.是否主智能体 ? '★ ' : '  '}${a.角色名}`,
        value: a.角色名,
      }));
      角色名 = await select('选择要修改的智能体', choices);
    }

    const target = agents.find(a => a.角色名 === 角色名);
    if (!target) {
      display.error(`未找到智能体"${角色名}"`);
      return;
    }

    display.info(`当前配置: ${target.角色名} → ${target.模型提供商}/${target.模型名}`);

    const updates = {};

    const newProvider = options.provider || await input('模型提供商 (回车跳过)', '');
    if (newProvider) updates.模型提供商 = newProvider;

    const newModel = options.model || await input('模型名 (回车跳过)', '');
    if (newModel) updates.模型名 = newModel;

    const changePrompt = await confirm('修改系统提示词?', false);
    if (changePrompt) {
      display.info('请输入新的系统提示词（可多行，输入空行结束）:');
      const newPrompt = await input('系统提示词');
      if (newPrompt !== null) updates.系统提示词 = newPrompt;
    }

    if (Object.keys(updates).length === 0) {
      display.info('没有需要修改的字段');
      return;
    }

    const spinner = display.spinner(`修改"${角色名}"...`).start();
    const result = await client.updateTeamAgent(角色名, updates);
    spinner.stop();
    display.success(`智能体"${角色名}"已更新`);
    console.log(`  ${chalk.cyan(result.模型提供商 + '/' + result.模型名)}`);
  } catch (err) {
    display.error(`修改失败: ${err.message}`);
  }
}

/**
 * 恢复为系统默认配置
 */
async function resetTeam(client) {
  const ok = await confirm('确认恢复为系统默认配置? 当前自定义配置将被覆盖', false);
  if (!ok) {
    display.info('已取消');
    return;
  }

  const spinner = display.spinner('获取默认配置...').start();
  try {
    const defaultConfig = await client.getDefaultTeamConfig();
    spinner.stop();

    const saveSpinner = display.spinner('保存配置...').start();
    await client.saveTeamConfig({
      智能体列表: defaultConfig.智能体列表,
      主智能体角色名: defaultConfig.主智能体角色名,
    });
    saveSpinner.stop();

    display.success('团队配置已恢复为系统默认');
    await showTeam(client);
  } catch (err) {
    display.error(`恢复失败: ${err.message}`);
  }
}

export default teamCommand;
