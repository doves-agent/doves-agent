/**
 * @file _扩展系统.js
 * @description 扩展条件提示 & 钩子注册系统（LLM执行器共享模块）
 * @generated 由智能体-LLM执行器.js 拆分，KISS 原则
 */
import { 角色提示映射, 合法子任务角色 } from '../常量.js';
import { 是否静默 } from '../utils/启动汇总.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('扩展系统', { 前缀: '[扩展系统]', 级别: 'debug', 显示调用位置: true });

// 扩展条件提示：Map<扩展包名, { conditionalPrompts, hooks }>
export const _扩展条件提示 = new Map();
export function 获取扩展条件提示(任务, tools) {
  let 提示词 = '';
  for (const [扩展包名, 执行模块] of _扩展条件提示) {
    if (执行模块.conditionalPrompts) {
      for (const 条件 of 执行模块.conditionalPrompts) {
        try {
          if (条件.match(任务, tools)) {
            提示词 += '\n' + 条件.prompt;
          }
        } catch (e) {
          logger.warn(`扩展 ${扩展包名} 条件提示匹配失败: ${e.message}`);
        }
      }
    }
  }
  return 提示词;
}

export function 生成角色提示(role) {
  if (!role) return '';
  // LLM 必须输出合法中文角色名
  if (!合法子任务角色.includes(role)) return '';
  const 映射 = 角色提示映射[role];
  if (!映射) return '';
  return `\n\n3. 🎭 你的角色：${映射.身份}\n   ${映射.指引}\n   行为要点：${映射.要点.map(要点 => `\n   - ${要点}`).join('')}`;
}

export function 注册扩展执行(扩展执行模块, 扩展包名) {
  _扩展条件提示.set(扩展包名, 扩展执行模块);
  logger.info(`注册扩展执行: ${扩展包名}`);
}

/**
 * 注销扩展条件提示和钩子（供扩展加载器卸载时调用）
 * @param {string} 扩展包名 - 来源扩展包
 */
export function 注销扩展执行(扩展包名) {
  _扩展条件提示.delete(扩展包名);
}
