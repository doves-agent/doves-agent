/**
 * 审查工具 - 扩展包版本
 * 6个审查工具：review_pr / review_diff / review_checkstyle / review_security / review_auto_fix / quality_gate
 * 
 * 导出格式：extTools / handleExtTool / extToolCategories / extToolAbilityMap / extToolSafetyLevels
 */

import fs from 'fs/promises';
import { extTools, extToolCategories, extToolAbilityMap, extToolSafetyLevels, text, runGit, 扫描安全内容, getSecuritySuggestion } from './_审查工具-定义.js';

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('审查工具', { 前缀: '[审查工具]', 级别: 'debug', 显示调用位置: true });

// ==================== 工具处理函数 ====================

export async function handleExtTool(name, args) {
  switch (name) {

    // ===== review_pr: 审查PR =====
    case 'review_pr': {
      const { base = 'main', target, dimensions, strictness = 'normal', cwd = process.cwd() } = args;
      try {
        // 获取diff统计
        const diffStat = await runGit(['diff', '--stat', `${base}..${target}`], cwd);
        const numstat = await runGit(['diff', '--numstat', `${base}..${target}`], cwd);
        const commits = await runGit(['log', '--pretty=format:%h|%an|%s', `${base}..${target}`], cwd);

        const files = numstat.trim().split('\n').filter(l => l.trim()).map(line => {
          const parts = line.split('\t');
          return { insertions: parseInt(parts[0]) || 0, deletions: parseInt(parts[1]) || 0, path: parts[2]?.trim() };
        });

        const commitList = commits.trim().split('\n').filter(l => l.trim()).map(line => {
          const parts = line.split('|');
          return { hash: parts[0]?.trim(), author: parts[1]?.trim(), subject: parts.slice(2).join('|').trim() };
        });

        // 对每个文件做安全扫描
        const securityFindings = [];
        for (const file of files.slice(0, 20)) { // 限制扫描文件数
          try {
            const content = await runGit(['show', `${target}:${file.path}`], cwd);
            const findings = 扫描安全内容(content, file.path);
            securityFindings.push(...findings);
          } catch { /* 文件可能不存在 */ }
        }

        return text({
          action: 'review_pr',
          base, target, strictness,
          dimensions: dimensions || ['security', 'performance', 'style', 'maintainability'],
          summary: {
            filesChanged: files.length,
            totalInsertions: files.reduce((s, f) => s + f.insertions, 0),
            totalDeletions: files.reduce((s, f) => s + f.deletions, 0),
            commitCount: commitList.length
          },
          commits: commitList,
          files,
          securityFindings,
          securityScore: Math.max(0, 100 - securityFindings.filter(f => f.severity === 'high').length * 20 - securityFindings.filter(f => f.severity === 'medium').length * 10),
          hint: '请基于以上数据进行多维度审查（安全/性能/规范/可维护性），然后使用 quality_gate 综合评分'
        });
      } catch (e) {
        return text({ action: 'review_pr', error: e.message });
      }
    }

    // ===== review_diff: 审查指定diff =====
    case 'review_diff': {
      const { from, to = 'HEAD', cwd = process.cwd() } = args;
      try {
        const diffStat = await runGit(['diff', '--stat', `${from}..${to}`], cwd);
        const numstat = await runGit(['diff', '--numstat', `${from}..${to}`], cwd);

        const files = numstat.trim().split('\n').filter(l => l.trim()).map(line => {
          const parts = line.split('\t');
          return { insertions: parseInt(parts[0]) || 0, deletions: parseInt(parts[1]) || 0, path: parts[2]?.trim() };
        });

        return text({
          action: 'review_diff',
          from, to,
          diffStat: diffStat.trim(),
          summary: {
            filesChanged: files.length,
            totalInsertions: files.reduce((s, f) => s + f.insertions, 0),
            totalDeletions: files.reduce((s, f) => s + f.deletions, 0)
          },
          files
        });
      } catch (e) {
        return text({ action: 'review_diff', error: e.message });
      }
    }

    // ===== review_checkstyle: 代码规范检查 =====
    case 'review_checkstyle': {
      const { path: checkPath, cwd = process.cwd() } = args;
      try {
        const stat = await fs.stat(checkPath);
        const results = [];

        if (stat.isFile()) {
          const content = await fs.readFile(checkPath, 'utf-8');
          // 基本规范检查
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.length > 120) {
              results.push({ line: i + 1, type: 'style', message: `行长度超过120字符 (${line.length})`, severity: 'low' });
            }
            if (/\t/.test(line)) {
              results.push({ line: i + 1, type: 'style', message: '使用了Tab缩进，建议使用空格', severity: 'low' });
            }
            if (line.trim().length > 0 && !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*') && !/[,;]\s*$/.test(line.trim()) === false && /[,{]\s*$/.test(line.trim()) === false) {
              // 简单的行尾检查
            }
          }
        }

        return text({
          action: 'review_checkstyle',
          path: checkPath,
          totalIssues: results.length,
          issues: results.slice(0, 50),
          score: Math.max(0, 100 - results.length * 2)
        });
      } catch (e) {
        return text({ action: 'review_checkstyle', error: e.message, path: checkPath });
      }
    }

    // ===== review_security: 安全扫描 =====
    case 'review_security': {
      const { path: scanPath, severity = 'all', cwd = process.cwd() } = args;
      try {
        const stat = await fs.stat(scanPath);
        const findings = [];

        if (stat.isFile()) {
          const content = await fs.readFile(scanPath, 'utf-8');
          findings.push(...扫描安全内容(content, scanPath, severity));
        } else if (stat.isDirectory()) {
          // 递归扫描目录中的代码文件
          const { readdir } = await import('fs/promises');
          const entries = await readdir(scanPath, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile() && /\.(js|ts|jsx|tsx|py|go|java|php|rb)$/.test(entry.name)) {
              try {
                const content = await fs.readFile(`${scanPath}/${entry.name}`, 'utf-8');
                findings.push(...扫描安全内容(content, `${scanPath}/${entry.name}`, severity));
              } catch { /* 跳过无法读取的文件 */ }
            }
          }
        }

        const summary = {
          high: findings.filter(f => f.severity === 'high').length,
          medium: findings.filter(f => f.severity === 'medium').length,
          low: findings.filter(f => f.severity === 'low').length
        };

        return text({
          action: 'review_security',
          path: scanPath,
          totalFindings: findings.length,
          summary,
          findings: findings.slice(0, 100),
          score: Math.max(0, 100 - summary.high * 20 - summary.medium * 10 - summary.low * 2)
        });
      } catch (e) {
        return text({ action: 'review_security', error: e.message, path: scanPath });
      }
    }

    // ===== review_auto_fix: 自动修复建议 =====
    case 'review_auto_fix': {
      const { file, issues = [], cwd = process.cwd() } = args;

      // 生成修复建议供LLM通过code_edit应用
      const fixes = issues.map(issue => ({
        file,
        type: issue.type,
        line: issue.line,
        message: issue.message,
        suggestion: issue.suggestion,
        action: '建议使用 code_edit 工具应用修复'
      }));

      return text({
        action: 'review_auto_fix',
        file,
        totalFixes: fixes.length,
        fixes,
        hint: '请根据修复建议使用 code_edit 工具逐一应用修复'
      });
    }

    // ===== quality_gate: 质量门禁 =====
    case 'quality_gate': {
      const { reviewResults = [], passThreshold = 80, blockOnCritical = true } = args;

      if (reviewResults.length === 0) {
        return text({ action: 'quality_gate', error: '没有审查结果', pass: false, score: 0 });
      }

      // 计算综合评分
      const totalScore = reviewResults.reduce((sum, r) => sum + (r.score || 0), 0);
      const avgScore = Math.round(totalScore / reviewResults.length);
      const totalIssues = reviewResults.reduce((sum, r) => sum + (r.issues || 0), 0);
      const totalCritical = reviewResults.reduce((sum, r) => sum + (r.criticalIssues || 0), 0);

      const pass = avgScore >= passThreshold && !(blockOnCritical && totalCritical > 0);

      return text({
        action: 'quality_gate',
        score: avgScore,
        pass,
        passThreshold,
        totalIssues,
        totalCritical,
        blockOnCritical,
        dimensions: reviewResults.map(r => ({
          dimension: r.dimension,
          score: r.score,
          issues: r.issues || 0,
          criticalIssues: r.criticalIssues || 0
        })),
        verdict: pass ? '通过 — 可以进行merge/push' : '阻断 — 存在严重问题或评分不足，请修复后重新审查'
      });
    }

    // ===== review_complexity: 代码复杂度分析 =====
    case 'review_complexity': {
      const { path: complexPath, threshold = {}, cwd = process.cwd() } = args;
      const maxCyclomatic = threshold.maxCyclomatic || 10;
      const maxNesting = threshold.maxNesting || 4;
      const maxFunctionLength = threshold.maxFunctionLength || 50;

      try {
        const stat = await fs.stat(complexPath);
        const results = [];

        async function analyzeFile(filePath) {
          const content = await fs.readFile(filePath, 'utf-8');
          const lines = content.split('\n');
          const fileIssues = [];

          // 简单的圈复杂度估算：计算 if/else/for/while/switch/case/try/catch/&&/|| 出现次数
          let cyclomaticBase = 1;
          const cyclomaticPatterns = [/\bif\b/g, /\belse\s+if\b/g, /\bfor\b/g, /\bwhile\b/g, /\bcase\b/g, /\bcatch\b/g, /&&/g, /\|\|/g];

          // 函数检测（简化版）
          let inFunction = false;
          let funcStart = 0;
          let funcName = '';
          let braceDepth = 0;
          let maxDepthInFunc = 0;
          let currentDepth = 0;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // 嵌套深度
            const opens = (line.match(/\{/g) || []).length;
            const closes = (line.match(/\}/g) || []).length;
            currentDepth += opens - closes;
            if (currentDepth > maxDepthInFunc) maxDepthInFunc = currentDepth;

            // 函数开始检测
            const funcMatch = trimmed.match(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\()|(?:async\s+)?(?:\w+\s*=>))/);
            if (funcMatch && !inFunction) {
              inFunction = true;
              funcStart = i + 1;
              funcName = funcMatch[1] || funcMatch[2] || 'anonymous';
              maxDepthInFunc = currentDepth;
            }

            // 函数结束
            if (inFunction && currentDepth <= braceDepth) {
              const funcLength = i + 1 - funcStart;
              if (funcLength > maxFunctionLength) {
                fileIssues.push({
                  type: 'function_length',
                  line: funcStart,
                  message: `函数 "${funcName}" 长度 ${funcLength} 行超过阈值 ${maxFunctionLength}`,
                  severity: 'medium',
                  suggestion: '建议将长函数拆分为更小的函数，每个函数只做一件事'
                });
              }
              inFunction = false;
            }

            if (!inFunction && opens > 0) {
              braceDepth = currentDepth;
            }
          }

          // 全局嵌套深度检查
          if (maxDepthInFunc > maxNesting) {
            fileIssues.push({
              type: 'nesting_depth',
              line: 0,
              message: `最大嵌套深度 ${maxDepthInFunc} 超过阈值 ${maxNesting}`,
              severity: 'medium',
              suggestion: '建议使用卫语句（early return）减少嵌套深度'
            });
          }

          // 圈复杂度估算（基于文件级别）
          let totalCyclomatic = 1;
          for (const pattern of cyclomaticPatterns) {
            pattern.lastIndex = 0;
            const matches = content.match(pattern);
            totalCyclomatic += matches ? matches.length : 0;
          }
          const funcCount = Math.max(1, (content.match(/(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:function|\())/g) || []).length);
          const avgCyclomatic = Math.round(totalCyclomatic / funcCount);

          if (avgCyclomatic > maxCyclomatic) {
            fileIssues.push({
              type: 'cyclomatic_complexity',
              line: 0,
              message: `平均圈复杂度 ${avgCyclomatic} 超过阈值 ${maxCyclomatic}`,
              severity: 'high',
              suggestion: '建议减少条件分支，使用策略模式或多态替代复杂条件'
            });
          }

          return {
            file: filePath,
            totalLines: lines.length,
            avgCyclomatic,
            maxNesting: maxDepthInFunc,
            issues: fileIssues,
            score: Math.max(0, 100 - fileIssues.filter(i => i.severity === 'high').length * 20 - fileIssues.filter(i => i.severity === 'medium').length * 10)
          };
        }

        if (stat.isFile()) {
          results.push(await analyzeFile(complexPath));
        } else if (stat.isDirectory()) {
          const { readdir } = await import('fs/promises');
          const entries = await readdir(complexPath, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile() && /\.(js|ts|jsx|tsx)$/.test(entry.name)) {
              try {
                results.push(await analyzeFile(`${complexPath}/${entry.name}`));
              } catch { /* 跳过无法读取的文件 */ }
            }
          }
        }

        const allIssues = results.flatMap(r => r.issues);
        return text({
          action: 'review_complexity',
          path: complexPath,
          filesAnalyzed: results.length,
          results,
          totalIssues: allIssues.length,
          overallScore: results.length > 0 ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) : 100,
          threshold
        });
      } catch (e) {
        return text({ action: 'review_complexity', error: e.message, path: complexPath });
      }
    }

    // ===== review_dependencies: 依赖安全审查 =====
    case 'review_dependencies': {
      const { path: depPath = '.', auditLevel = 'low', checkLicenses = true, cwd = process.cwd() } = args;
      const targetDir = depPath || cwd;

      try {
        // 读取package.json
        const pkgPath = `${targetDir}/package.json`;
        const pkgContent = await fs.readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(pkgContent);

        const dependencies = Object.entries(pkg.dependencies || {});
        const devDependencies = Object.entries(pkg.devDependencies || {});
        const allDeps = [...dependencies, ...devDependencies];

        // 许可证黑名单
        const licenseBlacklist = ['GPL-2.0', 'GPL-3.0', 'AGPL-3.0'];
        const licenseWarnings = [];

        // 已知漏洞包（简化版，实际应查询npm audit）
        const knownVulnerable = [
          { name: 'lodash', version: '<4.17.21', issue: '原型污染', severity: 'high' },
          { name: 'express', version: '<4.17.3', issue: '开放重定向', severity: 'medium' },
          { name: 'minimist', version: '<0.2.1', issue: '原型污染', severity: 'high' },
          { name: 'node-fetch', version: '<2.6.7', issue: 'SSRF', severity: 'high' },
        ];

        const findings = [];

        for (const [depName, depVersion] of allDeps) {
          // 检查已知漏洞
          for (const vuln of knownVulnerable) {
            if (depName === vuln.name) {
              findings.push({
                type: 'vulnerability',
                package: depName,
                installedVersion: depVersion,
                issue: vuln.issue,
                severity: vuln.severity,
                suggestion: `升级 ${depName} 到最新安全版本`
              });
            }
          }
        }

        // 尝试运行npm audit
        let auditResult = null;
        try {
          const { stdout } = await execFileAsync('npm', ['audit', '--json', '--audit-level', auditLevel], {
            cwd: targetDir, maxBuffer: 10 * 1024 * 1024
          });
          auditResult = JSON.parse(stdout);
        } catch (e) {
          // npm audit可能返回非零退出码表示有漏洞
          try {
            auditResult = JSON.parse(e.stdout || '{}');
          } catch (e) { logger.debug(`npm audit JSON解析失败: ${e.message}，使用手动检查结果`); }
        }

        // 汇总
        const severityCounts = { critical: 0, high: 0, moderate: 0, low: 0 };
        if (auditResult?.metadata?.vulnerabilities) {
          Object.assign(severityCounts, auditResult.metadata.vulnerabilities);
        }

        const auditFindings = findings.length;
        const depScore = Math.max(0, 100 - (severityCounts.critical || 0) * 25 - (severityCounts.high || 0) * 15 - (severityCounts.moderate || 0) * 5 - findings.filter(f => f.severity === 'high').length * 10);

        return text({
          action: 'review_dependencies',
          path: targetDir,
          totalDependencies: dependencies.length,
          totalDevDependencies: devDependencies.length,
          npmAudit: severityCounts,
          knownVulnerabilities: findings,
          licenseWarnings,
          score: depScore
        });
      } catch (e) {
        return text({ action: 'review_dependencies', error: e.message, path: depPath });
      }
    }

    // ===== review_history: 审查历史分析 =====
    case 'review_history': {
      const { path: histPath = '.', since = '30 days ago', topN = 10, cwd = process.cwd() } = args;

      try {
        // 分析最近提交中的变更模式
        const logOutput = await runGit(['log', `--since=${since}`, '--pretty=format:%h|%an|%s', '--numstat'], cwd || histPath);

        const lines = logOutput.trim().split('\n');
        const fileChangeCount = {};
        const fileLineCount = {};
        const authorCommits = {};
        const commitTypes = {};
        let currentCommit = null;

        for (const line of lines) {
          if (line.includes('|')) {
            const parts = line.split('|');
            currentCommit = { hash: parts[0]?.trim(), author: parts[1]?.trim(), subject: parts.slice(2).join('|').trim() };
            authorCommits[currentCommit.author] = (authorCommits[currentCommit.author] || 0) + 1;
            // 分类提交
            const lower = currentCommit.subject.toLowerCase();
            if (lower.match(/fix|bug|修复/)) commitTypes['bugfix'] = (commitTypes['bugfix'] || 0) + 1;
            else if (lower.match(/feat|feature|新增/)) commitTypes['feature'] = (commitTypes['feature'] || 0) + 1;
            else if (lower.match(/refactor|重构/)) commitTypes['refactor'] = (commitTypes['refactor'] || 0) + 1;
            else commitTypes['other'] = (commitTypes['other'] || 0) + 1;
          } else if (line.trim() && currentCommit) {
            const parts = line.split('\t');
            if (parts.length >= 3) {
              const filePath = parts[2]?.trim();
              if (filePath) {
                fileChangeCount[filePath] = (fileChangeCount[filePath] || 0) + 1;
                const add = parts[0] === '-' ? 0 : parseInt(parts[0]) || 0;
                const del = parts[1] === '-' ? 0 : parseInt(parts[1]) || 0;
                fileLineCount[filePath] = (fileLineCount[filePath] || 0) + add + del;
            }
          }
        }
      }

        // 高频变更文件（可能存在质量问题）
        const hotFiles = Object.entries(fileChangeCount)
          .map(([path, count]) => ({ path, changes: count, lines: fileLineCount[path] || 0 }))
          .sort((a, b) => b.changes - a.changes)
          .slice(0, topN);

        // 高Bug提交文件推断（bugfix提交中修改的文件）
        const riskInsight = hotFiles.length > 0
          ? `高频变更文件可能存在代码质量问题，建议重点审查: ${hotFiles.slice(0, 3).map(f => f.path).join(', ')}`
          : '未发现明显高频变更文件';

        const totalCommits = Object.values(authorCommits).reduce((s, c) => s + c, 0);

        return text({
          action: 'review_history',
          since,
          totalCommits,
          commitTypes,
          topAuthors: Object.entries(authorCommits).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, commits: count })),
          hotFiles,
          riskInsight,
          suggestion: hotFiles.length > 0 ? '建议对高频变更文件进行重点审查，关注代码复杂度和测试覆盖率' : '无'
        });
      } catch (e) {
        return text({ action: 'review_history', error: e.message });
      }
    }

    default:
      return null; // 不认识的工具返回 null，让其他扩展处理
  }
}

// Re-export from definition file for server-side tool registry
export { extTools, extToolCategories, extToolAbilityMap, extToolSafetyLevels };
