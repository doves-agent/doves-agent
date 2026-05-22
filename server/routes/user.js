/**
 * 白鸽服务端用户Key管理路由
 * 职责：用户个人API Key管理
 * 
 * 数据结构：使用管理库的 api_keys 集合，格式为 { userId, bailian: "sk-xxx", deepseek: "sk-yyy" }
 */

import { Router } from 'express';
import { CONFIG, logger } from '../core.js';
import { 
  getMongoClient, getUserDb, getAdminDb, getSystemConfig, getLLMConfig,
  getTimestamp, createTimestampFields 
} from '../db.js';
import { SYSTEM_MODEL_DEFAULTS, normalizeProvider, PROVIDER_TEST_ENDPOINTS } from '@dove/common/模型配置.js';

const router = Router();

/**
 * 获取用户的所有 API Key 状态
 */
router.get('/', async (req, res) => {
  const userId = req.user.userId;
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    
    // 查询用户的 API Key 配置（格式: { userId, bailian: "sk-xxx", deepseek: "sk-yyy" }）
    const userConfig = await adminDb.collection('API密钥').findOne({ 用户ID: userId });
    
    const safeKeys = {};
    const validProviders = ['bailian', 'deepseek', 'glm'];
    
    for (const provider of validProviders) {
      if (userConfig && userConfig[provider]) {
        const key = userConfig[provider];
        safeKeys[provider] = {
          provider,
          configured: true,
          maskedKey: key ? key.slice(0, 8) + '***' + key.slice(-4) : '',
          models: userConfig.models?.[provider] || [],
          创建时间: userConfig.创建时间 || userConfig.createdAt
        };
      }
    }
    
    const systemConfig = getSystemConfig();
    const officialKeys = {};
    for (const [provider, cfg] of Object.entries(systemConfig.llm || {})) {
      officialKeys[provider] = {
        provider,
        enabled: cfg.enabled,
        configured: !!(cfg.apiKey),
        models: cfg.models || []
      };
    }
    
    res.json({
      success: true,
      data: { userKeys: safeKeys, officialKeys }
    });
  } catch (e) {
    logger.error('获取用户 Key 失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 设置用户 API Key
 */
router.put('/', async (req, res) => {
  const userId = req.user.userId;
  const { provider, apiKey, models } = req.body;
  
  if (!provider || !apiKey) {
    return res.status(400).json({ success: false, error: 'provider 和 apiKey 必填' });
  }
  
  const validProviders = ['bailian', 'deepseek', 'glm'];
  if (!validProviders.includes(provider)) {
    return res.status(400).json({ success: false, error: `不支持的提供商: ${provider}` });
  }
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    
    const ts = createTimestampFields();
    
    // 更新用户的 API Key（格式: { 用户ID, bailian: "sk-xxx", ... }）
    await adminDb.collection('API密钥').updateOne(
      { 用户ID: userId },
      {
        $set: {
          [provider]: apiKey,
          [`models.${provider}`]: models || [],
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
    
    logger.info(`用户 ${userId} 设置了 ${provider} API Key`);
    
    res.json({ success: true, message: `已设置 ${provider} API Key` });
  } catch (e) {
    logger.error('设置用户 Key 失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 删除用户 API Key
 */
router.delete('/', async (req, res) => {
  const userId = req.user.userId;
  const { provider } = req.body;
  
  if (!provider) {
    return res.status(400).json({ success: false, error: 'provider 必填' });
  }
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    
    // 删除指定提供商的 Key（设置为空字符串）
    await adminDb.collection('API密钥').updateOne(
      { 用户ID: userId },
      { $unset: { [provider]: "", [`models.${provider}`]: "" } }
    );
    
    logger.info(`用户 ${userId} 删除了 ${provider} API Key`);
    
    res.json({ success: true, message: `已删除 ${provider} API Key` });
  } catch (e) {
    logger.error('删除用户 Key 失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 测试用户 API Key
 */
router.post('/test', async (req, res) => {
  const userId = req.user.userId;
  const { provider, testKey } = req.body;
  
  if (!provider) {
    return res.status(400).json({ success: false, error: 'provider 必填' });
  }
  
  try {
    let apiKey = testKey;
    
    if (!apiKey) {
      await getMongoClient();
      const adminDb = getAdminDb();
      const userConfig = await adminDb.collection('API密钥').findOne({ 用户ID: userId });
      apiKey = userConfig?.[provider];
    }
    
    if (!apiKey) {
      const config = getLLMConfig(provider);
      apiKey = config.apiKey;
    }
    
    if (!apiKey) {
      return res.json({
        success: false,
        data: { success: false, message: '未找到可用的 API Key' }
      });
    }
    
    const normalized = normalizeProvider(provider);
    const endpoint = PROVIDER_TEST_ENDPOINTS[normalized];
    if (!endpoint) {
      return res.json({
        success: false,
        data: { success: false, message: '不支持的提供商' }
      });
    }
    
    const response = await fetch(endpoint, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    
    const result = {
      success: response.ok,
      message: response.ok
        ? `${provider} API Key 有效`
        : `${provider} API Key 无效: HTTP ${response.status}`
    };
    
    res.json({ success: true, data: result });
  } catch (e) {
    logger.error('测试 Key 失败:', e.message);
    res.json({ success: true, data: { success: false, message: `测试失败: ${e.message}` } });
  }
});

// ==================== 用户模型配置 ====================

/**
 * 系统硬编码默认模型配置（从 common/模型配置.js 统一导入）
 * 优先级链：用户配置 > 管理员全局默认 > 系统硬编码
 * 修改默认值请编辑 common/模型配置.js
 */

/**
 * 合并模型配置：用户 > 管理员默认 > 系统硬编码
 * 每个角色独立合并，附带 _source 标记来源
 * @param {Object} userModelSettings - 用户配置的 modelSettings
 * @param {Object} adminModelSettings - 管理员配置的 modelSettings
 * @returns {Object} 合并后的 modelSettings
 */
function mergeModelSettings(userModelSettings, adminModelSettings) {
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
  
  return merged;
}

/**
 * 获取用户模型配置（合并后）
 * 包括意图识别、深度思考、任务规划、视觉理解、闪回等所有模型设置
 * 优先级链：用户配置 > 管理员全局默认 > 系统硬编码
 */
router.get('/model-settings', async (req, res) => {
  const userId = req.user.userId;
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    
    // 1. 读取用户自己的配置
    const userConfig = await adminDb.collection('API密钥').findOne({ 用户ID: userId });
    const userModelSettings = userConfig?.modelSettings || null;
    
    // 2. 读取管理员全局默认配置
    const adminDefaults = await adminDb.collection('系统配置').findOne({ _id: 'model_defaults' });
    const adminModelSettings = adminDefaults?.modelSettings || null;
    
    // 3. 合并：用户 > 管理员默认 > 系统硬编码
    const mergedSettings = mergeModelSettings(userModelSettings, adminModelSettings);
    
    res.json({
      success: true,
      data: mergedSettings
    });
  } catch (e) {
    logger.error('获取用户模型配置失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 设置用户模型配置
 * 支持设置所有角色模型（intentModel, reasoningModel, planningModel, visionModel, flashModel）
 * 每个角色可选，只传想改的角色即可
 * 
 * 请求体示例:
 * { "intentModel": { "provider": "百炼", "model": "qwen3.5-flash" } }
 * { "reasoningModel": { "provider": "deepseek", "model": "deepseek-r1" } }
 * { "intentModel": {...}, "reasoningModel": {...} }  // 同时设置多个
 */
router.put('/model-settings', async (req, res) => {
  const userId = req.user.userId;
  const roles = ['intentModel', 'reasoningModel', 'planningModel', 'visionModel', 'flashModel'];
  const updateFields = {};
  const updatedRoles = [];
  
  // 收集有效的角色配置
  for (const role of roles) {
    const value = req.body[role];
    if (value !== undefined) {
      // null 表示清除该角色的用户配置（回退到管理员默认/系统默认）
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
    
    await adminDb.collection('API密钥').updateOne(
      { 用户ID: userId },
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
    
    logger.info(`用户 ${userId} 设置模型配置: ${updatedRoles.join(', ')}`);
    
    res.json({
      success: true,
      message: `已更新模型配置: ${updatedRoles.join(', ')}`,
      data: { updatedRoles }
    });
  } catch (e) {
    logger.error('设置用户模型配置失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 删除用户模型配置中的指定角色
 * 清除后该角色回退到管理员默认/系统默认
 */
router.delete('/model-settings/:role', async (req, res) => {
  const userId = req.user.userId;
  const { role } = req.params;
  const validRoles = ['intentModel', 'reasoningModel', 'planningModel', 'visionModel', 'flashModel'];
  
  if (!validRoles.includes(role)) {
    return res.status(400).json({
      success: false,
      error: `无效的角色: ${role}，支持: ${validRoles.join(', ')}`
    });
  }
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    
    await adminDb.collection('API密钥').updateOne(
      { 用户ID: userId },
      { $unset: { [`modelSettings.${role}`]: "" } }
    );
    
    logger.info(`用户 ${userId} 清除了模型配置: ${role}`);
    
    res.json({
      success: true,
      message: `已清除 ${role} 配置，将使用管理员默认或系统默认`
    });
  } catch (e) {
    logger.error('清除用户模型配置失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 系统模型列表 ====================

/**
 * 获取系统模型列表
 * 从管理库读取各提供商的模型列表
 */
router.get('/model-list', async (req, res) => {
  const { provider } = req.query;
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    
    const systemConfig = await adminDb.collection('系统配置').findOne({ _id: 'model_list' });
    
    if (!systemConfig) {
      return res.json({
        success: true,
        data: { providers: {}, 更新时间: null }
      });
    }
    
    // 如果指定了提供商，只返回该提供商的模型
    if (provider && systemConfig.providers?.[provider]) {
      const models = systemConfig.providers[provider];
      return res.json({
        success: true,
        data: {
          provider,
          models,
          更新时间: systemConfig.更新时间
        }
      });
    }
    
    res.json({
      success: true,
      data: {
        providers: systemConfig.providers || {},
        更新时间: systemConfig.更新时间
      }
    });
  } catch (e) {
    logger.error('获取模型列表失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 更新系统模型列表（管理员或刷新时使用）
 * 存储各提供商的模型列表到管理库
 */
router.put('/model-list', async (req, res) => {
  const { provider, models } = req.body;
  
  if (!provider || !models) {
    return res.status(400).json({ success: false, error: 'provider 和 models 必填' });
  }
  
  if (!Array.isArray(models)) {
    return res.status(400).json({ success: false, error: 'models 必须是数组' });
  }
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    
    const ts = createTimestampFields();
    
    // 更新指定提供商的模型列表
    await adminDb.collection('系统配置').updateOne(
      { _id: 'model_list' },
      {
        $set: {
          [`providers.${provider}`]: models,
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
    
    logger.info(`更新模型列表: ${provider} (${models.length} 个模型)`);
    
    res.json({
      success: true,
      message: `已更新 ${provider} 模型列表 (${models.length} 个模型)`,
      data: { provider, count: models.length }
    });
  } catch (e) {
    logger.error('更新模型列表失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 终止确认超时配置 ====================

/** 默认终止确认超时: 30分钟 */
const DEFAULT_TERMINATION_TIMEOUT = 30 * 60 * 1000;

/**
 * 获取用户终止确认超时配置
 * GET /api/user/termination-timeout
 */
router.get('/termination-timeout', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const userConfig = await adminDb.collection('API密钥').findOne(
      { 用户ID: userId },
      { projection: { terminationTimeout: 1 } }
    );

    const timeout = userConfig?.terminationTimeout ?? DEFAULT_TERMINATION_TIMEOUT;

    res.json({
      success: true,
      data: {
        terminationTimeout: timeout,
        description: timeout === -1 ? '永不超时（监工标记后需用户手动确认）'
                    : `${timeout / 60000} 分钟后自动按监工判定终止`,
        isDefault: userConfig?.terminationTimeout === undefined,
      }
    });
  } catch (e) {
    logger.error('获取终止确认超时配置失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 设置用户终止确认超时配置
 * PUT /api/user/termination-timeout
 * 
 * 请求体：{ terminationTimeout: number }
 * - 正整数表示毫秒（如 600000 = 10分钟）
 * - -1 表示永不超时
 * - 最小 60000ms（1分钟），最大 86400000ms（24小时），-1 除外
 */
router.put('/termination-timeout', async (req, res) => {
  const userId = req.user.userId;
  const { terminationTimeout } = req.body;

  if (terminationTimeout === undefined || terminationTimeout === null) {
    return res.status(400).json({ success: false, error: 'terminationTimeout 必填' });
  }

  if (typeof terminationTimeout !== 'number') {
    return res.status(400).json({ success: false, error: 'terminationTimeout 必须是数字（毫秒），-1 表示永不超时' });
  }

  // 验证范围：-1 或 60000~86400000
  if (terminationTimeout !== -1 && (terminationTimeout < 60000 || terminationTimeout > 86400000)) {
    return res.status(400).json({
      success: false,
      error: 'terminationTimeout 范围: -1(永不超时) 或 60000~86400000 毫秒(1分钟~24小时)'
    });
  }

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const ts = createTimestampFields();

    await adminDb.collection('API密钥').updateOne(
      { 用户ID: userId },
      {
        $set: {
          terminationTimeout,
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

    logger.info(`用户 ${userId} 设置终止确认超时: ${terminationTimeout === -1 ? '永不超时' : (terminationTimeout / 60000) + '分钟'}`);

    res.json({
      success: true,
      message: `已设置终止确认超时: ${terminationTimeout === -1 ? '永不超时' : (terminationTimeout / 60000) + '分钟'}`,
      data: { terminationTimeout }
    });
  } catch (e) {
    logger.error('设置终止确认超时配置失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
