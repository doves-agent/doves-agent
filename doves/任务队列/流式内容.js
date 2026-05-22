/**
 * 任务队列 - 流式内容 mixin
 * 从 任务队列.js 提取
 */

import { createTimestampFields } from '@dove/common/时间工具.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('流式内容', { 前缀: '[流式内容]', 级别: 'debug', 显示调用位置: true });

export function mixinStreamContent(instance) {
  /**
   * 追加流式内容
   */
  instance.追加流式内容 = async function(任务ID, 内容, 类型 = 'text') {
    try {
      const collection = instance._获取集合();
      if (collection) {
        const ts = createTimestampFields();
        await collection.updateOne(
          { $or: [{ 任务ID }, { id: 任务ID }, { _id: 任务ID }] },
          { $push: { 流缓冲: { 内容, 类型, 时间: ts.localTime, 时间戳: ts.timestamp } } }
        );
      }
    } catch (error) {
      logger.error(`追加流式内容到任务 ${任务ID} 时出错: ${error.message}`);
    }
  };

  /**
   * 获取流式缓冲区
   */
  instance.获取流式缓冲 = async function(任务ID) {
    const 任务 = await instance.获取任务(任务ID, true);
    return 任务?.流缓冲 || [];
  };

  /**
   * 写入用户问题（用于 询问用户 工具）
   * @param {string} 任务ID - 目标任务ID（通常为 branch 父任务ID）
   * @param {Object} 问题数据 - 问题数据
   * @param {string} [来源子任务ID] - 可选，来源子任务ID
   */
  instance.写入用户问题 = async function(任务ID, 问题数据, 来源子任务ID) {
    try {
      logger.debug(`写入用户问题到任务 ${任务ID}${来源子任务ID ? ` (来源: ${来源子任务ID})` : ''}`);
      const collection = instance._获取集合();
      if (collection) {
        const ts = createTimestampFields();
        const 问题条目 = {
          类型: 'user_question',
          问题数据,
          时间: ts.localTime,
          时间戳: ts.timestamp
        };
        // 直接写入目标任务流缓冲（通常是 branch 父任务）
        const updateResult = await collection.updateOne(
          { 任务ID },
          { $push: { 流缓冲: { ...问题条目, ...(来源子任务ID ? { 来源子任务ID } : {}) } } }
        );
        logger.debug(`写入用户问题 updateOne 结果: matched=${updateResult.matchedCount}, modified=${updateResult.modifiedCount}`);
        // 如果目标任务不是根/branch 任务，尝试同步到父任务
        if (updateResult.matchedCount === 0) {
          logger.debug(`写入用户问题: 目标任务 ${任务ID} 未找到，尝试查找并同步到父任务`);
          const 当前任务 = await collection.findOne({ 任务ID });
          if (当前任务?.父任务ID) {
            const syncResult = await collection.updateOne(
              { 任务ID: 当前任务.父任务ID },
              { $push: { 流缓冲: { ...问题条目, 来源子任务ID: 来源子任务ID || 任务ID } } }
            );
            logger.debug(`用户问题已同步到父任务 ${当前任务.父任务ID}, matched=${syncResult.matchedCount}, modified=${syncResult.modifiedCount}`);
          } else {
            logger.debug(`写入用户问题: 任务 ${任务ID} 未找到或无父任务ID`);
          }
        }
      }
    } catch (error) {
      logger.error(`写入用户问题到任务 ${任务ID} 时出错: ${error.message}`);
    }
  };
}
