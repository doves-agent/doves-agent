/**
 * Cron 表达式解析工具
 * 简单 cron 解析，支持: 星号(每), 星号/N(步长), 数字(指定)
 */

import { toLocalISOString } from '@dove/common/时间工具.js';
import { logger } from '../core.js';

/**
 * 计算下次触发时间
 * @param {string} cron表达式 - 至少5段的cron表达式
 * @returns {string} ISO格式时间
 */
export function 计算下次触发时间(cron表达式) {
  try {
    const parts = cron表达式.trim().split(/\s+/);
    if (parts.length < 5) throw new Error('cron表达式至少5段');
    
    const [分, 时, 日, 月, 周] = parts;
    const now = new Date();
    const start = new Date(now.getTime() + 60000);
    start.setSeconds(0, 0);
    
    // 简单搜索：最多尝试 525600 分钟（1年）
    for (let i = 0; i < 525600; i++) {
      const candidate = new Date(start.getTime() + i * 60000);
      
      if (!匹配字段(分, candidate.getMinutes())) continue;
      if (!匹配字段(时, candidate.getHours())) continue;
      if (!匹配字段(日, candidate.getDate())) continue;
      if (!匹配字段(月, candidate.getMonth() + 1)) continue;
      if (!匹配字段(周, candidate.getDay())) continue;
      
      return toLocalISOString(candidate);
    }
    
    return toLocalISOString(new Date(Date.now() + 3600000));
  } catch (e) {
    logger.warn(`[事件调度器] 无效的cron表达式: ${cron表达式}, ${e.message}`);
    return toLocalISOString(new Date(Date.now() + 3600000));
  }
}

/**
 * 匹配 cron 字段 - 支持星号, 星号/N, 数字
 */
function 匹配字段(表达式, 值) {
  if (表达式 === '*') return true;
  if (表达式.startsWith('*/')) {
    const 步长 = parseInt(表达式.substring(2));
    return 步长 > 0 && 值 % 步长 === 0;
  }
  return parseInt(表达式) === 值;
}

export { 匹配字段 };
