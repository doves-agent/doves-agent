/**
 * 变更日志技能
 * 迁移自 git_analysis 的 changelog action，独立为文档扩展包的技能
 * 
 * 支持：
 * - conventional changelog 格式（按类型分组）
 * - 自定义格式模板
 * - 从 git log 自动生成
 * - 版本标签关联
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('changelog', { 前缀: '[changelog]', 级别: 'debug', 显示调用位置: true });

// ==================== 辅助函数 ====================

async function runGit(args, cwd = process.cwd()) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    throw new Error(`git ${args.join(' ')} 失败: ${e.message}`);
  }
}

/**
 * 根据 commit 消息分类
 */
function classifyCommit(message) {
  if (!message) return 'other';
  const lower = message.toLowerCase();

  // Conventional Commits 格式: type(scope): description
  const convMatch = lower.match(/^(\w+)(?:\([^)]*\))?:/);
  if (convMatch) {
    const type = convMatch[1];
    const typeMap = {
      feat: 'feature', fix: 'bugfix', refactor: 'refactor', docs: 'docs',
      test: 'test', chore: 'config', style: 'style', perf: 'perf',
      build: 'config', ci: 'config', revert: 'bugfix'
    };
    if (typeMap[type]) return typeMap[type];
  }

  // 中文/英文关键词匹配
  if (lower.match(/\b(fix|bug|修复|修正|hotfix|patch)\b/)) return 'bugfix';
  if (lower.match(/\b(feat|feature|新增|添加|add|implement|支持)\b/)) return 'feature';
  if (lower.match(/\b(refactor|重构|rewrite|cleanup|clean up)\b/)) return 'refactor';
  if (lower.match(/\b(docs?|文档|readme|comment|注释|guide)\b/)) return 'docs';
  if (lower.match(/\b(test|测试|spec|unit|e2e|coverage)\b/)) return 'test';
  if (lower.match(/\b(config|配置|conf|setting|env|dockerfile|ci|cd|workflow)\b/)) return 'config';
  if (lower.match(/\b(style|格式|格式化|空格|缩进|lint|format)\b/)) return 'style';
  if (lower.match(/\b(perf|性能|优化|加速|improve|cache|lazy|async|parallel)\b/)) return 'perf';
  return 'other';
}

/**
 * 从 conventional commit 消息中提取 scope
 */
function extractScope(message) {
  const match = message.match(/^\w+(?:\(([^)]+)\))?:/);
  return match ? match[1] : null;
}

/**
 * 获取最近的版本标签
 */
async function getLatestTag(cwd) {
  try {
    const { stdout } = await runGit(['describe', '--tags', '--abbrev=0'], cwd);
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * 获取所有版本标签
 */
async function getTags(cwd) {
  try {
    const { stdout } = await runGit(['tag', '--sort=-version:refname'], cwd);
    return stdout.trim().split('\n').filter(t => t.trim());
  } catch {
    return [];
  }
}

// ==================== 生成器 ====================

/**
 * 生成 conventional changelog（Markdown格式）
 */
function 生成ConventionalChangelog(commits, options = {}) {
  const { version = 'Unreleased', date = new Date().toISOString().split('T')[0], repoUrl } = options;

  const groups = {};
  const scopes = {};
  for (const c of commits) {
    if (!groups[c.type]) groups[c.type] = [];
    groups[c.type].push(c);
    const scope = extractScope(c.subject);
    if (scope) {
      if (!scopes[scope]) scopes[scope] = [];
      scopes[scope].push(c);
    }
  }

  const typeTitles = {
    feature: '🚀 新功能 (Features)',
    bugfix: '🐛 修复 (Bug Fixes)',
    refactor: '♻️ 重构 (Code Refactoring)',
    perf: '⚡ 性能 (Performance)',
    docs: '📝 文档 (Documentation)',
    test: '✅ 测试 (Tests)',
    config: '🔧 配置 (Configuration)',
    style: '💄 样式 (Styles)',
    other: '📌 其他 (Others)'
  };

  const typeOrder = ['feature', 'bugfix', 'refactor', 'perf', 'docs', 'test', 'config', 'style', 'other'];

  let markdown = `# Changelog\n\n## ${version} (${date})\n\n`;

  for (const type of typeOrder) {
    if (groups[type] && groups[type].length > 0) {
      markdown += `### ${typeTitles[type] || type}\n\n`;
      for (const c of groups[type]) {
        const scopeTag = extractScope(c.subject) ? `**${extractScope(c.subject)}**: ` : '';
        const link = repoUrl ? `([${c.hash}](${repoUrl}/commit/${c.hash}))` : `(${c.hash})`;
        markdown += `- ${scopeTag}${c.subject.replace(/^[^:]*:\s*/, '')} ${link}\n`;
      }
      markdown += '\n';
    }
  }

  // Scope 索引
  if (Object.keys(scopes).length > 0) {
    markdown += `### 按模块索引\n\n`;
    for (const [scope, scopeCommits] of Object.entries(scopes).sort()) {
      markdown += `- **${scope}**: ${scopeCommits.length} 个变更\n`;
    }
    markdown += '\n';
  }

  return markdown.trim();
}

/**
 * 生成 JSON 格式 changelog
 */
function 生成JSONChangelog(commits, options = {}) {
  const { version = 'Unreleased', date = new Date().toISOString().split('T')[0] } = options;

  const groups = {};
  for (const c of commits) {
    if (!groups[c.type]) groups[c.type] = [];
    groups[c.type].push({
      hash: c.hash,
      subject: c.subject,
      author: c.author,
      date: c.date,
      scope: extractScope(c.subject),
      breaking: c.subject.includes('BREAKING CHANGE') || c.subject.includes('!:')
    });
  }

  return {
    version,
    date,
    totalCommits: commits.length,
    groups,
    summary: {
      features: (groups.feature || []).length,
      bugfixes: (groups.bugfix || []).length,
      refactors: (groups.refactor || []).length,
      breaking: commits.filter(c => c.subject.includes('BREAKING CHANGE') || c.subject.includes('!:')).length
    }
  };
}

/**
 * 生成 HTML 格式 changelog（可用于页面托管）
 */
function 生成HTMLChangelog(commits, options = {}) {
  const { version = 'Unreleased', date = new Date().toISOString().split('T')[0], projectName = 'Project' } = options;

  const groups = {};
  for (const c of commits) {
    if (!groups[c.type]) groups[c.type] = [];
    groups[c.type].push(c);
  }

  const typeTitles = {
    feature: '🚀 新功能', bugfix: '🐛 修复', refactor: '♻️ 重构',
    perf: '⚡ 性能', docs: '📝 文档', test: '✅ 测试',
    config: '🔧 配置', style: '💄 样式', other: '📌 其他'
  };
  const typeOrder = ['feature', 'bugfix', 'refactor', 'perf', 'docs', 'test', 'config', 'style', 'other'];

  let items = '';
  for (const type of typeOrder) {
    if (groups[type] && groups[type].length > 0) {
      items += `<div class="change-group"><h3>${typeTitles[type] || type}</h3><ul>`;
      for (const c of groups[type]) {
        const scopeTag = extractScope(c.subject) ? `<span class="scope">${extractScope(c.subject)}</span> ` : '';
        items += `<li>${scopeTag}${c.subject.replace(/^[^:]*:\s*/, '')} <code>${c.hash}</code> <span class="author">@${c.author}</span></li>`;
      }
      items += '</ul></div>';
    }
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${projectName} - Changelog</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; }
  h1 { border-bottom: 2px solid #e1e4e8; padding-bottom: 10px; }
  h2 { color: #0366d6; }
  h3 { color: #586069; margin-top: 20px; }
  .change-group { margin-bottom: 20px; }
  ul { list-style: none; padding-left: 0; }
  li { padding: 6px 0; border-bottom: 1px solid #f1f3f5; }
  code { background: #f1f3f5; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
  .scope { background: #dafbe1; padding: 2px 6px; border-radius: 3px; font-size: 12px; font-weight: 600; }
  .author { color: #586069; font-size: 12px; }
  .meta { color: #586069; font-size: 14px; }
</style>
</head>
<body>
<h1>${projectName} Changelog</h1>
<div class="meta"><strong>${version}</strong> · ${date} · ${commits.length} commits</div>
${items}
</body>
</html>`;
}

// ==================== 主执行函数 ====================

async function execute(args, context) {
  const {
    action = 'generate',
    from,
    to = 'HEAD',
    format = 'markdown',
    version,
    date,
    cwd = process.cwd(),
    repoUrl,
    projectName
  } = args;

  logger.info(`执行: ${action}, from: ${from}, to: ${to}, format: ${format}`);

  try {
    switch (action) {

      case 'generate': {
        // 自动确定 from ref
        let fromRef = from;
        if (!fromRef) {
          const tag = await getLatestTag(cwd);
          if (tag) {
            fromRef = tag;
            logger.info(`使用最新标签作为起始: ${tag}`);
          } else {
            return { 成功: false, 错误: '缺少 from 参数，且未找到版本标签。请指定 from（起始 ref）' };
          }
        }

        // 获取 commit 列表
        const { stdout: logRaw } = await runGit([
          'log', `${fromRef}..${to}`,
          '--format=%H|%an|%ad|%s',
          '--date=short'
        ], cwd);

        const lines = logRaw.trim().split('\n').filter(l => l.trim());
        const commits = lines.map(line => {
          const parts = line.split('|');
          return {
            hash: parts[0]?.trim().substring(0, 7) || '',
            author: parts[1]?.trim() || '',
            date: parts[2]?.trim() || '',
            subject: parts.slice(3).join('|').trim(),
            type: classifyCommit(parts.slice(3).join('|'))
          };
        });

        if (commits.length === 0) {
          return { 成功: true, 数据: { 范围: `${fromRef}..${to}`, 提交数: 0, changelog: '无变更' } };
        }

        const options = {
          version: version || `v${date || new Date().toISOString().split('T')[0]}`,
          date: date || new Date().toISOString().split('T')[0],
          repoUrl,
          projectName
        };

        let result;
        if (format === 'json') {
          result = 生成JSONChangelog(commits, options);
        } else if (format === 'html') {
          result = 生成HTMLChangelog(commits, options);
        } else {
          result = 生成ConventionalChangelog(commits, options);
        }

        return {
          成功: true,
          数据: {
            范围: `${fromRef}..${to}`,
            提交数: commits.length,
            格式: format,
            changelog: result
          }
        };
      }

      case 'versions': {
        // 列出所有版本标签及其 changelog
        const tags = await getTags(cwd);
        if (tags.length === 0) {
          return { 成功: true, 数据: { tags: [], 提示: '未找到版本标签' } };
        }

        const versionList = [];
        for (let i = 0; i < Math.min(tags.length, 10); i++) {
          const currentTag = tags[i];
          const previousTag = tags[i + 1] || null;

          try {
            const { stdout: countRaw } = await runGit([
              'rev-list', '--count', previousTag ? `${previousTag}..${currentTag}` : currentTag
            ], cwd);

            const { stdout: dateRaw } = await runGit([
              'log', '-1', '--format=%ad', '--date=short', currentTag
            ], cwd);

            versionList.push({
              tag: currentTag,
              date: dateRaw.trim(),
              commits: parseInt(countRaw.trim(), 10) || 0
            });
          } catch {
            versionList.push({ tag: currentTag, date: '', commits: 0 });
          }
        }

        return { 成功: true, 数据: { tags: versionList } };
      }

      case 'since': {
        // 基于时间范围生成 changelog
        const { since, until } = args;
        if (!since) {
          return { 成功: false, 错误: '缺少必填参数: since（起始时间）' };
        }

        const logArgs = [
          'log', `--since=${since}`,
          '--format=%H|%an|%ad|%s',
          '--date=short'
        ];
        if (until) logArgs.push(`--until=${until}`);

        const { stdout: logRaw } = await runGit(logArgs, cwd);
        const lines = logRaw.trim().split('\n').filter(l => l.trim());
        const commits = lines.map(line => {
          const parts = line.split('|');
          return {
            hash: parts[0]?.trim().substring(0, 7) || '',
            author: parts[1]?.trim() || '',
            date: parts[2]?.trim() || '',
            subject: parts.slice(3).join('|').trim(),
            type: classifyCommit(parts.slice(3).join('|'))
          };
        });

        if (commits.length === 0) {
          return { 成功: true, 数据: { 时间段: `${since}${until ? ' ~ ' + until : ' ~ now'}`, 提交数: 0, changelog: '无变更' } };
        }

        const options = {
          version: version || `Changes since ${since}`,
          date: date || new Date().toISOString().split('T')[0],
          repoUrl,
          projectName
        };

        let result;
        if (format === 'json') {
          result = 生成JSONChangelog(commits, options);
        } else if (format === 'html') {
          result = 生成HTMLChangelog(commits, options);
        } else {
          result = 生成ConventionalChangelog(commits, options);
        }

        return {
          成功: true,
          数据: {
            时间段: `${since}${until ? ' ~ ' + until : ' ~ now'}`,
            提交数: commits.length,
            格式: format,
            changelog: result
          }
        };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}，支持: generate / versions / since` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

// ==================== 导出 ====================

export default {
  name: 'changelog',
  description: '变更日志技能 — 从Git提交历史自动生成Conventional Changelog，支持Markdown/JSON/HTML格式',
  abilities: ['文档管理', '文档生成'],

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['generate', 'versions', 'since'],
        description: '操作类型：generate=基于ref范围生成 / versions=列出版本标签 / since=基于时间范围生成'
      },
      from: { type: 'string', description: '起始ref（generate使用，不填则自动使用最新tag）' },
      to: { type: 'string', default: 'HEAD', description: '终止ref（默认HEAD）' },
      format: {
        type: 'string',
        enum: ['markdown', 'json', 'html'],
        default: 'markdown',
        description: '输出格式'
      },
      version: { type: 'string', description: '版本号（如 v1.2.0）' },
      date: { type: 'string', description: '发布日期' },
      since: { type: 'string', description: '起始时间（since模式使用，如 "2024-01-01"）' },
      until: { type: 'string', description: '截止时间（since模式使用）' },
      cwd: { type: 'string', description: '工作目录' },
      repoUrl: { type: 'string', description: '仓库URL（用于生成commit链接）' },
      projectName: { type: 'string', description: '项目名（HTML格式使用）' }
    },
    required: ['action']
  },

  execute
};
