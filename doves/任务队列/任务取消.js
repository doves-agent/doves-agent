/**
 * 任务队列 - 任务取消 mixin
 * 从 任务队列.js 提取
 */

import { 任务状态 } from '../常量.js';
import { createTimestampFields } from '@dove/common/时间工具.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('任务取消', { 前缀: '[任务取消]', 级别: 'debug', 显示调用位置: true });

export function mixinTaskCancellation(instance) {
  /**
   * 取消任务（只能取消自己领取的任务，或自己的子任务）
   */
  instance.取消任务 = async function(任务ID, 鸽子ID, 原因 = '') {
    logger.info(`鸽子 ${鸽子ID} 取消任务 ${任务ID}: ${原因}`);
    await instance.标记已取消(任务ID, 原因);
    return true;
  };

  /**
   * 标记任务为已取消（内部方法）
   */
  instance.标记已取消 = async function(任务ID, 原因 = '') {
    const ts = createTimestampFields();
    await instance.更新状态(任务ID, 任务状态.CANCELLED, {
      取消原因: 原因,
      取消时间: ts.localTime,
      取消时间戳: ts.timestamp
    });
    return true;
  };
}
