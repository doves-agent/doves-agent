/**
 * 白鸽服务端管理员路由
 * 职责：系统诊断、凭证管理
 */

import { Router } from 'express';
import { CONFIG, QUOTAS, logger } from '../core.js';
import { PROVIDER_TEST_ENDPOINTS, normalizeProvider } from '../../common/模型配置.js';
import {
  getMongoClient, getAdminDb, getUserDb, getSystemConfig,
  getLLMConfig, getOSSConfig, getOSSClient, resetOSSClient,
  updateSystemConfigCache, toLocalISOString, createTimestampFields
} from '../db.js';
import {
  获取限流名单, 持久化限流IP, 持久化移除限流IP, getRateLimitStats
} from '../middleware/rate-limiter.js';

const router = Router();

/**
 * 系统诊断接口
 * 超管：查看全部鸽子 + 系统统计
 * 普通用户：仅查看自己饲养的鸽子
 */
router.get('/diagnostic', async (req, res) => {
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    const userDb = getUserDb();
    const userId = req.user.userId;
    const isAdmin = req.user.role === 'admin';
    
    const adminStats = await adminDb.command({ dbStats: 1 });
    const userStats = await userDb.command({ dbStats: 1 });
    
    const usersCount = await adminDb.collection('用户').countDocuments({});
    const activeUsers = await adminDb.collection('用户')
      .countDocuments({ 最后登录时间: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } });
    
    const tasksStats = await userDb.collection('任务').aggregate([
      { $group: { _id: '$状态', count: { $sum: 1 } } }
    ]).toArray();
    
    // 查询鸽子：超管查全部，普通用户只看自己的
    const 鸽子查询条件 = isAdmin ? {} : { 饲养员ID: userId };
    const 鸽子身份列表 = await adminDb.collection('鸽子身份').find(
      鸽子查询条件,
      { projection: { 鸽子ID: 1, 名称: 1, 状态: 1, 最后心跳时间: 1, 最后心跳时间戳: 1, 能力列表: 1, 鸽子类型: 1, 饲养员ID: 1, '负载.活跃任务数': 1 } }
    ).toArray();

    const doves = 鸽子身份列表.map(d => {
      const heartbeatTs = d.最后心跳时间戳 || (d.最后心跳时间 ? new Date(d.最后心跳时间).getTime() : 0);
      const isOnline = heartbeatTs && (Date.now() - heartbeatTs < 120000); // 2分钟内有心跳视为在线
      return {
        id: d.鸽子ID,
        name: d.名称,
        platform: d.鸽子类型 || 'official',
        status: isOnline ? (d.状态 === '忙碌' ? '忙碌' : '在线') : '离线',
        capabilities: d.能力列表 || [],
        lastHeartbeat: d.最后心跳时间,
        activeTasks: d.负载?.活跃任务数 || 0,
        keeperId: d.饲养员ID
      };
    });
    
    // 非超管用户：只返回自己的鸽子信息，不暴露系统统计
    if (!isAdmin) {
      return res.json({
        success: true,
        data: {
          timestamp: toLocalISOString(),
          doves: { count: doves.length, online: doves.filter(d => d.status === '在线' || d.status === '忙碌').length, instances: doves }
        }
      });
    }

    // 超管：返回完整系统统计
    let ossStats = { enabled: CONFIG.ossEnabled, totalSize: 0, files: 0 };
    if (CONFIG.ossEnabled) {
      try {
        const client = await getOSSClient();
        if (client) {
          const result = await client.list({ 'max-keys': 1000 });
          ossStats.files = (result.objects || []).length;
          ossStats.totalSize = (result.objects || []).reduce((sum, obj) => sum + (obj.size || 0), 0);
        }
      } catch (e) {
        ossStats.error = e.message;
      }
    }
    
    res.json({
      success: true,
      data: {
        timestamp: toLocalISOString(),
        gateway: {
          status: '在线',
          uptime: Math.floor(process.uptime()),
          memory: process.memoryUsage(),
          version: '2.0.0'
        },
        database: {
          admin: {
            name: CONFIG.adminDb,
            collections: adminStats.collections,
            dataSize: adminStats.dataSize,
            storageSize: adminStats.storageSize,
            indexes: adminStats.indexes
          },
          user: {
            name: CONFIG.userDb,
            collections: userStats.collections,
            dataSize: userStats.dataSize,
            storageSize: userStats.storageSize,
            indexes: userStats.indexes
          }
        },
        users: { total: usersCount, active24h: activeUsers },
        tasks: { byStatus: tasksStats.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {}) },
        doves: { count: doves.length, online: doves.filter(d => d.status === '在线' || d.status === '忙碌').length, instances: doves },
        oss: ossStats,
        config: { quotas: QUOTAS, port: CONFIG.port }
      }
    });
  } catch (e) {
    logger.error('管理员诊断失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 获取系统凭证状态
 */
router.get('/credentials', async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: '需要管理员权限' });
  }
  
  try {
    const config = getSystemConfig();
    
    const safeConfig = { llm: {}, oss: {}, gitStorage: {} };

    for (const [provider, cfg] of Object.entries(config.llm || {})) {
      safeConfig.llm[provider] = {
        enabled: cfg.enabled,
        configured: !!(cfg.apiKey),
        maskedKey: cfg.apiKey ? cfg.apiKey.slice(0, 8) + '***' + cfg.apiKey.slice(-4) : '',
        models: cfg.models || []
      };
    }

    safeConfig.oss = {
      enabled: config.oss?.enabled || false,
      configured: !!(config.oss?.accessKeyId && config.oss?.accessKeySecret),
      region: config.oss?.region || '',
      bucket: config.oss?.bucket || ''
    };

    safeConfig.gitStorage = {
      enabled: true,
      type: 'local-git'
    };
    
    res.json({ success: true, data: safeConfig });
  } catch (e) {
    logger.error('获取凭证配置失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 更新系统凭证
 */
router.put('/credentials', async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: '需要管理员权限' });
  }
  
  const { category, provider, config: newConfig } = req.body;
  
  if (!category || !provider || !newConfig) {
    return res.status(400).json({ success: false, error: '参数不完整，需要 category, provider, config' });
  }
  
  try {
    const db = getAdminDb();
    const collection = db.collection('系统配置');
    
    const updatePath = `${category}.${provider}`;
    const updateData = {};
    updateData[updatePath] = newConfig;
    
    await collection.updateOne(
      { _id: 'credentials' },
      { $set: updateData }
    );
    
    updateSystemConfigCache(category, provider, newConfig);
    
    if (category === 'oss') {
      resetOSSClient();
      const ossConfig = getOSSConfig();
      CONFIG.ossEnabled = ossConfig.enabled;
    }
    
    logger.info(`管理员更新凭证: ${category}.${provider}`);
    
    res.json({ success: true, message: `已更新 ${category}.${provider}` });
  } catch (e) {
    logger.error('更新凭证失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 测试凭证
 */
router.post('/credentials/test', async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: '需要管理员权限' });
  }
  
  const { category, provider, testConfig } = req.body;
  
  if (!category || !provider) {
    return res.status(400).json({ success: false, error: '参数不完整' });
  }
  
  try {
    let result = { success: false, message: '' };
    
    if (category === 'llm') {
      const apiKey = testConfig?.apiKey || getLLMConfig(provider).apiKey;
      const normalized = normalizeProvider(provider);
      const endpoint = PROVIDER_TEST_ENDPOINTS[normalized];
      if (endpoint && apiKey) {
        const response = await fetch(endpoint, {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        
        if (response.ok) {
          result = { success: true, message: `${provider} API Key 有效` };
        } else {
          result = { success: false, message: `${provider} API Key 无效: HTTP ${response.status}` };
        }
      } else {
        result = { success: false, message: '不支持的提供商或未配置 API Key' };
      }
    }
    
    if (category === 'oss') {
      try {
        const OSS = (await import('ali-oss')).default;
        const testClient = new OSS({
          region: testConfig?.region || getOSSConfig().region,
          accessKeyId: testConfig?.accessKeyId || getOSSConfig().accessKeyId,
          accessKeySecret: testConfig?.accessKeySecret || getOSSConfig().accessKeySecret,
          bucket: testConfig?.bucket || getOSSConfig().bucket,
          secure: true
        });
        
        await testClient.list({ 'max-keys': 1 });
        result = { success: true, message: 'OSS 连接成功' };
      } catch (e) {
        result = { success: false, message: `OSS 连接失败: ${e.message}` };
      }
    }
    
    if (category === 'polarMemory' || category === 'gitMemory') {
      // Git记忆始终可用（本地git）
      result = { success: true, message: 'Git记忆服务（本地）就绪' };
    }
    
    res.json({ success: true, data: result });
  } catch (e) {
    logger.error('测试凭证失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 全局默认模型配置 ====================

/**
 * 获取管理员全局默认模型配置
 * 管理员设置的默认模型，所有未单独配置的用户自动继承
 */
router.get('/model-defaults', async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: '需要管理员权限' });
  }
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    
    const adminDefaults = await adminDb.collection('系统配置').findOne({ _id: 'model_defaults' });
    
    res.json({
      success: true,
      data: adminDefaults?.modelSettings || {}
    });
  } catch (e) {
    logger.error('获取全局默认模型配置失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 设置管理员全局默认模型配置
 * 支持设置每个角色的默认模型：intentModel, reasoningModel, planningModel, visionModel, flashModel
 * 每个角色可选，只传想改的角色即可
 * 
 * 请求体示例:
 * { "reasoningModel": { "provider": "百炼", "model": "qwen3-max" } }
 * { "intentModel": {...}, "reasoningModel": {...} }  // 同时设置多个
 */
router.put('/model-defaults', async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: '需要管理员权限' });
  }
  
  const roles = ['intentModel', 'reasoningModel', 'planningModel', 'visionModel', 'flashModel'];
  const updateFields = {};
  const updatedRoles = [];
  
  for (const role of roles) {
    const value = req.body[role];
    if (value !== undefined) {
      // null 表示清除该角色的管理员默认
      if (value === null) {
        updateFields[`modelSettings.${role}`] = null;
        updatedRoles.push(`${role}(清除)`);
        continue;
      }
      
      if (!value.provider || !value.model) {
        return res.status(400).json({
          success: false,
          error: `${role}.provider 和 ${role}.model 必填`
        });
      }
      updateFields[`modelSettings.${role}`] = { provider: value.provider, model: value.model };
      updatedRoles.push(`${role}: ${value.provider}/${value.model}`);
    }
  }
  
  if (Object.keys(updateFields).length === 0) {
    return res.status(400).json({
      success: false,
      error: `至少提供一个角色配置，支持: ${roles.join(', ')}`
    });
  }
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    const ts = createTimestampFields();
    
    await adminDb.collection('系统配置').updateOne(
      { _id: 'model_defaults' },
      {
        $set: {
          ...updateFields,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp
        },
        $setOnInsert: {
          创建时间: ts.localTime,
          创建时间戳: ts.timestamp
        }
      },
      { upsert: true }
    );
    
    logger.info(`管理员设置全局默认模型: ${updatedRoles.join(', ')}`);
    
    res.json({
      success: true,
      message: `已更新全局默认模型配置: ${updatedRoles.join(', ')}`,
      data: { updatedRoles }
    });
  } catch (e) {
    logger.error('设置全局默认模型配置失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 内部凭证获取接口（供鸽子使用）
 */
router.get('/internal/credentials', async (req, res) => {
  const token = req.headers['x-token'] || req.headers['x-auth-token'];
  
  if (!token) {
    return res.status(401).json({ success: false, error: '未提供认证令牌' });
  }
  
  try {
    const jwt = (await import('jsonwebtoken')).default;
    const decoded = jwt.verify(token, CONFIG.jwtSecret);
    
    if (decoded.role !== 'admin' && !decoded.doveId) {
      return res.status(403).json({ success: false, error: '权限不足' });
    }
    
    res.json({ success: true, data: getSystemConfig() });
  } catch (e) {
    res.status(401).json({ success: false, error: '令牌无效或已过期' });
  }
});

// ==================== 限流名单管理（热增删改查） ====================

/**
 * 查询限流名单
 */
router.get('/rate-limit/list', async (req, res) => {
  try {
    res.json({ success: true, data: 获取限流名单() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 查询限流统计
 */
router.get('/rate-limit/stats', async (req, res) => {
  try {
    res.json({ success: true, data: getRateLimitStats() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 添加 IP 到限流名单
 * body: { ip, 备注?, 过期时间? (ISO字符串或时长秒数) }
 */
router.post('/rate-limit/add', async (req, res) => {
  try {
    const { ip, 备注, 过期时间, 时长秒数 } = req.body;
    if (!ip) return res.status(400).json({ success: false, error: '缺少 ip 参数' });

    const options = { 备注 };
    if (时长秒数) {
      options.过期时间 = Date.now() + 时长秒数 * 1000;
    } else if (过期时间) {
      options.过期时间 = new Date(过期时间).getTime();
    }

    const adminDb = getAdminDb();
    await 持久化限流IP(adminDb.collection('系统配置'), ip, options);
    logger.info(`[限流名单] 管理员 ${req.user.userId} 添加: ${ip} (${备注 || '无备注'})`);
    res.json({ success: true, message: `已添加 ${ip} 到限流名单` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 从限流名单移除 IP
 * body: { ip }
 */
router.post('/rate-limit/remove', async (req, res) => {
  try {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ success: false, error: '缺少 ip 参数' });

    const adminDb = getAdminDb();
    await 持久化移除限流IP(adminDb.collection('系统配置'), ip);
    logger.info(`[限流名单] 管理员 ${req.user.userId} 移除: ${ip}`);
    res.json({ success: true, message: `已从限流名单移除 ${ip}` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
