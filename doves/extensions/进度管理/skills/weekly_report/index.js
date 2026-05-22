/**
 * 周报自动生成技能
 * 基于Git commit历史 + 任务状态 → 自动生成周报
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('weekly_report', { 前缀: '[weekly_report]', 级别: 'debug', 显示调用位置: true });

async function runGit(args, cwd = process.cwd()) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    throw new Error(`git ${args.join(' ')} 失败: ${e.message}`);
  }
}

/**
 * 分类commit
 */
function classifyCommit(message) {
  if (!message) return 'other';
  const lower = message.toLowerCase();
  if (lower.match(/\b(feat|feature|新增|添加)\b/)) return 'feature';
  if (lower.match(/\b(fix|bug|修复)\b/)) return 'bugfix';
  if (lower.match(/\b(refactor|重构)\b/)) return 'refactor';
  if (lower.match(/\b(docs?|文档)\b/)) return 'docs';
  if (lower.match(/\b(test|测试)\b/)) return 'test';
  if (lower.match(/\b(perf|性能|优化)\b/)) return 'perf';
  return 'other';
}

async function execute(args, context) {
  const {
    action = 'generate',
    since,
    until,
    project = '',
    author,
    format = 'markdown',
    cwd = process.cwd(),
    includeStats = true,
    tasks = []
  } = args;

  logger.info(`执行: ${action}`);

  try {
    switch (action) {

      case 'generate': {
        // 默认本周
        const now = new Date();
        const weekStart = since || new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const weekEnd = until || now.toISOString().split('T')[0];

        // 获取本周commit
        const logArgs = ['log', `--since=${weekStart}`, '--format=%H|%an|%ad|%s', '--date=short'];
        if (until) logArgs.push(`--until=${until}`);
        if (author) logArgs.push(`--author=${author}`);

        let commits = [];
        try {
          const { stdout: logRaw } = await runGit(logArgs, cwd);
          commits = logRaw.trim().split('\n').filter(l => l.trim()).map(line => {
            const parts = line.split('|');
            return {
              hash: parts[0]?.trim().substring(0, 7) || '',
              author: parts[1]?.trim() || '',
              date: parts[2]?.trim() || '',
              subject: parts.slice(3).join('|').trim(),
              type: classifyCommit(parts.slice(3).join('|'))
            };
          });
        } catch {
          // Git不可用时，返回空列表
        }

        // 按类型分组
        const groups = {};
        for (const c of commits) {
          if (!groups[c.type]) groups[c.type] = [];
          groups[c.type].push(c);
        }

        const typeTitles = {
          feature: '新功能',
          bugfix: '修复',
          refactor: '重构',
          docs: '文档',
          test: '测试',
          perf: '性能优化',
          other: '其他'
        };

        // 统计
        const stats = {
          totalCommits: commits.length,
          contributors: [...new Set(commits.map(c => c.author))].length,
          features: (groups.feature || []).length,
          bugfixes: (groups.bugfix || []).length,
        };

        // 生成报告
        let report = `# ${project ? project + ' ' : ''}周报\n\n`;
        report += `**时间段**: ${weekStart} ~ ${weekEnd}\n\n`;

        if (includeStats) {
          report += `## 概览\n\n`;
          report += `- 提交数: ${stats.totalCommits}\n`;
          report += `- 贡献者: ${stats.contributors}\n`;
          report += `- 新功能: ${stats.features}\n`;
          report += `- 修复: ${stats.bugfixes}\n\n`;
        }

        report += `## 本周进展\n\n`;
        for (const [type, typeCommits] of Object.entries(groups)) {
          report += `### ${typeTitles[type] || type}\n\n`;
          for (const c of typeCommits) {
            report += `- ${c.subject} (${c.hash})\n`;
          }
          report += '\n';
        }

        // 任务进度
        if (tasks.length > 0) {
          report += `## 任务进度\n\n`;
          for (const task of tasks) {
            report += `- ${task.title || task}: ${task.status || '进行中'}${task.progress ? ` (${task.progress}%)` : ''}\n`;
          }
          report += '\n';
        }

        report += `## 下周计划\n\n`;
        report += `> 请补充下周工作计划\n\n`;

        report += `## 风险与问题\n\n`;
        report += `> 请补充风险和问题\n`;

        return {
          成功: true,
          数据: {
            action: 'generate',
            period: { from: weekStart, to: weekEnd },
            stats,
            report,
            hint: format === 'html'
              ? '请使用 data_report 或 页面托管 将报告托管为HTML页面'
              : '周报已生成，可使用 code_create_file 保存到文件'
          }
        };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}，支持: generate` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'weekly_report',
  description: '周报自动生成技能 — 基于Git commit历史 + 任务状态自动生成周报',
  abilities: ['进度管理', '项目跟踪'],

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['generate'],
        description: '操作类型'
      },
      since: { type: 'string', description: '起始日期（默认7天前）' },
      until: { type: 'string', description: '截止日期（默认今天）' },
      project: { type: 'string', description: '项目名称' },
      author: { type: 'string', description: '按作者过滤' },
      format: { type: 'string', enum: ['markdown', 'html'], description: '输出格式' },
      cwd: { type: 'string', description: '工作目录' },
      includeStats: { type: 'boolean', description: '包含统计信息' },
      tasks: { type: 'array', items: { type: 'object' }, description: '任务列表' }
    },
    required: ['action']
  },

  execute
};
