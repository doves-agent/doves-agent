/**
 * 自动化规则 子路由
 * 职责：创建/查询/更新/删除规则
 */

import { Router } from 'express';
import { logger } from '../../core.js';
import { 
  getMongoClient, getAdminDb, createTimestampFields
} from '../../db.js';
import { 记录审计 } from '../../审计日志.js';
import { toObjectId, 支持的事件 } from './breeder-helpers.js';

const router = Router();

/**
 * POST /api/breeder/rule
 * 创建自动化规则
 */
router.post('/rule', async (req, res) => {
  const userId = req.user.userId;
  const { 名称, 触发条件, 执行动作, 启用 = true } = req.body;
  
  if (!名称) {
    return res.status(400).json({ success: false, error: '规则名称不能为空' });
  }
  
  if (!触发条件?.事件) {
    return res.status(400).json({ success: false, error: '必须指定触发事件' });
  }
  
  if (!支持的事件.includes(触发条件.事件)) {
    return res.status(400).json({ success: false, error: `不支持的事件: ${触发条件.事件}`, 支持的事件 });
  }
  
  if (!执行动作?.类型) {
    return res.status(400).json({ success: false, error: '必须指定执行动作类型' });
  }
  
  const 支持的动作类型 = ['create_task', 'send_notification', 'call_webhook'];
  if (!支持的动作类型.includes(执行动作.类型)) {
    return res.status(400).json({ success: false, error: `不支持的动作类型: ${执行动作.类型}`, 支持的动作类型 });
  }
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    const ts = createTimestampFields();
    
    // 限制规则数量
    const count = await db.collection('饲养员规则').countDocuments({ 用户ID: userId });
    if (count >= 50) {
      return res.status(400).json({ success: false, error: '每个饲养员最多 50 条规则' });
    }
    
    const rule = {
      用户ID: userId,
      名称,
      触发条件,
      执行动作,
      启用,
      触发次数: 0,
      最后触发时间: null,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp,
      更新时间: ts.localTime
    };
    
    const result = await db.collection('饲养员规则').insertOne(rule);
    
    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'create_rule',
      目标ID: result.insertedId.toString(),
      结果: 'success',
      详情: { 名称, 触发事件: 触发条件.事件, 动作类型: 执行动作.类型 }
    });
    
    res.status(201).json({
      success: true,
      data: {
        ruleId: result.insertedId.toString(),
        名称,
        启用
      }
    });
  } catch (e) {
    logger.error('创建规则失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/breeder/rule
 * 列出规则
 */
router.get('/rule', async (req, res) => {
  const userId = req.user.userId;
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    
    const rules = await db.collection('饲养员规则')
      .find({ 用户ID: userId })
      .sort({ 创建时间戳: -1 })
      .toArray();
    
    res.json({ success: true, data: rules });
  } catch (e) {
    logger.error('获取规则列表失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * PUT /api/breeder/rule/:id
 * 更新规则（启用/禁用/修改）
 */
router.put('/rule/:id', async (req, res) => {
  const userId = req.user.userId;
  const { id } = req.params;
  const { 名称, 触发条件, 执行动作, 启用 } = req.body;
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    const ts = createTimestampFields();
    
    const updateFields = { 更新时间: ts.localTime };
    if (名称 !== undefined) updateFields.名称 = 名称;
    if (启用 !== undefined) updateFields.启用 = 启用;
    if (触发条件) updateFields.触发条件 = 触发条件;
    if (执行动作) updateFields.执行动作 = 执行动作;
    
    const result = await db.collection('饲养员规则').updateOne(
      { _id: toObjectId(id), 用户ID: userId },
      { $set: updateFields }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: '规则不存在' });
    }
    
    res.json({ success: true, data: { ruleId: id, updated: true } });
  } catch (e) {
    logger.error('更新规则失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * DELETE /api/breeder/rule/:id
 * 删除规则
 */
router.delete('/rule/:id', async (req, res) => {
  const userId = req.user.userId;
  const { id } = req.params;
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    
    const result = await db.collection('饲养员规则').deleteOne({ _id: toObjectId(id), 用户ID: userId });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: '规则不存在' });
    }
    
    res.json({ success: true, data: { deleted: true } });
  } catch (e) {
    logger.error('删除规则失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
