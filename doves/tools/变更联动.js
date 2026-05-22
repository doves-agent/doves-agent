/**
 * @file tools/变更联动
 * @description 事件总线模式，Git commit/merge 后自动触发下游动作
 * 
 * 全链路联动：
 *   commit → code_review(审查) → git_vcs(push+PR)
 *   merge → document(文档同步+changelog) → project_mgmt(状态同步)
 *   merge(前端) → demo_showcase(Demo更新)
 *   定时 → data_analytics(统计汇总)
 * 
 * 联动处理器接口：
 * {
 *   name: '处理器名称',
 *   match: (gitEvent) => boolean,       // 匹配条件
 *   execute: async (gitEvent, 上下文) => {}  // 执行联动
 * }
 * 
 * gitEvent 结构：
 * {
 *   type: 'commit' | 'merge' | 'push' | 'rebase' | 'reset' | 'review_pass' | 'scheduled',
 *   action: 'commit' | 'merge' | 'push' | ...,
 *   result: { ... },       // 工具调用返回的结果
 *   taskId: '...',          // 关联任务ID
 *   userId: '...',          // 用户ID
 *   cwd: '...'              // 工作目录
 * }
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('变更联动', { 前缀: '[变更联动]', 级别: 'debug', 显示调用位置: true });

// ==================== 联动处理器注册表 ====================

// Map<处理器名, { match, execute, 扩展包名 }>
const _联动处理器 = new Map();

// ==================== 核心接口 ====================

/**
 * 注册联动处理器
 * @param {string} 名称 - 处理器名称（建议格式：扩展包名_动作，如 code_review_on_commit）
 * @param {Object} 处理器 - { match(gitEvent), execute(gitEvent, 上下文) }
 * @param {string} 扩展包名 - 来源扩展包
 */
export function 注册联动处理器(名称, 处理器, 扩展包名) {
  if (!处理器 || typeof 处理器.match !== 'function' || typeof 处理器.execute !== 'function') {
    logger.warn(`联动处理器 ${名称} 缺少 match 或 execute 方法，跳过注册`);
    return;
  }
  _联动处理器.set(名称, { ...处理器, 扩展包名 });
  logger.info(`注册联动处理器: ${名称} (来自 ${扩展包名})`);
}

/**
 * 注销联动处理器（扩展包卸载时调用）
 * @param {string} 扩展包名 - 来源扩展包
 */
export function 注销联动处理器(扩展包名) {
  const 待移除 = [];
  for (const [名称, 处理器] of _联动处理器) {
    if (处理器.扩展包名 === 扩展包名) {
      待移除.push(名称);
    }
  }
  for (const 名称 of 待移除) {
    _联动处理器.delete(名称);
  }
  if (待移除.length > 0) {
    logger.info(`注销联动处理器: [${待移除.join(', ')}] (来自 ${扩展包名})`);
  }
}

/**
 * 触发变更联动
 * 遍历所有注册的联动处理器，匹配则执行
 * @param {Object} gitEvent - 变更事件
 * @param {Object} 上下文 - 执行上下文
 * @returns {Array} 执行结果列表
 */
export async function 触发变更联动(gitEvent, 上下文 = {}) {
  const 匹配结果 = [];

  for (const [名称, 处理器] of _联动处理器) {
    try {
      if (处理器.match(gitEvent)) {
        logger.info(`联动匹配: ${名称} (事件类型: ${gitEvent.type})`);
        const 结果 = await 处理器.execute(gitEvent, 上下文);
        匹配结果.push({ 名称, 结果 });
      }
    } catch (e) {
      logger.error(`联动处理器 ${名称} 执行失败: ${e.message}`);
      匹配结果.push({ 名称, 错误: e.message });
    }
  }

  if (匹配结果.length > 0) {
    logger.info(`变更联动完成: ${匹配结果.length} 个处理器触发 (事件: ${gitEvent.type})`);
  }

  return 匹配结果;
}

/**
 * 获取所有已注册的联动处理器名称
 * @returns {string[]}
 */
export function 获取联动处理器列表() {
  return Array.from(_联动处理器.keys());
}

/**
 * 构建变更事件
 * 供扩展包的 hooks.afterToolCall 使用
 * @param {string} type - 事件类型
 * @param {Object} 工具结果 - 工具调用结果
 * @param {Object} 任务 - 关联任务
 * @returns {Object} gitEvent
 */
export function 构建变更事件(type, 工具结果, 任务 = {}) {
  return {
    type,
    action: type,
    result: 工具结果,
    taskId: 任务.ID || 任务.id || '',
    userId: 任务.userId || 任务.用户ID || '',
    cwd: 任务.cwd || process.cwd(),
    timestamp: Date.now()
  };
}

export default {
  注册联动处理器,
  注销联动处理器,
  触发变更联动,
  获取联动处理器列表,
  构建变更事件
};
