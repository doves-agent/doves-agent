/**
 * 认证路由 - 密码重置与会话管理
 * 
 * 包含：forgot-password、reset-password、sessions（查询/撤销/撤销全部）
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import { CONFIG, logger } from '../core.js';
import { getMongoClient, getAdminDb, createTimestampFields } from '../db.js';
import { authMiddleware } from './dove-auth.js';
import { 错误码, 创建错误响应 } from '../../common/错误码.js';
import { validatePasswordStrength } from './auth.js';

const router = Router();
const authCheck = authMiddleware;

// ==================== 密码重置流程 ====================

/**
 * 请求密码重置
 * 提交用户名或邮箱，生成一次性重置 Token
 * 前端/IM 通道负责将 Token 交付给用户
 */
router.post('/forgot-password', async (req, res) => {
  const { username, email } = req.body;
  
  if (!username && !email) {
    return res.status(400).json(创建错误响应(错误码.GEN_001, req.requestId, '用户名或邮箱必填'));
  }
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    const users = db.collection('用户');
    
    // 按用户名或邮箱查找
    const query = username ? { 用户名: username } : { 邮箱: email };
    const user = await users.findOne(query);
    
    // 即使用户不存在也返回成功，防止用户名枚举攻击
    if (!user) {
      return res.json({ success: true, message: '如果该账号存在，重置令牌已生成' });
    }
    
    // 检查是否已有未过期的重置 Token（防刷）
    const existing = await db.collection('密码重置令牌').findOne({
      用户ID: user.用户ID,
      过期时间: { $gt: new Date() },
      已使用: { $ne: true }
    });
    
    if (existing) {
      return res.json({ success: true, message: '如果该账号存在，重置令牌已生成' });
    }
    
    // 生成一次性重置 Token（JWT，15分钟有效）
    const resetToken = jwt.sign(
      { userId: user.用户ID, purpose: 'password_reset' },
      CONFIG.jwtSecret,
      { expiresIn: '15m' }
    );
    
    const ts = createTimestampFields();
    await db.collection('密码重置令牌').insertOne({
      令牌: resetToken,
      用户ID: user.用户ID,
      用户名: user.用户名,
      邮箱: user.邮箱,
      过期时间: new Date(Date.now() + 15 * 60 * 1000),
      已使用: false,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp
    });
    
    logger.info(`密码重置令牌已生成: ${user.用户名} (${user.用户ID})`);
    
    // 返回重置 Token（生产环境应通过邮件/IM 发送，此处直接返回用于开发调试）
    res.json({ 
      success: true, 
      message: '如果该账号存在，重置令牌已生成',
      // 开发模式直接返回 Token，生产环境应删除此字段
      ...(process.env.NODE_ENV !== 'production' ? { resetToken } : {})
    });
    
  } catch (e) {
    logger.error('密码重置请求失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 执行密码重置
 * 使用重置 Token 设置新密码
 */
router.post('/reset-password', async (req, res) => {
  const { resetToken, newPassword } = req.body;
  
  if (!resetToken || !newPassword) {
    return res.status(400).json({ success: false, error: '重置令牌和新密码必填' });
  }
  
  // 密码强度校验
  const strengthCheck = validatePasswordStrength(newPassword);
  if (!strengthCheck.valid) {
    return res.status(400).json(创建错误响应(错误码.AUTH_009, req.requestId, strengthCheck.error));
  }
  
  try {
    // 验证重置 Token
    let decoded;
    try {
      decoded = jwt.verify(resetToken, CONFIG.jwtSecret);
    } catch (e) {
      return res.status(400).json({ success: false, error: '重置令牌无效或已过期' });
    }
    
    if (decoded.purpose !== 'password_reset') {
      return res.status(400).json({ success: false, error: '令牌用途不正确' });
    }
    
    await getMongoClient();
    const db = getAdminDb();
    
    // 检查令牌是否已使用（一次性）
    const tokenRecord = await db.collection('密码重置令牌').findOne({
      令牌: resetToken,
      已使用: { $ne: true }
    });
    
    if (!tokenRecord) {
      return res.status(400).json({ success: false, error: '重置令牌已使用或不存在' });
    }
    
    // 标记令牌已使用
    await db.collection('密码重置令牌').updateOne(
      { 令牌: resetToken },
      { $set: { 已使用: true, 使用时间: new Date().toISOString() } }
    );
    
    // 更新密码
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const updateResult = await db.collection('用户').updateOne(
      { 用户ID: decoded.userId },
      { 
        $set: { 密码: hashedPassword },
        $unset: { 登录失败次数: '', 锁定至: '' } // 重置失败计数和锁定
      }
    );
    
    if (updateResult.matchedCount === 0) {
      return res.status(404).json(创建错误响应(错误码.AUTH_010, req.requestId));
    }
    
    logger.info(`密码重置成功: ${decoded.userId}`);
    
    res.json({ success: true, message: '密码重置成功' });
    
  } catch (e) {
    logger.error('密码重置失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 会话管理 API ====================

/**
 * 查询当前用户活跃会话
 */
router.get('/sessions', authCheck, async (req, res) => {
  const userId = req.user.userId;
  
  try {
    const db = getAdminDb();
    const sessions = await db.collection('登录会话')
      .find({ 用户ID: userId, 状态: '活跃' })
      .project({ 会话ID: 1, 认证类型: 1, '设备信息.userAgent': 1, '设备信息.ip': 1, 签发时间: 1, 过期时间: 1 })
      .sort({ 签发时间戳: -1 })
      .limit(50)
      .toArray();
    
    res.json({ success: true, data: sessions });
  } catch (e) {
    logger.error('查询会话失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 撤销指定会话
 */
router.post('/sessions/:sessionId/revoke', authCheck, async (req, res) => {
  const { sessionId } = req.params;
  const userId = req.user.userId;
  
  try {
    const db = getAdminDb();
    const result = await db.collection('登录会话').updateOne(
      { 会话ID: sessionId, 用户ID: userId, 状态: '活跃' },
      { $set: { 状态: '已撤销', 撤销时间: new Date().toISOString() } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: '会话不存在或已撤销' });
    }
    
    res.json({ success: true, message: '会话已撤销' });
  } catch (e) {
    logger.error('撤销会话失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 撤销当前用户所有其他会话（仅保留当前会话）
 */
router.post('/sessions/revoke-all', authCheck, async (req, res) => {
  const userId = req.user.userId;
  const currentToken = req.token;
  
  try {
    const db = getAdminDb();
    const result = await db.collection('登录会话').updateMany(
      { 用户ID: userId, 状态: '活跃' },
      { $set: { 状态: '已撤销', 撤销时间: new Date().toISOString() } }
    );
    
    // 为当前 token 重新创建一个会话记录
    const ts = createTimestampFields();
    await db.collection('登录会话').insertOne({
      会话ID: new ObjectId().toString(),
      用户ID: userId,
      用户名: req.user.username,
      认证类型: req.user.authType || 'permanent',
      设备信息: {
        userAgent: req.headers?.['user-agent'] || '',
        ip: req.ip || '',
      },
      签发时间: ts.localTime,
      签发时间戳: ts.timestamp,
      过期时间: null,
      状态: '活跃'
    });
    
    res.json({ success: true, message: `已撤销${result.modifiedCount}个会话`, revokedCount: result.modifiedCount });
  } catch (e) {
    logger.error('撤销所有会话失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
