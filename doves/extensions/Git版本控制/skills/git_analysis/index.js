/**
 * Git 仓库智能分析技能
 *
 * 提供 Git 仓库的深度语义分析能力：
 * - analyze_commit: 单次提交深度分析（变更分类、影响评估、建议生成）
 * - analyze_range: 时间段/范围分析（提交统计、热点文件、贡献者）
 * - review_suggest: 代码审查建议（基于变更模式）
 * - changelog: 自动生成 Changelog（按类型分组）
 * - impact_analysis: 变更影响分析（文件重要度与风险）
 * - doc_check: 文档关联检查（源码变更与文档同步）
 *
 * 迁移自 skills/git_analysis/index.js
 */

import { runGit, 解析工作目录, classifyCommit, classifyFile, generateSuggestions, calcImpactLevel, logger } from './helpers.js';
import { actionAnalyzeRange, actionReviewSuggest, actionChangelog } from './actions.js';
import { 保存分析 } from '../../data/分析记录.js';
import { 记录结论 } from '../../data/记忆.js';

// ============================================================================
// Action: analyze_commit
// ============================================================================

async function actionAnalyzeCommit(args) {
  const { ref = 'HEAD', cwd = process.cwd() } = args;

  const formatArgs = [
    'show', ref,
    '--format=%H|%an|%ae|%ad|%s|%b|END',
    '--no-patch',
    '--date=iso'
  ];
  const { stdout: metaRaw } = await runGit(formatArgs, cwd);
  const metaParts = metaRaw.split('|END')[0].split('|');
  const commitMeta = {
    hash: metaParts[0]?.trim() || '',
    author: metaParts[1]?.trim() || '',
    email: metaParts[2]?.trim() || '',
    date: metaParts[3]?.trim() || '',
    subject: metaParts[4]?.trim() || '',
    body: metaParts[5]?.trim() || ''
  };

  const { stdout: statRaw } = await runGit(['show', ref, '--numstat', '--format='], cwd);
  const fileLines = statRaw.trim().split('\n').filter(l => l.trim());

  const files = [];
  const typeDistribution = {};
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const line of fileLines) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const add = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
    const del = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
    const path = parts[2]?.trim();
    if (!path) continue;

    const type = classifyFile(path);
    files.push({ path, additions: add, deletions: del, type, status: 'M' });
    totalAdditions += add;
    totalDeletions += del;
    typeDistribution[type] = (typeDistribution[type] || 0) + 1;
  }

  try {
    const { stdout: nameStatusRaw } = await runGit(['show', ref, '--name-status', '--format='], cwd);
    const statusLines = nameStatusRaw.trim().split('\n').filter(l => l.trim());
    for (const line of statusLines) {
      const sParts = line.split('\t');
      if (sParts.length >= 2) {
        const status = sParts[0].trim();
        const path = sParts[1]?.trim();
        const f = files.find(x => x.path === path);
        if (f) f.status = status;
      }
    }
  } catch {
    // 忽略状态获取失败
  }

  const mainType = Object.entries(typeDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || 'other';
  const impactLevel = calcImpactLevel(files.length, totalAdditions, totalDeletions);
  const suggestions = generateSuggestions(files, commitMeta.subject);

  return {
    成功: true,
    数据: {
      提交: commitMeta,
      变更摘要: {
        文件数: files.length,
        新增行: totalAdditions,
        删除行: totalDeletions,
        影响级别: impactLevel,
        主要类型: mainType
      },
      文件列表: files,
      类型分布: typeDistribution,
      建议: suggestions
    }
  };
}

// ============================================================================
// Action: impact_analysis
// ============================================================================

async function actionImpactAnalysis(args) {
  const { files: fileList, cwd = process.cwd() } = args;

  if (!Array.isArray(fileList) || fileList.length === 0) {
    return { 成功: false, 错误: '缺少必填参数: files（文件路径数组）' };
  }

  const results = [];

  for (const filePath of fileList) {
    try {
      const { stdout: logRaw } = await runGit([
        'log',
        '--since=3 months ago',
        '--follow',
        '--format=%H|%an|%ad|%s',
        '--',
        filePath
      ], cwd);

      const lines = logRaw.trim().split('\n').filter(l => l.trim());
      const fileCommits = lines.map(line => {
        const parts = line.split('|');
        return { hash: parts[0]?.trim(), author: parts[1]?.trim(), date: parts[2]?.trim(), subject: parts[3]?.trim() };
      });

      const uniqueContributors = new Set(fileCommits.map(c => c.author));

      let riskLevel = '低';
      if (fileCommits.length > 10 || uniqueContributors.size > 3) {
        riskLevel = '高';
      } else if (fileCommits.length > 3 || uniqueContributors.size > 1) {
        riskLevel = '中';
      }

      const isCritical = filePath.includes('index.') ||
        filePath.includes('main.') ||
        filePath.includes('core') ||
        filePath.includes('api') ||
        filePath.includes('config');

      if (isCritical && riskLevel !== '高') {
        riskLevel = '中';
      }

      results.push({
        路径: filePath,
        最近修改次数: fileCommits.length,
        贡献者数: uniqueContributors.size,
        贡献者列表: Array.from(uniqueContributors),
        最近提交: fileCommits.slice(0, 5),
        风险级别: riskLevel,
        关键路径: isCritical
      });
    } catch (error) {
      results.push({
        路径: filePath,
        错误: error.message,
        风险级别: '未知'
      });
    }
  }

  return {
    成功: true,
    数据: {
      分析文件数: results.length,
      文件分析: results,
      总体风险: results.some(r => r.风险级别 === '高') ? '高' : results.some(r => r.风险级别 === '中') ? '中' : '低'
    }
  };
}

// ============================================================================
// Action: doc_check
// ============================================================================

async function actionDocCheck(args) {
  const { ref = 'HEAD', cwd = process.cwd() } = args;

  const { stdout: nameRaw } = await runGit(['show', ref, '--name-only', '--format='], cwd);
  const allFiles = nameRaw.trim().split('\n').filter(l => l.trim());

  const sourceFiles = allFiles.filter(f => classifyFile(f) === 'code');
  const docFiles = allFiles.filter(f => classifyFile(f) === 'docs');
  const testFiles = allFiles.filter(f => classifyFile(f) === 'test');

  const suggestions = [];

  if (sourceFiles.length > 0 && docFiles.length === 0) {
    const readmeKeywords = sourceFiles.map(f => {
      const basename = f.split('/').pop()?.replace(/\.[^.]+$/, '');
      return basename;
    }).filter(Boolean);

    suggestions.push(`修改了 ${sourceFiles.length} 个源代码文件但未更新文档，建议检查 README 和 API 文档是否需要同步`);

    try {
      const { stdout: readmeRaw } = await runGit(['show', 'HEAD:README.md'], cwd);
      const readmeLower = readmeRaw.toLowerCase();
      const missingDocs = readmeKeywords.filter(kw => !readmeLower.includes(kw.toLowerCase()));
      if (missingDocs.length > 0) {
        suggestions.push(`README 中未提及以下相关模块，建议补充文档: ${missingDocs.join(', ')}`);
      }
    } catch {
      // README 可能不存在或无法读取
    }
  }

  const apiFiles = sourceFiles.filter(f => f.includes('route') || f.includes('api') || f.includes('controller'));
  if (apiFiles.length > 0) {
    suggestions.push('检测到 API/路由相关文件变更，建议同步更新 API 文档和使用说明');
  }

  const commonFiles = sourceFiles.filter(f => f.includes('common') || f.includes('utils') || f.includes('lib'));
  if (commonFiles.length > 0) {
    suggestions.push('公共工具/库文件有变更，建议检查依赖这些模块的其他代码是否受影响，并更新相关文档');
  }

  if (sourceFiles.length > 0 && testFiles.length === 0) {
    suggestions.push('源代码变更缺少测试文件更新，建议补充单元测试');
  }

  const configFiles = allFiles.filter(f => classifyFile(f) === 'config');
  if (configFiles.length > 0) {
    suggestions.push('配置文件有变更，建议在 README 或部署文档中记录配置变更说明');
  }

  return {
    成功: true,
    数据: {
      提交: ref,
      源码文件: sourceFiles,
      文档文件: docFiles,
      测试文件: testFiles,
      配置文件: configFiles,
      文档建议: suggestions,
      文档完整度评分: suggestions.length === 0 ? 100 : Math.max(0, 100 - suggestions.length * 15)
    }
  };
}

// ============================================================================
// 主执行函数
// ============================================================================

async function execute(args, context) {
  const { action, 仓库: 仓库标识 } = args;
  const cwd = await 解析工作目录(args.cwd, 仓库标识);
  const resolvedArgs = { ...args, cwd };

  logger.info(`执行: ${action}, cwd: ${cwd}`);

  if (!action) {
    return { 成功: false, 错误: '缺少必填参数: action' };
  }

  try {
    let result;
    switch (action) {
      case 'analyze_commit':
        result = await actionAnalyzeCommit(resolvedArgs);
        break;

      case 'analyze_range':
        result = await actionAnalyzeRange(resolvedArgs);
        break;

      case 'review_suggest':
        result = await actionReviewSuggest(resolvedArgs);
        break;

      case 'changelog':
        result = await actionChangelog(resolvedArgs);
        break;

      case 'impact_analysis':
        result = await actionImpactAnalysis(resolvedArgs);
        break;

      case 'doc_check':
        result = await actionDocCheck(resolvedArgs);
        break;

      default:
        return { 成功: false, 错误: `未知操作: ${action}` };
    }

    // 持久化分析结果
    if (result.成功) {
      try {
        await 保存分析({
          仓库别名: 仓库标识 || '',
          分析类型: action,
          输入参数: args,
          结果: result.数据,
          commit: result.数据?.提交 ? { hash: result.数据.提交.hash, subject: result.数据.提交.subject } : null,
        });
      } catch (e) {
        logger.warn(`分析记录持久化失败（不影响结果）: ${e.message}`);
      }

      // 重要发现写入语义记忆（高影响或有建议时）
      try {
        const data = result.数据;
        const shouldRemember = data?.变更摘要?.影响级别 === '高'
          || (data?.建议 && data.建议.length >= 2)
          || (data?.总体风险 === '高');
        if (shouldRemember) {
          const summary = data.建议?.join('; ') || data.文档建议?.join('; ') || `影响级别: ${data.变更摘要?.影响级别 || data.总体风险}`;
          await 记录结论({
            仓库: 仓库标识 || '未指定',
            类型: action,
            结论: summary,
            commit: data.提交?.hash,
          });
        }
      } catch (e) {
        logger.warn(`记忆写入失败（不影响结果）: ${e.message}`);
      }
    }

    // 记录用户活动
    import('../../../../用户活动记录器.js').then(({ 记录用户活动 }) => {
      记录用户活动({
        用户ID: context?.userId || context?.用户ID || 'default',
        扩展名: 'Git版本控制',
        活动: `进行了Git分析: ${action}`,
        详情: { 仓库: 仓库标识, 分析类型: action },
      });
    }).catch(() => {});

    return result;
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return {
      成功: false,
      错误: error.message,
      错误码: 'EXECUTION_ERROR'
    };
  }
}

// ============================================================================
// 导出
// ============================================================================

export default {
  name: 'Git仓库分析',
  description: 'Git 仓库智能分析技能 — 提交分类、变更影响分析、代码审查建议、文档关联、Bug风险评估',

  abilities: ['Git', '代码分析', '版本控制', '代码审查', '变更分析', 'git'],

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['analyze_commit', 'analyze_range', 'review_suggest', 'changelog', 'impact_analysis', 'doc_check'],
        description: '分析类型'
      },
      仓库: {
        type: 'string',
        description: '目标仓库别名或ID（从仓库配置获取路径，省略则用最近访问的仓库）'
      },
      ref: {
        type: 'string',
        default: 'HEAD',
        description: '提交 hash 或引用（analyze_commit / review_suggest / doc_check 使用）'
      },
      base: {
        type: 'string',
        description: '对比基准 ref（review_suggest 使用，可选）'
      },
      since: {
        type: 'string',
        description: '起始时间（analyze_range 使用，如 "7 days ago" 或 "2026-04-01"）'
      },
      until: {
        type: 'string',
        description: '截止时间（analyze_range 使用，可选）'
      },
      from: {
        type: 'string',
        description: '起始 ref（changelog 使用）'
      },
      to: {
        type: 'string',
        default: 'HEAD',
        description: '终止 ref（changelog 使用，默认 HEAD）'
      },
      format: {
        type: 'string',
        enum: ['markdown', 'json'],
        default: 'markdown',
        description: 'Changelog 输出格式（changelog 使用）'
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: '文件路径数组（impact_analysis 使用）'
      },
      cwd: {
        type: 'string',
        description: 'Git 仓库工作目录（可选，默认当前目录）'
      }
    },
    required: ['action']
  },

  execute
};
