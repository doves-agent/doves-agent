/**
 * 鸽子配置 + 管理后台 子路由
 * 职责：系统配置/用户密钥/模型设置/管理数据库操作
 */

import { Router } from 'express';
import { logger } from '../../core.js';
import { 
  getMongoClient, getAdminDb, getSystemConfig,
  createTimestampFields
} from '../../db.js';
import { SYSTEM_MODEL_DEFAULTS } from '@dove/common/模型配置.js';
import 注册服务 from '../../白鸽注册服务.js';
const { DEFAULT_CONFIG } = 注册服务;

const router = Router();

/**
 * GET /api/dove/config/defaults
 * 获取注册配置默认值
 */
router.get('/config/defaults', (req, res) => {
  res.json({
    success: true,
    data: DEFAULT_CONFIG
  });
});

/**
 * 获取系统配置（鸽子专用）
 */
router.get('/config', async (req, res) => {
  try {
    const config = getSystemConfig();
    
    res.json({
      success: true,
      data: {
        ...config,
        timestamp: new Date().toISOString()
      }
    });
  } catch (e) {
    logger.error('获取系统配置失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 获取用户 API 密钥配置
 * 
 * 权限规则：
 * - 用户自己可访问
 * - 管理员可访问
 * - 鸽子（apikey 认证）可访问（鸽子代表用户执行任务，需读取用户配置）
 */
router.get('/user-keys/:userId', async (req, res) => {
  const { userId } = req.params;
  const isDove = req.user.authType === 'apikey' || req.user.doveId;
  
  if (req.user.userId !== userId && req.user.role !== 'admin' && !isDove) {
    return res.status(403).json({ success: false, error: '无权访问' });
  }
  
  try {
    const adminDb = getAdminDb();
    const userKeys = await adminDb.collection('API密钥').findOne({ 用户ID: userId });
    
    if (!userKeys) {
      return res.json({ success: true, data: null });
    }
    
    res.json({ 
      success: true, 
      data: {
        userId: userKeys.用户ID || userKeys.userId,
        bailian: userKeys.bailian ? { configured: true } : null,
        deepseek: userKeys.deepseek ? { configured: true } : null,
        glm: userKeys.glm ? { configured: true } : null,
        // 包含 modelSettings（如果用户有配置）
        modelSettings: userKeys.modelSettings || null
      }
    });
  } catch (e) {
    logger.error('获取用户密钥失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 获取用户模型配置（合并后：用户 > 管理员默认 > 系统默认）
 * 供鸽子侧的 DovesProxy 调用
 * 
 * 权限规则：
 * - 用户自己可访问
 * - 管理员可访问
 * - 鸽子（apikey 认证）可访问（鸽子代表用户执行任务，需读取用户模型配置）
 */
router.get('/user-model-settings/:userId', async (req, res) => {
  const { userId } = req.params;
  const isDove = req.user.authType === 'apikey' || req.user.doveId;
  
  if (req.user.userId !== userId && req.user.role !== 'admin' && !isDove) {
    return res.status(403).json({ success: false, error: '无权访问' });
  }
  
  try {
    const adminDb = getAdminDb();
    
    // 1. 读取用户自己的配置
    const userConfig = await adminDb.collection('API密钥').findOne({ 用户ID: userId });
    const userModelSettings = userConfig?.modelSettings || null;
    
    // 2. 读取管理员全局默认配置
    const adminDefaults = await adminDb.collection('系统配置').findOne({ _id: 'model_defaults' });
    const adminModelSettings = adminDefaults?.modelSettings || null;
    
    // 3. 合并：用户 > 管理员默认 > 系统硬编码（从 common/模型配置.js 统一导入）
    // 修改默认值请编辑 common/模型配置.js
    
    const merged = {};
    for (const role of Object.keys(SYSTEM_MODEL_DEFAULTS)) {
      const userVal = userModelSettings?.[role];
      const adminVal = adminModelSettings?.[role];
      const systemVal = SYSTEM_MODEL_DEFAULTS[role];
      
      if (userVal?.provider && userVal?.model) {
        merged[role] = { ...userVal, _source: 'user' };
      } else if (adminVal?.provider && adminVal?.model) {
        merged[role] = { ...adminVal, _source: 'admin' };
      } else {
        merged[role] = { ...systemVal, _source: 'system' };
      }
    }
    
    res.json({
      success: true,
      data: merged
    });
  } catch (e) {
    logger.error('获取用户模型配置失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 管理数据库操作代理（受限）
 * 仅允许特定集合的特定操作
 */
router.post('/admin/:collection/:action', async (req, res) => {
  const { collection, action } = req.params;
  const { query, update, doc, options } = req.body;
  const user = req.user;
  const isDove = user.authType === 'apikey' || user.doveId;
  const doveId = user.doveId;
  const isAdmin = user.role === '---admin---';
  
  const allowedCollections = ['鸽子身份', 'API密钥', '技能', '能力'];
  if (!allowedCollections.includes(collection)) {
    return res.status(400).json({ success: false, error: `不允许访问集合: ${collection}` });
  }
  
  const allowedActions = ['findOne', 'find', 'insertOne', 'updateOne', 'deleteOne'];
  if (!allowedActions.includes(action)) {
    return res.status(400).json({ success: false, error: `不允许执行操作: ${action}` });
  }
  
  // 鸽子级别的集合访问限制
  if (isDove && !isAdmin) {
    if ((collection === '技能' || collection === '能力') && 
        ['insertOne', 'updateOne', 'deleteOne'].includes(action)) {
      return res.status(403).json({ success: false, error: `鸽子对「${collection}」集合只有只读权限` });
    }
    
    if (collection === 'API密钥') {
      if (['insertOne', 'updateOne', 'deleteOne'].includes(action)) {
        return res.status(403).json({ success: false, error: '鸽子对API密钥集合只有只读权限' });
      }
      if (action === 'findOne' || action === 'find') {
        if (!query) {
          return res.status(400).json({ success: false, error: '查询条件必填' });
        }
        if (query.doveId !== doveId && query._id !== user.keyId) {
          return res.status(403).json({ success: false, error: '只能查询自己的API密钥' });
        }
      }
    }
    
    if (collection === '鸽子身份') {
      if (action === 'findOne' || action === 'find') {
        query.鸽子ID = doveId;
      }
      if (action === 'updateOne') {
        if (!query || query.鸽子ID !== doveId) {
          query.鸽子ID = doveId;
        }
      }
      if (action === 'insertOne' || action === 'deleteOne') {
        return res.status(403).json({ success: false, error: '鸽子身份的创建和删除请使用注册API' });
      }
    }
  }
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    const coll = adminDb.collection(collection);
    
    let result;
    
    switch (action) {
      case 'findOne':
        result = await coll.findOne(query, options);
        break;
      case 'find':
        const cursor = coll.find(query, options);
        if (options?.sort) cursor.sort(options.sort);
        if (options?.limit) cursor.limit(options.limit);
        if (options?.skip) cursor.skip(options.skip);
        result = await cursor.toArray();
        break;
      case 'insertOne':
        const ts = createTimestampFields();
        const insertDoc = { ...doc, 创建时间: ts.localTime, 创建时间戳: ts.timestamp };
        const insertResult = await coll.insertOne(insertDoc);
        result = { insertedId: insertResult.insertedId, ...insertDoc };
        break;
      case 'updateOne':
        const updateTs = createTimestampFields();
        result = await coll.updateOne(
          query,
          { $set: { ...update, 更新时间: updateTs.localTime, 更新时间戳: updateTs.timestamp } },
          options
        );
        break;
      case 'deleteOne':
        result = await coll.deleteOne(query, options);
        break;
      default:
        return res.status(400).json({ success: false, error: '未知操作' });
    }
    
    // 过滤响应中的敏感字段
    if (collection === 'API密钥') {
      const filterSensitive = (doc) => {
        if (!doc) return doc;
        const { keySecret, ...safe } = doc;
        return safe;
      };
      if (Array.isArray(result)) {
        result = result.map(filterSensitive);
      } else {
        result = filterSensitive(result);
      }
    }
    
    res.json({ success: true, data: result });
  } catch (e) {
    logger.error('管理数据库操作失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
