/**
 * 事件管理 子路由
 * 职责：注册定时/语义/变更事件 + 意图驱动事件 + CRUD
 */

import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getUserDb } from '../../db.js';
import { getEventScheduler } from '../../事件调度器.js';
import { createTimestampFields } from '@dove/common/时间工具.js';
import { logger } from '../../core.js';
import * as 记忆服务 from '../../Git存储/记忆服务.js';

const router = Router();

/**
 * POST /api/event/schedule - 注册定时事件
 */
router.post('/schedule', async (req, res) => {
  const { name, cron, task } = req.body;
  const userId = req.user.userId;
  
  if (!name || !cron || !task) {
    return res.status(400).json({ success: false, error: '缺少参数: name, cron, task' });
  }
  
  try {
    const userDb = getUserDb();
    const ts = createTimestampFields();
    const scheduler = getEventScheduler();
    
    const 事件 = {
      事件ID: new ObjectId().toString(),
      事件类型: 'scheduled',
      事件名称: name,
      触发源: { 类型: 'cron', 表达式: cron },
      任务模板: task,
      状态: '活跃',
      下次触发时间: scheduler._计算下次触发时间(cron),
      重复: true,
      cron表达式: cron,
      用户ID: userId,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp,
      更新时间: ts.localTime,
      更新时间戳: ts.timestamp
    };
    
    await userDb.collection('事件').insertOne(事件);
    
    res.json({ success: true, data: 事件 });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/event/semantic - 注册语义事件
 */
router.post('/semantic', async (req, res) => {
  const { name, condition, task, threshold, llmConfirm, cooldown } = req.body;
  const userId = req.user.userId;
  
  if (!name || !condition || !task) {
    return res.status(400).json({ success: false, error: '缺少参数: name, condition, task' });
  }
  
  if (!task.用户消息) {
    return res.status(400).json({ success: false, error: '任务模板缺少用户消息' });
  }
  
  try {
    const scheduler = getEventScheduler();
    const 事件 = await scheduler.注册语义事件(condition, task, userId, {
      名称: name,
      触发阈值: threshold || 0.7,
      LLM确认: llmConfirm !== undefined ? llmConfirm : true,
      冷却时间: cooldown ? cooldown * 1000 : 300000
    });
    
    res.json({ success: true, data: 事件 });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/event/watch - 注册变更监听
 */
router.post('/watch', async (req, res) => {
  const { name, collection, condition, task } = req.body;
  const userId = req.user.userId;
  
  if (!name || !collection || !task) {
    return res.status(400).json({ success: false, error: '缺少参数: name, collection, task' });
  }
  
  try {
    const userDb = getUserDb();
    const ts = createTimestampFields();
    const scheduler = getEventScheduler();
    
    const 事件 = {
      事件ID: new ObjectId().toString(),
      事件类型: 'data_change',
      事件名称: name,
      触发源: { 类型: 'change_stream', 监听集合: collection, 监听条件: condition || null },
      任务模板: task,
      状态: '活跃',
      用户ID: userId,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp
    };
    
    await userDb.collection('事件').insertOne(事件);
    
    // 立即注册 Change Stream
    await scheduler.注册变更监听(name, collection, condition, task, userId, 事件.事件ID);
    
    res.json({ success: true, data: 事件 });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/event/intent-create - 意图驱动事件创建
 */
router.post('/intent-create', async (req, res) => {
  const { condition, action, name, userId: bodyUserId } = req.body;
  const userId = bodyUserId || req.user.userId;
  
  if (!condition || !action) {
    return res.status(400).json({ success: false, error: '缺少参数: condition, action' });
  }
  
  try {
    const scheduler = getEventScheduler();
    const 事件 = await scheduler.注册意图驱动事件(condition, action, userId, {
      名称: name || `事件: ${condition.slice(0, 20)}${condition.length > 20 ? '...' : ''}`
    });
    
    res.json({
      success: true,
      data: {
        事件ID: 事件.事件ID,
        事件名称: 事件.事件名称,
        触发条件: 事件.触发条件,
        处理动作: action,
        记忆ID: 事件.记忆ID
      }
    });
  } catch (e) {
    logger.error('创建意图驱动事件失败:', e.message);
    res.status(400).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/event/intent-handler - 意图驱动事件处理追加
 */
router.post('/intent-handler', async (req, res) => {
  const { message, action, userId: bodyUserId } = req.body;
  const userId = bodyUserId || req.user.userId;
  
  if (!message || !action) {
    return res.status(400).json({ success: false, error: '缺少参数: message, action' });
  }
  
  try {
    const scheduler = getEventScheduler();
    const 结果 = await scheduler.追加事件处理动作(message, action, userId);
    
    res.json({
      success: true,
      data: {
        匹配事件: 结果.匹配事件,
        处理ID: 结果.处理ID
      }
    });
  } catch (e) {
    logger.error('追加事件处理动作失败:', e.message);
    res.status(400).json({ success: false, error: e.message });
  }
});

// ==================== 事件CRUD与向量同步 ====================

/**
 * PATCH /api/event/:id - 修改事件触发条件
 */
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { condition, name } = req.body;
  const userId = req.user.userId;
  
  if (!condition) {
    return res.status(400).json({ success: false, error: '缺少参数: condition' });
  }
  
  try {
    const userDb = getUserDb();
    const ts = createTimestampFields();
    
    // 1. 查询事件（鉴权）
    const 事件 = await userDb.collection('事件').findOne({ 事件ID: id, $or: [{ 用户ID: userId }, { userId }] });
    if (!事件) {
      return res.status(404).json({ success: false, error: '事件不存在' });
    }
    
    // 2. 如果有旧记忆ID，删除旧记忆
    if (事件.记忆ID && 记忆服务.是否可用()) {
      try {
        await 记忆服务.删除记忆({ 记忆ID: 事件.记忆ID });
        logger.info(`[事件CRUD] 删除旧记忆: ${事件.记忆ID}`);
      } catch (e) {
        logger.warn(`[事件CRUD] 删除旧记忆失败: ${e.message}`);
      }
    }
    
    // 3. 存入新记忆
    let 新记忆ID = null;
    if (记忆服务.是否可用()) {
      try {
        const 记忆结果 = await 记忆服务.添加记忆({
          用户ID: userId,
          消息列表: [
            { role: 'system', content: `${事件.事件类型 === 'intent_driven' ? '意图驱动' : '语义'}事件触发条件` },
            { role: 'user', content: condition }
          ],
          元数据: {
            type: 'event_trigger',
            事件类型: 事件.事件类型,
            事件ID: id,
            事件名称: name || 事件.事件名称
          }
        });
        新记忆ID = 记忆结果?.id || 记忆结果?.memory_id || null;
      } catch (e) {
        logger.warn(`[事件CRUD] 存入新记忆失败: ${e.message}`);
      }
    }
    
    // 4. 更新MDB
    const 更新字段 = {
      触发条件: condition,
      记忆ID: 新记忆ID,
      更新时间: ts.localTime,
      更新时间戳: ts.timestamp
    };
    if (事件.事件类型 === 'intent_driven' || 事件.事件类型 === 'semantic') {
      更新字段['触发源.条件'] = condition;
    }
    if (name) {
      更新字段.事件名称 = name;
    }
    
    await userDb.collection('事件').updateOne(
      { 事件ID: id },
      { $set: 更新字段 }
    );
    
    logger.info(`[事件CRUD] 事件 ${id} 触发条件已更新，新记忆ID: ${新记忆ID}`);
    res.json({
      success: true,
      data: { 事件ID: id, 触发条件: condition, 记忆ID: 新记忆ID }
    });
  } catch (e) {
    logger.error('修改事件失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/event/:id/handler - 添加处理动作
 */
router.post('/:id/handler', async (req, res) => {
  const { id } = req.params;
  const { action } = req.body;
  const userId = req.user.userId;
  
  if (!action) {
    return res.status(400).json({ success: false, error: '缺少参数: action' });
  }
  
  try {
    const userDb = getUserDb();
    const ts = createTimestampFields();
    
    const 事件 = await userDb.collection('事件').findOne({ 事件ID: id, $or: [{ 用户ID: userId }, { userId }] });
    if (!事件) {
      return res.status(404).json({ success: false, error: '事件不存在' });
    }
    if (事件.事件类型 !== 'intent_driven') {
      return res.status(400).json({ success: false, error: '仅意图驱动事件支持添加处理动作' });
    }
    
    const 当前处理数 = (事件.事件处理列表 || []).length;
    if (当前处理数 >= 5) {
      return res.status(400).json({ success: false, error: '该事件的处理动作已达上限（5个）' });
    }
    
    const 新处理 = {
      处理ID: 'h-' + Math.random().toString(16).substr(2, 6),
      处理描述: action,
      任务模板: { 用户消息: action },
      启用: true,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp
    };
    
    await userDb.collection('事件').updateOne(
      { 事件ID: id },
      {
        $push: { 事件处理列表: 新处理 },
        $set: { 更新时间: ts.localTime, 更新时间戳: ts.timestamp }
      }
    );
    
    logger.info(`[事件CRUD] 事件 ${id} 添加处理动作: ${新处理.处理ID}`);
    res.json({ success: true, data: 新处理 });
  } catch (e) {
    logger.error('添加处理动作失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * DELETE /api/event/:id/handler/:hid - 删除处理动作
 */
router.delete('/:id/handler/:hid', async (req, res) => {
  const { id, hid } = req.params;
  const userId = req.user.userId;
  
  try {
    const userDb = getUserDb();
    const ts = createTimestampFields();
    
    const 事件 = await userDb.collection('事件').findOne({ 事件ID: id, $or: [{ 用户ID: userId }, { userId }] });
    if (!事件) {
      return res.status(404).json({ success: false, error: '事件不存在' });
    }
    
    const 处理列表 = 事件.事件处理列表 || [];
    const 目标处理 = 处理列表.find(h => h.处理ID === hid);
    if (!目标处理) {
      return res.status(404).json({ success: false, error: '处理动作不存在' });
    }
    
    if (处理列表.length <= 1) {
      return res.status(400).json({ success: false, error: '事件至少需要保留一个处理动作，如需删除请直接删除事件' });
    }
    
    await userDb.collection('事件').updateOne(
      { 事件ID: id },
      {
        $pull: { 事件处理列表: { 处理ID: hid } },
        $set: { 更新时间: ts.localTime, 更新时间戳: ts.timestamp }
      }
    );
    
    logger.info(`[事件CRUD] 事件 ${id} 删除处理动作: ${hid}`);
    res.json({ success: true, data: { 删除的处理ID: hid } });
  } catch (e) {
    logger.error('删除处理动作失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/event/:id/disable - 禁用事件
 */
router.post('/:id/disable', async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;
  
  try {
    const userDb = getUserDb();
    const ts = createTimestampFields();
    
    const result = await userDb.collection('事件').findOneAndUpdate(
      { 事件ID: id, $or: [{ 用户ID: userId }, { userId }], 状态: { $ne: '已禁用' } },
      {
        $set: {
          状态: '已禁用',
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp
        }
      },
      { returnDocument: 'after' }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, error: '事件不存在或已禁用' });
    }
    
    logger.info(`[事件CRUD] 事件 ${id} 已禁用`);
    res.json({ success: true, data: { 事件ID: id, 状态: '已禁用' } });
  } catch (e) {
    logger.error('禁用事件失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/event/:id/enable - 启用事件
 */
router.post('/:id/enable', async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;
  
  try {
    const userDb = getUserDb();
    const ts = createTimestampFields();
    
    const 事件 = await userDb.collection('事件').findOne({
      事件ID: id,
      $or: [{ 用户ID: userId }, { userId }],
      状态: { $in: ['已禁用', '已耗尽'] }
    });
    
    if (!事件) {
      return res.status(404).json({ success: false, error: '事件不存在或不可启用（可能已是active状态）' });
    }
    
    const 更新字段 = {
      状态: '活跃',
      更新时间: ts.localTime,
      更新时间戳: ts.timestamp
    };
    
    if (事件.状态 === '已耗尽' && 事件.最大触发次数 !== null && 事件.最大触发次数 !== undefined) {
      更新字段.剩余触发次数 = 事件.最大触发次数;
      logger.info(`[事件CRUD] 事件 ${id} 从已耗尽恢复，重置剩余触发次数为 ${事件.最大触发次数}`);
    }
    
    const result = await userDb.collection('事件').findOneAndUpdate(
      { 事件ID: id, $or: [{ 用户ID: userId }, { userId }], 状态: { $in: ['已禁用', '已耗尽'] } },
      { $set: 更新字段 },
      { returnDocument: 'after' }
    );
    
    logger.info(`[事件CRUD] 事件 ${id} 已启用`);
    res.json({ success: true, data: { 事件ID: id, 状态: '活跃', 剩余触发次数: result?.剩余触发次数 } });
  } catch (e) {
    logger.error('启用事件失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * DELETE /api/event/:id - 删除事件（软删除 + 同步记忆服务）
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;
  
  try {
    const userDb = getUserDb();
    const ts = createTimestampFields();
    
    const 事件 = await userDb.collection('事件').findOne({ 
      事件ID: id, 
      $or: [{ 用户ID: userId }, { userId }],
      状态: { $ne: '已禁用' }
    });
    
    if (!事件) {
      return res.status(404).json({ success: false, error: '事件不存在或已删除' });
    }
    
    if (事件.记忆ID && 记忆服务.是否可用()) {
      try {
        await 记忆服务.删除记忆({ 记忆ID: 事件.记忆ID });
        logger.info(`[事件CRUD] 删除事件 ${id} 关联记忆: ${事件.记忆ID}`);
      } catch (e) {
        logger.warn(`[事件CRUD] 删除关联记忆失败（事件仍会删除）: ${e.message}`);
      }
    }
    
    const result = await userDb.collection('事件').updateOne(
      { 事件ID: id, $or: [{ 用户ID: userId }, { userId }] },
      {
        $set: {
          状态: '已禁用',
          删除时间: ts.localTime,
          删除时间戳: ts.timestamp,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp
        }
      }
    );
    
    logger.info(`[事件CRUD] 软删除事件: ${id}`);
    res.json({ success: true, deleted: result.modifiedCount });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
