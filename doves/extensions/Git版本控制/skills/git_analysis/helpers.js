/**
 * @file helpers.js
 * @description git_analysis 公共辅助函数，从 index.js 抽取
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { 获取仓库路径 } from '../../data/仓库管理.js';

const execFileAsync = promisify(execFile);

import { 创建日志器 } from '@dove/common/日志管理器.js';
export { 创建日志器 };

const logger = 创建日志器('Git仓库分析', { 前缀: '[Git仓库分析]', 级别: 'debug', 显示调用位置: true });
export { logger };

/**
 * 解析工作目录：优先用传入的 cwd，其次从仓库配置获取，最后 fallback process.cwd()
 */
export async function 解析工作目录(cwd, 仓库标识) {
  if (cwd) return cwd;
  if (仓库标识) {
    const path = await 获取仓库路径(仓库标识);
    if (path) return path;
  }
  return process.cwd();
}

export async function runGit(args, cwd = process.cwd()) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024
    });
    if (stderr && stderr.trim()) {
      logger.warn(`git stderr: ${stderr.trim()}`);
    }
    return { stdout: stdout || '', stderr: stderr || '' };
  } catch (error) {
    throw new Error(`git 命令失败: git ${args.join(' ')} — ${error.message}`);
  }
}

export function classifyCommit(message) {
  if (!message) return 'other';
  const lower = message.toLowerCase();

  if (lower.match(/\b(fix|bug|修复|修正|hotfix|patch)\b/)) return 'bugfix';
  if (lower.match(/\b(feat|feature|新增|添加|add|implement|支持)\b/)) return 'feature';
  if (lower.match(/\b(refactor|重构|重构|rewrite|cleanup|clean up)\b/)) return 'refactor';
  if (lower.match(/\b(docs?|文档|readme|comment|注释|guide)\b/)) return 'docs';
  if (lower.match(/\b(test|测试|spec|unit|e2e|coverage)\b/)) return 'test';
  if (lower.match(/\b(config|配置|conf|setting|env|dockerfile|ci|cd|workflow|eslint|prettier|babel|webpack|vite|tsconfig)\b/)) return 'config';
  if (lower.match(/\b(style|格式|格式化|空格|缩进|lint|format)\b/)) return 'style';
  if (lower.match(/\b(perf|性能|优化|加速|improve|cache|lazy|async|parallel)\b/)) return 'perf';
  return 'other';
}

export function classifyFile(filePath) {
  if (!filePath) return 'other';
  const lower = filePath.toLowerCase();

  if (lower.match(/\.(test|spec)\.(js|ts|jsx|tsx|py|go|java|cs|rb|php)$/) ||
      lower.match(/(__tests__|tests?|spec|test)\//) ||
      lower.match(/\/(jest|vitest|mocha|pytest|cypress|playwright)\./)) {
    return 'test';
  }

  if (lower.match(/\.(md|mdx|rst|txt|adoc)$/) ||
      lower.match(/^(readme|changelog|contributing|license|notice|security)/) ||
      lower.match(/\/(docs?|documentation|wiki|guides?)\//)) {
    return 'docs';
  }

  if (lower.match(/\.(json|yaml|yml|toml|ini|conf|config|properties|env)$/) ||
      lower.match(/\/(dockerfile|docker-compose|makefile|cmakelists|eslint|prettier|babel|webpack|vite|rollup|tsconfig|jsconfig|postcss|tailwind|nginx|gitignore|npmignore|editorconfig)\b/) ||
      lower.match(/(^|\/)(package|tsconfig|jsconfig|tailwind|postcss|vite|webpack|rollup|babel|eslint|prettier)\.config\./)) {
    return 'config';
  }

  if (lower.match(/\/(\.github|\.gitlab-ci|\.circleci|\.travis|jenkins|workflows)\//)) {
    return 'config';
  }

  if (lower.match(/\.(css|scss|sass|less|styl|stylus|pcss)$/) ||
      lower.match(/\bstyle\b/)) {
    return 'style';
  }

  if (lower.match(/\.(js|ts|jsx|tsx|py|go|java|cs|c|cpp|h|hpp|rs|rb|php|swift|kt|dart|scala|lua|pl|sh|ps1)$/)) {
    return 'code';
  }

  return 'other';
}

export function generateSuggestions(files, commitMsg) {
  const suggestions = [];
  const codeFiles = files.filter(f => f.type === 'code' || f.type === 'feature');
  const testFiles = files.filter(f => f.type === 'test');
  const docFiles = files.filter(f => f.type === 'docs');

  if (codeFiles.length > 0 && testFiles.length === 0) {
    suggestions.push('修改了源代码但没有对应的测试变更，建议补充测试');
  }

  if (codeFiles.some(f => f.path.includes('route') || f.path.includes('api') || f.path.includes('controller')) && docFiles.length === 0) {
    suggestions.push('修改了 API/路由文件，建议检查是否需要更新 API 文档');
  }

  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);
  if (totalDeletions > 100) {
    suggestions.push('大量代码删除，建议确认是否有依赖该代码的其他模块');
  }

  if (files.some(f => f.type === 'config')) {
    suggestions.push('配置文件有变更，建议检查部署环境是否需要同步更新');
  }

  const newFiles = files.filter(f => f.status === 'A');
  if (newFiles.length > 0 && testFiles.length === 0) {
    suggestions.push(`新增了 ${newFiles.length} 个文件但没有对应的测试文件，建议补充测试`);
  }

  return suggestions;
}

export function calcImpactLevel(fileCount, addCount, delCount) {
  const total = addCount + delCount;
  if (fileCount > 20 || total > 500) return '高';
  if (fileCount > 5 || total > 100) return '中';
  return '低';
}
