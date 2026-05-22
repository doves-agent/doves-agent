/**
 * 仓库管理技能
 * 提供仓库的添加(含clone)、列表、切换、删除、状态查看
 * 所有配置通过 ctx.db 持久化，跨设备同步
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import {
  添加仓库, 查询仓库列表, 按别名查找, 按ID查找,
  更新仓库, 删除仓库, 获取仓库路径, 记录访问,
} from '../../data/仓库管理.js';
import { 写入记录 } from '../../data/操作记录.js';
import { 记录偏好, 查询偏好 } from '../../data/记忆.js';

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('仓库管理', { 前缀: '[仓库管理]', 级别: 'debug', 显示调用位置: true });
const execFileAsync = promisify(execFile);

const DEFAULT_REPOS_DIR = join(homedir(), '.dove', 'repos');

async function runGit(args, cwd) {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout: stdout || '', stderr: stderr || '' };
}

async function 确保目录存在(dir) {
  const { mkdir } = await import('fs/promises');
  await mkdir(dir, { recursive: true });
}

async function 是否Git仓库(path) {
  try {
    await runGit(['rev-parse', '--is-inside-work-tree'], path);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Actions
// ============================================================================

async function action添加(args) {
  const { 地址, 别名, 本地路径, 认证, 默认分支 } = args;

  if (!地址) return { 成功: false, 错误: '缺少必填参数: 地址（远程URL或本地路径）' };
  if (!别名) return { 成功: false, 错误: '缺少必填参数: 别名' };

  const existing = await 按别名查找(别名);
  if (existing) return { 成功: false, 错误: `别名 "${别名}" 已被使用` };

  const isLocal = 地址.startsWith('/') || /^[a-zA-Z]:/.test(地址);

  if (isLocal) {
    try {
      const s = await stat(地址);
      if (!s.isDirectory()) return { 成功: false, 错误: `路径不是目录: ${地址}` };
    } catch {
      return { 成功: false, 错误: `路径不存在: ${地址}` };
    }
    if (!await 是否Git仓库(地址)) {
      return { 成功: false, 错误: `路径不是Git仓库: ${地址}` };
    }

    const result = await 添加仓库({
      地址,
      别名,
      类型: 'local',
      本地路径: 地址,
      默认分支: 默认分支 || 'main',
      认证: 认证 || { 方式: 'none' },
    });

    logger.info(`本地仓库已添加: ${别名} → ${地址}`);
    return { 成功: true, 数据: { id: result.insertedId, 别名, 类型: 'local', 本地路径: 地址 } };
  }

  // 远程仓库 → clone
  const cloneTo = 本地路径 || join(DEFAULT_REPOS_DIR, 别名);
  await 确保目录存在(DEFAULT_REPOS_DIR);

  logger.info(`开始克隆: ${地址} → ${cloneTo}`);
  try {
    const cloneArgs = ['clone', 地址, cloneTo];
    if (默认分支) cloneArgs.push('--branch', 默认分支);
    await execFileAsync('git', cloneArgs, { encoding: 'utf-8', timeout: 300000 });
  } catch (e) {
    return { 成功: false, 错误: `克隆失败: ${e.message}` };
  }

  const result = await 添加仓库({
    地址,
    别名,
    类型: 'remote',
    本地路径: cloneTo,
    默认分支: 默认分支 || 'main',
    认证: 认证 || { 方式: 'none' },
  });

  await 写入记录({
    仓库ID: result.insertedId,
    仓库别名: 别名,
    操作类型: 'clone',
    参数: { 地址, 本地路径: cloneTo },
    结果: { success: true },
  });

  logger.info(`远程仓库已克隆并添加: ${别名}`);
  return { 成功: true, 数据: { id: result.insertedId, 别名, 类型: 'remote', 本地路径: cloneTo } };
}

async function action列表(args) {
  const { 状态 = 'active', limit = 50 } = args;
  const repos = await 查询仓库列表({ 状态, limit });

  const list = repos.map(r => ({
    id: r._id,
    别名: r.别名,
    地址: r.地址,
    类型: r.类型,
    本地路径: r.本地路径,
    默认分支: r.默认分支,
    最后访问: r.最后访问时间,
    状态: r.状态,
  }));

  return { 成功: true, 数据: { 仓库数: list.length, 仓库列表: list } };
}

async function action状态(args) {
  const { 仓库: 仓库标识 } = args;
  const path = await 获取仓库路径(仓库标识);
  if (!path) return { 成功: false, 错误: `未找到仓库: ${仓库标识 || '(无活跃仓库)'}` };

  try {
    const [branchResult, statusResult, remoteResult, logResult] = await Promise.all([
      runGit(['branch', '--show-current'], path),
      runGit(['status', '--porcelain'], path),
      runGit(['remote', '-v'], path),
      runGit(['log', '--oneline', '-5'], path),
    ]);

    const changes = statusResult.stdout.trim().split('\n').filter(l => l.trim());

    return {
      成功: true,
      数据: {
        本地路径: path,
        当前分支: branchResult.stdout.trim(),
        工作区变更数: changes.length,
        变更列表: changes.slice(0, 20),
        远程: remoteResult.stdout.trim(),
        最近提交: logResult.stdout.trim().split('\n'),
      },
    };
  } catch (e) {
    return { 成功: false, 错误: e.message };
  }
}

async function action删除(args) {
  const { 仓库: 仓库标识 } = args;
  if (!仓库标识) return { 成功: false, 错误: '缺少参数: 仓库（别名或ID）' };

  const repo = await 按别名查找(仓库标识) || await 按ID查找(仓库标识);
  if (!repo) return { 成功: false, 错误: `未找到仓库: ${仓库标识}` };

  await 删除仓库(repo._id);
  logger.info(`仓库已归档: ${repo.别名}`);
  return { 成功: true, 数据: { 别名: repo.别名, 操作: '已归档（软删除）' } };
}

async function action同步(args) {
  const { 仓库: 仓库标识 } = args;
  const path = await 获取仓库路径(仓库标识);
  if (!path) return { 成功: false, 错误: `未找到仓库: ${仓库标识 || '(无活跃仓库)'}` };

  try {
    const { stdout, stderr } = await runGit(['pull', '--rebase'], path);
    const repo = await 按别名查找(仓库标识);
    if (repo) {
      await 更新仓库(repo._id, { 最后同步时间: new Date() });
      await 写入记录({
        仓库ID: repo._id,
        仓库别名: repo.别名,
        操作类型: 'pull',
        参数: { rebase: true },
        结果: { success: true, stdout: stdout.trim() },
      });
    }
    return { 成功: true, 数据: { stdout: stdout.trim(), stderr: stderr.trim() } };
  } catch (e) {
    return { 成功: false, 错误: e.message };
  }
}

async function action设置偏好(args) {
  const { 仓库: 仓库标识, 偏好类型, 内容 } = args;
  if (!偏好类型 || !内容) return { 成功: false, 错误: '缺少参数: 偏好类型 和 内容' };

  await 记录偏好({
    仓库: 仓库标识 || '全局',
    类别: 偏好类型,
    内容,
  });

  return { 成功: true, 数据: { 偏好类型, 已保存: true } };
}

async function action查询偏好fn(args) {
  const { 查询 } = args;
  if (!查询) return { 成功: false, 错误: '缺少参数: 查询' };

  const results = await 查询偏好(查询);
  return { 成功: true, 数据: { 结果: results } };
}

// ============================================================================
// 主执行函数
// ============================================================================

async function execute(args) {
  const { action } = args;
  if (!action) return { 成功: false, 错误: '缺少必填参数: action' };

  switch (action) {
    case 'add':       return await action添加(args);
    case 'list':      return await action列表(args);
    case 'status':    return await action状态(args);
    case 'remove':    return await action删除(args);
    case 'sync':      return await action同步(args);
    case 'set_preference': return await action设置偏好(args);
    case 'get_preference': return await action查询偏好fn(args);
    default:
      return { 成功: false, 错误: `未知操作: ${action}` };
  }
}

export default {
  name: '仓库管理',
  description: '管理Git仓库配置 — 添加(本地/远程+clone)、列表、状态查看、同步拉取、偏好记忆',

  abilities: ['Git', '版本控制', '仓库管理'],

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'list', 'status', 'remove', 'sync', 'set_preference', 'get_preference'],
        description: '操作类型：add=添加仓库, list=列出仓库, status=查看状态, remove=删除, sync=同步拉取, set_preference=设置偏好, get_preference=查询偏好',
      },
      地址: {
        type: 'string',
        description: '仓库地址（远程URL如 https://github.com/x/y.git 或本地路径如 /path/to/repo）',
      },
      别名: {
        type: 'string',
        description: '仓库别名（用户友好名称，后续操作可用别名指代）',
      },
      仓库: {
        type: 'string',
        description: '目标仓库的别名或ID',
      },
      本地路径: {
        type: 'string',
        description: '远程仓库克隆到的本地路径（可选，默认 ~/.dove/repos/{别名}）',
      },
      默认分支: {
        type: 'string',
        description: '默认分支名（可选，默认 main）',
      },
      认证: {
        type: 'object',
        description: '认证配置 { 方式: "ssh"|"token"|"none", token引用?: string }',
      },
      偏好类型: {
        type: 'string',
        description: '偏好类别（如 merge策略、commit风格、分支命名）',
      },
      内容: {
        type: 'string',
        description: '偏好内容（自然语言描述）',
      },
      查询: {
        type: 'string',
        description: '查询偏好时的语义搜索关键词',
      },
      状态: {
        type: 'string',
        enum: ['active', 'archived'],
        description: '仓库状态过滤（list 操作用）',
      },
      limit: { type: 'number', description: '返回数量限制' },
    },
    required: ['action'],
  },

  execute,
};
