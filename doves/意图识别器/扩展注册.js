/**
 * @file 意图识别器/扩展注册
 * @description 扩展意图注册系统：注册/注销扩展意图、获取完整提示词
 * @generated 由 意图识别器.js 拆分，KISS 原则
 */

import { 统一意图提示词 } from './提示词.js';
import { generateIntentSummary } from '../扩展能力注册表.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('扩展意图注册', { 前缀: '[扩展意图]', 级别: 'debug', 显示调用位置: true });

// ==================== 扩展包意图注册系统（模块级，所有意图识别器实例共享） ====================
// 扩展意图类型：Map<意图名, { executionMode, 扩展包名 }>
const _扩展意图 = new Map();
// 扩展意图提示词补充：Map<扩展包名, 提示词片段>
const _扩展意图提示词 = new Map();
// 扩展意图关键词：Map<意图名, { keywords, 扩展包名 }>
const _扩展意图关键词 = new Map();

/**
 * 注册扩展意图（供扩展加载器调用，模块级）
 * @param {Object} 扩展意图模块 - { intents, executionModeMap, intentPromptAddon, intentKeywords }
 * @param {string} 扩展包名 - 来源扩展包
 */
export function 注册扩展意图(扩展意图模块, 扩展包名) {
  const { intents, executionModeMap, intentPromptAddon, intentKeywords } = 扩展意图模块;

  // 注册意图类型和执行模式映射
  if (intents) {
    for (const [key, value] of Object.entries(intents)) {
      _扩展意图.set(value, {
        executionMode: executionModeMap?.[value] || '先规划后执行',
        扩展包名
      });
      logger.info(`注册扩展意图: ${value} (来自 ${扩展包名})`);
    }
  }

  // 注册意图提示词补充
  if (intentPromptAddon) {
    _扩展意图提示词.set(扩展包名, intentPromptAddon);
  }

  // 注册意图关键词
  if (intentKeywords) {
    for (const [intentName, keywords] of Object.entries(intentKeywords)) {
      _扩展意图关键词.set(intentName, { keywords, 扩展包名 });
    }
  }
}

/**
 * 注销扩展意图（供扩展加载器卸载时调用，模块级）
 * @param {string} 扩展包名 - 来源扩展包
 */
export function 注销扩展意图(扩展包名) {
  // 移除意图类型
  for (const [意图, 数据] of _扩展意图) {
    if (数据.扩展包名 === 扩展包名) _扩展意图.delete(意图);
  }
  // 移除提示词补充
  _扩展意图提示词.delete(扩展包名);
  // 移除关键词
  for (const [意图名, 数据] of _扩展意图关键词) {
    if (数据.扩展包名 === 扩展包名) _扩展意图关键词.delete(意图名);
  }
}

/**
 * 获取含扩展意图的完整提示词
 * 使用扩展能力注册表自动生成的结构化摘要
 * @returns {string} 完整的意图识别提示词
 */
export function 获取完整意图提示词() {
  let 提示词 = 统一意图提示词;

  const registrySummary = generateIntentSummary();
  if (registrySummary) {
    提示词 += registrySummary;
  }

  return 提示词;
}

/**
 * 获取所有已注册的扩展意图名
 * @returns {IterableIterator<string>}
 */
export function 获取扩展意图列表() {
  return _扩展意图.keys();
}

/**
 * 获取指定意图的执行模式
 * @param {string} intent - 意图名
 * @returns {{ executionMode: string, 扩展包名: string } | undefined}
 */
export function 获取扩展意图模式(intent) {
  return _扩展意图.get(intent);
}
