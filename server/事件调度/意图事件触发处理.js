/**
 * 意图事件触发处理
 * 由 事件调度器._处理意图事件触发 动态导入
 * 原子抢锁 → 读取事件处理列表 → 为每个启用处理动作创建标准任务 → 释放锁
 */

import { getUserDb } from '../db.js';
import { toLocalISOString, getTimestamp } from '@dove/common/时间工具.js';
import { logger } from '../core.js';

/**
 * 处理意图事件触发（作为 事件调度器 的实例方法调用）
 * @this {import('../事件调度器.js').事件调度器}
 * @param {Object} 事件 - 事件文档
 * @param {string} SERVER_INSTANCE_ID - 服务器实例ID
 */
export default async function _处理意图事件触发(事件, SERVER_INSTANCE_ID) {
  const userDb = getUserDb();
  const 事件集合 = userDb.collection('事件');
  const 任务集合 = userDb.collection('任务');
  const 事件ID = 事件.事件ID;
  
  // 1. 原子抢锁：触发中 = false → true
  const 抢锁结果 = await 事件集合.findOneAndUpdate(
    { 事件ID, 触发中: { $ne: true } },
    { $set: { 触发中: true, 触发者实例: SERVER_INSTANCE_ID } },
    { returnDocument: 'after' }
  );
  
  if (!抢锁结果) {
    logger.debug(`[事件调度器] 意图事件 ${事件ID} 已被其他实例处理，跳过`);
    return;
  }
  
  const 锁定事件 = 抢锁结果;
  
  try {
    const 处理列表 = 锁定事件.事件处理列表 || [];
    const 启用处理列表 = 处理列表.filter(h => h.启用);
    
    if (启用处理列表.length === 0) {
      logger.info(`[事件调度器] 意图事件 ${事件ID} 无启用处理动作，跳过`);
      await 事件集合.updateOne(
        { 事件ID },
        {
          $set: { 触发中: false, 触发者实例: null },
          $unset: { 待处理触发: '' }
        }
      );
      return;
    }
    
    const 最新触发记录 = (锁定事件.触发记录 || []).slice(-1)[0] || {};
    
    const 创建的任务列表 = [];
    for (const 处理 of 启用处理列表) {
      try {
        const 任务消息 = 处理.任务模板?.用户消息 || '';
        const 任务模板 = {
          用户消息: 任务消息,
          分类: '系统任务',
          复杂度: 'low',
          能力需求: ['推理'],
          策略: '简单执行',
          执行模式: '直接执行'
        };
        
        const 任务 = this._创建任务文档(任务模板, 锁定事件.userId, 事件ID);
        
        任务.routing.触发类型 = 'intent_event';
        任务.routing.触发事件ID = 事件ID;
        任务.routing.触发处理ID = 处理.处理ID;
        任务.routing.触发摘要 = 最新触发记录.触发摘要 || '';
        任务.routing.触发对话ID = 最新触发记录.触发对话ID || '';
        
        创建的任务列表.push(任务);
      } catch (e) {
        logger.error(`[事件调度器] 创建处理动作任务失败 (${处理.处理ID}): ${e.message}`);
      }
    }
    
    if (创建的任务列表.length > 0) {
      await 任务集合.insertMany(创建的任务列表);

      // 投递通知
      import('../通知服务.js').then(({ 投递通知 }) => {
        投递通知({
          userId: 锁定事件.userId,
          来源类型: 'event',
          来源ID: 事件ID,
          来源名称: 锁定事件.事件名称 || '意图事件',
          标题: `事件触发: ${锁定事件.事件名称 || '意图事件'}`,
          摘要: `意图事件「${锁定事件.事件名称 || ''}」匹配成功，创建了 ${创建的任务列表.length} 个任务`,
        }).catch(() => {});
      }).catch(() => {});
      
      const 任务ID列表 = 创建的任务列表.map(t => t.任务ID);
      if (最新触发记录.触发时间戳) {
        await 事件集合.updateOne(
          { 事件ID },
          {
            $set: {
              '触发记录.$[elem].创建的任务ID': 任务ID列表.join(','),
              更新时间: toLocalISOString(new Date()),
              更新时间戳: getTimestamp()
            }
          },
          { arrayFilters: [{ 'elem.触发时间戳': 最新触发记录.触发时间戳 }] }
        );
      }
      
      if (锁定事件.最大触发次数 !== null && 锁定事件.最大触发次数 !== undefined) {
        const 递减结果 = await 事件集合.findOneAndUpdate(
          { 事件ID, 剩余触发次数: { $gt: 0 } },
          { $inc: { 剩余触发次数: -1 } },
          { returnDocument: 'after' }
        );
        if (递减结果 && 递减结果.剩余触发次数 <= 0) {
          await 事件集合.updateOne(
            { 事件ID, 状态: { $ne: '已耗尽' } },
            { $set: { 状态: '已耗尽' } }
          );
          logger.info(`[事件调度器] 意图事件 ${事件ID} 触发次数耗尽，标记已耗尽`);
        } else if (!递减结果) {
          await 事件集合.updateOne(
            { 事件ID, 状态: { $ne: '已耗尽' } },
            { $set: { 状态: '已耗尽' } }
          );
          logger.info(`[事件调度器] 意图事件 ${事件ID} 剩余次数为0，标记exhausted`);
        }
      }
      
      logger.info(`[事件调度器] 意图事件 ${事件ID} 触发 → 创建 ${创建的任务列表.length} 个任务: ${任务ID列表.join(', ')}`);
    }
    
  } finally {
    await 事件集合.updateOne(
      { 事件ID },
      {
        $set: { 触发中: false, 触发者实例: null },
        $unset: { 待处理触发: '' }
      }
    );
  }
}
