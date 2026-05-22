/**
 * 任务队列 - 任务获取（原子抢锁） mixin
 * 从 任务队列.js 提取
 */

import { 任务状态, 任务阶段 } from '../常量.js';
import { createTimestampFields } from '@dove/common/时间工具.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('任务获取', { 前缀: '[任务获取]', 级别: 'debug', 显示调用位置: true });

export function mixinTaskClaiming(instance) {
  /**
   * 原子获取待执行任务
   * MongoDB findOneAndUpdate 是原子操作，通过服务端执行同样保持原子性
   *
   * 原则：一个任务永远只被一只鸽子独占执行
   * 状态从 pending/ready → running，原子操作保证无重复领取
   *
   * 机器亲和逻辑：
   * - 无 机器亲和 字段的任务：所有鸽子可抢
   * - 机器亲和=true 的任务：只匹配 task.machineId === dove.machineId
   * - 优先级：亲和任务优先抢取
   *
   * 【状态流转机制】
   * - 子任务创建时状态为 PENDING（待准备），不可被抢
   * - Flash 填充能力后转为 READY（已就绪），可被抢取执行
   * - 有依赖的子任务创建时状态为 BLOCKED，依赖满足后 → PENDING → READY
   * - routing/branch 任务：直接创建为 READY（无需 Flash 填充能力）
   */
  instance.获取待执行任务 = async function(鸽子ID, 能力列表 = [], 机器标识 = null) {
    // 优先走加密通道（关键操作）
    if (this.加密客户端?.connected) {
      try {
        // 所有鸽子都传 doveId，让服务端区分不同实例
        const effectiveDoveId = 鸽子ID || null;
        const result = await this.加密客户端.claimTask(能力列表, effectiveDoveId);
        if (result?.success && result?.data) {
          logger.info(`鸽子 ${鸽子ID} 通过加密通道获取任务 ${result.data.任务ID || ''}`);
          return result.data;
        }
      } catch (e) {
        logger.warn(`加密通道直接抢任务失败，通过 DovesProxy 加密代理重试: ${e.message}`);
      }
    }

    const collection = instance._获取集合();
    if (!collection) return null;

    const 能力数组 = Array.isArray(能力列表) ? 能力列表 : [];
    const ts = createTimestampFields();

    // 优先抢取本机亲和任务（如果有机器标识）
    if (机器标识) {
      const 亲和结果 = await collection.findOneAndUpdate(
        {
          $and: [
            {
              $or: [
                { 状态: 任务状态.READY },
                { 状态: 任务状态.PENDING, 类型: { $nin: ['subtask', 'subtask_d1', 'subtask_d2', 'subtask_d3'] } }
              ]
            },
            {
              $or: [
                { 所需能力: { $exists: false } },
                { 所需能力: { $size: 0 } },
                ...(能力数组.length > 0 ? [{ 所需能力: { $all: 能力数组 } }] : [])
              ]
            },
            // 无执行者（确保未被其他鸽子领取）
            {
              $or: [
                { 执行者: { $exists: false } },
                { 执行者: null },
                { 执行者: '' }
              ]
            }
          ],
          机器亲和: true,
          machineId: 机器标识
        },
        {
          $set: {
            状态: 任务状态.RUNNING,
            执行者: 鸽子ID,
            开始时间: ts.localTime,
            开始时间戳: ts.timestamp,
            领取时间: ts.localTime,
            领取时间戳: ts.timestamp,
            心跳时间: ts.localTime,
            心跳时间戳: ts.timestamp
          }
        },
        {
          returnDocument: 'after',
          sort: { 优先级: 1, 创建时间戳: 1 },
          updateOperators: true
        }
      );

      if (亲和结果) {
        logger.info(`鸽子 ${鸽子ID} 成功获取亲和任务 ${亲和结果.任务ID} (machineId=${机器标识})`);
        return 亲和结果;
      }
    }

    // 常规抢取
    const result = await collection.findOneAndUpdate(
      {
        $and: [
          {
            $or: [
              { 状态: 任务状态.READY },
              { 状态: 任务状态.PENDING, 类型: { $nin: ['subtask', 'subtask_d1', 'subtask_d2', 'subtask_d3'] } }
            ]
          },
          {
            $or: [
              { 机器亲和: { $exists: false } },
              { 机器亲和: false },
              { 机器亲和: null },
              ...(机器标识 ? [{ 机器亲和: true, machineId: 机器标识 }] : [])
            ]
          },
          {
            $or: [
              { 所需能力: { $exists: false } },
              { 所需能力: { $size: 0 } },
              ...(能力数组.length > 0 ? [{ 所需能力: { $all: 能力数组 } }] : [])
            ]
          },
          // 无执行者（确保未被其他鸽子领取）
          {
            $or: [
              { 执行者: { $exists: false } },
              { 执行者: null },
              { 执行者: '' }
            ]
          }
        ]
      },
      {
        $set: {
          状态: 任务状态.RUNNING,
          执行者: 鸽子ID,
          开始时间: ts.localTime,
          开始时间戳: ts.timestamp,
          领取时间: ts.localTime,
          领取时间戳: ts.timestamp,
          心跳时间: ts.localTime,
          心跳时间戳: ts.timestamp
        }
      },
      {
        returnDocument: 'after',
        sort: { 优先级: 1, 创建时间戳: 1 },
        updateOperators: true
      }
    );

    if (result) {
      logger.info(`鸽子 ${鸽子ID} 成功获取任务 ${result.任务ID}`);
      return result;
    }

    return null;
  };
}
