/**
 * dove stats - Token 用量与成本看板
 *
 * 用法:
 *   dove stats             — 今日用量总览
 *   dove stats --by-model  — 按模型分组
 *   dove stats --by-provider — 按提供商分组
 *   dove stats --today     — 今日用量
 *   dove stats --week      — 近7天用量
 *   dove stats --month     — 近30天用量
 *   dove stats --from 2025-01-01 --to 2025-01-31
 */

import { Command } from 'commander';
import { display } from '../display.js';
import { DoveClient } from '../client.js';

/**
 * 调用 Server /stats/usage 接口
 */
async function fetchUsage(params = {}) {
  const client = new DoveClient();
  await client.ensureAuth?.();

  const qs = new URLSearchParams();
  if (params.by) qs.set('by', params.by);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.all) qs.set('all', '1');

  const path = `/stats/usage${qs.toString() ? '?' + qs.toString() : ''}`;

  return await client.get(path);
}

/**
 * 格式化 token 数（K / M）
 */
function fmtToken(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

/**
 * 估算费用（人民币元）
 * 基于 2025 年主流价格，粗略估算
 */
function estimateCost(inputTokens, outputTokens, provider) {
  // 每百万 token 价格（元），粗略均值
  const PRICES = {
    '百炼': { input: 2, output: 6 },
    'DeepSeek': { input: 1, output: 2 },
    'GLM': { input: 5, output: 10 },
  };
  const p = PRICES[provider] || PRICES['百炼'];
  const cost = (inputTokens / 1000000) * p.input + (outputTokens / 1000000) * p.output;
  return cost;
}

// ==================== 命令注册 ====================

export const statsCommand = new Command('stats')
  .description('Token 用量与成本看板')
  .option('--by-model', '按模型分组统计')
  .option('--by-provider', '按提供商分组统计')
  .option('--by-day', '按天分组统计')
  .option('--today', '今日用量（默认）')
  .option('--week', '近7天用量')
  .option('--month', '近30天用量')
  .option('--from <date>', '起始日期 (YYYY-MM-DD)')
  .option('--to <date>', '截止日期 (YYYY-MM-DD)')
  .option('--all', '超管：查看全局用量')
  .action(async (options) => {
    try {
      // 确定分组维度
      let by = null;
      if (options.byModel) by = 'model';
      else if (options.byProvider) by = 'provider';
      else if (options.byDay) by = 'day';

      // 确定时间范围
      let from, to;
      const now = new Date();

      if (options.from) {
        from = options.from;
      } else if (options.week) {
        const d = new Date(now);
        d.setDate(d.getDate() - 7);
        from = d.toISOString().substring(0, 10);
      } else if (options.month) {
        const d = new Date(now);
        d.setDate(d.getDate() - 30);
        from = d.toISOString().substring(0, 10);
      } else {
        // 默认今日
        from = now.toISOString().substring(0, 10);
      }

      if (options.to) {
        to = options.to;
      }

      // 查询
      const result = await fetchUsage({
        by,
        from,
        to,
        all: options.all || false,
      });

      if (!result.success) {
        display.error(result.error || '查询失败');
        return;
      }

      // 展示
      console.log('');
      display.title('Token 用量统计');
      console.log(`  时间范围: ${from}${to ? ' ~ ' + to : ' ~ 今天'}`);
      console.log('');

      if (!by) {
        // 明细模式
        const records = result.data || [];
        if (records.length === 0) {
          console.log('  (暂无用量数据)');
          console.log('');
          display.info('使用 dove chat 发起对话后，用量会自动记录');
          return;
        }

        let totalInput = 0, totalOutput = 0;
        for (const r of records) {
          totalInput += r.inputTokens || 0;
          totalOutput += r.outputTokens || 0;
        }

        console.log(`  输入 Token:  ${fmtToken(totalInput)}`);
        console.log(`  输出 Token:  ${fmtToken(totalOutput)}`);
        console.log(`  估算费用:    ¥${estimateCost(totalInput, totalOutput, '百炼').toFixed(2)}`);
        console.log(`  记录条数:    ${records.length}`);
        console.log('');
        display.info('使用 --by-model / --by-provider / --by-day 查看分组统计');

      } else {
        // 分组聚合模式
        const groups = result.data || [];
        if (groups.length === 0) {
          console.log('  (暂无用量数据)');
          return;
        }

        let totalInput = 0, totalOutput = 0;
        for (const g of groups) {
          totalInput += g.totalInput || 0;
          totalOutput += g.totalOutput || 0;

          let label;
          if (by === 'model') {
            label = `${g._id?.provider || '-'}/${g._id?.model || '-'}`;
          } else if (by === 'provider') {
            label = g._id || '-';
          } else {
            label = g._id || '-';
          }

          const cost = estimateCost(g.totalInput || 0, g.totalOutput || 0,
            by === 'model' ? g._id?.provider : (by === 'provider' ? g._id : '百炼'));

          console.log(`  ${label.padEnd(30)} 输入=${fmtToken(g.totalInput || 0).padStart(8)}  输出=${fmtToken(g.totalOutput || 0).padStart(8)}  调用=${String(g.callCount || 0).padStart(5)}  ¥${cost.toFixed(2)}`);
        }

        console.log('─'.repeat(90));
        console.log(`  ${'合计'.padEnd(30)} 输入=${fmtToken(totalInput).padStart(8)}  输出=${fmtToken(totalOutput).padStart(8)}  ¥${estimateCost(totalInput, totalOutput, '百炼').toFixed(2)}`);
      }

      console.log('');
      display.info('费用为粗略估算，实际以云厂商账单为准');

    } catch (err) {
      display.error(err.message);
      process.exit(1);
    }
  });

export default statsCommand;
