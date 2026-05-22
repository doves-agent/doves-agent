/**
 * 事件管理命令
 * 类似 Windows 计划任务，支持定时触发、语义触发和意图驱动事件
 * 
 * 功能：
 * - schedule: 注册定时事件 (cron)
 * - semantic: 注册语义事件 (自然语言条件)
 * - list: 查看事件列表（支持 --type intent 筛选意图驱动事件）
 * - show: 查看事件详情（含处理动作列表+触发记录）
 * - trigger: 手动触发事件
 * - check: 检查消息是否触发语义事件
 * - delete: 删除事件（含Git记忆同步提示）
 * - add-handler: 为意图驱动事件添加处理动作
 * - remove-handler: 删除指定处理动作
 * - disable: 禁用事件
 * - enable: 启用事件
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { display } from '../display.js';
import { DoveClient, AdminClient } from '../client.js';
import { loadConfig } from '../lib/config.js';
import { select, EVENT_TYPE_CHOICES, EXECUTION_MODE_CHOICES, TOOL_LEVEL_CHOICES } from '../lib/interactive.js';
import { handleSchedule, handleSemantic } from './event-注册.js';

const EVENT_ACTION_CHOICES = [
  { name: 'schedule      - 注册定时事件', value: 'schedule' },
  { name: 'semantic      - 注册语义事件', value: 'semantic' },
  { name: 'list          - 查看事件列表', value: 'list' },
  { name: 'show          - 查看事件详情', value: 'show' },
  { name: 'trigger       - 手动触发', value: 'trigger' },
  { name: 'check         - 检查消息触发', value: 'check' },
  { name: 'delete        - 删除事件', value: 'delete' },
  { name: 'add-handler   - 添加处理动作', value: 'add-handler' },
  { name: 'remove-handler - 删除处理动作', value: 'remove-handler' },
  { name: 'disable       - 禁用事件', value: 'disable' },
  { name: 'enable        - 启用事件', value: 'enable' },
  { name: 'quota         - 查询事件限额', value: 'quota' },
];

export const eventCommand = new Command('event')
  .alias('evt')
  .description('事件管理 - 定时/语义/意图驱动事件')
  .argument('[action]', '操作')
  .argument('[name]', '事件名称、ID或消息')
  .option('--cron <expression>', '定时表达式 (如 "*/5 * * * *")')
  .option('--condition <text>', '语义触发条件 (如 "当用户提到想写代码时")')
  .option('--task <json>', '任务模板 JSON (如 \'{"用户消息":"启动编程助手"}\')')
  .option('--threshold <n>', '语义触发相似度阈值', parseFloat, 0.7)
  .option('--cooldown <seconds>', '冷却时间(秒)', parseInt, 300)
  .option('--no-llm-confirm', '跳过LLM二次确认')
  .option('-t, --type <type>', '按类型筛选 (scheduled/data_change/semantic/external/intent_driven)')
  .option('--action-text <text>', '处理动作描述 (add-handler用)')
  .option('--handler-id <id>', '处理动作ID (remove-handler用)')
  .option('--json', 'JSON 格式输出')
  .option('-a, --all', '查看所有用户的事件（仅超级管理员可用）')
  .option('--uid <userId>', '查看指定用户的事件（仅超级管理员可用）')
  .action(async (action, name, options) => {
    const config = loadConfig();
    const client = config.role === 'admin' ? new AdminClient() : new DoveClient();
    
    try {
      await client.ensureAuth();
    } catch (e) {
      display.error('请先登录: dove login');
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
    
    try {
      // 无 action 时交互式选择
      if (!action) {
        action = await select('选择操作', EVENT_ACTION_CHOICES, 'list');
      }
      switch (action) {
        case 'schedule':
          await handleSchedule(client, name, options);
          break;
        case 'semantic':
          await handleSemantic(client, name, options);
          break;
        case 'list':
        case 'ls':
          await handleList(client, options);
          break;
        case 'show':
          await handleShow(client, name, options);
          break;
        case 'trigger':
          await handleTrigger(client, name, options);
          break;
        case 'check':
          await handleCheck(client, name, options);
          break;
        case 'delete':
        case 'del':
          await handleDelete(client, name);
          break;
        case 'add-handler':
          await handleAddHandler(client, name, options);
          break;
        case 'remove-handler':
          await handleRemoveHandler(client, name, options);
          break;
        case 'disable':
          await handleDisable(client, name);
          break;
        case 'enable':
          await handleEnable(client, name);
          break;
        case 'quota':
          await handleQuota(client, options);
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

/**
 * 查看事件列表
 */
async function handleList(client, options) {
  // 交互式选择事件类型筛选
  let typeFilter = options.type;
  if (!typeFilter) {
    const ALL_TYPES = [{ name: '全部类型', value: '__all__' }, ...EVENT_TYPE_CHOICES];
    typeFilter = await select('按类型筛选', ALL_TYPES, '__all__');
  }
  const params = new URLSearchParams();
  if (typeFilter && typeFilter !== '__all__') params.append('type', typeFilter);
  
  const data = await client.get(`/api/event/list?${params}`) || {};
  const events = data.事件列表 || data || [];
  const stats = data.统计 || {};
  
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  
  if (events.length === 0) {
    display.info('暂无事件');
    return;
  }
  
  // 显示统计
  if (Object.keys(stats).length > 0) {
    console.log(chalk.cyan('\n事件统计:'));
    const typeLabels = { scheduled: '定时', data_change: '数据变更', semantic: '语义', external: '外部触发', intent_driven: '意图驱动' };
    for (const [type, count] of Object.entries(stats)) {
      console.log(`  ${typeLabels[type] || type}: ${chalk.green(count)}`);
    }
    console.log();
  }
  
  console.log(chalk.cyan(`事件列表 (共${events.length}条):\n`));
  
  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    const typeColors = {
      scheduled: chalk.blue,
      data_change: chalk.magenta,
      semantic: chalk.green,
      external: chalk.yellow,
      intent_driven: chalk.cyan
    };
    const typeLabels = {
      scheduled: '定时',
      data_change: '变更',
      semantic: '语义',
      external: '外部',
      intent_driven: '意图'
    };
    const colorFn = typeColors[evt.事件类型] || chalk.white;
    const label = typeLabels[evt.事件类型] || evt.事件类型;
    
    console.log(`${chalk.green(`${i + 1}.`)} ${colorFn(`[${label}]`)} ${evt.事件名称 || '-'}`);
    console.log(chalk.dim(`   ID: ${evt.事件ID} | 状态: ${evt.状态}`));
    
    if (evt.事件类型 === 'scheduled') {
      console.log(chalk.dim(`   Cron: ${evt.cron表达式 || '-'} | 下次: ${evt.下次触发时间 || '-'}`));
    } else if (evt.事件类型 === 'semantic') {
      console.log(chalk.dim(`   条件: ${evt.触发条件 || '-'} | 阈值: ${evt.触发阈值 || '-'} | 触发${evt.触发次数 || 0}次`));
      if (evt.最近触发时间) {
        console.log(chalk.dim(`   最近触发: ${evt.最近触发时间}`));
      }
    } else if (evt.事件类型 === 'data_change') {
      console.log(chalk.dim(`   监听: ${evt.触发源?.监听集合 || '-'}`));
    } else if (evt.事件类型 === 'intent_driven') {
      const handlers = evt.事件处理列表 || [];
      console.log(chalk.dim(`   条件: ${evt.触发条件 || '-'} | 处理: ${handlers.length}个 | 触发${evt.触发次数 || 0}次`));
    }
    console.log();
  }
}

/**
 * 手动触发事件
 */
async function handleTrigger(client, name, options) {
  let task;
  try {
    task = options.task ? JSON.parse(options.task) : { 用户消息: name || '手动触发' };
  } catch (e) {
    display.error('--task 参数 JSON 格式错误');
    return;
  }
  
  const data = await client.post('/api/event/trigger', { task });

  display.success(`事件已触发，任务已创建: ${data?.任务ID || 'OK'}`);
}

/**
 * 检查消息是否触发语义事件
 */
async function handleCheck(client, message, options) {
  if (!message) {
    display.error('请提供要检查的消息: dove event check "我想写一个爬虫"');
    return;
  }
  
  display.info(`检查消息是否触发语义事件: "${message}"`);
  
  const data = await client.post('/api/event/check', { message }) || {};
  
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  
  if (data.匹配事件数 === 0) {
    display.info('未匹配到任何语义事件');
    return;
  }
  
  console.log(chalk.cyan(`\n匹配到 ${data.匹配事件数} 个语义事件:\n`));
  
  for (const m of (data.匹配事件 || [])) {
    console.log(`${chalk.green('-')} ${chalk.yellow(m.事件名称)} (相似度: ${m.相似度?.toFixed(3) || '-'})`);
    console.log(chalk.dim(`  条件: ${m.触发条件}`));
    console.log(chalk.dim(`  LLM判断: ${m.LLM判断} | 置信度: ${m.置信度 || '-'}`));
  }
  
  if (data.触发结果?.length > 0) {
    console.log(chalk.green('\n已触发:'));
    for (const t of data.触发结果) {
      console.log(`  ${t.事件名称} → 任务 ${t.任务ID}`);
    }
  }
}

/**
 * 删除事件
 */
async function handleDelete(client, id) {
  if (!id) {
    display.error('请提供事件ID: dove event delete evt_xxx');
    return;
  }
  
  const data = await client._apiRequest('DELETE', `/api/event/${id}`);

  display.success(`事件已删除: ${id} (删除${data?.deleted || 0}条)`);
}

/**
 * 查看事件详情
 */
async function handleShow(client, id, options) {
  if (!id) {
    display.error('请提供事件ID: dove event show evt_xxx');
    return;
  }
  
  // 直接按ID查询，避免全量拉取再客户端过滤
  const evt = await client.get(`/api/event/${id}`);
  if (!evt) {
    display.error(`未找到事件: ${id}`);
    return;
  }
  
  if (options.json) {
    console.log(JSON.stringify(evt, null, 2));
    return;
  }
  
  const typeLabels = { scheduled: '定时', data_change: '数据变更', semantic: '语义', external: '外部触发', intent_driven: '意图驱动' };
  
  console.log(chalk.cyan(`\n事件详情:\n`));
  console.log(`  ${chalk.bold('名称')}: ${evt.事件名称}`);
  console.log(`  ${chalk.bold('ID')}: ${evt.事件ID}`);
  console.log(`  ${chalk.bold('类型')}: ${typeLabels[evt.事件类型] || evt.事件类型}`);
  console.log(`  ${chalk.bold('状态')}: ${evt.状态}`);
  console.log(`  ${chalk.bold('触发条件')}: ${evt.触发条件 || '-'}`);
  console.log(`  ${chalk.bold('触发阈值')}: ${evt.触发阈值 || '-'}`);
  console.log(`  ${chalk.bold('冷却时间')}: ${evt.冷却时间 ? `${evt.冷却时间 / 1000}秒` : '-'}`);
  console.log(`  ${chalk.bold('触发次数')}: ${evt.触发次数 || 0}${evt.最大触发次数 ? ` / ${evt.最大触发次数}` : ' (无限)'}`);
  if (evt.剩余触发次数 !== null && evt.剩余触发次数 !== undefined) {
    console.log(`  ${chalk.bold('剩余次数')}: ${evt.剩余触发次数}`);
  }
  if (evt.记忆ID) {
    console.log(`  ${chalk.bold('记忆ID')}: ${evt.记忆ID}`);
  }
  console.log(`  ${chalk.bold('创建时间')}: ${evt.创建时间}`);
  
  // 事件处理列表
  const handlers = evt.事件处理列表 || [];
  if (handlers.length > 0) {
    console.log(chalk.cyan(`\n  处理动作 (${handlers.length}个):\n`));
    for (const h of handlers) {
      const statusIcon = h.启用 ? chalk.green('●') : chalk.red('○');
      console.log(`    ${statusIcon} ${chalk.bold(h.处理ID)}: ${h.处理描述 || h.动作描述 || '-'}`);
      console.log(chalk.dim(`      创建: ${h.创建时间 || '-'}`));
    }
  }
  
  // 触发记录
  const records = evt.触发记录 || [];
  if (records.length > 0) {
    console.log(chalk.cyan(`\n  触发记录 (最近${Math.min(records.length, 5)}条):\n`));
    const recent = records.slice(-5).reverse();
    for (const r of recent) {
      console.log(`    ${chalk.dim(r.触发时间)} ${r.触发摘要?.slice(0, 50) || '-'}`);
    }
  }
  
  console.log();
}

/**
 * 添加处理动作
 */
async function handleAddHandler(client, id, options) {
  if (!id) {
    display.error('请提供事件ID: dove event add-handler evt_xxx --action-text "通知我"');
    return;
  }
  if (!options.actionText) {
    display.error('请提供 --action-text 处理动作描述');
    return;
  }
  
  const data = await client.post(`/api/event/${id}/handler`, { action: options.actionText });

  display.success(`已添加处理动作: ${options.actionText}`);
  console.log(chalk.dim(`  处理ID: ${data?.处理ID}`));
}

/**
 * 删除处理动作
 */
async function handleRemoveHandler(client, id, options) {
  if (!id) {
    display.error('请提供事件ID: dove event remove-handler evt_xxx --handler-id hdl_xxx');
    return;
  }
  if (!options.handlerId) {
    display.error('请提供 --handler-id 处理动作ID');
    return;
  }
  
  await client._apiRequest('DELETE', `/api/event/${id}/handler/${options.handlerId}`);

  display.success(`已删除处理动作: ${options.handlerId}`);
}

/**
 * 禁用事件
 */
async function handleDisable(client, id) {
  if (!id) {
    display.error('请提供事件ID: dove event disable evt_xxx');
    return;
  }
  
  await client.post(`/api/event/${id}/disable`);

  display.success(`事件已禁用: ${id}`);
}

/**
 * 启用事件
 */
async function handleEnable(client, id) {
  if (!id) {
    display.error('请提供事件ID: dove event enable evt_xxx');
    return;
  }
  
  await client.post(`/api/event/${id}/enable`);

  display.success(`事件已启用: ${id}`);
}

/**
 * 查询事件限额
 */
async function handleQuota(client, options) {
  const data = await client.get('/api/event/quota') || {};
  
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  
  const 当前数量 = data.当前数量 ?? 0;
  const 上限 = data.上限 ?? 10;
  const 会员 = data.会员 ?? false;
  
  console.log(chalk.cyan('\n事件限额使用情况:\n'));
  console.log(`  ${chalk.bold('当前事件数')}: ${当前数量}`);
  console.log(`  ${chalk.bold('事件上限')}: ${上限}`);
  console.log(`  ${chalk.bold('剩余可创建')}: ${Math.max(0, 上限 - 当前数量)}`);
  console.log(`  ${chalk.bold('会员状态')}: ${会员 ? '会员' : '非会员'}`);
  console.log();
}

/**
 * 显示帮助
 */
function showHelp() {
  console.log(`
事件管理命令 (定时/语义/意图驱动事件):

  dove event schedule <名称> --cron "*/5 * * * *" --task '{"用户消息":"xxx"}'
      注册定时事件

  dove event semantic <名称> --condition "当用户提到xxx" --task '{"用户消息":"xxx"}'
      注册语义事件（自然语言条件触发）
      --threshold 0.7        相似度阈值
      --cooldown 300         冷却时间(秒)
      --no-llm-confirm       跳过LLM二次确认

  dove event list           查看事件列表
  dove event show <事件ID>   查看事件详情（含处理动作+触发记录）
  dove event trigger <消息> 手动触发
  dove event check <消息>   检查消息是否触发语义事件
  dove event delete <ID>    删除事件（含向量记忆同步）

  dove event add-handler <事件ID> --action-text "通知我"
      为意图驱动事件添加处理动作

  dove event remove-handler <事件ID> --handler-id <处理ID>
      删除指定处理动作

  dove event disable <事件ID>  禁用事件
  dove event enable <事件ID>   启用事件

  dove event quota            查询事件限额使用情况

快捷方式:
  dove evt ls               列表
  dove evt check "写代码"   检查

选项:
  -t, --type <type>          按类型筛选 (scheduled/semantic/data_change/external/intent_driven)
  --json                     JSON 格式输出
`);
}

