/**
 * 白鸽渠道权限管理
 * 职责：渠道权限的设置、重置、查询
 */

import { display } from '../../display.js';
import { loadConfig } from '../../lib/config.js';
import { select, multiSelect, CHANNEL_CHOICES, TOOL_LEVEL_CHOICES, PERMISSION_ROLE_CHOICES, TOOL_MODULE_CHOICES } from '../../lib/interactive.js';
import chalk from 'chalk';

/**
 * 渠道权限管理
 */
async function handleChannelPermission(client, args, options) {
  const doveId = args[0];
  if (!doveId) {
    display.error('请指定白鸽ID: dove cp <doveId>');
    return;
  }

  // 重置模式
  if (options.reset) {
    let role = options.owner ? 'owner' : (options.granted ? 'granted' : undefined);
    if (!role) {
      role = await select('选择重置的角色', PERMISSION_ROLE_CHOICES, 'owner');
    }
    const spinner = display.spinner('重置渠道权限...').start();
    try {
      const result = await client.resetChannelPermission(doveId, role);
      spinner.stop();
      if (result.success) {
        display.success(`渠道权限已重置 (${role || '全部'})`);
      } else {
        display.error(`重置失败: ${result.error}`);
      }
    } catch (err) {
      spinner.stop();
      display.error(err.message);
    }
    return;
  }

  // 设置模式 - 如果没有指定channel，交互式选择
  let channel = options.channel;
  let level = options.level;
  let role = options.owner ? 'owner' : (options.granted ? 'granted' : null);
  
  // 交互式设置
  if (!channel) {
    channel = await select('选择渠道', CHANNEL_CHOICES);
  }
  if (!level) {
    level = await select('选择安全级别', TOOL_LEVEL_CHOICES);
  }
  if (!role) {
    role = await select('选择角色', PERMISSION_ROLE_CHOICES, 'owner');
  }
  
  const config = {};
  config.工具安全级别上限 = level;
  // 禁用工具：交互式多选
  if (options.block) {
    config.禁用工具 = options.block.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    const blocked = await multiSelect('禁用工具（空格勾选，回车确认，空列表=不禁用）', TOOL_MODULE_CHOICES);
    config.禁用工具 = blocked;
  }
  if (options.hint !== undefined) config.自定义提示 = options.hint || null;

  const spinner = display.spinner('更新渠道权限...').start();
  try {
    const result = await client.updateChannelPermission(doveId, role, channel, config);
    spinner.stop();
    if (result.success) {
      display.success(`渠道权限已更新: ${role}/${channel}`);
    } else {
      display.error(`更新失败: ${result.error}`);
    }
  } catch (err) {
    spinner.stop();
    display.error(err.message);
  }
  return;

  // 查询模式（默认）
  const spinner2 = display.spinner('获取渠道权限...').start();
  try {
    const data = await client.getChannelPermission(doveId);
    spinner2.stop();

    console.log();
    display.title(`渠道权限 - ${doveId}`);
    console.log(`  身份: ${data.isOwner ? chalk.green('鸽主') : chalk.yellow('非鸽主')}`);
    console.log();

    const renderRole = (roleName, roleData) => {
      display.title(`  ${roleName}`);
      const channels = ['local', 'remote', 'wechat', 'dingtalk', 'feishu', '_default'];
      const channelNames = { local: '本地同机', remote: '远程异机', wechat: '微信', dingtalk: '钉钉', feishu: '飞书', _default: '默认' };
      for (const ch of channels) {
        const cfg = roleData?.[ch];
        if (cfg) {
          const levelColor = cfg.工具安全级别上限 === '危险' ? chalk.red : (cfg.工具安全级别上限 === '安全' ? chalk.green : chalk.yellow);
          const blockStr = cfg.禁用工具?.length > 0 ? chalk.gray(` [禁用: ${cfg.禁用工具.join(', ')}]`) : '';
          const hintStr = cfg.自定义提示 ? chalk.gray(` 提示:"${cfg.自定义提示}"`) : '';
          console.log(`    ${chalk.cyan(channelNames[ch] || ch)}: ${levelColor(cfg.工具安全级别上限)}${blockStr}${hintStr}`);
        }
      }
      console.log();
    };

    if (data.渠道权限?.鸽主) renderRole('鸽主权限', data.渠道权限.鸽主);
    if (data.渠道权限?.授权) renderRole('授权权限', data.渠道权限.授权);
  } catch (err) {
    spinner2.stop();
    display.error(err.message);
  }
}

export { handleChannelPermission };
