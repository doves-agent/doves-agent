/**
 * 工具扩展注册系统
 * 支持扩展包的动态注册、注销，以及工具分类/安全分级/能力映射的合并
 */
import { 工具分类, 工具安全分级, 工具能力映射 } from './工具元数据.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('工具扩展注册', { 前缀: '[工具注册]', 级别: 'debug', 显示调用位置: true });

// 扩展工具：Map<扩展包名, { tools, handler, categories, abilityMap, safetyLevels }>
export const _扩展工具 = new Map();

/**
 * 注册扩展工具（供扩展加载器调用）
 */
export function 注册扩展工具(扩展工具模块, 扩展包名) {
  const { extTools, handleExtTool, extToolCategories, extToolAbilityMap, extToolSafetyLevels } = 扩展工具模块;

  const 已有 = _扩展工具.get(扩展包名);

  // 链式合并处理器
  let 合并处理器 = handleExtTool || null;
  if (已有 && 已有.handler && handleExtTool) {
    const 旧处理器 = 已有.handler;
    合并处理器 = async (name, args) => {
      const 结果 = await handleExtTool(name, args);
      if (结果 !== null && 结果 !== undefined) return 结果;
      return 旧处理器(name, args);
    };
  } else if (已有 && 已有.handler) {
    合并处理器 = 已有.handler;
  }

  // 合并工具定义（去重：同名工具只保留新版本）
  const 新版工具名 = new Set((extTools || []).map(e => e.name));
  const 已有工具 = (已有?.tools || []).filter(t => !新版工具名.has(t.name));

  _扩展工具.set(扩展包名, {
    tools: [...已有工具, ...(extTools || [])],
    handler: 合并处理器,
    categories: { ...(已有?.categories || {}), ...(extToolCategories || {}) },
    abilityMap: { ...(已有?.abilityMap || {}), ...(extToolAbilityMap || {}) },
    safetyLevels: { ...(已有?.safetyLevels || {}), ...(extToolSafetyLevels || {}) },
  });

  // 合并工具分类
  if (extToolCategories) {
    for (const [分类, 工具列表] of Object.entries(extToolCategories)) {
      if (!Array.isArray(工具列表)) {
        logger.warn(`扩展 ${扩展包名} 的 extToolCategories.${分类} 不是数组，已跳过 (值: ${JSON.stringify(工具列表)})`);
        continue;
      }
      if (!工具分类[分类]) 工具分类[分类] = [];
      for (const 工具名 of 工具列表) {
        if (!工具分类[分类].includes(工具名)) 工具分类[分类].push(工具名);
      }
    }
  }

  // 合并工具能力映射
  if (extToolAbilityMap) Object.assign(工具能力映射, extToolAbilityMap);

  // 合并工具安全分级
  if (extToolSafetyLevels) Object.assign(工具安全分级, extToolSafetyLevels);

  logger.info(`注册扩展工具: ${(extTools || []).map(t => t.name).join(', ')} (来自 ${扩展包名})`);
}

/**
 * 注销扩展工具
 */
export function 注销扩展工具(扩展包名) {
  const 扩展 = _扩展工具.get(扩展包名);
  if (!扩展) return;

  if (扩展.categories) {
    for (const [分类, 工具列表] of Object.entries(扩展.categories)) {
      if (工具分类[分类]) {
        工具分类[分类] = 工具分类[分类].filter(t => !工具列表.includes(t));
        if (工具分类[分类].length === 0) delete 工具分类[分类];
      }
    }
  }

  if (扩展.abilityMap) {
    for (const 工具名 of Object.keys(扩展.abilityMap)) delete 工具能力映射[工具名];
  }

  if (扩展.safetyLevels) {
    for (const 工具名 of Object.keys(扩展.safetyLevels)) delete 工具安全分级[工具名];
  }

  _扩展工具.delete(扩展包名);
  logger.info(`注销扩展工具 (来自 ${扩展包名})`);
}
