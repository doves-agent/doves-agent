/**
 * 白鸽服务端认证路由
 * 职责：用户注册、登录、密码重置、Token管理
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import { CONFIG, logger } from '../core.js';
import {
  getMongoClient, getAdminDb, getUserDb, getUserQuotaStatsForUser,
  getTimestamp, createTimestampFields, toLocalISOString, 检查配额告警
} from '../db.js';
import { 创建目录 } from '../storage-permission.js';
import { loginLimiter, registerLimiter } from '../middleware/rate-limiter.js';
import { authMiddleware } from './dove-auth.js';
import { 错误码, 创建错误响应 } from '../../common/错误码.js';

const router = Router();

// 统一认证中间件复用 dove-auth.js 的 authMiddleware
// auth.js 路由内需要认证的端点（verify/refresh/resource-status）统一走 authMiddleware
// authMiddleware 同时设置 req.user 和 req.tokenDecoded，完全兼容原有的 authCheck 行为
const authCheck = authMiddleware;

// ==================== 密码强度校验 ====================

/** 常见弱密码黑名单 */
const WEAK_PASSWORDS = new Set([
  '123456', 'password', 'admin', '12345678', 'qwerty', 'abc123',
  '111111', '123123', 'admin123', 'root', '123456789', '1234567890',
  'password123', '000000', '654321', '1234', '12345'
]);

/**
 * 校验密码强度
 * @param {string} password - 明文密码
 * @returns {{ valid: boolean, error?: string }}
 */
function validatePasswordStrength(password) {

  if (!password || typeof password !== 'string') {
    return { valid: false, error: '密码不能为空' };
  }
  if (password.length < 8) {
    return { valid: false, error: '密码长度至少8位' };
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return { valid: false, error: '密码必须同时包含字母和数字' };
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    return { valid: false, error: '密码过于简单，请使用更强的密码' };
  }
  return { valid: true };
}

// ==================== 登录失败锁定 ====================

const LOGIN_LOCKOUT = {
  MAX_ATTEMPTS: 5,      // 连续失败5次触发锁定
  LOCKOUT_MINUTES: 30, // 锁定30分钟
};

// ==================== 会话管理 ====================

/**
 * 签发 JWT 并记录会话到数据库
 * 
 * @param {object} payload - JWT payload
 * @param {object} options - jwt.sign 选项
 * @param {object} req - Express request（提取设备信息）
 * @returns {Promise<string>} JWT token
 */
async function 签发并记录会话(payload, options, req) {
  const token = jwt.sign(payload, CONFIG.jwtSecret, options);
  
  const db = getAdminDb();
  const ts = createTimestampFields();
  await db.collection('登录会话').insertOne({
    会话ID: new ObjectId().toString(),
    用户ID: payload.userId || payload.sub,
    用户名: payload.username,
    认证类型: payload.authType,
    设备信息: {
      userAgent: req?.headers?.['user-agent'] || '',
      ip: req?.ip || req?.connection?.remoteAddress || '',
    },
    签发时间: ts.localTime,
    签发时间戳: ts.timestamp,
    过期时间: options.expiresIn ? new Date(ts.timestamp + parseExpiry(options.expiresIn)).toISOString() : null,
    状态: '活跃'
  });
  
  return token;
}

/**
 * 解析 expiresIn 字符串为毫秒数
 * @param {string|number} expiresIn - 如 '7d', '24h', '15m'
 * @returns {number} 毫秒数
 */
function parseExpiry(expiresIn) {
  if (typeof expiresIn === 'number') return expiresIn * 1000;
  const match = String(expiresIn).match(/^(\d+)(d|h|m|s)?$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // 默认7天
  const num = parseInt(match[1]);
  const unit = match[2] || 's';
  const multipliers = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
  return num * (multipliers[unit] || 1000);
}

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: 用户注册
 *     tags: [认证]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *                 minLength: 3
 *               password:
 *                 type: string
 *                 minLength: 8
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: 注册成功
 *       400:
 *         description: 参数错误或用户名已存在
 */
router.post('/register', registerLimiter, async (req, res) => {
  const { username, password, email } = req.body;
  
  if (!username || !password) {
    return res.status(400).json(创建错误响应(错误码.AUTH_008, req.requestId));
  }
  
  // 密码强度校验
  const strengthCheck = validatePasswordStrength(password);
  if (!strengthCheck.valid) {
    return res.status(400).json(创建错误响应(错误码.AUTH_009, req.requestId, strengthCheck.error));
  }
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    const users = db.collection('用户');
    
    const existing = await users.findOne({ 用户名: username });
    if (existing) {
      return res.status(400).json(创建错误响应(错误码.AUTH_007, req.requestId));
    }
    
    const userId = new ObjectId().toString();
    
    const userTs = createTimestampFields();
    const user = {
      用户ID: userId,
      用户名: username,
      密码: await bcrypt.hash(password, 12),
      邮箱: email || '',
      创建时间: userTs.localTime,
      创建时间戳: userTs.timestamp,
      资源状态: '已就绪',  // 不再需要资源分配任务
      配额: {
        方案: 'free',
        // 配额使用量（直接记录，不再查询集合）
        已用: {
          '任务': 0,
          '对话': 0,
          '文件元数据': 0
        },
        上限: {
          '任务': 1000,
          '对话': 100,
          '文件元数据': 500
        },
        创建时间: userTs.localTime,
        创建时间戳: userTs.timestamp
      },
      拥有技能: []  // 用户拥有的技能授权
    };
    
    await users.insertOne(user);
    
    // 创建用户个人目录
    try {
      const userDirPath = `/users/${userId}`;
      await 创建目录(userId, userDirPath, {
        名称: `${username}的个人目录`,
        类型: '个人目录',
        描述: '用户注册时自动创建',
        状态: '活跃'
      });
      logger.info(`为用户 ${userId} 创建个人目录: ${userDirPath}`);
    } catch (dirError) {
      logger.error(`创建个人目录失败: ${dirError.message}`);
      throw dirError;
    }
    
    // 不再需要资源分配任务，用户直接可用
    // OSS 用户目录会在首次上传时自动创建
    
    const token = await 签发并记录会话(
      { userId, username, authType: 'permanent' },
      { expiresIn: '7d' },
      req
    );
    
    logger.info(`用户注册成功: ${username} (${userId})`);
    
    res.json({
      success: true,
      data: {
        userId,
        username,
        token,
        resourceStatus: '已就绪',
        message: '注册成功'
      }
    });
  } catch (e) {
    logger.error('注册失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: 用户登录
 *     tags: [认证]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: 登录成功，返回 JWT Token
 *       401:
 *         description: 用户名或密码错误
 *       423:
 *         description: 账号已锁定
 */
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json(创建错误响应(错误码.AUTH_008, req.requestId));
  }
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    const users = db.collection('用户');
    
    const user = await users.findOne({ 用户名: username });
    if (!user) {
      return res.status(401).json(创建错误响应(错误码.AUTH_004, req.requestId));
    }
    
    // 检查账号是否被锁定
    if (user.锁定至 && new Date(user.锁定至) > new Date()) {
      const remainingMinutes = Math.ceil((new Date(user.锁定至) - Date.now()) / 60000);
      return res.status(423).json(创建错误响应(错误码.AUTH_006, req.requestId, `账号已锁定，请${remainingMinutes}分钟后再试`));
    }
    
    // 验证密码
    const 密码匹配 = await bcrypt.compare(password, user.密码);
    if (!密码匹配) {
      // 更新失败计数
      const 当前失败次数 = (user.登录失败次数 || 0) + 1;
      const 更新字段 = { 登录失败次数: 当前失败次数 };
      
      // 达到锁定阈值，锁定账号
      if (当前失败次数 >= LOGIN_LOCKOUT.MAX_ATTEMPTS) {
        const 锁定至 = new Date(Date.now() + LOGIN_LOCKOUT.LOCKOUT_MINUTES * 60 * 1000);
        更新字段.锁定至 = 锁定至.toISOString();
        更新字段.登录失败次数 = 0; // 重置计数，锁定解除后重新计算
        logger.warn(`账号锁定: ${username}，连续${当前失败次数}次登录失败，锁定至${锁定至.toISOString()}`);
      }
      
      await users.updateOne({ 用户ID: user.用户ID }, { $set: 更新字段 });
      return res.status(401).json(创建错误响应(错误码.AUTH_004, req.requestId));
    }
    
    // 登录成功：清除失败计数和锁定
    if (user.登录失败次数 || user.锁定至) {
      await users.updateOne(
        { 用户ID: user.用户ID },
        { $unset: { 登录失败次数: '', 锁定至: '' } }
      );
    }
    
    // 直接从用户记录获取配额信息
    const quotaData = user.配额 || { 已用: {}, 上限: {} };
    const quotaStats = {
      usage: quotaData.已用 || { '任务': 0, '对话': 0, '文件元数据': 0 },
      totalDocs: Object.values(quotaData.已用 || {}).reduce((a, b) => a + b, 0),
      limits: quotaData.上限 || { '任务': 1000, '对话': 100, '文件元数据': 500 },
      percentages: {}
    };
    // 计算百分比
    for (const [key, value] of Object.entries(quotaStats.usage)) {
      const limit = quotaStats.limits[key] || 1;
      quotaStats.percentages[key] = Math.round(value / limit * 100);
    }
    
    const token = await 签发并记录会话(
      { userId: user.用户ID, username: user.用户名, authType: 'permanent' },
      { expiresIn: '7d' },
      req
    );
    
    // 更新最后登录时间
    const ts = createTimestampFields();
    await users.updateOne(
      { 用户ID: user.用户ID },
      { $set: { 最后登录时间: ts.localTime } }
    );
    
    logger.info(`用户登录成功: ${username}`);
    
    // 配额告警检查
    const quotaWarnings = await 检查配额告警(user.用户ID);
    
    const loginExpiresAt = new Date(getTimestamp() + 7 * 24 * 60 * 60 * 1000); // 7天
    res.json({
      success: true,
      data: {
        userId: user.用户ID,
        username: user.用户名,
        token,
        authType: 'permanent',
        expiresIn: 7 * 24 * 60 * 60,
        expiresAt: toLocalISOString(loginExpiresAt),
        resourceStatus: user.资源状态 || '已就绪',
        quota: quotaStats,
        ...(quotaWarnings.length > 0 ? { quotaWarnings } : {})
      }
    });
  } catch (e) {
    logger.error('登录失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 超级管理员登录
 */
router.post('/admin', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json(创建错误响应(错误码.AUTH_008, req.requestId));
  }
  
  try {
    const baseUri = process.env.MONGODB_URI || process.env.MONGODB;
    
    let authUri;
    if (baseUri.includes('@')) {
      authUri = baseUri;
    } else if (baseUri.includes('mongodb://')) {
      const uriParts = baseUri.replace('mongodb://', '').split('/');
      const hostPort = uriParts[0];
      const dbName = uriParts[1] || 'admin';
      authUri = `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${hostPort}/${dbName}?authSource=admin`;
    } else {
      authUri = baseUri;
    }
    
    const testClient = new MongoClient(authUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000
    });
    
    await testClient.connect();
    const adminDb = testClient.db('admin');
    await adminDb.command({ ping: 1 });
    await testClient.close();
    
    const adminUserId = 'admin-' + Math.random().toString(16).substr(2, 6);
    const token = await 签发并记录会话(
      { userId: adminUserId, username, role: 'admin', authType: 'admin', admin: true },
      { expiresIn: '24h' },
      req
    );
    
    logger.info(`超级管理员登录成功: ${username}`);
    
    const adminExpiresAt = new Date(getTimestamp() + 24 * 60 * 60 * 1000);
    res.json({
      success: true,
      data: {
        userId: adminUserId,
        username,
        role: 'admin',
        token,
        expiresIn: 24 * 60 * 60,
        expiresAt: toLocalISOString(adminExpiresAt),
        message: '超级管理员登录成功'
      }
    });
  } catch (e) {
    logger.warn(`管理员登录失败: ${username} - ${e.message}`);
    
    if (e.message.includes('AuthenticationFailed') || e.message.includes('auth')) {
      return res.status(401).json(创建错误响应(错误码.AUTH_004, req.requestId));
    }
    if (e.message.includes('ECONNREFUSED') || e.message.includes('timeout')) {
      return res.status(503).json({ success: false, error: '数据库连接失败' });
    }
    
    res.status(401).json(创建错误响应(错误码.AUTH_003, req.requestId, '认证失败'));
  }
});

/**
 * 查询是否允许匿名登录（公开接口，无需认证）
 */
router.get('/anonymous-status', (req, res) => {
  res.json({
    success: true,
    data: {
      allowed: CONFIG.allowAnonymous
    }
  });
});

/**
 * 匿名登录
 */
router.post('/anonymous', async (req, res) => {
  // 检查是否允许匿名登录
  if (!CONFIG.allowAnonymous) {
    return res.status(403).json(创建错误响应(错误码.AUTH_011, req.requestId, '匿名登录已禁用，请注册账号后登录'));
  }
  
  try {
    const userId = 'anon-' + Math.random().toString(16).substr(2, 6);
    const username = 'anonymous_' + Math.random().toString(36).slice(2, 8);
    
    const token = await 签发并记录会话(
      { userId, username, anonymous: true, authType: 'temporary' },
      { expiresIn: '24h' },
      req
    );
    
    const quotaStats = {
      usage: { tasks: 0, conversations: 0, file_meta: 0, dove_contexts: 0 },
      totalDocs: 0,
      limits: { tasks: 1000, conversations: 100, file_meta: 500, dove_contexts: 50 },
      percentages: { tasks: 0, conversations: 0, file_meta: 0, dove_contexts: 0 }
    };
    
    const anonExpiresAt = new Date(getTimestamp() + 24 * 60 * 60 * 1000);
    res.json({
      success: true,
      data: {
        userId,
        username,
        token,
        authType: 'temporary',
        expiresIn: 24 * 60 * 60,
        expiresAt: toLocalISOString(anonExpiresAt),
        quota: quotaStats
      }
    });
  } catch (e) {
    logger.error('匿名登录失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 查询资源状态（需要认证）
 * 简化后不再需要资源分配任务，直接返回用户状态
 */
router.get('/resource-status', authCheck, async (req, res) => {
  const userId = req.user.userId;
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    
    const user = await adminDb.collection('用户').findOne({ 用户ID: userId });
    if (!user) {
      return res.status(404).json(创建错误响应(错误码.AUTH_010, req.requestId));
    }
    
    res.json({
      success: true,
      data: {
        userId,
        resourceStatus: user.资源状态 || '已就绪'
      }
    });
  } catch (e) {
    logger.error('查询资源状态失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 验证 Token（需要认证）
 */
router.get('/verify', authCheck, async (req, res) => {
  const decoded = req.tokenDecoded;
  if (!decoded) {
    return res.status(400).json(创建错误响应(错误码.GEN_001, req.requestId, '此端点仅支持JWT令牌验证'));
  }
  const now = Math.floor(getTimestamp() / 1000);
  const expiresIn = decoded.exp - now;
  
  res.json({
    success: true,
    data: {
      valid: true,
      userId: decoded.userId,
      username: decoded.username,
      authType: decoded.authType,
      anonymous: decoded.anonymous || false,
      expiresIn: expiresIn > 0 ? expiresIn : 0,
      expiresAt: toLocalISOString(new Date(decoded.exp * 1000))
    }
  });
});

/**
 * 刷新 Token（需要认证）
 */
router.post('/refresh', authCheck, async (req, res) => {
  const decoded = req.tokenDecoded;
  if (!decoded) {
    return res.status(400).json(创建错误响应(错误码.GEN_001, req.requestId, '此端点仅支持JWT令牌刷新'));
  }
  const authType = decoded.authType;
  const expiresIn = authType === 'permanent' ? '7d' : '24h';
  
  const newToken = jwt.sign(
    {
      userId: decoded.userId,
      username: decoded.username,
      authType: authType,
      anonymous: decoded.anonymous || false
    },
    CONFIG.jwtSecret,
    { expiresIn }
  );
  
  logger.info(`Token 已刷新: ${decoded.userId} (${authType})`);
  
  const refreshExpiresAt = new Date(getTimestamp() + (authType === 'permanent' ? 7 : 1) * 24 * 60 * 60 * 1000);
  res.json({
    success: true,
    data: {
      token: newToken,
      authType: authType,
      expiresIn: authType === 'permanent' ? 7 * 24 * 60 * 60 : 24 * 60 * 60,
      expiresAt: toLocalISOString(refreshExpiresAt)
    }
  });
});

export { validatePasswordStrength };

// ==================== 密码重置与会话管理子路由 ====================
import 密码重置路由 from './auth-密码重置.js';
router.use(密码重置路由);

export default router;
