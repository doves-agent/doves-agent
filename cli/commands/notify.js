import { Command } from 'commander';
import chalk from 'chalk';
import { display } from '../display.js';
import { DoveClient } from '../client.js';
import { loadConfig } from '../lib/config.js';

const NOTIFY_ACTION_CHOICES = [
  { name: 'list    - 查看未读通知', value: 'list' },
  { name: 'read    - 标记已读', value: 'read' },
  { name: 'config  - 通知配置', value: 'config' },
  { name: 'history - 历史通知', value: 'history' },
];

export const notifyCommand = new Command('notify')
  .alias('ntf')
  .description('通知管理')
  .argument('[action]', '操作: list/read/config/history')
  .argument('[id]', '通知ID（read 时可选）')
  .option('--json', 'JSON 格式输出')
  .option('-n, --limit <n>', '数量限制', '20')
  .action(async (action, id, options) => {
    const config = loadConfig();
    if (!config.token) {
      display.error('未登录，请先执行 dove login');
      return;
    }

    if (!action) {
      action = 'list';
    }

    const client = new DoveClient();

    switch (action) {
      case 'list':
        await handleList(client, options);
        break;
      case 'read':
        await handleRead(client, id, options);
        break;
      case 'config':
        await handleConfig(client, options);
        break;
      case 'history':
        await handleHistory(client, options);
        break;
      default:
        display.error(`未知操作: ${action}`);
        console.log('可用操作: list, read, config, history');
    }
  });

async function handleList(client, options) {
  try {
    const res = await client.request('GET', `/api/notify/list?limit=${options.limit}`);
    if (!res?.success) {
      display.error(res?.error || '获取通知列表失败');
      return;
    }

    const { 总数, 列表 } = res.data;
    if (列表.length === 0) {
      display.success('暂无未读通知');
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(res.data, null, 2));
      return;
    }

    display.info(`未读通知 (${总数} 条):`);
    console.log('');
    for (const n of 列表) {
      const 状态标记 = n.投递状态 === 'failed' ? chalk.red('[投递失败]') : '';
      const 来源标签 = { event: '事件', task: '任务', system: '系统' }[n.来源类型] || n.来源类型;
      console.log(`  ${chalk.dim(n.通知ID.slice(-6))} ${chalk.cyan(`[${来源标签}]`)} ${n.标题} ${状态标记}`);
      console.log(`       ${chalk.dim(n.摘要)}`);
      console.log(`       ${chalk.dim(n.创建时间)}`);
      console.log('');
    }
    display.info(`dove notify read 标记全部已读 | dove notify read <id> 标记单条`);
  } catch (e) {
    display.error(`获取通知失败: ${e.message}`);
  }
}

async function handleRead(client, id, options) {
  try {
    const body = id ? { ids: [id] } : {};
    const res = await client.request('POST', '/api/notify/read', body);
    if (!res?.success) {
      display.error(res?.error || '标记已读失败');
      return;
    }
    display.success(`已标记 ${res.data.已标记} 条通知为已读`);
  } catch (e) {
    display.error(`操作失败: ${e.message}`);
  }
}

async function handleConfig(client, options) {
  try {
    const res = await client.request('GET', '/api/notify/config');
    if (!res?.success) {
      display.error(res?.error || '获取配置失败');
      return;
    }

    const cfg = res.data;
    display.info('当前通知配置:');
    console.log(`  默认渠道: ${cfg.默认渠道 || chalk.dim('无（仅 CLI 拉取）')}`);
    console.log(`  事件通知: ${cfg.事件通知 !== false ? chalk.green('开启') : chalk.dim('关闭')}`);
    if (cfg.静默时段) {
      console.log(`  静默时段: ${cfg.静默时段.开始} - ${cfg.静默时段.结束}`);
    }
    if (cfg.渠道列表?.length > 0) {
      console.log('  渠道列表:');
      for (const ch of cfg.渠道列表) {
        const 状态 = ch.启用 ? chalk.green('启用') : chalk.dim('停用');
        console.log(`    ${ch.渠道} → ${ch.用户标识} [${状态}]`);
      }
    }
    console.log('');
    display.info('更新配置请使用: dove notify config set <字段> <值>');
    display.info('或通过 API: POST /api/notify/config');
  } catch (e) {
    display.error(`获取配置失败: ${e.message}`);
  }
}

async function handleHistory(client, options) {
  try {
    const res = await client.request('GET', `/api/notify/list?status=read&limit=${options.limit}`);
    if (!res?.success) {
      display.error(res?.error || '获取历史通知失败');
      return;
    }

    const { 总数, 列表 } = res.data;
    if (列表.length === 0) {
      display.info('暂无历史通知');
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(res.data, null, 2));
      return;
    }

    display.info(`历史通知 (共 ${总数} 条):`);
    console.log('');
    for (const n of 列表) {
      const 来源标签 = { event: '事件', task: '任务', system: '系统' }[n.来源类型] || n.来源类型;
      console.log(`  ${chalk.dim(n.通知ID.slice(-6))} ${chalk.cyan(`[${来源标签}]`)} ${n.标题}`);
      console.log(`       ${chalk.dim(n.创建时间)}  读取于: ${chalk.dim(n.读取时间 || '-')}`);
      console.log('');
    }
  } catch (e) {
    display.error(`获取历史通知失败: ${e.message}`);
  }
}
