/**
 * @file actions.js
 * @description git_analysis 大型 action 函数，从 index.js 抽取
 *   - actionAnalyzeRange: 时间段/范围分析
 *   - actionReviewSuggest: 代码审查建议
 *   - actionChangelog: 自动生成 Changelog
 */

import { runGit, classifyCommit, classifyFile } from './helpers.js';

// ============================================================================
// Action: analyze_range
// ============================================================================

export async function actionAnalyzeRange(args) {
  const { since, until, cwd = process.cwd() } = args;

  if (!since) {
    return { 成功: false, 错误: '缺少必填参数: since（起始时间）' };
  }

  const logArgs = [
    'log',
    `--since=${since}`,
    '--format=%H|%an|%ad|%s',
    '--numstat',
    '--date=iso'
  ];
  if (until) logArgs.push(`--until=${until}`);

  const { stdout: logRaw } = await runGit(logArgs, cwd);
  const lines = logRaw.trim().split('\n');

  const commits = [];
  const fileChangeCount = {};
  const fileLineCount = {};
  const contributorCommits = {};
  let currentCommit = null;

  for (const line of lines) {
    if (line.includes('|')) {
      const parts = line.split('|');
      currentCommit = {
        hash: parts[0]?.trim(),
        author: parts[1]?.trim(),
        date: parts[2]?.trim(),
        subject: parts[3]?.trim(),
        type: classifyCommit(parts[3] || ''),
        files: []
      };
      commits.push(currentCommit);
      contributorCommits[currentCommit.author] = (contributorCommits[currentCommit.author] || 0) + 1;
    } else if (line.trim() && currentCommit) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const path = parts[2]?.trim();
        if (path) {
          currentCommit.files.push(path);
          fileChangeCount[path] = (fileChangeCount[path] || 0) + 1;
          const add = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
          const del = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
          fileLineCount[path] = (fileLineCount[path] || 0) + add + del;
        }
      }
    }
  }

  const typeGroups = {};
  for (const c of commits) {
    typeGroups[c.type] = (typeGroups[c.type] || 0) + 1;
  }

  const hotFiles = Object.entries(fileChangeCount)
    .map(([path, count]) => ({
      路径: path,
      修改次数: count,
      变更行数: fileLineCount[path] || 0
    }))
    .sort((a, b) => b.修改次数 - a.修改次数)
    .slice(0, 10);

  const contributors = Object.entries(contributorCommits)
    .map(([name, count]) => ({ 姓名: name, 提交数: count }))
    .sort((a, b) => b.提交数 - a.提交数);

  return {
    成功: true,
    数据: {
      统计: {
        总提交数: commits.length,
        时间段: `${since}${until ? ' ~ ' + until : ' ~ now'}`
      },
      类型分布: typeGroups,
      热点文件: hotFiles,
      贡献者: contributors,
      提交列表: commits.map(c => ({
        hash: c.hash,
        作者: c.author,
        日期: c.date,
        标题: c.subject,
        类型: c.type
      }))
    }
  };
}

// ============================================================================
// Action: review_suggest
// ============================================================================

export async function actionReviewSuggest(args) {
  const { ref = 'HEAD', base, cwd = process.cwd() } = args;

  const diffRange = base ? `${base}..${ref}` : `${ref}~1..${ref}`;
  const { stdout: diffRaw } = await runGit(['diff', diffRange, '--numstat'], cwd);

  const files = [];
  let totalAdd = 0;
  let totalDel = 0;

  const lines = diffRaw.trim().split('\n').filter(l => l.trim());
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const add = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
    const del = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
    const path = parts[2]?.trim();
    if (!path) continue;
    files.push({ path, additions: add, deletions: del, type: classifyFile(path) });
    totalAdd += add;
    totalDel += del;
  }

  const { stdout: msgRaw } = await runGit(['log', diffRange, '--format=%s'], cwd);
  const messages = msgRaw.trim().split('\n').filter(l => l.trim());
  const typesInRange = new Set(messages.map(classifyCommit));

  const suggestions = [];
  const priority = [];

  const bigFiles = files.filter(f => f.additions + f.deletions > 200);
  if (bigFiles.length > 0) {
    suggestions.push(`有 ${bigFiles.length} 个文件变更超过 200 行，建议拆分为多个提交以便审查`);
    priority.push('中');
  }

  if (typesInRange.size > 1 && typesInRange.has('feature') && typesInRange.has('bugfix')) {
    suggestions.push('同一批提交中混合了功能新增和缺陷修复，建议拆分到不同提交');
    priority.push('高');
  }

  const apiFiles = files.filter(f => f.path.includes('api') || f.path.includes('route') || f.path.includes('interface'));
  if (apiFiles.some(f => f.additions > 10)) {
    suggestions.push('新增了公共 API 或接口定义，建议补充文档和测试用例');
    priority.push('高');
  }

  const securityFiles = files.filter(f =>
    f.path.includes('auth') || f.path.includes('security') ||
    f.path.includes('password') || f.path.includes('token') ||
    f.path.includes('permission') || f.path.includes('encrypt')
  );
  if (securityFiles.length > 0) {
    suggestions.push(`修改了安全相关文件（${securityFiles.map(f => f.path).join(', ')}），建议高优先级审查`);
    priority.push('高');
  }

  if (totalAdd + totalDel > 500) {
    suggestions.push(`总体变更量较大（+${totalAdd} -${totalDel}），建议分阶段审查`);
    priority.push('中');
  }

  if (files.length === 1 && totalAdd + totalDel < 5 && files[0].type === 'style') {
    suggestions.push('仅为格式/样式小调整，建议快速通过');
    priority.push('低');
  }

  const codeFiles = files.filter(f => f.type === 'code');
  const testFiles = files.filter(f => f.type === 'test');
  if (codeFiles.length > 0 && testFiles.length === 0) {
    suggestions.push('代码变更缺少测试覆盖，建议补充单元测试或集成测试');
    priority.push('中');
  }

  let reviewPriority = '中';
  if (priority.includes('高')) reviewPriority = '高';
  else if (priority.includes('中')) reviewPriority = '中';
  else if (priority.includes('低')) reviewPriority = '低';

  return {
    成功: true,
    数据: {
      审查范围: diffRange,
      变更文件数: files.length,
      新增行: totalAdd,
      删除行: totalDel,
      建议优先级: reviewPriority,
      审查建议: suggestions,
      文件详情: files
    }
  };
}

// ============================================================================
// Action: changelog
// ============================================================================

export async function actionChangelog(args) {
  const { from, to = 'HEAD', format = 'markdown', cwd = process.cwd() } = args;

  if (!from) {
    return { 成功: false, 错误: '缺少必填参数: from（起始 ref）' };
  }

  const { stdout: logRaw } = await runGit([
    'log',
    `${from}..${to}`,
    '--format=%H|%an|%s'
  ], cwd);

  const lines = logRaw.trim().split('\n').filter(l => l.trim());
  const commits = lines.map(line => {
    const parts = line.split('|');
    return {
      hash: parts[0]?.trim().substring(0, 7),
      author: parts[1]?.trim(),
      subject: parts[2]?.trim(),
      type: classifyCommit(parts[2] || '')
    };
  });

  const groups = {};
  for (const c of commits) {
    if (!groups[c.type]) groups[c.type] = [];
    groups[c.type].push(c);
  }

  const typeTitles = {
    feature: '新功能 (Features)',
    bugfix: '修复 (Bug Fixes)',
    refactor: '重构 (Refactors)',
    docs: '文档 (Documentation)',
    test: '测试 (Tests)',
    config: '配置 (Configuration)',
    style: '样式 (Styles)',
    perf: '性能 (Performance)',
    other: '其他 (Others)'
  };

  let markdown = '';
  const typeOrder = ['feature', 'bugfix', 'refactor', 'perf', 'docs', 'test', 'config', 'style', 'other'];

  for (const type of typeOrder) {
    if (groups[type] && groups[type].length > 0) {
      markdown += `## ${typeTitles[type] || type}\n`;
      for (const c of groups[type]) {
        markdown += `- ${c.hash}: ${c.subject} (@${c.author})\n`;
      }
      markdown += '\n';
    }
  }

  if (format === 'json') {
    return {
      成功: true,
      数据: {
        范围: `${from}..${to}`,
        提交数: commits.length,
        分组: groups
      }
    };
  }

  return {
    成功: true,
    数据: {
      范围: `${from}..${to}`,
      提交数: commits.length,
      changelog: markdown.trim()
    }
  };
}
