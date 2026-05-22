/**
 * 任务模板 子路由
 * 职责：创建/查询/更新/删除/使用模板
 */

import { Router } from 'express';
import { logger } from '../../core.js';
import { 
  getMongoClient, getAdminDb, createTimestampFields
} from '../../db.js';
import { toObjectId } from './breeder-helpers.js';

const router = Router();

/**
 * POST /api/breeder/template
 * 创建任务模板
 */
router.post('/template', async (req, res) => {
  const userId = req.user.userId;
  const { 名称, 描述, 任务配置, 公开 = false } = req.body;
  
  if (!名称) {
    return res.status(400).json({ success: false, error: '模板名称不能为空' });
  }
  
  if (!任务配置) {
    return res.status(400).json({ success: false, error: '必须提供任务配置' });
  }
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    const ts = createTimestampFields();
    
    const template = {
      用户ID: userId,
      名称,
      描述: 描述 || '',
      任务配置,
      公开,
      使用次数: 0,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp,
      更新时间: ts.localTime
    };
    
    const result = await db.collection('任务模板').insertOne(template);
    
    res.status(201).json({
      success: true,
      data: {
        templateId: result.insertedId.toString(),
        名称,
        公开
      }
    });
  } catch (e) {
    logger.error('创建模板失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/breeder/template
 * 列出模板（包含自己的和公开的）
 */
router.get('/template', async (req, res) => {
  const userId = req.user.userId;
  const { 类型 = 'all' } = req.query;  // all / mine / public
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    
    let query = {};
    if (类型 === 'mine') {
      query = { 用户ID: userId };
    } else if (类型 === 'public') {
      query = { 公开: true };
    } else {
      query = { $or: [{ 用户ID: userId }, { 公开: true }] };
    }
    
    const templates = await db.collection('任务模板')
      .find(query)
      .sort({ 创建时间戳: -1 })
      .toArray();
    
    res.json({ success: true, data: templates });
  } catch (e) {
    logger.error('获取模板列表失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/breeder/template/:id
 * 获取模板详情
 */
router.get('/template/:id', async (req, res) => {
  const userId = req.user.userId;
  const { id } = req.params;
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    
    const template = await db.collection('任务模板').findOne({ _id: toObjectId(id) });
    
    if (!template) {
      return res.status(404).json({ success: false, error: '模板不存在' });
    }
    
    // 私有模板只有创建者可访问
    if (!template.公开 && template.用户ID !== userId) {
      return res.status(403).json({ success: false, error: '无权访问此模板' });
    }
    
    res.json({ success: true, data: template });
  } catch (e) {
    logger.error('获取模板详情失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * PUT /api/breeder/template/:id
 * 更新模板
 */
router.put('/template/:id', async (req, res) => {
  const userId = req.user.userId;
  const { id } = req.params;
  const { 名称, 描述, 任务配置, 公开 } = req.body;
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    const ts = createTimestampFields();
    
    const updateFields = { 更新时间: ts.localTime };
    if (名称 !== undefined) updateFields.名称 = 名称;
    if (描述 !== undefined) updateFields.描述 = 描述;
    if (任务配置) updateFields.任务配置 = 任务配置;
    if (公开 !== undefined) updateFields.公开 = 公开;
    
    const result = await db.collection('任务模板').updateOne(
      { _id: toObjectId(id), 用户ID: userId },
      { $set: updateFields }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: '模板不存在或无权修改' });
    }
    
    res.json({ success: true, data: { templateId: id, updated: true } });
  } catch (e) {
    logger.error('更新模板失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * DELETE /api/breeder/template/:id
 * 删除模板
 */
router.delete('/template/:id', async (req, res) => {
  const userId = req.user.userId;
  const { id } = req.params;
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    
    const result = await db.collection('任务模板').deleteOne({ _id: toObjectId(id), 用户ID: userId });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: '模板不存在或无权删除' });
    }
    
    res.json({ success: true, data: { deleted: true } });
  } catch (e) {
    logger.error('删除模板失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/breeder/template/:id/use
 * 记录模板使用（递增使用次数）
 */
router.post('/template/:id/use', async (req, res) => {
  const { id } = req.params;
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    
    const result = await db.collection('任务模板').updateOne(
      { _id: toObjectId(id) },
      { $inc: { 使用次数: 1 } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: '模板不存在' });
    }
    
    res.json({ success: true, data: { incremented: true } });
  } catch (e) {
    logger.error('记录模板使用失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
