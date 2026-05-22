/**
 * 事件查询 子路由
 * 职责：事件列表/详情/限额/待处理查询
 */

import { Router } from 'express';
import { getUserDb } from '../../db.js';
import { getEventScheduler } from '../../事件调度器.js';
import { logger } from '../../core.js';

const router = Router();

/**
 * GET /api/event/list - 查看事件列表
 */
router.get('/list', async (req, res) => {
  const userId = req.user.userId;
  const { type } = req.query;
  
  try {
    const userDb = getUserDb();
    const query = { $or: [{ 用户ID: userId }, { userId }] };
    if (type) query.事件类型 = type;
    
    const 事件列表 = await userDb.collection('事件')
      .find(query)
      .sort({ 创建时间戳: -1 })
      .limit(50)
      .toArray();
    
    const 统计 = {};
    for (const evt of 事件列表) {
      统计[evt.事件类型] = (统计[evt.事件类型] || 0) + 1;
    }
    
    res.json({ success: true, data: { 事件列表, 统计 } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/event/quota - 查询事件限额使用情况
 */
router.get('/quota', async (req, res) => {
  const userId = req.user.userId;
  
  try {
    const scheduler = getEventScheduler();
    const 限额 = await scheduler.检查事件限额(userId);
    
    res.json({
      success: true,
      data: 限额
    });
  } catch (e) {
    logger.error('查询事件限额失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/event/pending - 鸽子查询待处理的交互事件
 */
router.get('/pending', async (req, res) => {
  const userId = req.user.userId;
  const { 根任务ID } = req.query;
  
  try {
    const userDb = getUserDb();
    const query = { 事件类型: 'user_interaction', 用户ID: userId, 状态: '已回复' };
    if (根任务ID) query.根任务ID = 根任务ID;
    
    const { toLocalISOString, getTimestamp } = await import('@dove/common/时间工具.js');
    
    const 已回答 = [];
    while (true) {
      const result = await userDb.collection('事件').findOneAndUpdate(
        query,
        { $set: { 状态: '已消费', 消费时间: toLocalISOString(), 消费时间戳: getTimestamp() } },
        { returnDocument: 'after', sort: { 创建时间戳: 1 } }
      );
      if (!result) break;
      已回答.push(result);
    }
    
    res.json({
      success: true,
      data: 已回答.map(e => ({
        事件ID: e.事件ID,
        根任务ID: e.根任务ID,
        问题: e.问题,
        答案: e.答案,
        回答时间: e.回答时间
      }))
    });
  } catch (e) {
    logger.error('查询待处理交互事件失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/event/:id - 查询事件详情
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;
  
  try {
    const userDb = getUserDb();
    
    const 事件 = await userDb.collection('事件').findOne({
      事件ID: id,
      $or: [{ 用户ID: userId }, { userId }]
    });
    
    if (!事件) {
      return res.status(404).json({ success: false, error: '事件不存在' });
    }
    
    res.json({ success: true, data: 事件 });
  } catch (e) {
    logger.error('查询事件详情失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
