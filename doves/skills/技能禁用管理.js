/**
 * @file 技能禁用管理
 * @description 技能禁用/启用状态管理，从 技能管理器.js 抽取
 */

import { 技能分类 } from './技能常量.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('技能管理器', { 前缀: '[技能管理器]', 级别: 'debug', 显示调用位置: true });

/**
 * 设置禁用配置
 */
export function 设置禁用配置(manager, 配置 = {}) {
  if (配置.禁用技能列表) {
    manager.禁用技能列表 = new Set(配置.禁用技能列表);
  }
  if (配置.禁用分类列表) {
    manager.禁用分类列表 = new Set(配置.禁用分类列表);
  }
  logger.info(`禁用配置已更新: ${manager.禁用技能列表.size} 个技能, ${manager.禁用分类列表.size} 个分类`);
}

/**
 * 检查技能是否被禁用
 */
export function 检查技能禁用状态(manager, 技能名) {
  if (manager.禁用技能列表.has(技能名)) {
    return { 禁用: true, 原因: '技能单独禁用' };
  }

  const 分类 = 获取技能分类(manager, 技能名);
  if (分类 && manager.禁用分类列表.has(分类)) {
    return { 禁用: true, 原因: `分类「${分类}」已禁用` };
  }

  return { 禁用: false, 原因: null };
}

/**
 * 获取技能所属分类
 */
export function 获取技能分类(manager, 技能名) {
  for (const [分类, 技能列表] of Object.entries(技能分类)) {
    if (技能列表.includes(技能名)) {
      return 分类;
    }
  }
  return null;
}

export function 禁用技能(manager, 技能名) {
  manager.禁用技能列表.add(技能名);
  logger.info(`已禁用技能: ${技能名}`);
  return true;
}

export function 启用技能(manager, 技能名) {
  manager.禁用技能列表.delete(技能名);
  logger.info(`已启用技能: ${技能名}`);
  return true;
}

export function 禁用分类(manager, 分类名) {
  if (!技能分类[分类名]) {
    logger.warn(`未知分类: ${分类名}`);
    return false;
  }
  manager.禁用分类列表.add(分类名);
  logger.info(`已禁用分类: ${分类名}`);
  return true;
}

export function 启用分类(manager, 分类名) {
  manager.禁用分类列表.delete(分类名);
  logger.info(`已启用分类: ${分类名}`);
  return true;
}

export function 获取禁用列表(manager) {
  return {
    技能: Array.from(manager.禁用技能列表),
    分类: Array.from(manager.禁用分类列表)
  };
}

export function 获取可用技能列表(manager) {
  return manager.获取技能列表().filter(技能名 => {
    const { 禁用 } = 检查技能禁用状态(manager, 技能名);
    return !禁用;
  });
}

export function 获取所有技能详情(manager) {
  return manager.获取技能列表().map(技能名 => {
    const 技能 = manager.已注册技能.get(技能名);
    const { 禁用, 原因 } = 检查技能禁用状态(manager, 技能名);
    const 分类 = 获取技能分类(manager, 技能名);

    return {
      名称: 技能名,
      描述: 技能?.description || '-',
      分类,
      状态: 禁用 ? 'disabled' : 'enabled',
      禁用原因: 原因,
      来源: 技能?._id ? '数据库' : '目录'
    };
  });
}
