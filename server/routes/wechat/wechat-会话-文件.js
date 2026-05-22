/**
 * 微信会话与文件 子路由
 * 职责：会话令牌管理 / 诊断 / 文件发送
 */

import { Router } from 'express';
import crypto from 'crypto';
import { logger } from '../../core.js';
import { getAdminDb, getMongoClient } from '../../db.js';
import { 记录审计 } from '../../审计日志.js';
import { toLocalISOString } from '@dove/common/时间工具.js';
import { 判断媒体类型, 验证文件大小 } from '../../im/媒体服务.js';
import { decryptToken } from './加密工具.js';
import {
  SESSION_TOKEN_TTL,
  sessionCache,
  wechatListenerManager
} from './shared.js';

const router = Router();

/**
 * POST /api/wechat/session - 获取临时会话令牌
 */
router.post('/session', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const binding = await adminDb.collection('微信绑定').findOne({
      userId,
      status: 'bound',
      enabled: true,
    });

    if (!binding) {
      return res.status(403).json({
        success: false,
        error: '微信通道未绑定或未启用'
      });
    }

    const botToken = decryptToken(binding.encryptedBotToken);
    if (!botToken) {
      logger.error(`用户 ${userId} 的 botToken 解密失败`);
      return res.status(500).json({ success: false, error: '绑定数据异常' });
    }

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_TOKEN_TTL;

    sessionCache.set(sessionToken, {
      userId,
      botToken,
      botBaseUrl: binding.botBaseUrl || '',
      botUserId: binding.botUserId || '',
      expiresAt,
    });

    await adminDb.collection('微信绑定').updateOne(
      { userId },
      { $set: { lastActiveAt: toLocalISOString() } }
    );

    res.json({
      success: true,
      data: {
        sessionToken,
        expiresAt: new Date(expiresAt).toISOString(),
        botUserId: binding.botUserId || '',
        botBaseUrl: binding.botBaseUrl || '',
      }
    });
  } catch (e) {
    logger.error(`获取微信会话令牌失败 (${userId}):`, e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/wechat/session/verify - 验证会话令牌有效性
 */
router.get('/session/verify', async (req, res) => {
  const sessionToken = req.headers['x-wechat-session'];

  if (!sessionToken) {
    return res.status(401).json({ success: false, error: '缺少会话令牌' });
  }

  const session = sessionCache.get(sessionToken);
  if (!session) {
    return res.status(401).json({ success: false, error: '会话令牌无效' });
  }

  if (session.expiresAt < Date.now()) {
    sessionCache.delete(sessionToken);
    return res.status(401).json({ success: false, error: '会话令牌已过期' });
  }

  if (req.user.userId !== session.userId) {
    return res.status(403).json({ success: false, error: '令牌不属于当前用户' });
  }

  res.json({
    success: true,
    data: {
      botToken: session.botToken,
      botBaseUrl: session.botBaseUrl,
      botUserId: session.botUserId,
      expiresAt: new Date(session.expiresAt).toISOString(),
    }
  });
});

/**
 * GET /api/wechat/listener/status - 诊断接口
 */
router.get('/listener/status', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const binding = await adminDb.collection('微信绑定').findOne({ userId });

    const isListenerRunning = wechatListenerManager.listeners.has(userId);
    const allListenerCount = wechatListenerManager.listeners.size;

    res.json({
      success: true,
      data: {
        bindingExists: !!binding,
        bindingStatus: binding?.status || 'none',
        bindingEnabled: binding?.enabled || false,
        botTokenExists: !!binding?.encryptedBotToken,
        botUserId: binding?.botUserId || '',
        botBaseUrl: binding?.botBaseUrl || '',
        listenerRunning: isListenerRunning,
        allListenerCount,
        timestamp: toLocalISOString(),
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/wechat/sendfile - 发送本地文件到微信
 */
router.post('/sendfile', async (req, res) => {
  const userId = req.user.userId;
  const { filePath, fileName, toUserId, contextToken, caption } = req.body;

  if (!filePath) {
    return res.status(400).json({ success: false, error: 'filePath 必填' });
  }

  try {
    const normalizedPath = filePath.replace(/\\/g, '/');
    if (normalizedPath.includes('..') || normalizedPath.includes('//')) {
      return res.status(403).json({ success: false, error: '文件路径不允许包含 .. 或双斜杠' });
    }

    const fs = await import('fs');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: `文件不存在: ${filePath}` });
    }

    const stat = fs.statSync(filePath);
    const mediaType = 判断媒体类型(fileName || filePath);
    const sizeCheck = 验证文件大小(stat.size, mediaType);
    if (!sizeCheck.ok) {
      return res.status(413).json({
        success: false,
        error: `文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，${mediaType}限制 ${sizeCheck.limit / 1024 / 1024}MB`
      });
    }

    const state = wechatListenerManager.listeners.get(userId);
    if (!state) {
      return res.status(400).json({ success: false, error: '微信监听器未运行，请先绑定并启用微信通道' });
    }

    const targetUserId = toUserId || state.lastFromUserId;
    const targetContextToken = contextToken || state.lastContextToken;

    if (!targetUserId) {
      return res.status(400).json({ success: false, error: '未指定目标用户且无上次对话用户' });
    }

    const result = await wechatListenerManager._sendWeChatMediaMessage(
      state,
      targetUserId,
      filePath,
      targetContextToken,
      caption || ''
    );

    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'wechat_send_file',
      目标ID: targetUserId,
      结果: 'success',
      详情: { fileName: result.fileName, mediaType: result.mediaType, filePath }
    });

    res.json({
      success: true,
      data: {
        clientId: result.clientId,
        mediaType: result.mediaType,
        fileName: result.fileName,
        toUserId: targetUserId,
      }
    });
  } catch (err) {
    logger.error(`[微信] 发送文件失败 (${userId}): ${err.message}`);
    res.status(500).json({ success: false, error: `发送文件失败: ${err.message}` });
  }
});

export default router;
