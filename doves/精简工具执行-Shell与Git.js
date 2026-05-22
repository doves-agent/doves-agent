/**
 * @file 精简工具执行-Shell与Git
 * @description KISS 精简工具 - Shell 命令执行 + Git 操作
 */

import { execSync } from 'child_process';
import { resolve } from 'path';
import { safePath } from './精简工具执行-文件操作.js';

// ==================== Shell 执行 ====================

export async function 执行Shell(args) {
  const timeout = (args.timeout || 60) * 1000;
  const cwd = args.cwd ? safePath(args.cwd) : process.cwd();
  try {
    const result = execSync(args.command, {
      encoding: 'utf-8',
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      // Windows 用 cmd.exe（支持 && 链接、中文路径），与 Git 命令行为一致
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
    });
    return result || '(命令执行成功，无输出)';
  } catch (e) {
    const stdout = e.stdout || '';
    const stderr = e.stderr || '';
    return `退出码: ${e.status}\n${stdout}\n${stderr}`;
  }
}

// ==================== Git 操作 ====================

function _gitCmd(repoPath, subCmd) {
  const cmd = `git ${subCmd}`;
  const cwd = repoPath ? safePath(repoPath) : process.cwd();
  try {
    return execSync(cmd, { encoding: 'utf-8', cwd, timeout: 30000, maxBuffer: 1024 * 1024 }).trim();
  } catch (e) {
    return `Git 错误: ${e.stderr || e.message}`;
  }
}

export async function git状态(args) { return _gitCmd(args.repo_path, 'status --short'); }
export async function git差异(args) {
  let cmd = 'diff';
  if (args.staged) cmd += ' --staged';
  if (args.file_path) cmd += ` -- "${args.file_path}"`;
  return _gitCmd(args.repo_path, cmd);
}
export async function git日志(args) {
  const count = args.count || 20;
  return _gitCmd(args.repo_path, `log --oneline -${count}`);
}
export async function git分支(args) {
  switch (args.action) {
    case 'create': return _gitCmd(args.repo_path, `branch "${args.name}"`);
    case 'delete': return _gitCmd(args.repo_path, `branch -d "${args.name}"`);
    default: return _gitCmd(args.repo_path, 'branch -a');
  }
}
export async function git切换(args) {
  let cmd = 'checkout';
  if (args.create_branch) cmd += ' -b';
  cmd += ` "${args.target}"`;
  return _gitCmd(args.repo_path, cmd);
}
export async function git提交(args) {
  let cmd = `commit -m "${args.message.replace(/"/g, '\\"')}"`;
  if (args.files?.length) cmd += ' -- ' + args.files.map(f => `"${f}"`).join(' ');
  return _gitCmd(args.repo_path, cmd);
}
export async function git推送(args) {
  const remote = args.remote || 'origin';
  const branch = args.branch || '';
  return _gitCmd(args.repo_path, `push ${remote} ${branch}`);
}
export async function git拉取(args) {
  const remote = args.remote || 'origin';
  const branch = args.branch || '';
  return _gitCmd(args.repo_path, `pull ${remote} ${branch}`);
}

// ==================== 测试执行 ====================

export async function 执行测试(args) {
  const cwd = args.cwd ? safePath(args.cwd) : process.cwd();
  const timeout = (args.timeout || 120) * 1000;

  let command = args.command;
  if (!command) {
    try {
      const { readFileSync, existsSync } = await import('fs');
      const { join } = await import('path');
      const pkgPath = join(cwd, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        command = pkg.scripts?.test ? 'npm test' : null;
      }
      if (!command) {
        const pytestExists = existsSync(join(cwd, 'pytest.ini')) || existsSync(join(cwd, 'pyproject.toml'));
        command = pytestExists ? 'python -m pytest --tb=short -q' : null;
      }
    } catch { /* ignore */ }
    if (!command) throw new Error('无法自动检测测试命令，请通过 command 参数指定');
  }

  let stdout = '', stderr = '', exitCode = 0;
  try {
    stdout = execSync(command, {
      encoding: 'utf-8',
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
    });
  } catch (e) {
    stdout = e.stdout || '';
    stderr = e.stderr || '';
    exitCode = e.status || 1;
  }

  const output = (stdout + '\n' + stderr).trim();
  const lines = output.split('\n');

  let passed = 0, failed = 0, total = 0;
  const failures = [];

  for (const line of lines) {
    const jestMatch = line.match(/Tests:\s+(\d+)\s+passed|(\d+)\s+failed/g);
    const mochaMatch = line.match(/(\d+)\s+passing|(\d+)\s+failing/g);
    const pytestMatch = line.match(/(\d+)\s+passed|(\d+)\s+failed/);
    const vitestMatch = line.match(/Tests\s+(\d+)\s+passed|(\d+)\s+failed/g);

    if (jestMatch || mochaMatch || vitestMatch) {
      const pMatch = line.match(/(\d+)\s+passed/);
      const fMatch = line.match(/(\d+)\s+failed/);
      if (pMatch) passed = parseInt(pMatch[1]);
      if (fMatch) failed = parseInt(fMatch[1]);
    }
    if (pytestMatch) {
      const pMatch = line.match(/(\d+)\s+passed/);
      const fMatch = line.match(/(\d+)\s+failed/);
      if (pMatch) passed = parseInt(pMatch[1]);
      if (fMatch) failed = parseInt(fMatch[1]);
    }

    if (line.match(/FAIL|✗|✕|FAILED|AssertionError|Error:/i) && line.trim().length > 5) {
      failures.push(line.trim().substring(0, 200));
    }
  }

  total = passed + failed;
  const status = exitCode === 0 ? '✅ 全部通过' : '❌ 有失败';
  const summary = total > 0
    ? `${status} | 通过: ${passed}, 失败: ${failed}, 总计: ${total}`
    : `${status} | 退出码: ${exitCode}`;

  const failDetail = failures.length > 0
    ? `\n\n失败详情 (前 10 条):\n${failures.slice(0, 10).join('\n')}`
    : '';

  const rawTail = exitCode !== 0 && total === 0
    ? `\n\n原始输出 (末尾 30 行):\n${lines.slice(-30).join('\n')}`
    : '';

  return `${summary}${failDetail}${rawTail}`;
}
