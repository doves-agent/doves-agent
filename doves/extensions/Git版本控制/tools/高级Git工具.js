/**
 * Git高级工具 - 扩展包版本
 * 提供Git全流程操作能力：push/pull/merge/rebase/reset/checkout/stash/conflict_resolve/PR
 *
 * 子模块:
 *   高级Git工具/工具定义.js  - 工具定义、分类、能力映射、安全分级
 *   高级Git工具/PR平台工具.js - GitHub/GitLab/Gitee API + PR创建/列表/审查
 *
 * 导出格式：
 * - extTools: 工具定义数组
 * - handleExtTool: 工具调用处理器
 * - extToolCategories: 工具分类
 * - extToolAbilityMap: 工具能力映射
 * - extToolSafetyLevels: 工具安全分级
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { prHandlers } from './高级Git工具/PR平台工具.js';
import { 写入记录 } from '../data/操作记录.js';
import { 获取仓库路径 } from '../data/仓库管理.js';

// 重导出工具定义
export {
  extTools,
  extToolCategories,
  extToolAbilityMap,
  extToolSafetyLevels
} from './高级Git工具/工具定义.js';

const execFileAsync = promisify(execFile);

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('高级Git工具', { 前缀: '[高级Git工具]', 级别: 'debug', 显示调用位置: true });

// ==================== 辅助函数 ====================

const RECORD_OPERATIONS = new Set([
  'git_push', 'git_pull', 'git_merge', 'git_rebase',
  'git_reset', 'git_revert', 'git_cherry_pick', 'git_commit', 'git_tag'
]);

async function 解析cwd(args) {
  if (args.cwd) return args.cwd;
  if (args.仓库) {
    const path = await 获取仓库路径(args.仓库);
    if (path) return path;
  }
  return process.cwd();
}

const text = (content) => ({
  content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }]
});

async function runGit(args, cwd = process.cwd()) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024
    });
    return { stdout: stdout || '', stderr: stderr || '' };
  } catch (error) {
    throw new Error(`git ${args.join(' ')} 失败: ${error.message}`);
  }
}

/**
 * 解析冲突标记
 */
function 解析冲突内容(content) {
  const conflicts = [];
  const lines = content.split('\n');
  let current = null;
  let section = 'common';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('<<<<<<<')) {
      current = {
        startLine: i + 1,
        ours: [],
        theirs: [],
        oursLabel: line.replace('<<<<<<<', '').trim() || 'ours',
        theirsLabel: ''
      };
      section = 'ours';
    } else if (line.startsWith('=======') && current) {
      section = 'theirs';
    } else if (line.startsWith('>>>>>>>') && current) {
      current.theirsLabel = line.replace('>>>>>>>', '').trim() || 'theirs';
      current.endLine = i + 1;
      conflicts.push({ ...current, ours: current.ours.join('\n'), theirs: current.theirs.join('\n') });
      current = null;
      section = 'common';
    } else if (current) {
      if (section === 'ours') current.ours.push(line);
      else if (section === 'theirs') current.theirs.push(line);
    }
  }

  return conflicts;
}

// ==================== 工具处理函数 ====================

export async function handleExtTool(name, args) {
  // 解析 cwd：支持通过仓库别名/ID 指定目标仓库
  const cwd = await 解析cwd(args);
  const resolvedArgs = { ...args, cwd };

  // PR相关操作委托给子模块
  if (['git_pr_create', 'git_pr_list', 'git_pr_review'].includes(name)) {
    return await prHandlers(name, resolvedArgs);
  }

  const result = await _executeGitTool(name, resolvedArgs);

  // 关键操作写入记录
  if (result && RECORD_OPERATIONS.has(name)) {
    try {
      const parsed = JSON.parse(result.content?.[0]?.text || '{}');
      await 写入记录({
        仓库别名: args.仓库 || '',
        操作类型: name.replace('git_', ''),
        参数: args,
        结果: { success: parsed.success, error: parsed.error },
        分支: args.branch || '',
      });
    } catch (e) {
      logger.warn(`操作记录写入失败（不影响执行）: ${e.message}`);
    }
  }

  return result;
}

async function _executeGitTool(name, args) {
  switch (name) {

    // ===== 仓库管理 =====
    case 'git_repo_add': {
      const { 地址, 别名, 本地路径, 默认分支, 认证方式 } = args;
      try {
        const { 添加仓库, 按别名查找 } = await import('../data/仓库管理.js');
        const existing = await 按别名查找(别名);
        if (existing) {
          return text({ error: `别名 "${别名}" 已存在，请使用其他名称`, success: false });
        }

        const 类型 = (地址.startsWith('/') || /^[a-zA-Z]:/.test(地址)) ? 'local' : 'remote';
        let 实际本地路径 = 本地路径;

        if (类型 === 'remote' && 本地路径) {
          await runGit(['clone', 地址, 本地路径]);
          logger.info(`仓库已克隆: ${地址} → ${本地路径}`);
        } else if (类型 === 'local') {
          实际本地路径 = 地址;
          await runGit(['status'], 地址);
        }

        const result = await 添加仓库({
          地址, 别名, 类型,
          本地路径: 实际本地路径,
          默认分支: 默认分支 || 'main',
          认证: { 方式: 认证方式 || 'none' },
        });

        return text({
          action: 'repo_add', 别名, 地址, 类型,
          本地路径: 实际本地路径,
          id: result.insertedId,
          success: true
        });
      } catch (e) {
        return text({ action: 'repo_add', error: e.message, success: false });
      }
    }

    case 'git_repo_list': {
      try {
        const { 查询仓库列表 } = await import('../data/仓库管理.js');
        const 状态 = args.状态 === 'all' ? null : (args.状态 || 'active');
        const repos = await 查询仓库列表({ 状态 });
        return text({
          action: 'repo_list',
          repos: repos.map(r => ({
            id: r._id, 别名: r.别名, 地址: r.地址, 类型: r.类型,
            本地路径: r.本地路径, 默认分支: r.默认分支, 状态: r.状态,
            最后访问: r.最后访问时间,
          })),
          total: repos.length,
          success: true
        });
      } catch (e) {
        return text({ action: 'repo_list', error: e.message, success: false });
      }
    }

    case 'git_repo_remove': {
      try {
        const { 按别名查找, 按ID查找, 删除仓库 } = await import('../data/仓库管理.js');
        const repo = await 按别名查找(args.仓库) || await 按ID查找(args.仓库);
        if (!repo) {
          return text({ error: `未找到仓库: ${args.仓库}`, success: false });
        }
        await 删除仓库(repo._id);
        return text({ action: 'repo_remove', 别名: repo.别名, success: true });
      } catch (e) {
        return text({ action: 'repo_remove', error: e.message, success: false });
      }
    }

    case 'git_repo_switch': {
      try {
        const { 按别名查找, 按ID查找, 记录访问 } = await import('../data/仓库管理.js');
        const repo = await 按别名查找(args.仓库) || await 按ID查找(args.仓库);
        if (!repo) {
          return text({ error: `未找到仓库: ${args.仓库}`, success: false });
        }
        await 记录访问(repo._id);
        return text({
          action: 'repo_switch', 别名: repo.别名,
          本地路径: repo.本地路径, success: true,
          message: `已切换到仓库 "${repo.别名}"，后续操作将使用该仓库`
        });
      } catch (e) {
        return text({ action: 'repo_switch', error: e.message, success: false });
      }
    }

    case 'git_history': {
      try {
        const { 查询记录 } = await import('../data/操作记录.js');
        const { 按别名查找 } = await import('../data/仓库管理.js');
        let 仓库ID = null;
        if (args.仓库) {
          const repo = await 按别名查找(args.仓库);
          if (repo) 仓库ID = repo._id;
        }
        const records = await 查询记录({
          仓库ID,
          操作类型: args.操作类型,
          limit: args.limit || 20,
        });
        return text({
          action: 'history',
          records: records.map(r => ({
            操作类型: r.操作类型, 时间: r.时间,
            仓库别名: r.仓库别名, 分支: r.分支,
            成功: r.结果?.success, 错误: r.结果?.error,
          })),
          total: records.length,
          success: true
        });
      } catch (e) {
        return text({ action: 'history', error: e.message, success: false });
      }
    }

    // ===== git_push =====
    case 'git_push': {
      const { remote = 'origin', branch, force = false, cwd } = args;
      try {
        const pushArgs = ['push', remote, branch];
        if (force) pushArgs.splice(1, 0, '--force');
        const { stdout, stderr } = await runGit(pushArgs, cwd);
        logger.info(`push完成: ${remote}/${branch} ${force ? '(force)' : ''}`);
        return text({
          action: 'push', remote, branch, force,
          stdout: stdout.trim(), stderr: stderr.trim(),
          success: true
        });
      } catch (e) {
        return text({ action: 'push', error: e.message, success: false });
      }
    }

    // ===== git_pull =====
    case 'git_pull': {
      const { remote = 'origin', branch, rebase = false, cwd } = args;
      try {
        const pullArgs = ['pull', remote];
        if (branch) pullArgs.push(branch);
        if (rebase) pullArgs.push('--rebase');
        const { stdout, stderr } = await runGit(pullArgs, cwd);
        return text({
          action: 'pull', remote, branch, rebase,
          stdout: stdout.trim(), stderr: stderr.trim(),
          success: true
        });
      } catch (e) {
        return text({ action: 'pull', error: e.message, success: false });
      }
    }

    // ===== git_fetch =====
    case 'git_fetch': {
      const { remote = 'origin', prune = false, cwd } = args;
      try {
        const fetchArgs = ['fetch', remote];
        if (prune) fetchArgs.push('--prune');
        const { stdout, stderr } = await runGit(fetchArgs, cwd);
        return text({
          action: 'fetch', remote, prune,
          stdout: stdout.trim(), stderr: stderr.trim(),
          success: true
        });
      } catch (e) {
        return text({ action: 'fetch', error: e.message, success: false });
      }
    }

    // ===== git_merge =====
    case 'git_merge': {
      const { branch, no_ff = false, message, cwd } = args;
      try {
        const mergeArgs = ['merge', branch];
        if (no_ff) mergeArgs.push('--no-ff');
        if (message) mergeArgs.push('-m', message);
        const { stdout, stderr } = await runGit(mergeArgs, cwd);
        logger.info(`merge完成: ${branch}`);
        return text({
          action: 'merge', branch, no_ff, message,
          stdout: stdout.trim(), stderr: stderr.trim(),
          success: true
        });
      } catch (e) {
        return text({ action: 'merge', branch, error: e.message, success: false });
      }
    }

    // ===== git_rebase =====
    case 'git_rebase': {
      const { branch, onto, cwd } = args;
      try {
        const rebaseArgs = ['rebase', branch];
        if (onto) { rebaseArgs.push('--onto', onto); }
        const { stdout, stderr } = await runGit(rebaseArgs, cwd);
        logger.info(`rebase完成: onto ${branch}`);
        return text({
          action: 'rebase', branch, onto,
          stdout: stdout.trim(), stderr: stderr.trim(),
          success: true
        });
      } catch (e) {
        return text({ action: 'rebase', branch, error: e.message, success: false });
      }
    }

    // ===== git_reset =====
    case 'git_reset': {
      const { ref, mode = 'mixed', cwd } = args;
      try {
        const resetArgs = ['reset', `--${mode}`, ref];
        const { stdout, stderr } = await runGit(resetArgs, cwd);
        logger.info(`reset完成: ${mode} ${ref}`);
        return text({
          action: 'reset', ref, mode,
          stdout: stdout.trim(), stderr: stderr.trim(),
          success: true
        });
      } catch (e) {
        return text({ action: 'reset', ref, mode, error: e.message, success: false });
      }
    }

    // ===== git_checkout =====
    case 'git_checkout': {
      const { branch, create = false, cwd } = args;
      try {
        const checkoutArgs = ['checkout'];
        if (create) checkoutArgs.push('-b');
        checkoutArgs.push(branch);
        const { stdout, stderr } = await runGit(checkoutArgs, cwd);
        return text({
          action: 'checkout', branch, created: create,
          stdout: stdout.trim(), stderr: stderr.trim(),
          success: true
        });
      } catch (e) {
        return text({ action: 'checkout', branch, error: e.message, success: false });
      }
    }

    // ===== git_stash =====
    case 'git_stash': {
      const { action: stashAction, message, index = 0, cwd } = args;
      try {
        let stashArgs;
        switch (stashAction) {
          case 'save':
            stashArgs = ['stash', 'save'];
            if (message) stashArgs.push(message);
            break;
          case 'pop':
            stashArgs = ['stash', 'pop', `stash@{${index}}`];
            break;
          case 'apply':
            stashArgs = ['stash', 'apply', `stash@{${index}}`];
            break;
          case 'drop':
            stashArgs = ['stash', 'drop', `stash@{${index}}`];
            break;
          case 'list':
            stashArgs = ['stash', 'list'];
            break;
          default:
            return text({ error: `未知的stash操作: ${stashAction}` });
        }
        const { stdout, stderr } = await runGit(stashArgs, cwd);
        return text({
          action: 'stash', stashAction,
          stdout: stdout.trim(), stderr: stderr.trim(),
          success: true
        });
      } catch (e) {
        return text({ action: 'stash', stashAction, error: e.message, success: false });
      }
    }

    // ===== git_conflict_resolve =====
    case 'git_conflict_resolve': {
      const { path: filePath, cwd } = args;
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const conflicts = 解析冲突内容(content);

        if (conflicts.length === 0) {
          return text({ message: '文件中没有发现冲突标记', path: filePath });
        }

        return text({
          action: 'conflict_resolve',
          path: filePath,
          conflictCount: conflicts.length,
          conflicts: conflicts.map(c => ({
            startLine: c.startLine,
            endLine: c.endLine,
            oursLabel: c.oursLabel,
            theirsLabel: c.theirsLabel,
            ours: c.ours,
            theirs: c.theirs
          })),
          hint: '请分析双方的修改意图，选择保留/融合/选择一方的方案，然后使用 code_edit 写入解决方案'
        });
      } catch (e) {
        return text({ action: 'conflict_resolve', error: e.message, path: filePath });
      }
    }

    // ===== git_cherry_pick =====
    case 'git_cherry_pick': {
      const { refs, noCommit = false, cwd } = args;
      if (!Array.isArray(refs) || refs.length === 0) {
        return text({ error: 'refs参数必须是非空数组' });
      }
      try {
        const cpArgs = ['cherry-pick'];
        if (noCommit) cpArgs.push('--no-commit');
        cpArgs.push(...refs);
        const { stdout, stderr } = await runGit(cpArgs, cwd);
        logger.info(`cherry-pick完成: ${refs.join(', ')}`);
        return text({
          action: 'cherry_pick', refs, noCommit,
          stdout: stdout.trim(), stderr: stderr.trim(),
          success: true
        });
      } catch (e) {
        const isConflict = e.message.includes('conflict') || e.message.includes('CONFLICT');
        return text({
          action: 'cherry_pick', refs, error: e.message,
          conflict: isConflict,
          hint: isConflict ? 'Cherry-pick产生冲突，请使用 git_conflict_resolve 或 conflict_resolver 技能解决' : undefined,
          success: false
        });
      }
    }

    // ===== git_tag =====
    case 'git_tag': {
      const { action: tagAction, name, ref = 'HEAD', annotate = false, message: tagMsg, pattern, cwd } = args;
      try {
        switch (tagAction) {
          case 'create': {
            if (!name) return text({ error: '创建标签需要name参数' });
            const tagArgs = ['tag'];
            if (annotate) {
              tagArgs.push('-a', name, '-m', tagMsg || `Release ${name}`);
            } else {
              tagArgs.push(name);
            }
            tagArgs.push(ref);
            const { stdout, stderr } = await runGit(tagArgs, cwd);
            logger.info(`标签已创建: ${name} @ ${ref}`);
            return text({ action: 'tag_create', name, ref, annotated: annotate, stdout: stdout.trim(), stderr: stderr.trim(), success: true });
          }
          case 'list': {
            const listArgs = ['tag'];
            if (pattern) listArgs.push('-l', pattern);
            const { stdout } = await runGit(listArgs, cwd);
            const tags = stdout.trim().split('\n').filter(t => t.trim());
            return text({ action: 'tag_list', tags, total: tags.length, pattern: pattern || null, success: true });
          }
          case 'delete': {
            if (!name) return text({ error: '删除标签需要name参数' });
            const { stdout, stderr } = await runGit(['tag', '-d', name], cwd);
            return text({ action: 'tag_delete', name, stdout: stdout.trim(), stderr: stderr.trim(), success: true });
          }
          case 'show': {
            if (!name) return text({ error: '查看标签需要name参数' });
            const { stdout } = await runGit(['show', name], cwd);
            return text({ action: 'tag_show', name, detail: stdout.trim(), success: true });
          }
          default:
            return text({ error: `未知的tag操作: ${tagAction}` });
        }
      } catch (e) {
        return text({ action: 'tag', error: e.message, success: false });
      }
    }

    // ===== git_bisect =====
    case 'git_bisect': {
      const { action: bisectAction, goodRef, badRef, script, cwd } = args;
      try {
        switch (bisectAction) {
          case 'start': {
            const startArgs = ['bisect', 'start'];
            if (badRef) startArgs.push(badRef);
            if (goodRef) startArgs.push(goodRef);
            const { stdout, stderr } = await runGit(startArgs, cwd);
            return text({ action: 'bisect_start', goodRef, badRef, stdout: stdout.trim(), stderr: stderr.trim(), success: true });
          }
          case 'good': {
            const { stdout, stderr } = await runGit(['bisect', 'good', goodRef].filter(Boolean), cwd);
            return text({ action: 'bisect_good', ref: goodRef, stdout: stdout.trim(), stderr: stderr.trim(), success: true });
          }
          case 'bad': {
            const { stdout, stderr } = await runGit(['bisect', 'bad', badRef].filter(Boolean), cwd);
            return text({ action: 'bisect_bad', ref: badRef, stdout: stdout.trim(), stderr: stderr.trim(), success: true });
          }
          case 'skip': {
            const { stdout, stderr } = await runGit(['bisect', 'skip'], cwd);
            return text({ action: 'bisect_skip', stdout: stdout.trim(), stderr: stderr.trim(), success: true });
          }
          case 'reset': {
            const { stdout, stderr } = await runGit(['bisect', 'reset'], cwd);
            return text({ action: 'bisect_reset', stdout: stdout.trim(), stderr: stderr.trim(), success: true });
          }
          case 'log': {
            const { stdout } = await runGit(['bisect', 'log'], cwd);
            return text({ action: 'bisect_log', log: stdout.trim(), success: true });
          }
          case 'run': {
            if (!script) return text({ error: 'run模式需要script参数' });
            const { stdout, stderr } = await runGit(['bisect', 'run', script], cwd);
            return text({ action: 'bisect_run', script, stdout: stdout.trim(), stderr: stderr.trim(), success: true });
          }
          default:
            return text({ error: `未知的bisect操作: ${bisectAction}` });
        }
      } catch (e) {
        return text({ action: 'bisect', error: e.message, success: false });
      }
    }

    // ===== git_worktree =====
    case 'git_worktree': {
      const { action: wtAction, path: wtPath, branch: wtBranch, force = false, cwd } = args;
      try {
        switch (wtAction) {
          case 'add': {
            if (!wtPath) return text({ error: 'add操作需要path参数' });
            const addArgs = ['worktree', 'add'];
            if (force) addArgs.push('--force');
            if (wtBranch) { addArgs.push('-b', wtBranch); }
            addArgs.push(wtPath);
            const { stdout, stderr } = await runGit(addArgs, cwd);
            return text({ action: 'worktree_add', path: wtPath, branch: wtBranch, stdout: stdout.trim(), stderr: stderr.trim(), success: true });
          }
          case 'list': {
            const { stdout } = await runGit(['worktree', 'list', '--porcelain'], cwd);
            const entries = stdout.trim().split('\n\n').filter(Boolean).map(block => {
              const map = {};
              for (const line of block.split('\n')) {
                const [key, ...rest] = line.split(' ');
                map[key] = rest.join(' ');
              }
              return map;
            });
            return text({ action: 'worktree_list', worktrees: entries, total: entries.length, success: true });
          }
          case 'remove': {
            if (!wtPath) return text({ error: 'remove操作需要path参数' });
            const rmArgs = ['worktree', 'remove'];
            if (force) rmArgs.push('--force');
            rmArgs.push(wtPath);
            const { stdout, stderr } = await runGit(rmArgs, cwd);
            return text({ action: 'worktree_remove', path: wtPath, stdout: stdout.trim(), stderr: stderr.trim(), success: true });
          }
          case 'prune': {
            const { stdout, stderr } = await runGit(['worktree', 'prune'], cwd);
            return text({ action: 'worktree_prune', stdout: stdout.trim(), stderr: stderr.trim(), success: true });
          }
          default:
            return text({ error: `未知的worktree操作: ${wtAction}` });
        }
      } catch (e) {
        return text({ action: 'worktree', error: e.message, success: false });
      }
    }

    // ===== git_reflog =====
    case 'git_reflog': {
      const { action: reflogAction, count = 20, ref = 'HEAD', expire, index, cwd } = args;
      try {
        switch (reflogAction) {
          case 'show': {
            const showArgs = ['reflog', `--max-count=${count}`, ref];
            const { stdout } = await runGit(showArgs, cwd);
            const entries = stdout.trim().split('\n').filter(l => l.trim()).map(line => {
              const match = line.match(/^([a-f0-9]+)\s+(.+?)\s+(.+)$/);
              return match
                ? { hash: match[1], action: match[2].trim(), detail: match[3].trim() }
                : { raw: line.trim() };
            });
            return text({ action: 'reflog_show', ref, entries, total: entries.length, success: true });
          }
          case 'expire': {
            const expireArgs = ['reflog', 'expire'];
            if (expire) expireArgs.push(`--expire=${expire}`);
            else expireArgs.push('--expire=now');
            expireArgs.push('--all');
            const { stdout, stderr } = await runGit(expireArgs, cwd);
            return text({ action: 'reflog_expire', expire: expire || 'now', stdout: stdout.trim(), stderr: stderr.trim(), success: true });
          }
          case 'delete': {
            if (index === undefined) return text({ error: 'delete操作需要index参数' });
            const { stdout, stderr } = await runGit(['reflog', 'delete', `HEAD@{${index}}`], cwd);
            return text({ action: 'reflog_delete', index, stdout: stdout.trim(), stderr: stderr.trim(), success: true });
          }
          default:
            return text({ error: `未知的reflog操作: ${reflogAction}` });
        }
      } catch (e) {
        return text({ action: 'reflog', error: e.message, success: false });
      }
    }

    // ===== git_revert =====
    case 'git_revert': {
      const { refs, noCommit = false, noEdit = true, cwd } = args;
      if (!Array.isArray(refs) || refs.length === 0) {
        return text({ error: 'refs参数必须是非空数组' });
      }
      try {
        const revertArgs = ['revert'];
        if (noCommit) revertArgs.push('--no-commit');
        if (noEdit) revertArgs.push('--no-edit');
        revertArgs.push(...refs);
        const { stdout, stderr } = await runGit(revertArgs, cwd);
        logger.info(`revert完成: ${refs.join(', ')}`);
        return text({
          action: 'revert', refs, noCommit, noEdit,
          stdout: stdout.trim(), stderr: stderr.trim(),
          success: true
        });
      } catch (e) {
        const isConflict = e.message.includes('conflict') || e.message.includes('CONFLICT');
        return text({
          action: 'revert', refs, error: e.message,
          conflict: isConflict,
          hint: isConflict ? 'Revert产生冲突，请使用 git_conflict_resolve 或 conflict_resolver 技能解决' : undefined,
          success: false
        });
      }
    }

    // ===== git_commit =====
    case 'git_commit': {
      const { files, message, type, scope, breaking = false, amend = false, allowEmpty = false, cwd } = args;
      try {
        if (files && Array.isArray(files) && files.length > 0) {
          await runGit(['add', ...files], cwd);
        } else if (files === undefined || (Array.isArray(files) && files.length === 0)) {
          await runGit(['add', '-A'], cwd);
        }

        let commitMsg = message;
        if (type) {
          commitMsg = scope ? `${type}(${scope})` : type;
          commitMsg += breaking ? '!' : '';
          commitMsg += `: ${message}`;
        }
        if (breaking && !type) {
          commitMsg += '\n\nBREAKING CHANGE: 此提交包含破坏性变更';
        }

        const commitArgs = ['commit', '-m', commitMsg];
        if (amend) commitArgs.push('--amend', '--no-edit');
        if (allowEmpty) commitArgs.push('--allow-empty');
        commitArgs.push('--no-gpg-sign');

        const { stdout, stderr } = await runGit(commitArgs, cwd);
        logger.info(`提交完成: ${commitMsg}`);

        return text({
          action: 'commit',
          message: commitMsg,
          type: type || null,
          scope: scope || null,
          breaking,
          amend,
          filesStaged: files ? (files.length > 0 ? files : 'all') : 'all',
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          success: true
        });
      } catch (e) {
        return text({ action: 'commit', error: e.message, success: false });
      }
    }

    default:
      return null;
  }
}
