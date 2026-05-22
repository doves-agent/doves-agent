import { Router } from 'express';
import { getUserDb, getAdminDb } from '../db.js';
import { toLocalISOString, getTimestamp } from '../../common/时间工具.js';
import { logger } from '../core.js';

const router = Router();

/**
 * GET /api/notify/summary - 未读通知摘要（类型+数量）
 */
router.get('/summary', async (req, res) => {
  const userId = req.user.userId;

  try {
    const userDb = getUserDb();
    const 通知集合 = userDb.collection('通知');

    const 未读列表 = await 通知集合.find({
      userId,
      投递状态: { $in: ['pending', 'delivered', 'failed'] }
    }).sort({ 创建时间戳: -1 }).limit(100).toArray();

    const 未读总数 = 未读列表.length;
    const 按来源 = {};
    for (const n of 未读列表) {
      按来源[n.来源类型] = (按来源[n.来源类型] || 0) + 1;
    }

    const 最近一条 = 未读列表[0] ? {
      标题: 未读列表[0].标题,
      创建时间: 未读列表[0].创建时间,
    } : null;

    res.json({ success: true, data: { 未读总数, 按来源, 最近一条 } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/notify/list - 通知列表
 * query: status (pending/delivered/failed/read), limit, offset
 */
router.get('/list', async (req, res) => {
  const userId = req.user.userId;
  const { status, limit = '20', offset = '0' } = req.query;

  try {
    const userDb = getUserDb();
    const query = { userId };
    if (status) {
      query.投递状态 = status;
    } else {
      query.投递状态 = { $ne: 'read' };
    }

    const 总数 = await userDb.collection('通知').countDocuments(query);
    const 列表 = await userDb.collection('通知')
      .find(query)
      .sort({ 创建时间戳: -1 })
      .skip(Number(offset))
      .limit(Math.min(Number(limit), 50))
      .toArray();

    res.json({ success: true, data: { 总数, 列表 } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/notify/read - 批量标记已读
 * body: { ids: [通知ID, ...] }  不传 ids 则全部已读
 */
router.post('/read', async (req, res) => {
  const userId = req.user.userId;
  const { ids } = req.body || {};

  try {
    const userDb = getUserDb();
    const query = { userId, 投递状态: { $ne: 'read' } };
    if (ids && ids.length > 0) {
      query.通知ID = { $in: ids };
    }

    const result = await userDb.collection('通知').updateMany(
      query,
      { $set: { 投递状态: 'read', 读取时间: toLocalISOString(new Date()) } }
    );

    res.json({ success: true, data: { 已标记: result.modifiedCount } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/notify/config - 获取通知配置
 */
router.get('/config', async (req, res) => {
  const userId = req.user.userId;

  try {
    const adminDb = getAdminDb();
    const 用户 = await adminDb.collection('用户').findOne({ 用户ID: userId });
    const 通知配置 = 用户?.通知配置 || { 默认渠道: null, 渠道列表: [], 事件通知: true };

    res.json({ success: true, data: 通知配置 });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/notify/config - 更新通知配置
 * body: { 默认渠道, 渠道列表, 静默时段, 事件通知 }
 */
router.post('/config', async (req, res) => {
  const userId = req.user.userId;
  const { 默认渠道, 渠道列表, 静默时段, 事件通知 } = req.body || {};

  try {
    const adminDb = getAdminDb();
    const 更新 = {};

    if (默认渠道 !== undefined) 更新['通知配置.默认渠道'] = 默认渠道;
    if (渠道列表 !== undefined) 更新['通知配置.渠道列表'] = 渠道列表;
    if (静默时段 !== undefined) 更新['通知配置.静默时段'] = 静默时段;
    if (事件通知 !== undefined) 更新['通知配置.事件通知'] = 事件通知;

    if (Object.keys(更新).length === 0) {
      return res.status(400).json({ success: false, error: '无更新字段' });
    }

    await adminDb.collection('用户').updateOne(
      { 用户ID: userId },
      { $set: 更新 }
    );

    res.json({ success: true, message: '通知配置已更新' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
