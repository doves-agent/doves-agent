/**
 * 记忆管理命令
 * 用自然语言搜索记忆、统计记忆、管理Git记忆
 *
 * 功能：
 * - search: 用自然语言语义搜索记忆
 * - list: 列出记忆
 * - stats: 统计记忆
 * - add: 添加记忆
 * - delete: 删除记忆
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { display } from '../display.js';
import { DoveClient, AdminClient } from '../client.js';
import { loadConfig } from '../lib/config.js';
import { select, input } from '../lib/interactive.js';

const MEMORY_ACTION_CHOICES = [
  { name: 'search - 语义搜索记忆', value: 'search' },
  { name: 'list   - 列出记忆', value: 'list' },
  { name: 'stats  - 统计记忆', value: 'stats' },
  { name: 'add    - 添加记忆', value: 'add' },
  { name: 'delete - 删除记忆', value: 'delete' },
];

const MEMORY_TYPE_CHOICES = [
  { name: 'event_trigger - 事件触发', value: 'event_trigger' },
  { name: 'conversation - 对话记忆', value: 'conversation' },
  { name: 'knowledge    - 知识', value: 'knowledge' },
  { name: 'instruction  - 指令', value: 'instruction' },
];

export const memoryCommand = new Command('memory')
  .alias('mem')
  .description('记忆管理 - 用自然语言搜索和管理Git记忆')
  .argument('[action]', '操作类型')
  .argument('[query]', '搜索查询或内容')
  .option('-u, --user <userId>', '指定用户ID')
  .option('-t, --type <type>', '按类型筛选')
  .option('-p, --page <n>', '页码', parseInt, 1)
  .option('-l, --limit <n>', '每页数量', parseInt, 20)
  .option('--threshold <n>', '搜索相似度阈值', parseFloat, 0.3)
  .option('--top-k <n>', '搜索返回数量', parseInt, 10)
  .option('--json', 'JSON 格式输出')
  .option('-a, --all', '查看所有用户的记忆（仅超级管理员可用）')
  .option('--uid <userId>', '查看指定用户的记忆（仅超级管理员可用）')
  .action(async (action, query, options) => {
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
        action = await select('选择操作', MEMORY_ACTION_CHOICES, 'list');
      }
      switch (action) {
        case 'search':
        case 's':
          await handleSearch(client, query, options);
          break;
        case 'list':
        case 'ls':
          await handleList(client, options);
          break;
        case 'stats':
        case 'stat':
          await handleStats(client, options);
          break;
        case 'add':
        case 'a':
          await handleAdd(client, query, options);
          break;
        case 'delete':
        case 'del':
        case 'd':
          await handleDelete(client, query, options);
          break;
        default:
          // 如果 action 不是已知命令，当作搜索查询
          if (action && !['search', 'list', 'stats', 'add', 'delete'].includes(action)) {
            await handleSearch(client, action, options);
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
 * 语义搜索记忆
 */
async function handleSearch(client, query, options) {
  if (!query) {
    query = await input('输入搜索内容');
    if (!query) return;
  }
  
  display.info(`搜索记忆: "${query}"`);
  
  const body = {
    query,
    topK: options.topK || 10,
    threshold: options.threshold || 0.3
  };
  if (options.user) body.userId = options.user;
  let type = options.type;
  if (!type) {
    type = await select('选择记忆类型', MEMORY_TYPE_CHOICES);
  }
  if (type) body.filters = { type };
  
  const data = await client.post('/api/memory/search', body);

  const results = data?.results || data || [];
  
  if (results.length === 0) {
    display.info('未找到相关记忆');
    return;
  }
  
  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  
  console.log(chalk.cyan(`\n找到 ${results.length} 条相关记忆:\n`));
  
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const score = r.score ? chalk.dim(`(相似度: ${r.score.toFixed(3)})`) : '';
    const type = r.metadata?.type ? chalk.yellow(`[${r.metadata.type}]`) : '';
    const userId = r.user_id ? chalk.dim(`用户: ${r.user_id}`) : '';
    
    console.log(`${chalk.green(`${i + 1}.`)} ${type} ${r.memory || r.text || r.content || JSON.stringify(r)}`);
    console.log(`   ${score} ${userId}`);
    if (r.id || r.memory_id) {
      console.log(chalk.dim(`   ID: ${r.id || r.memory_id}`));
    }
    console.log();
  }
}

/**
 * 列出记忆
 */
async function handleList(client, options) {
  const params = new URLSearchParams({
    page: options.page,
    page_size: options.limit
  });
  if (options.user) params.append('user_id', options.user);
  if (options.type) params.append('type', options.type);
  
  const data = await client.get(`/api/memory/list?${params}`);

  const items = data?.items || data || [];
  
  if (options.json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }
  
  if (items.length === 0) {
    display.info('暂无记忆数据');
    return;
  }
  
  console.log(chalk.cyan(`\n记忆列表 (第${options.page}页, 共${items.length}条):\n`));
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const type = item.metadata?.type ? chalk.yellow(`[${item.metadata.type}]`) : '';
    console.log(`${chalk.green(`${i + 1}.`)} ${type} ${(item.memory || item.text || '').slice(0, 80)}`);
    console.log(chalk.dim(`   ID: ${item.id || item.memory_id || '-'} | 用户: ${item.user_id || '-'}`));
  }
}

/**
 * 统计记忆
 */
async function handleStats(client, options) {
  const params = new URLSearchParams();
  if (options.user) params.append('user_id', options.user);
  if (options.type) params.append('type', options.type);
  
  const data = await client.get(`/api/memory/stats?${params}`);

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(chalk.cyan('\n记忆统计:\n'));
  console.log(`  总数: ${chalk.green(data.total || 0)}`);

  if (data.byType) {
    console.log('\n  按类型:');
    for (const [type, count] of Object.entries(data.byType)) {
      console.log(`    ${chalk.yellow(type)}: ${count}`);
    }
  }
  
  if (data.byUser) {
    console.log('\n  按用户:');
    for (const [user, count] of Object.entries(data.byUser)) {
      console.log(`    ${user}: ${count}`);
    }
  }
}

/**
 * 添加记忆
 */
async function handleAdd(client, content, options) {
  if (!content) {
    content = await input('输入记忆内容');
    if (!content) return;
  }
  
  // 交互式选择类型
  let type = options.type;
  if (!type) {
    type = await select('选择记忆类型', MEMORY_TYPE_CHOICES);
  }
  
  const body = {
    messages: [
      { role: 'user', content }
    ],
    metadata: {}
  };
  if (options.user) body.userId = options.user;
  if (options.type) body.metadata.type = options.type;

  const data = await client.post('/api/memory/add', body);

  display.success(`记忆添加成功: ${data?.id || data?.memory_id || 'OK'}`);
}

/**
 * 删除记忆
 */
async function handleDelete(client, id, options) {
  if (!id) {
    display.error('请提供记忆ID，如: dove memory delete mem_xxx');
    return;
  }

  await client._apiRequest('DELETE', `/api/memory/${id}`);

  display.success(`记忆已删除: ${id}`);
}

/**
 * 显示帮助
 */
function showHelp() {
  console.log(`
记忆管理命令:

  dove memory search <查询>   用自然语言搜索记忆
  dove memory list            列出记忆
  dove memory stats           统计记忆
  dove memory add <内容>      添加记忆
  dove memory delete <ID>     删除记忆

快捷方式:
  dove mem s "编程问题"       搜索
  dove mem ls                 列表
  dove mem "编程问题"         直接搜索（省略search）

选项:
  -u, --user <userId>          指定用户ID
  -t, --type <type>            按类型筛选 (event_trigger/conversation/knowledge)
  -p, --page <n>               页码 (默认1)
  -l, --limit <n>              每页数量 (默认20)
  --threshold <n>              搜索相似度阈值 (默认0.3)
  --top-k <n>                  搜索返回数量 (默认10)
  --json                       JSON 格式输出
`);
}

