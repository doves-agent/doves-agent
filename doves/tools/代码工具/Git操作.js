/**
 * Git 操作处理函数
 * 从 代码工具.js 提取
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

import { text, isExcludedDir } from './代码搜索工具.js';
import { parseGitStatus, parseGitLog, classifyChange, parseGitBlame, parseNumstat } from './Git解析工具.js';

/**
 * 处理所有 Git 相关的工具调用
 */
export async function handleGitTool(name, args) {
  switch (name) {

    // ===== Git操作 =====
    case 'Git操作': {
      const action = args.action;
      const gitArgs = args.args || {};

      try {
        switch (action) {

          case 'status': {
            const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-b'], { maxBuffer: 10 * 1024 * 1024 });
            const parsed = parseGitStatus(stdout);
            return text({ action: 'status', ...parsed });
          }

          case 'diff': {
            const diffArgs = ['diff'];
            if (gitArgs.staged) diffArgs.push('--staged');
            if (gitArgs.file) diffArgs.push('--', gitArgs.file);
            const { stdout } = await execFileAsync('git', diffArgs, { maxBuffer: 10 * 1024 * 1024 });
            return text({
              action: 'diff',
              file: gitArgs.file || null,
              staged: gitArgs.staged || false,
              diff: stdout.trim()
            });
          }

          case 'log': {
            const count = gitArgs.count || 10;
            const logArgs = ['log', '--pretty=format:%h|%an|%ai|%s', '-n', String(count)];
            if (gitArgs.file) logArgs.push('--', gitArgs.file);
            const { stdout } = await execFileAsync('git', logArgs, { maxBuffer: 10 * 1024 * 1024 });
            const commits = parseGitLog(stdout);
            return text({
              action: 'log',
              count,
              file: gitArgs.file || null,
              commits
            });
          }

          case 'add': {
            const files = gitArgs.files;
            if (!files || !Array.isArray(files) || files.length === 0) {
              return text({ error: 'add 操作需要 files 参数（文件路径数组）' });
            }
            const { stdout, stderr } = await execFileAsync('git', ['add', ...files], { maxBuffer: 10 * 1024 * 1024 });
            return text({
              action: 'add',
              files,
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              success: true
            });
          }

          case 'commit': {
            const message = gitArgs.message;
            if (!message) {
              return text({ error: 'commit 操作需要 message 参数' });
            }
            const { stdout, stderr } = await execFileAsync('git', ['commit', '-m', message], { maxBuffer: 10 * 1024 * 1024 });
            return text({
              action: 'commit',
              message,
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              success: true
            });
          }

          case 'branch': {
            if (gitArgs.name) {
              const { stdout, stderr } = await execFileAsync('git', ['branch', gitArgs.name], { maxBuffer: 10 * 1024 * 1024 });
              return text({
                action: 'branch',
                created: gitArgs.name,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                success: true
              });
            } else {
              const { stdout } = await execFileAsync('git', ['branch', '-a'], { maxBuffer: 10 * 1024 * 1024 });
              const branches = stdout.trim().split('\n').map(b => ({
                name: b.replace(/^\*?\s+/, '').trim(),
                current: b.startsWith('*')
              })).filter(b => b.name);
              return text({
                action: 'branch',
                branches
              });
            }
          }

          case 'show': {
            const ref = gitArgs.ref || 'HEAD';
            const { stdout } = await execFileAsync('git', ['show', '--stat', '--pretty=format:%H|%an|%ai|%s', ref], { maxBuffer: 10 * 1024 * 1024 });
            return text({
              action: 'show',
              ref,
              result: stdout.trim()
            });
          }

          default:
            return text({ error: `未知的 git 操作: ${action}` });
        }
      } catch (err) {
        return text({
          action,
          error: err.message,
          stdout: err.stdout || '',
          stderr: err.stderr || '',
          success: false
        });
      }
    }

    // ===== Git差异 =====
    case 'Git差异': {
      const ref = args.ref || 'HEAD';
      const base = args.base;
      const cwd = args.cwd || process.cwd();
      try {
        let numstatOutput;
        if (base) {
          const { stdout } = await execFileAsync('git', ['diff', '--stat', '--numstat', base, ref], { cwd, maxBuffer: 10 * 1024 * 1024 });
          numstatOutput = stdout;
        } else {
          const { stdout } = await execFileAsync('git', ['show', '--stat', '--numstat', '--format=', ref], { cwd, maxBuffer: 10 * 1024 * 1024 });
          numstatOutput = stdout;
        }

        const { stdout: logOutput } = await execFileAsync('git', ['log', '-1', '--pretty=format:%H|%an|%ae|%ai|%s|%b', ref], { cwd, maxBuffer: 10 * 1024 * 1024 });
        const logParts = logOutput.split('|');
        const commit = {
          hash: logParts[0] || '',
          author: logParts[1] || '',
          email: logParts[2] || '',
          date: logParts[3] || '',
          subject: logParts[4] || '',
          body: logParts.slice(5).join('|').trim()
        };

        const files = parseNumstat(numstatOutput);
        let totalInsertions = 0;
        let totalDeletions = 0;
        const changeTypes = {};

        for (const f of files) {
          totalInsertions += f.insertions;
          totalDeletions += f.deletions;
          const ct = classifyChange(f.path, commit.subject);
          f.changeType = ct;
          f.status = 'modified';
          changeTypes[ct] = (changeTypes[ct] || 0) + 1;
        }

        let statusOutput = '';
        try {
          if (base) {
            const { stdout } = await execFileAsync('git', ['diff', '--name-status', base, ref], { cwd, maxBuffer: 10 * 1024 * 1024 });
            statusOutput = stdout;
          } else {
            const { stdout } = await execFileAsync('git', ['show', '--name-status', '--format=', ref], { cwd, maxBuffer: 10 * 1024 * 1024 });
            statusOutput = stdout;
          }
        } catch (e) { logger.debug(`获取 status 失败: ${e.message}`); }

        const statusLines = statusOutput.trim().split('\n');
        for (const line of statusLines) {
          const m = line.match(/^([AMDRCU])\s+(.+)$/);
          if (m) {
            const file = files.find(f => f.path === m[2]);
            if (file) {
              const statusMap = { 'A': 'added', 'M': 'modified', 'D': 'deleted', 'R': 'renamed', 'C': 'copied', 'U': 'updated' };
              file.status = statusMap[m[1]] || 'modified';
            }
          }
        }

        const totalChanges = totalInsertions + totalDeletions;
        const impactLevel = totalChanges < 10 ? 'low' : totalChanges <= 100 ? 'medium' : 'high';

        return text({
          commit,
          summary: {
            filesChanged: files.length,
            insertions: totalInsertions,
            deletions: totalDeletions
          },
          files,
          changeTypes,
          impactLevel
        });
      } catch (err) {
        return text({ error: `diff detail 失败: ${err.message}` });
      }
    }

    // ===== Git溯源 =====
    case 'Git溯源': {
      const filePath = args.path;
      const startLine = args.start_line;
      const endLine = args.end_line;
      const cwd = args.cwd || process.cwd();
      try {
        const blameArgs = ['blame', '--porcelain'];
        if (startLine && endLine) {
          blameArgs.push('-L', `${startLine},${endLine}`);
        }
        blameArgs.push(filePath);
        const { stdout } = await execFileAsync('git', blameArgs, { cwd, maxBuffer: 10 * 1024 * 1024 });
        const lines = parseGitBlame(stdout);

        const authors = {};
        const seenHashes = new Set();
        const recentChanges = [];

        for (const line of lines) {
          authors[line.author] = (authors[line.author] || 0) + 1;
          if (!seenHashes.has(line.fullHash)) {
            seenHashes.add(line.fullHash);
            recentChanges.push({
              hash: line.hash,
              author: line.author,
              date: line.date,
              subject: line.summary
            });
          }
        }

        return text({
          file: filePath,
          lines: lines.map(l => ({
            line: l.line,
            hash: l.hash,
            author: l.author,
            date: l.date,
            content: l.content
          })),
          authors,
          recentChanges: recentChanges.slice(0, 10)
        });
      } catch (err) {
        return text({ error: `blame 失败: ${err.message}` });
      }
    }

    // ===== Git文件历史 =====
    case 'Git文件历史': {
      const filePath = args.path;
      const count = args.count ?? 20;
      const showDiff = args.show_diff ?? false;
      const cwd = args.cwd || process.cwd();
      try {
        const { stdout: logOutput } = await execFileAsync('git', ['log', '--pretty=format:%H|%an|%ai|%s', '-n', String(count), '--follow', '--', filePath], { cwd, maxBuffer: 10 * 1024 * 1024 });
        const commits = [];
        for (const line of logOutput.trim().split('\n')) {
          const parts = line.split('|');
          if (parts.length >= 4) {
            commits.push({
              hash: parts[0].trim(),
              author: parts[1].trim(),
              date: parts[2].trim(),
              subject: parts.slice(3).join('|').trim(),
              insertions: 0,
              deletions: 0
            });
          }
        }

        if (showDiff && commits.length > 0) {
          try {
            const { stdout: numstatOutput } = await execFileAsync('git', ['log', '--pretty=format:%H', '--numstat', '-n', String(count), '--follow', '--', filePath], { cwd, maxBuffer: 10 * 1024 * 1024 });
            const lines = numstatOutput.trim().split('\n');
            let currentHash = null;
            for (const line of lines) {
              if (line.match(/^[0-9a-f]{40}$/)) {
                currentHash = line;
              } else if (currentHash) {
                const m = line.match(/^(\d+)\t(\d+)\t(.+)$/);
                if (m) {
                  const commit = commits.find(c => c.hash === currentHash);
                  if (commit) {
                    commit.insertions += parseInt(m[1], 10);
                    commit.deletions += parseInt(m[2], 10);
                  }
                }
              }
            }
          } catch (e) { logger.debug(`获取 numstat 失败: ${e.message}`); }
        }

        const authorCounts = {};
        for (const c of commits) {
          authorCounts[c.author] = (authorCounts[c.author] || 0) + 1;
        }
        const topAuthors = Object.entries(authorCounts)
          .map(([name, commitsCount]) => ({ name, commits: commitsCount }))
          .sort((a, b) => b.commits - a.commits)
          .slice(0, 5);

        return text({
          file: filePath,
          totalCommits: commits.length,
          history: commits,
          topAuthors
        });
      } catch (err) {
        return text({ error: `file history 失败: ${err.message}` });
      }
    }

    // ===== Git对比 =====
    case 'Git对比': {
      const base = args.base;
      const target = args.target;
      const cwd = args.cwd || process.cwd();
      try {
        const { stdout: logOutput } = await execFileAsync('git', ['log', '--pretty=format:%H|%an|%ai|%s', `${base}..${target}`], { cwd, maxBuffer: 10 * 1024 * 1024 });
        const commits = [];
        for (const line of logOutput.trim().split('\n')) {
          const parts = line.split('|');
          if (parts.length >= 4) {
            commits.push({
              hash: parts[0].trim(),
              author: parts[1].trim(),
              date: parts[2].trim(),
              subject: parts.slice(3).join('|').trim()
            });
          }
        }

        const { stdout: diffOutput } = await execFileAsync('git', ['diff', '--stat', '--numstat', base, target], { cwd, maxBuffer: 10 * 1024 * 1024 });
        const files = parseNumstat(diffOutput);

        let totalInsertions = 0;
        let totalDeletions = 0;
        const changeTypes = {};

        for (const f of files) {
          totalInsertions += f.insertions;
          totalDeletions += f.deletions;
          const ct = classifyChange(f.path, commits[0]?.subject || '');
          f.changeType = ct;
          changeTypes[ct] = (changeTypes[ct] || 0) + 1;
        }

        return text({
          base,
          target,
          commits,
          commitCount: commits.length,
          fileSummary: {
            filesChanged: files.length,
            insertions: totalInsertions,
            deletions: totalDeletions
          },
          files,
          changeTypes
        });
      } catch (err) {
        return text({ error: `compare 失败: ${err.message}` });
      }
    }

    // ===== Git统计 =====
    case 'Git统计': {
      const days = args.days ?? 30;
      const cwd = args.cwd || process.cwd();
      try {
        const { stdout } = await execFileAsync('git', ['log', `--since=${days} days ago`, '--pretty=format:%H|%an|%ai|%s', '--numstat'], { cwd, maxBuffer: 50 * 1024 * 1024 });

        const commits = [];
        const hotFiles = {};
        const contributors = {};
        const activityByDay = {};
        const changeTypeDistribution = {};
        const hashSet = new Set();

        const allLines = stdout.trim().split('\n');
        let currentCommit = null;

        for (const line of allLines) {
          const commitMatch = line.match(/^([0-9a-f]{40,})\|(.+)\|(.+)\|(.+)$/);
          if (commitMatch) {
            const hash = commitMatch[1];
            if (!hashSet.has(hash)) {
              hashSet.add(hash);
              currentCommit = {
                hash,
                author: commitMatch[2],
                date: commitMatch[3].trim().split(' ')[0],
                subject: commitMatch[4]
              };
              commits.push(currentCommit);

              contributors[currentCommit.author] = contributors[currentCommit.author] || { commits: 0, insertions: 0, deletions: 0 };
              contributors[currentCommit.author].commits += 1;

              activityByDay[currentCommit.date] = (activityByDay[currentCommit.date] || 0) + 1;

              const ct = classifyChange('', currentCommit.subject);
              changeTypeDistribution[ct] = (changeTypeDistribution[ct] || 0) + 1;
            }
          } else {
            const numstatMatch = line.match(/^(\d+)\t(\d+)\t(.+)$/);
            if (numstatMatch && currentCommit) {
              const fp = numstatMatch[3].trim();
              const ins = parseInt(numstatMatch[1], 10);
              const del = parseInt(numstatMatch[2], 10);

              if (!hotFiles[fp]) {
                hotFiles[fp] = { changeCount: 0, totalInsertions: 0, totalDeletions: 0 };
              }
              hotFiles[fp].changeCount += 1;
              hotFiles[fp].totalInsertions += ins;
              hotFiles[fp].totalDeletions += del;

              contributors[currentCommit.author].insertions += ins;
              contributors[currentCommit.author].deletions += del;
            }
          }
        }

        const hotFilesList = Object.entries(hotFiles)
          .map(([path, data]) => ({ path, ...data }))
          .sort((a, b) => b.changeCount - a.changeCount)
          .slice(0, 10);

        const contributorsList = Object.entries(contributors)
          .map(([name, data]) => ({ name, ...data }))
          .sort((a, b) => b.commits - a.commits);

        return text({
          period: `最近 ${days} 天`,
          totalCommits: commits.length,
          hotFiles: hotFilesList,
          contributors: contributorsList,
          activityByDay,
          changeTypeDistribution
        });
      } catch (err) {
        return text({ error: `stats 失败: ${err.message}` });
      }
    }

    // ===== Git搜索 =====
    case 'Git搜索': {
      const query = args.query;
      const searchType = args.search_type || 'message';
      const count = args.count ?? 20;
      const cwd = args.cwd || process.cwd();
      try {
        let results = [];
        if (searchType === 'content') {
          const { stdout } = await execFileAsync('git', ['log', '-S', query, '--pretty=format:%H|%an|%ai|%s', '-n', String(count)], { cwd, maxBuffer: 10 * 1024 * 1024 });
          results = parseGitLog(stdout);
        } else {
          const { stdout } = await execFileAsync('git', ['log', '--grep', query, '--pretty=format:%H|%an|%ai|%s', '-n', String(count)], { cwd, maxBuffer: 10 * 1024 * 1024 });
          results = parseGitLog(stdout);
        }

        return text({
          query,
          searchType,
          results: results.map(r => ({
            hash: r.hash,
            author: r.author,
            date: r.date,
            subject: r.message
          })),
          totalFound: results.length
        });
      } catch (err) {
        return text({ error: `search 失败: ${err.message}` });
      }
    }

    default:
      return null; // Not a git tool
  }
}
