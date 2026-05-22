/**
 * 任务队列 - 任务释放恢复 + 心跳 mixin
 * 从 任务队列.js 提取
 */

import { 任务状态 } from '../常量.js';
import { createTimestampFields, getTimestamp } from '@dove/common/时间工具.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('任务释放', { 前缀: '[任务释放]', 级别: 'debug', 显示调用位置: true });

export function mixinTaskRelease(instance) {
  /**
   * 释放任务（将 running 任务放回 ready 状态）
   */
  instance.释放任务 = async function(任务ID, 原因 = '鸽子停止') {
    logger.info(`释放任务 ${任务ID}，原因: ${原因}`);
    
    // 优先走加密通道（关键操作）
    if (this.加密客户端?.connected && this.鸽子ID) {
      try {
        const result = await this.加密客户端.abandonTask(任务ID, this.鸽子ID, 原因);
        if (result?.success) {
          logger.info(`通过加密通道释放任务 ${任务ID}`);
          return true;
        }
      } catch (e) {
        logger.warn(`加密通道直接释放失败，通过 DovesProxy 加密代理重试: ${e.message}`);
      }
    }
    
    const collection = instance._获取集合();
    if (!collection) return false;
    const ts = createTimestampFields();
    const result = await collection.findOneAndUpdate(
      {
        $or: [{ 任务ID }, { id: 任务ID }, { _id: 任务ID }],
        状态: { $in: [任务状态.RUNNING, 任务状态.WAITING_CHILDREN] }
      },
      {
        $set: {
          状态: 任务状态.READY,
          执行者: null,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp,
          释放原因: 原因,
          释放时间: ts.localTime
        }
      },
      { returnDocument: 'after' }
    );
    if (result) {
      logger.info(`任务 ${任务ID} 已释放回 ready 状态，原因: ${原因}`);
      return true;
    }
    logger.debug(`任务 ${任务ID} 不在 running/waiting_children 状态，跳过释放`);
    return false;
  };

  /**
   * 批量释放指定鸽子的所有 running 任务
   */
  instance.释放鸽子任务 = async function(鸽子ID, 原因 = '鸽子停止') {
    logger.info(`释放鸽子 ${鸽子ID} 的所有 running 任务`);
    const collection = instance._获取集合();
    if (!collection) return 0;
    const ts = createTimestampFields();
    const result = await collection.updateMany(
      {
        执行者: 鸽子ID,
        状态: { $in: [任务状态.RUNNING, 任务状态.WAITING_CHILDREN] }
      },
      {
        $set: {
          状态: 任务状态.READY,
          执行者: null,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp,
          释放原因: 原因,
          释放时间: ts.localTime
        }
      }
    );
    logger.info(`已释放鸽子 ${鸽子ID} 的 ${result.modifiedCount} 个任务`);

    return result.modifiedCount;
  };

  /**
   * 查询指定鸽子的 running 任务
   */
  instance.查询鸽子任务 = async function(鸽子ID) {
    const collection = instance._获取集合();
    if (!collection) return [];
    const 任务列表 = await collection.find({
      执行者: 鸽子ID,
      状态: { $in: [任务状态.RUNNING, 任务状态.WAITING_CHILDREN] }
    }).toArray();
    if (任务列表.length > 0) {
      logger.debug(`鸽子 ${鸽子ID} 有 ${任务列表.length} 个未完成任务`);
    }
    return 任务列表;
  };

  /**
   * 更新任务心跳
   */
  instance.更新心跳 = async function(任务ID, 鸽子ID) {
    // 优先走加密通道（关键操作）
    if (this.加密客户端?.connected && this.鸽子ID) {
      try {
        const result = await this.加密客户端.heartbeat(this.鸽子ID);
        if (result?.success) {
          return;  // 加密通道心跳成功
        }
      } catch (e) {
        // 加密心跳直接失败，通过 DovesProxy 加密代理重试
      }
    }
    
    logger.debug(`更新任务 ${任务ID} 心跳，鸽子: ${鸽子ID}`);
    const collection = instance._获取集合();
    if (collection) {
      const ts = createTimestampFields();
      await collection.updateOne(
        { $or: [{ 任务ID }, { id: 任务ID }, { _id: 任务ID }] },
        { $set: { 心跳时间: ts.localTime, 心跳时间戳: ts.timestamp } }
      );
    }
  };

  /**
   * 检测超时任务
   */
  instance.检测超时任务 = async function(超时阈值 = 120000) {
    const 运行中任务 = await instance.按状态查询(任务状态.RUNNING);
    const 超时任务 = [];
    const nowTs = getTimestamp();
    for (const 任务 of 运行中任务) {
      if (任务.心跳时间戳) {
        if (nowTs - 任务.心跳时间戳 > 超时阈值) {
          超时任务.push(任务);
        }
      }
    }
    return 超时任务;
  };
}
