/**
 * @file 精简工具执行-扩展交互
 * @description KISS 精简工具 - CLI 协作、通知用户、能力发现、工具组加载、子任务委派、长期记忆、文件快照
 */

import { existsSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { 创建日志器 } from '@dove/common/日志管理器.js';
import { 获取或生成机器标识 } from '@dove/common/机器标识.js';
import { Git记忆适配器 } from './tools/存储接口/Git记忆适配器.js';
import { Git数据适配器 } from './tools/存储接口/Git数据适配器.js';

const logger = 创建日志器('扩展交互', { 前缀: '[Skill]', 级别: 'debug' });

// 懒加载适配器实例
let _记忆适配器 = null;
let _存储适配器 = null;
export function 获取记忆适配器() {
  if (!_记忆适配器) _记忆适配器 = new Git记忆适配器();
  return _记忆适配器;
}
export function 获取存储适配器() {
  if (!_存储适配器) _存储适配器 = new Git数据适配器();
  return _存储适配器;
}

// ==================== 文件上传（请求 CLI 上传） ====================

export async function 请求上传(args) {
  const files = args.files || [args.file_path];
  if (!files || !files.length) return '错误: 缺少 files 参数';
  if (files.length > 3) return '错误: 每次最多上传 3 个文件';
  return `__RESPOND__${JSON.stringify({ type: 'need_upload', files })}`;
}

// ==================== CLI 协作 ====================

const CLI_CAPABILITIES = new Set([
  'cli_file_upload',
  'cli_file_download',
  'cli_file_read',
  'cli_local_path_check',
]);

export async function cli协作(args, 上下文) {
  const { DovesProxy, 根任务ID } = 上下文;
  if (!DovesProxy) return '错误: DovesProxy 未初始化，无法请求 CLI 操作';
  if (!根任务ID) return '错误: 缺少根任务ID，无法请求 CLI 操作';

  if (!CLI_CAPABILITIES.has(args.capability)) {
    return `错误: CLI 不支持能力 "${args.capability}"。支持的能力: ${[...CLI_CAPABILITIES].join(', ')}`;
  }

  // ★ 同机检测：与 CLI 在同一台机器时，文件操作无需通过 CLI 中转
  const 本地文件类能力 = new Set(['cli_file_download', 'cli_file_read', 'cli_local_path_check']);
  if (本地文件类能力.has(args.capability)) {
    try {
      const cliInfo = await DovesProxy.getCliCapabilities();
      if (cliInfo) {
        const myMachineId = 获取或生成机器标识();
        const cliMachineIds = cliInfo.cliMachineIds || [];
        if (cliMachineIds.includes(myMachineId)) {
          return `你与 CLI 在同一台机器上运行，不需要通过 cli_action 操作本地文件。请直接用 shell_exec / read_file / write_file / list_dir 等本地工具完成操作。参数信息: ${JSON.stringify(args.params)}`;
        }
      }
    } catch (e) {
      // 查询失败，继续走 CLI 转发流程
    }
  }

  try {
    const result = await DovesProxy.requestCliAction(根任务ID, {
      capability: args.capability,
      params: args.params,
      description: args.description,
    });

    if (!result) return '错误: CLI 操作请求失败（无响应）';

    const actionId = result.actionId;
    if (!actionId) return `CLI 操作已提交: ${JSON.stringify(result)}`;

    const maxPoll = 15;
    for (let i = 0; i < maxPoll; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const status = await DovesProxy.getCliActionStatus(actionId);
      if (!status) continue;
      if (status.status === 'completed' || status.status === 'done') {
        return `✅ CLI 操作完成: ${JSON.stringify(status.result).substring(0, 2000)}`;
      }
      if (status.status === 'failed' || status.status === 'error') {
        return `❌ CLI 操作失败: ${status.error || status.result || '未知错误'}`;
      }
    }
    return `❌ CLI 操作超时（30秒内未完成，操作ID: ${actionId}）。不要再重试相同的操作。`;
  } catch (e) {
    return `CLI 操作请求失败: ${e.message}`;
  }
}

// ==================== 通知用户 ====================

export async function 通知用户(args, 上下文) {
  const { DovesProxy, 任务ID } = 上下文;

  if (DovesProxy && 任务ID) {
    try {
      await DovesProxy.dbOperation('任务', 'updateOne', {
        query: { 任务ID },
        update: { $push: { 流缓冲: { 类型: 'notify', 消息: args.message, 级别: args.level || 'info', 时间: new Date().toISOString() } } },
      });
      return `已通知用户: ${args.message.substring(0, 100)}`;
    } catch (e) {
      logger.warn(`写入流缓冲失败: ${e.message}`);
    }
  }

  logger.info(`[通知] (${args.level || 'info'}) ${args.message}`);
  return `已记录通知: ${args.message.substring(0, 100)}`;
}

// ==================== 能力发现 ====================

export async function 能力发现(args) {
  try {
    const { generateFullCatalog } = await import('./扩展能力注册表.js');
    const catalog = generateFullCatalog();

    if (!catalog || catalog.length === 0) {
      return '当前无已注册的扩展能力。';
    }

    const query = args.query.toLowerCase();
    const matched = catalog.filter(ext => {
      const text = `${ext.name} ${ext.description} ${(ext.abilities || []).join(' ')}`.toLowerCase();
      return text.includes(query) ||
        ext.intents?.some(i => i.keywords?.some(k => k.toLowerCase().includes(query)));
    });

    if (matched.length === 0) {
      const 摘要 = catalog.map(e => `- ${e.name}: ${e.description}`).join('\n');
      return `未找到与 "${args.query}" 直接匹配的扩展。所有可用扩展:\n${摘要}`;
    }

    const results = matched.map(ext => {
      const 能力列表 = ext.abilities?.map(a => `  - ${a}`).join('\n') || '';
      const 意图列表 = ext.intents?.map(i => `  - ${i.name} (${i.executionMode}): ${i.keywords?.join(', ')}`).join('\n') || '';
      return `【${ext.name}】${ext.description}\n能力:\n${能力列表}\n意图:\n${意图列表}`;
    });

    return `找到 ${matched.length} 个匹配扩展:\n\n${results.join('\n\n')}`;
  } catch (e) {
    return `能力发现失败: ${e.message}`;
  }
}

// ==================== 工具组加载 ====================

export async function 加载工具组(args) {
  try {
    const 组名 = args.group;
    if (!组名) return { result: '请指定 group 参数（工具组名称）' };

    let tools = null;
    const { 获取分组工具定义: 索引获取 } = await import('./技能分组索引.js');
    tools = await 索引获取(组名);

    if (!tools || tools.length === 0) {
      const { 获取分组工具定义: 本地获取, 获取所有分组名 } = await import('./精简工具定义.js');
      const 本地结果 = 本地获取(组名);
      if (本地结果) {
        tools = 本地结果.tools;
      }
      if (!tools || tools.length === 0) {
        const available = 获取所有分组名().join('、');
        return `未知工具组: ${组名}。可用组: ${available}`;
      }
    }

    const toolNames = tools.map(t => t.function?.name || t.name).join('、');
    return {
      result: `已加载「${组名}」组，包含 ${tools.length} 个工具：${toolNames}。下一轮对话中可直接使用这些工具。`,
      groupTools: tools,
    };
  } catch (e) {
    return `加载工具组失败: ${e.message}`;
  }
}

// ==================== 子任务委派 ====================

export async function 委派子任务(args, 上下文) {
  const { DovesProxy, 任务ID, 根任务ID, 用户ID } = 上下文;
  const subtasks = args.subtasks;

  if (!subtasks?.length) return '请提供至少一个子任务';
  if (subtasks.length > 20) return '最多20个子任务';
  if (!DovesProxy) return '错误: DovesProxy 未初始化，无法创建子任务';

  try {
    const { 任务队列 } = await import('./任务队列.js');
    const queue = new 任务队列(DovesProxy);

    const createdIds = [];
    for (const st of subtasks) {
      const desc = st.description || '';
      if (!desc.trim()) return `子任务 ${createdIds.length} 描述为空，请提供完整描述`;

      const task = await queue.创建任务({
        用户消息: desc,
        描述: desc,
        taskType: 'subtask',
        父任务ID: 任务ID,
        根任务ID: 根任务ID || 任务ID,
        用户ID,
      });
      createdIds.push(task.任务ID);
      logger.info(`  子任务已创建: ${task.任务ID} | ${desc.substring(0, 60)}`);
    }

    for (let i = 0; i < subtasks.length; i++) {
      const deps = subtasks[i].depends_on;
      if (deps?.length) {
        const depIds = deps.map(idx => {
          if (idx < 0 || idx >= createdIds.length) throw new Error(`依赖索引 ${idx} 超出范围 (0-${createdIds.length - 1})`);
          return createdIds[idx];
        });
        const collection = queue._获取集合();
        if (collection) {
          await collection.updateOne(
            { 任务ID: createdIds[i] },
            { $set: { 依赖: depIds, 状态: 'blocked' } }
          );
        }
        logger.info(`  子任务 ${createdIds[i]} 依赖: [${depIds.join(', ')}]`);
      }
    }

    await queue.更新状态(任务ID, 'waiting_children', {
      children: createdIds,
    });
    logger.info(`父任务 ${任务ID} → waiting_children, 等待 ${createdIds.length} 个子任务`);

    const waitResult = await queue.等待子任务(任务ID, 2000, 600000);

    if (!waitResult.成功) {
      const partial = await queue.获取子任务(任务ID);
      const completed = partial.filter(c => c.状态 === 'completed').length;
      return `⏱️ 子任务等待超时（10分钟）。已完成: ${completed}/${createdIds.length}`;
    }

    const children = await queue.获取子任务(任务ID);
    const results = children.map(c => {
      const resultObj = c.结果 || {};
      const text = resultObj.回复 || resultObj.数据?.内容 || '';
      return {
        id: c.任务ID?.substring(0, 8),
        描述: (c.描述 || c.用户消息 || '').substring(0, 120),
        状态: c.状态,
        结果: text.substring(0, 800),
        ...(c.状态 === 'failed' ? { 错误: c.error?.substring(0, 200) || '未知' } : {}),
      };
    });

    const successCount = children.filter(c => c.状态 === 'completed').length;
    const failCount = children.filter(c => c.状态 === 'failed').length;

    let report = `✅ 子任务执行完成: ${successCount}/${children.length} 成功`;
    if (failCount > 0) report += `, ${failCount} 失败`;
    report += `\n\n`;

    for (const r of results) {
      const icon = r.状态 === 'completed' ? '✅' : r.状态 === 'failed' ? '❌' : '⏳';
      report += `### ${icon} ${r.描述}\n`;
      if (r.结果) report += `${r.结果}\n`;
      if (r.错误) report += `错误: ${r.错误}\n`;
      report += '\n';
    }

    return report;
  } catch (e) {
    logger.error(`委派子任务失败: ${e.message}`);
    return `委派子任务失败: ${e.message}`;
  }
}

// ==================== 长期记忆 ====================

export async function 记住(args, 上下文) {
  const { 用户ID } = 上下文;
  const content = args.content;
  if (!content?.trim()) return '请提供要记住的内容';

  try {
    const adapter = 获取记忆适配器();
    const available = await adapter.checkAvailable();
    if (!available) return '记忆系统未启用（Server未连接）';

    const metadata = {};
    if (args.category) metadata.category = args.category;
    if (args.title) metadata.title = args.title;

    const result = await adapter.add(用户ID || 'default', [
      { role: 'user', content },
    ], metadata);

    if (result.成功) {
      return `✅ 已记住: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`;
    }
    return `记忆保存失败: ${result.错误 || '未知错误'}`;
  } catch (e) {
    logger.warn(`remember 失败: ${e.message}`);
    return `记忆保存失败: ${e.message}`;
  }
}

export async function 回忆(args, 上下文) {
  const { 用户ID } = 上下文;
  const query = args.query;
  if (!query?.trim()) return '请提供搜索查询';

  try {
    const adapter = 获取记忆适配器();
    const available = await adapter.checkAvailable();
    if (!available) return '记忆系统未启用（Server未连接）';

    const result = await adapter.search(query, 用户ID || 'default', {
      limit: Math.min(args.limit || 5, 20),
      includeMultimodal: args.includeMultimodal
    });

    if (!result.成功) return `记忆搜索失败: ${result.错误 || '未知错误'}`;

    const memories = result.data?.memories || result.data || [];
    if (!memories.length) return `未找到与 "${query}" 相关的记忆`;

    const lines = memories.map((m, i) => {
      const content = m.内容 || m.content || m.消息列表?.[0]?.content || JSON.stringify(m);
      const title = m.标题 || m.元数据?.title || m.title || '';
      const cat = m.类别 || m.元数据?.category || m.category || '';
      const sim = m.相似度 ? ` [${(m.相似度 * 100).toFixed(0)}%]` : '';
      const media = m.多模态类型 ? ` 📎${m.多模态类型}: ${m.多模态URL}` : '';
      const prefix = title ? `[${title}] ` : '';
      const suffix = cat ? ` (${cat})` : '';
      return `${i + 1}. ${prefix}${content.substring(0, 300)}${suffix}${sim}${media}`;
    });

    return `找到 ${memories.length} 条相关记忆:\n\n${lines.join('\n\n')}`;
  } catch (e) {
    logger.warn(`recall 失败: ${e.message}`);
    return `记忆搜索失败: ${e.message}`;
  }
}

export async function 记住多媒体(args, 上下文) {
  const { 用户ID } = 上下文;
  if (!args.text && !args.imageUrl && !args.audioUrl && !args.videoUrl) {
    return '请至少提供一种内容（文本描述、图片URL、音频URL 或 视频URL）';
  }

  try {
    const adapter = 获取记忆适配器();
    const available = await adapter.checkAvailable();
    if (!available) return '记忆系统未启用（Server未连接）';

    const result = await adapter.addMultimodal(用户ID || 'default', {
      文本: args.text,
      图片URL: args.imageUrl,
      音频URL: args.audioUrl,
      视频URL: args.videoUrl,
      类别: args.category || '经验记忆'
    });

    if (result.成功 || result.id) {
      const 类型 = args.imageUrl ? '图片' : args.audioUrl ? '音频' : args.videoUrl ? '视频' : '文本';
      return `✅ 已记住${类型}内容${args.text ? ': ' + args.text.substring(0, 80) : ''}`;
    }
    return `多媒体记忆保存失败: ${result.错误 || '未知错误'}`;
  } catch (e) {
    logger.warn(`remember_media 失败: ${e.message}`);
    return `多媒体记忆保存失败: ${e.message}`;
  }
}

// ==================== 文件快照 ====================
// 快照存储属于外部扩展能力，支持两种实现：Git存储适配器（优先）/ 本地 Git 快照（降级）

function _执行Git命令(cmd, cwd) {
  try {
    const result = execSync(`git ${cmd}`, { encoding: 'utf-8', cwd: cwd || process.cwd(), timeout: 30000, maxBuffer: 1024 * 1024 });
    return { 成功: true, 输出: result.trim() };
  } catch (e) {
    return { 成功: false, 错误: (e.stderr || e.message || '').trim() };
  }
}

function _在Git仓库中(cwd) {
  const r = _执行Git命令('rev-parse --git-dir', cwd);
  return r.成功 && !r.输出.includes('fatal');
}

function _执行Git快照(action, args) {
  const cwd = args.path ? (existsSync(args.path) && statSync(args.path).isDirectory() ? args.path : process.cwd()) : process.cwd();

  if (!_在Git仓库中(cwd)) {
    return '快照不可用：Git存储未启用，且当前目录不在 Git 仓库中。';
  }

  const TAG = 'dove-snapshot';

  switch (action) {
    case 'create': {
      const stashResult = _执行Git命令('stash push --include-untracked -m "dove-snapshot-stash"', cwd);
      const hasStash = stashResult.成功 && !stashResult.输出.includes('No local changes');

      const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const msg = `dove-snapshot: ${ts}${args.path ? ' [' + args.path + ']' : ''}`;
      const commitResult = _执行Git命令(`commit --allow-empty -m "${msg}"`, cwd);

      if (hasStash) _执行Git命令('stash pop', cwd);

      if (!commitResult.成功) {
        return `Git 快照创建失败: ${commitResult.错误}`;
      }

      const hashMatch = commitResult.输出.match(/\[\S*\s*([a-f0-9]{7,})\]/);
      const hash = hashMatch ? hashMatch[1] : commitResult.输出.substring(0, 40).trim();
      return `✅ Git 快照已创建: ${hash}\n信息: ${msg}`;
    }

    case 'rollback': {
      const snapshotId = args.snapshot_id;
      if (!snapshotId) return '请提供 snapshot_id 参数（Git commit hash）';

      _执行Git命令('stash push --include-untracked -m "dove-snapshot-rollback-stash"', cwd);
      const checkoutResult = _执行Git命令(`checkout ${snapshotId} -- .`, cwd);

      if (!checkoutResult.成功) {
        _执行Git命令('stash pop', cwd);
        return `Git 回滚失败: ${checkoutResult.错误}`;
      }

      return `✅ 已回滚到 Git 快照: ${snapshotId}\n💡 stash 中保留了回滚前的改动，可用 git stash pop 恢复`;
    }

    case 'list': {
      const logResult = _执行Git命令(`log --oneline -20 --grep="${TAG}"`, cwd);
      if (!logResult.成功) return `列出 Git 快照失败: ${logResult.错误}`;
      if (!logResult.输出) return '当前 Git 仓库中无 dove-snapshot 快照';

      const lines = logResult.输出.split('\n').map((l, i) => `${i + 1}. ${l}`);
      return `Git 快照列表 (dove-snapshot):\n${lines.join('\n')}`;
    }

    default:
      return `未知操作: ${action}。支持: create / rollback / list`;
  }
}

export async function 快照(args) {
  const action = args.action;

  // Git存储适配器可用时使用适配器，否则使用本地 Git 快照
  const adapter = 获取存储适配器();
  let 适配器可用 = false;
  try {
    适配器可用 = await adapter.checkAvailable();
  } catch {
    适配器可用 = false;
  }

  if (!适配器可用) {
    return _执行Git快照(action, args);
  }

  try {
    switch (action) {
      case 'create': {
        const path = args.path;
        if (!path) return '请提供 path 参数（文件或目录的绝对路径）';

        let result;
        if (existsSync(path)) {
          const st = statSync(path);
          if (st.isDirectory()) {
            result = await adapter.createDirSnapshot(path, {});
          } else {
            result = await adapter.createSnapshot(path, {});
          }
        } else {
          return `路径不存在: ${path}`;
        }

        if (result.成功) {
          const id = result.快照?.ID || result.snapshotId || '未知';
          return `✅ 快照已创建: ${id}\n路径: ${path}`;
        }
        return `快照创建失败: ${result.错误 || '未知错误'}`;
      }

      case 'rollback': {
        const snapshotId = args.snapshot_id;
        if (!snapshotId) return '请提供 snapshot_id 参数';

        const result = await adapter.rollbackSnapshot(snapshotId);
        if (result.成功) {
          return `✅ 已回滚到快照: ${snapshotId}`;
        }
        return `快照回滚失败: ${result.错误 || '未知错误'}`;
      }

      case 'list': {
        const result = await adapter.listSnapshots();
        if (!result.成功) return `列出快照失败: ${result.错误 || '未知错误'}`;

        const snapshots = result.快照列表 || result.snapshots || [];
        if (!snapshots.length) return '当前无快照';

        const lines = snapshots.map((s, i) => {
          const id = s.ID || s.id || '';
          const path = s.路径 || s.path || '';
          const time = s.创建时间 || s.createdAt || '';
          return `${i + 1}. ${id} — ${path} (${time})`;
        });
        return `共 ${snapshots.length} 个快照:\n${lines.join('\n')}`;
      }

      default:
        return `未知操作: ${action}。支持: create / rollback / list`;
    }
  } catch (e) {
    logger.error(`快照操作失败: ${e.message}，尝试本地 Git 快照`);
    return _执行Git快照(action, args);
  }
}
