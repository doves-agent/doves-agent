/**
 * @file 用户活动记录器
 * @description 标准化的用户活动写入接口，扩展在关键节点调用以记录"用户做了什么"
 */

import { 获取记忆适配器 } from './精简工具执行-扩展交互.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('活动记录', { 前缀: '[活动]' });

export const 活动类别 = '用户活动';

/**
 * 记录一条用户活动（fire-and-forget，永不抛错）
 * @param {{ 用户ID: string, 扩展名: string, 活动: string, 详情?: object }} params
 */
export async function 记录用户活动({ 用户ID, 扩展名, 活动, 详情 = {} }) {
  try {
    const adapter = 获取记忆适配器();
    const available = await adapter.checkAvailable();
    if (!available) return;

    const content = `[用户活动][${扩展名}] ${活动}`;
    const metadata = {
      category: 活动类别,
      title: 活动,
      扩展名,
      时间: new Date().toISOString(),
      ...详情,
    };

    await adapter.add(用户ID, [{ role: 'user', content }], metadata);
    logger.debug(`已记录: ${content}`);
  } catch (e) {
    logger.debug(`活动记录失败（不影响主流程）: ${e.message}`);
  }
}
