/**
 * 任务队列 - 检查点保存与恢复 mixin
 * 从 任务队列.js 提取
 */

import { createTimestampFields } from '@dove/common/时间工具.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('检查点', { 前缀: '[检查点]', 级别: 'debug', 显示调用位置: true });

export function mixinCheckpoint(instance) {
  /**
   * 保存任务检查点
   */
  instance.保存检查点 = async function(任务ID, 检查点数据) {
    logger.debug(`保存任务 ${任务ID} 的检查点`);
    const collection = instance._获取集合();
    if (collection) {
      const ts = createTimestampFields();
      await collection.updateOne(
        { $or: [{ 任务ID }, { id: 任务ID }, { _id: 任务ID }] },
        { $set: { 检查点: { ...检查点数据, 保存时间: ts.localTime, 保存时间戳: ts.timestamp } } }
      );
    }
    return true;
  };

  /**
   * 恢复检查点
   */
  instance.恢复检查点 = async function(任务ID) {
    logger.debug(`恢复任务 ${任务ID} 的检查点`);
    const 任务 = await instance.获取任务(任务ID);
    if (任务 && 任务.检查点) {
      return 任务.检查点;
    }
    return null;
  };
}
