import { execFile } from 'child_process';
import { mkdir, access, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

export const logger = 创建日志器('Git存储', { 前缀: '[Git存储]' });

const 默认仓库根路径 = join(__dirname, '..', 'data', 'repos');
const 默认工作树根路径 = join(__dirname, '..', 'data', 'worktrees');

let 仓库根路径 = process.env.GIT_REPOS_PATH || 默认仓库根路径;
let 工作树根路径 = process.env.GIT_WORKTREES_PATH || 默认工作树根路径;

const 记忆分支列表 = ['技能记忆', '对话记忆', '经验记忆', '用户画像', '事件触发'];

export function 获取仓库路径(用户ID, 仓库类型) {
  return join(仓库根路径, 用户ID, `${仓库类型}.git`);
}

export function 获取工作树路径(用户ID, 仓库类型) {
  return join(工作树根路径, 用户ID, 仓库类型);
}

async function 路径存在(路径) {
  try { await access(路径); return true; } catch { return false; }
}

export async function 执行git(工作目录, ...参数) {
  try {
    const { stdout, stderr } = await execFileAsync('git', 参数, {
      cwd: 工作目录,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    return { 成功: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    return { 成功: false, 错误: err.stderr?.trim() || err.message, code: err.code };
  }
}

async function 初始化bare仓库(仓库路径) {
  await mkdir(仓库路径, { recursive: true });
  const result = await 执行git(仓库路径, 'init', '--bare');
  if (!result.成功) throw new Error(`初始化bare仓库失败: ${result.错误}`);
  return result;
}

async function 创建工作树(仓库路径, 工作树路径, 分支名) {
  await mkdir(dirname(工作树路径), { recursive: true });

  const 分支存在 = await 执行git(仓库路径, 'branch', '--list', 分支名);
  if (!分支存在.stdout) {
    // 创建orphan分支：先创建worktree再初始化
    const result = await 执行git(仓库路径, 'worktree', 'add', '--orphan', '-b', 分支名, 工作树路径);
    if (!result.成功) throw new Error(`创建工作树失败(${分支名}): ${result.错误}`);
  } else {
    if (await 路径存在(工作树路径)) return;
    const result = await 执行git(仓库路径, 'worktree', 'add', 工作树路径, 分支名);
    if (!result.成功) throw new Error(`创建工作树失败(${分支名}): ${result.错误}`);
  }
}

export async function 确保用户记忆仓库(用户ID) {
  const 仓库路径 = 获取仓库路径(用户ID, 'memory');

  if (!await 路径存在(仓库路径)) {
    await 初始化bare仓库(仓库路径);
    logger.info(`已创建记忆仓库: ${用户ID}`);
  }

  for (const 分支 of 记忆分支列表) {
    const 树路径 = join(获取工作树路径(用户ID, 'memory'), 分支);
    if (!await 路径存在(树路径)) {
      await 创建工作树(仓库路径, 树路径, 分支);
    }
  }

  return 仓库路径;
}

export async function 确保用户数据仓库(用户ID) {
  const 仓库路径 = 获取仓库路径(用户ID, 'data');

  if (!await 路径存在(仓库路径)) {
    await 初始化bare仓库(仓库路径);
    logger.info(`已创建数据仓库: ${用户ID}`);
  }

  const 树路径 = 获取工作树路径(用户ID, 'data');
  if (!await 路径存在(树路径)) {
    await 创建工作树(仓库路径, 树路径, 'main');
  }

  return 仓库路径;
}

export async function 确保用户仓库(用户ID) {
  await 确保用户记忆仓库(用户ID);
  await 确保用户数据仓库(用户ID);
}

export async function 提交变更(工作树路径, 消息) {
  await 执行git(工作树路径, 'add', '-A');
  const status = await 执行git(工作树路径, 'status', '--porcelain');
  if (!status.stdout) return { 成功: true, 无变更: true };
  const result = await 执行git(工作树路径, 'commit', '-m', 消息);
  if (!result.成功) throw new Error(`提交失败: ${result.错误}`);
  return { 成功: true, stdout: result.stdout };
}

export async function 获取文件历史(工作树路径, 文件路径, 数量 = 20) {
  const result = await 执行git(工作树路径, 'log', `--max-count=${数量}`, '--format=%H|%ai|%s', '--', 文件路径);
  if (!result.成功) return [];
  return result.stdout.split('\n').filter(Boolean).map(行 => {
    const [hash, 时间, ...消息部分] = 行.split('|');
    return { hash, 时间, 消息: 消息部分.join('|') };
  });
}

export async function GC(仓库路径) {
  return await 执行git(仓库路径, 'gc', '--auto');
}

export async function 初始化存储系统() {
  await mkdir(仓库根路径, { recursive: true });
  await mkdir(工作树根路径, { recursive: true });
  logger.info(`Git存储系统已初始化 — 仓库: ${仓库根路径}`);
}

export async function 列出所有用户() {
  if (!await 路径存在(仓库根路径)) return [];
  return await readdir(仓库根路径);
}
