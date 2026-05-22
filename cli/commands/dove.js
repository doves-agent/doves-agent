/**
 * 白鸽管理命令
 * 提供白鸽账号的注册、管理、配置等功能
 */

import { Command } from 'commander';
import { display } from '../display.js';
import { DoveClient, AdminClient } from '../client.js';
import { loadConfig } from '../lib/config.js';
import { MCPClient } from '../lib/mcp.js';
import { select } from '../lib/interactive.js';
import { handleRegister, handleList, handleInfo, handleDelete, handleKey, handleConfig, handleUse, handleCurrent, handleCapability } from './dove/基础处理.js';
import { MCP_SUB_CHOICES, handleMCP } from './dove/MCP处理.js';
import { handleChannelPermission } from './dove/渠道权限.js';
import { capabilityCommand as _origCapabilityCmd } from './capability.js';
import { skillCommand as _origSkillCmd } from './skill.js';

const DOVE_ACTION_CHOICES = [
  { name: 'register     - 注册白鸽', value: 'register' },
  { name: 'list         - 列出我的白鸽', value: 'list' },
  { name: 'info         - 查看白鸽详情', value: 'info' },
  { name: 'delete       - 注销白鸽', value: 'delete' },
  { name: 'key          - 重新生成密钥', value: 'key' },
  { name: 'config       - 查看配置默认值', value: 'config' },
  { name: 'use          - 设置当前鸽子', value: 'use' },
  { name: 'current      - 查看当前鸽子', value: 'current' },
  { name: 'mcp          - MCP配置管理', value: 'mcp' },
  { name: 'capability   - 查看鸽子能力', value: 'capability' },
  { name: 'cp           - 渠道权限管理', value: 'cp' },
];

export const doveCommand = new Command('dove')
  .description('白鸽管理')
  .argument('[action]', '操作类型')
  .argument('[args...]', '操作参数')
  .option('-n, --name <name>', '白鸽名称')
  .option('-t, --type <type>', '类型 (official/community/private)', 'private')
  .option('-c, --capabilities <caps>', '能力列表 (逗号分隔)')
  .option('--id <doveId>', '白鸽ID')
  .option('--force', '强制执行')
  .option('--type <type>', 'MCP类型 (stdio/http/sse)')
  .option('--command <command>', 'stdio命令')
  .option('--args <args>', '命令参数 (逗号分隔)')
  .option('--url <url>', 'HTTP/SSE URL')
  .option('--cwd <cwd>', '工作目录')
  .option('--env <env>', '环境变量 (格式: KEY=VALUE,KEY2=VALUE2)')
  .option('--owner', '鸽主权限')
  .option('--granted', '授权权限')
  .option('--channel <channel>', '渠道 (local/remote/wechat/dingtalk/feishu/_default)')
  .option('--level <level>', '安全级别 (safe/caution/dangerous)')
  .option('--block <tools>', '禁用工具 (逗号分隔)')
  .option('--hint <text>', '自定义提示')
  .option('--reset', '重置为默认')
  .option('-a, --all', '查看所有用户的白鸽（仅超级管理员可用）')
  .option('--uid <userId>', '查看指定用户的白鸽（仅超级管理员可用）')
  .action(async (action, args, options) => {
    const config = loadConfig();
    const client = config.role === 'admin' ? new AdminClient() : new DoveClient();
    const authed = await client.ensureAuth();
    if (!authed) {
      display.error('登录已过期，请重新执行 dove login');
      process.exit(1);
    }
    
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
    const mcpClient = new MCPClient();
    
    try {
      // 无 action 时进入交互式选择
      if (!action) {
        action = await select('选择操作', DOVE_ACTION_CHOICES);
      }
      
      switch (action) {
        case 'help':
        case '--help':
        case '-h':
          showHelp();
          break;
        case 'register':
          await handleRegister(client, options, args);
          break;
        case 'list':
        case 'ls':
          await handleList(client);
          break;
        case 'info':
          await handleInfo(client, args[0] || options.id);
          break;
        case 'delete':
        case 'rm':
          await handleDelete(client, args[0] || options.id, options.force);
          break;
        case 'key':
          await handleKey(client, args[0] || options.id);
          break;
        case 'config':
          await handleConfig(client);
          break;
        case 'use':
          await handleUse(mcpClient, args[0]);
          break;
        case 'current':
          await handleCurrent(mcpClient);
          break;
        case 'mcp':
          await handleMCP(mcpClient, args, options);
          break;
        case 'capability':
        case 'cap':
          await handleCapability(mcpClient, args[0]);
          break;
        case 'channel-permission':
        case 'cp':
          await handleChannelPermission(client, args, options);
          break;
        default:
          display.error(`未知操作: ${action}`);
          showHelp();
      }
    } catch (err) {
      display.error(err.message);
      process.exit(1);
    }
  });

// ==================== 子命令: dove capability ====================

const capabilitySub = new Command('capability')
  .alias('cap')
  .description('能力管理 (refresh/list/info/report)')
  .argument('[action]', '操作类型', 'list')
  .argument('[args...]', '操作参数')
  .option('-d, --dove <doveId>', '指定白鸽ID')
  .option('-a, --all', '显示所有能力')
  .option('--json', 'JSON 格式输出')
  .action(async (action, args, options) => {
    const delegateArgs = ['capability'];
    if (action) delegateArgs.push(action);
    if (args) delegateArgs.push(...args);
    if (options.dove) { delegateArgs.push('-d', options.dove); }
    if (options.all) delegateArgs.push('-a');
    if (options.json) delegateArgs.push('--json');
    try {
      await _origCapabilityCmd.parseAsync(delegateArgs, { from: 'user' });
    } catch (e) {
      if (e.code !== 'commander.help' && e.code !== 'commander.version') {
        display.error(e.message);
      }
    }
  });

doveCommand.addCommand(capabilitySub);

// ==================== 子命令: dove skill ====================

const skillSub = new Command('skill')
  .alias('skills')
  .description('技能管理 (list/enable/disable/status)')
  .argument('[action]', '操作类型', 'list')
  .argument('[target]', '目标')
  .option('-c, --category <category>', '按类别操作')
  .option('-a, --all', '操作所有技能')
  .option('--json', 'JSON 格式输出')
  .option('--remote', '同步到远程服务端')
  .action(async (action, target, options) => {
    const delegateArgs = ['skill'];
    if (action) delegateArgs.push(action);
    if (target) delegateArgs.push(target);
    if (options.category) { delegateArgs.push('-c', options.category); }
    if (options.all) delegateArgs.push('-a');
    if (options.json) delegateArgs.push('--json');
    if (options.remote) delegateArgs.push('--remote');
    try {
      await _origSkillCmd.parseAsync(delegateArgs, { from: 'user' });
    } catch (e) {
      if (e.code !== 'commander.help' && e.code !== 'commander.version') {
        display.error(e.message);
      }
    }
  });

doveCommand.addCommand(skillSub);

function showHelp() {
  console.log('');
  display.title('白鸽管理命令');
  console.log('  register       注册新的白鸽账号');
  console.log('  list, ls       列出我的白鸽');
  console.log('  info           查看白鸽详情 <doveId>');
  console.log('  delete, rm     注销白鸽账号 <doveId> --force');
  console.log('  key            重新生成 API 密钥 <doveId>');
  console.log('  config         查看配置默认值');
  console.log('  use            设置当前鸽子 <doveId>');
  console.log('  current        查看当前鸽子');
  console.log('  mcp            MCP配置管理 (输入 dove dove mcp 查看子命令)');
  console.log('  capability     查看鸽子能力 <doveId>');
  console.log('');
  display.title('子命令');
  console.log('  capability, cap   能力管理 (refresh/list/info/report)');
  console.log('  skill, skills     技能管理 (list/enable/disable/status)');
  console.log('  channel-permission, cp  渠道权限管理');
  console.log('');
  display.title('选项');
  console.log('  -n, --name <name>        白鸽名称');
  console.log('  -t, --type <type>        类型 (official/community/private)');
  console.log('  -c, --capabilities <caps> 能力列表 (逗号分隔)');
  console.log('  --id <doveId>            白鸽ID');
  console.log('  --force                  强制执行危险操作');
  console.log('');
  display.title('示例');
  console.log('  dove dove register -n "我的助手" -t private');
  console.log('  dove dove list');
  console.log('  dove dove use dove_xxx');
  console.log('  dove dove current');
  console.log('  dove dove mcp add my_mcp --type stdio --command "node" --args "server.js"');
  console.log('  dove dove capability list');
  console.log('  dove dove skill list');
  console.log('  dove dove cp dove_xxx                                # 查看渠道权限');
  console.log('  dove dove cp dove_xxx --owner --channel local --level dangerous  # 设置鸽主本地权限');
  console.log('  dove dove cp dove_xxx --granted --channel wechat --level safe --block system_exec  # 设置授权微信权限');
  console.log('  dove dove cp dove_xxx --reset                        # 重置全部渠道权限');
  console.log('');
}
