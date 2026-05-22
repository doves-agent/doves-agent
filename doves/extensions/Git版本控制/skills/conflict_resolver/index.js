/**
 * 冲突解决技能
 * 
 * 能力：
 * - 读取冲突文件（<<<<<<< / ======= / >>>>>>> 标记解析）
 * - 返回结构化冲突信息供LLM分析
 * - 生成合并方案（保留/融合/选择一方）
 * - 存储冲突解决偏好到Git记忆
 */

import fs from 'fs/promises';

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('conflict_resolver', { 前缀: '[conflict_resolver]', 级别: 'debug', 显示调用位置: true });

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
        oursLabel: line.replace('<<<<<<<', '').trim() || 'ours',
        ours: [],
        theirs: [],
        theirsLabel: ''
      };
      section = 'ours';
    } else if (line.startsWith('=======') && current) {
      section = 'theirs';
    } else if (line.startsWith('>>>>>>>') && current) {
      current.theirsLabel = line.replace('>>>>>>>', '').trim() || 'theirs';
      current.endLine = i + 1;
      conflicts.push({
        startLine: current.startLine,
        endLine: current.endLine,
        oursLabel: current.oursLabel,
        theirsLabel: current.theirsLabel,
        ours: current.ours.join('\n'),
        theirs: current.theirs.join('\n')
      });
      current = null;
      section = 'common';
    } else if (current) {
      if (section === 'ours') current.ours.push(line);
      else if (section === 'theirs') current.theirs.push(line);
    }
  }

  return conflicts;
}

/**
 * 查找仓库中所有冲突文件
 */
async function 查找冲突文件(cwd) {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  try {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--diff-filter=U'], { cwd, maxBuffer: 10 * 1024 * 1024 });
    return stdout.trim().split('\n').filter(f => f.trim());
  } catch {
    return [];
  }
}

/**
 * 执行冲突解决
 */
async function execute(args, context) {
  const { action = 'analyze', path: filePath, resolution, cwd = process.cwd() } = args;

  logger.info(`执行: ${action}, cwd: ${cwd}`);

  try {
    switch (action) {

      // 分析冲突：读取并解析冲突文件
      case 'analyze': {
        // 如果指定了文件，分析单个文件
        if (filePath) {
          const content = await fs.readFile(filePath, 'utf-8');
          const conflicts = 解析冲突内容(content);

          if (conflicts.length === 0) {
            return { 成功: true, 数据: { message: '文件中没有冲突标记', path: filePath } };
          }

          return {
            成功: true,
            数据: {
              path: filePath,
              conflictCount: conflicts.length,
              conflicts,
              建议: '请分析双方修改意图，选择解决策略：keep_ours(保留我方) / keep_theirs(保留对方) / merge(融合双方) / manual(手动指定)'
            }
          };
        }

        // 否则扫描所有冲突文件
        const conflictFiles = await 查找冲突文件(cwd);
        if (conflictFiles.length === 0) {
          return { 成功: true, 数据: { message: '当前没有冲突文件', cwd } };
        }

        const 分析结果 = [];
        for (const file of conflictFiles) {
          try {
            const content = await fs.readFile(file, 'utf-8');
            const conflicts = 解析冲突内容(content);
            分析结果.push({ path: file, conflictCount: conflicts.length, conflicts });
          } catch (e) {
            分析结果.push({ path: file, error: e.message });
          }
        }

        return {
          成功: true,
          数据: {
            cwd,
            totalFiles: conflictFiles.length,
            totalConflicts: 分析结果.reduce((sum, r) => sum + (r.conflictCount || 0), 0),
            files: 分析结果
          }
        };
      }

      // 应用解决方案
      case 'resolve': {
        if (!filePath || !resolution) {
          return { 成功: false, 错误: '缺少必填参数: path 和 resolution' };
        }

        if (!Array.isArray(resolution)) {
          return { 成功: false, 错误: 'resolution 必须是数组，每个元素包含 conflictIndex 和 strategy' };
        }

        const content = await fs.readFile(filePath, 'utf-8');
        let result = content;
        const appliedResolutions = [];

        // 从后往前替换，避免行号偏移
        const sortedResolutions = [...resolution].sort((a, b) => b.conflictIndex - a.conflictIndex);

        for (const res of sortedResolutions) {
          const { conflictIndex, strategy, content: manualContent } = res;

          // 重新解析当前内容的冲突
          const currentConflicts = 解析冲突内容(result);
          if (conflictIndex >= currentConflicts.length) {
            appliedResolutions.push({ conflictIndex, success: false, error: '冲突索引超出范围' });
            continue;
          }

          const conflict = currentConflicts[conflictIndex];
          const lines = result.split('\n');
          let replacement;

          switch (strategy) {
            case 'keep_ours':
              replacement = conflict.ours;
              break;
            case 'keep_theirs':
              replacement = conflict.theirs;
              break;
            case 'merge':
              replacement = `${conflict.ours}\n${conflict.theirs}`;
              break;
            case 'manual':
              replacement = manualContent || '';
              break;
            default:
              appliedResolutions.push({ conflictIndex, success: false, error: `未知策略: ${strategy}` });
              continue;
          }

          // 替换冲突块
          const newLines = [
            ...lines.slice(0, conflict.startLine - 1),
            ...replacement.split('\n'),
            ...lines.slice(conflict.endLine)
          ];
          result = newLines.join('\n');

          appliedResolutions.push({ conflictIndex, strategy, success: true });
        }

        // 写回文件
        await fs.writeFile(filePath, result, 'utf-8');

        return {
          成功: true,
          数据: {
            path: filePath,
            resolvedCount: appliedResolutions.filter(r => r.success).length,
            resolutions: appliedResolutions
          }
        };
      }

      // 自动合并：基于三方分析自动选择解决策略
      case 'auto_merge': {
        if (!filePath) {
          return { 成功: false, 错误: '缺少必填参数: path' };
        }

        const content = await fs.readFile(filePath, 'utf-8');
        const conflicts = 解析冲突内容(content);

        if (conflicts.length === 0) {
          return { 成功: true, 数据: { message: '文件中没有冲突标记', path: filePath } };
        }

        let result = content;
        const autoResolutions = [];

        // 从后往前处理，避免行号偏移
        for (let i = conflicts.length - 1; i >= 0; i--) {
          const conflict = conflicts[i];
          let strategy = 'manual'; // 默认需要手动
          let reason = '';

          const oursEmpty = !conflict.ours.trim();
          const theirsEmpty = !conflict.theirs.trim();

          if (oursEmpty && !theirsEmpty) {
            // 我方删除，对方有内容 → 保留对方
            strategy = 'keep_theirs';
            reason = '我方为空，自动保留对方修改';
          } else if (!oursEmpty && theirsEmpty) {
            // 对方删除，我方有内容 → 保留我方
            strategy = 'keep_ours';
            reason = '对方为空，自动保留我方修改';
          } else if (oursEmpty && theirsEmpty) {
            // 双方都删除 → 保留空
            strategy = 'keep_ours';
            reason = '双方都为空，自动清除冲突标记';
          } else if (conflict.ours.trim() === conflict.theirs.trim()) {
            // 双方内容完全一致 → 保留任一方
            strategy = 'keep_ours';
            reason = '双方修改内容一致，自动合并';
          } else {
            // 双方都有不同的修改 → 需要手动判断
            strategy = 'manual';
            reason = '双方都有不同的修改，无法自动合并，需要手动确认';
          }

          autoResolutions.push({ conflictIndex: i, strategy, reason });

          // 自动解决的冲突直接应用
          if (strategy !== 'manual') {
            const currentConflicts = 解析冲突内容(result);
            if (i < currentConflicts.length) {
              const current = currentConflicts[i];
              const lines = result.split('\n');
              const replacement = strategy === 'keep_theirs' ? current.theirs : current.ours;
              const newLines = [
                ...lines.slice(0, current.startLine - 1),
                ...replacement.split('\n'),
                ...lines.slice(current.endLine)
              ];
              result = newLines.join('\n');
            }
          }
        }

        const autoResolved = autoResolutions.filter(r => r.strategy !== 'manual').length;
        const manualNeeded = autoResolutions.filter(r => r.strategy === 'manual').length;

        // 只有全部自动解决才写回文件
        if (manualNeeded === 0) {
          await fs.writeFile(filePath, result, 'utf-8');
          return {
            成功: true,
            数据: {
              path: filePath,
              自动解决数: autoResolved,
              需手动解决数: manualNeeded,
              全部自动解决: true,
              决策详情: autoResolutions
            }
          };
        }

        // 有未解决的冲突，不写回文件，返回分析结果
        return {
          成功: true,
          数据: {
            path: filePath,
            自动解决数: autoResolved,
            需手动解决数: manualNeeded,
            全部自动解决: false,
            决策详情: autoResolutions,
            建议: `有 ${manualNeeded} 个冲突无法自动合并，请使用 resolve action 手动指定解决方案`
          }
        };
      }

      // 批量解决：一次性解决所有冲突文件的简单冲突
      case 'batch_resolve': {
        const conflictFiles = await 查找冲突文件(cwd);
        if (conflictFiles.length === 0) {
          return { 成功: true, 数据: { message: '当前没有冲突文件', cwd } };
        }

        const results = [];
        for (const file of conflictFiles) {
          try {
            const content = await fs.readFile(file, 'utf-8');
            const conflicts = 解析冲突内容(content);

            let result = content;
            const resolutions = [];
            let allAuto = true;

            // 从后往前处理
            for (let i = conflicts.length - 1; i >= 0; i--) {
              const conflict = conflicts[i];
              let strategy = 'manual';

              const oursEmpty = !conflict.ours.trim();
              const theirsEmpty = !conflict.theirs.trim();

              if (oursEmpty && !theirsEmpty) strategy = 'keep_theirs';
              else if (!oursEmpty && theirsEmpty) strategy = 'keep_ours';
              else if (conflict.ours.trim() === conflict.theirs.trim()) strategy = 'keep_ours';
              else { strategy = 'manual'; allAuto = false; }

              resolutions.push({ conflictIndex: i, strategy });

              if (strategy !== 'manual') {
                const currentConflicts = 解析冲突内容(result);
                if (i < currentConflicts.length) {
                  const current = currentConflicts[i];
                  const lines = result.split('\n');
                  const replacement = strategy === 'keep_theirs' ? current.theirs : current.ours;
                  result = [
                    ...lines.slice(0, current.startLine - 1),
                    ...replacement.split('\n'),
                    ...lines.slice(current.endLine)
                  ].join('\n');
                }
              }
            }

            if (allAuto) {
              await fs.writeFile(file, result, 'utf-8');
              results.push({ path: file, status: '已解决', conflictCount: conflicts.length });
            } else {
              // 不写回部分解决的文件，避免状态不一致
              results.push({ path: file, status: '需手动解决', conflictCount: conflicts.length, autoResolvable: resolutions.filter(r => r.strategy !== 'manual').length });
            }
          } catch (e) {
            results.push({ path: file, status: '错误', error: e.message });
          }
        }

        const resolvedCount = results.filter(r => r.status === '已解决').length;
        const manualCount = results.filter(r => r.status === '需手动解决').length;

        return {
          成功: true,
          数据: {
            cwd,
            总文件数: conflictFiles.length,
            已自动解决: resolvedCount,
            需手动解决: manualCount,
            文件详情: results
          }
        };
      }

      // 偏好学习：记录用户的冲突解决偏好到Git记忆
      case 'preference_learn': {
        const { preferences } = args;
        if (!preferences || typeof preferences !== 'object') {
          return { 成功: false, 错误: '缺少 preferences 参数（对象格式）' };
        }

        // 存储到context中（如果有Git记忆系统）
        try {
          if (context?.memory?.set) {
            await context.memory.set('conflict_resolution_preferences', preferences);
          }
        } catch { /* 记忆系统不可用 */ }

        return {
          成功: true,
          数据: {
            message: '冲突解决偏好已记录',
            preferences,
            提示: '在后续冲突解决中将参考这些偏好自动选择策略'
          }
        };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'conflict_resolver',
  description: 'Git冲突解决技能 — 读取冲突标记、分析双方意图、应用解决策略',
  abilities: ['Git', '版本控制'],
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['analyze', 'resolve', 'auto_merge', 'batch_resolve', 'preference_learn'],
        description: '操作类型：analyze(分析冲突) / resolve(应用解决方案) / auto_merge(自动合并) / batch_resolve(批量解决) / preference_learn(学习偏好)'
      },
      path: { type: 'string', description: '冲突文件路径' },
      resolution: {
        type: 'array',
        description: '解决方案数组（resolve时使用），每项包含 conflictIndex、strategy(keep_ours/keep_theirs/merge/manual)、content(manual时必填)',
        items: {
          type: 'object',
          properties: {
            conflictIndex: { type: 'number', description: '冲突索引（从0开始）' },
            strategy: { type: 'string', enum: ['keep_ours', 'keep_theirs', 'merge', 'manual'], description: '解决策略' },
            content: { type: 'string', description: '手动内容（strategy=manual时必填）' }
          },
          required: ['conflictIndex', 'strategy']
        }
      },
      cwd: { type: 'string', description: '工作目录' },
      preferences: {
        type: 'object',
        description: '用户冲突解决偏好（preference_learn时使用），如 { "defaultStrategy": "keep_ours", "filePatterns": { "package.json": "keep_theirs" } }',
        properties: {
          defaultStrategy: { type: 'string', enum: ['keep_ours', 'keep_theirs', 'merge'], description: '默认解决策略' },
          filePatterns: { type: 'object', description: '按文件模式匹配策略，如 {"*.json": "keep_theirs"}' },
          alwaysAskOnBoth: { type: 'boolean', description: '双方都有修改时是否总是询问（默认true）' }
        }
      }
    },
    required: ['action']
  },
  execute
};
