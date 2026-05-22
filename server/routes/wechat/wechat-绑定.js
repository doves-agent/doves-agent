/**
 * 微信绑定管理 子路由
 * 职责：绑定/解绑 / 状态查询 / 启用禁用
 */

import { Router } from 'express';
import { logger } from '../../core.js';
import { getAdminDb, getMongoClient } from '../../db.js';
import { 记录审计 } from '../../审计日志.js';
import { toLocalISOString } from '@dove/common/时间工具.js';
import { encryptToken } from './加密工具.js';
import { ilinkRequest } from './iLink工具.js';
import {
  ILINK_BASE,
  sessionCache,
  startWeChatListenerForUser,
  stopWeChatListenerForUser
} from './shared.js';

const router = Router();

/**
 * POST /api/wechat/bind/initiate - 获取微信绑定二维码
 */
router.post('/bind/initiate', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const existing = await adminDb.collection('微信绑定').findOne({ userId });
    if (existing && existing.status === 'bound') {
      return res.status(409).json({
        success: false,
        error: '已绑定微信，请先解绑 (DELETE /api/wechat/bind)'
      });
    }

    if (existing?.lastBindAttempt && (Date.now() - existing.lastBindAttempt) < 30000) {
      return res.status(429).json({
        success: false,
        error: '请求过于频繁，请30秒后重试'
      });
    }

    await adminDb.collection('微信绑定').updateOne(
      { userId },
      { $set: { lastBindAttempt: Date.now() } },
      { upsert: true }
    );

    const qrResult = await ilinkRequest('/ilink/bot/get_bot_qrcode?bot_type=3');

    logger.debug(`iLink get_bot_qrcode 返回字段: ${Object.keys(qrResult).join(', ')}`);

    res.json({
      success: true,
      data: {
        qrcode: qrResult.qrcode || null,
        qrcodeUrl: qrResult.qrcode_url || qrResult.url || qrResult.qrcode_image_url || null,
        qrcodeImgContent: qrResult.qrcode_img_content || qrResult.qrcode_image || qrResult.image || null,
      }
    });
  } catch (e) {
    logger.error(`微信绑定初始化失败 (${userId}):`, e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/wechat/bind/poll - 轮询扫码状态
 */
router.post('/bind/poll', async (req, res) => {
  const userId = req.user.userId;
  const { qrcodeId } = req.body;

  if (!qrcodeId) {
    return res.status(400).json({ success: false, error: 'qrcodeId 必填' });
  }

  try {
    const statusResult = await ilinkRequest(`/ilink/bot/get_qrcode_status?qrcode=${qrcodeId}`);
    const 状态映射 = { confirmed: '已确认', expired: '已过期', scaned: '已扫码', scanned: '已扫码', wait: '等待扫码', waiting: '等待扫码' };
    const 中文状态 = 状态映射[statusResult.status] || statusResult.status;

    res.json({
      success: true,
      data: {
        status: 中文状态,
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/wechat/bind/complete - 确认绑定完成
 */
router.post('/bind/complete', async (req, res) => {
  const userId = req.user.userId;
  const { qrcodeId } = req.body;

  if (!qrcodeId) {
    return res.status(400).json({ success: false, error: 'qrcodeId 必填' });
  }

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const statusResult = await ilinkRequest(`/ilink/bot/get_qrcode_status?qrcode=${qrcodeId}`);

    const 状态映射 = { confirmed: '已确认', expired: '已过期', scaned: '已扫码', scanned: '已扫码', wait: '等待扫码', waiting: '等待扫码' };
    const status = 状态映射[statusResult.status] || statusResult.status;
    if (status !== '已确认') {
      return res.status(400).json({
        success: false,
        error: `绑定未确认，当前状态: ${status}`
      });
    }

    const botToken = statusResult.bot_token || statusResult.credentials?.bot_token || '';
    const botBaseUrl = statusResult.baseurl || statusResult.baseUrl || '';
    const botUserId = statusResult.ilink_bot_id || statusResult.bot_user_id || statusResult.credentials?.ilink_bot_id || '';
    const ilinkUserId = statusResult.ilink_user_id || statusResult.credentials?.ilink_user_id || '';

    if (!botToken) {
      return res.status(400).json({ success: false, error: '未获取到 bot_token' });
    }

    const encryptedToken = encryptToken(botToken);

    await adminDb.collection('微信绑定').updateOne(
      { userId },
      {
        $set: {
          userId,
          encryptedBotToken: encryptedToken,
          botBaseUrl,
          botUserId,
          ilinkUserId,
          status: 'bound',
          enabled: true,
          boundAt: toLocalISOString(),
          boundAtTimestamp: Date.now(),
          lastActiveAt: toLocalISOString(),
        },
        $unset: {
          lastBindAttempt: '',
        }
      },
      { upsert: true }
    );

    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'wechat_bind',
      目标ID: userId,
      结果: 'success',
      详情: { botUserId, botBaseUrl: botBaseUrl || '(默认)' }
    });

    logger.info(`用户 ${userId} 绑定微信成功 (botUserId: ${botUserId})`);

    startWeChatListenerForUser(userId, botToken, botBaseUrl || ILINK_BASE, botUserId);

    res.json({
      success: true,
      data: {
        status: 'bound',
        enabled: true,
        botUserId,
        botBaseUrl: botBaseUrl || '(默认)',
        boundAt: toLocalISOString(),
      }
    });
  } catch (e) {
    logger.error(`微信绑定完成失败 (${userId}):`, e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/wechat/status - 查看微信绑定状态
 */
router.get('/status', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const binding = await adminDb.collection('微信绑定').findOne({ userId });

    if (!binding || binding.status !== 'bound') {
      return res.json({
        success: true,
        data: { bound: false, enabled: false }
      });
    }

    res.json({
      success: true,
      data: {
        bound: true,
        enabled: binding.enabled || false,
        botUserId: binding.botUserId || '',
        botBaseUrl: binding.botBaseUrl || '',
        boundAt: binding.boundAt || '',
        lastActiveAt: binding.lastActiveAt || '',
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * DELETE /api/wechat/bind - 解除微信绑定
 */
router.delete('/bind', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const result = await adminDb.collection('微信绑定').updateOne(
      { userId, status: 'bound' },
      {
        $set: {
          status: 'unbound',
          enabled: false,
          encryptedBotToken: '',
          botBaseUrl: '',
          botUserId: '',
          unboundAt: toLocalISOString(),
          unboundAtTimestamp: Date.now(),
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: '未找到绑定记录' });
    }

    for (const [key, val] of sessionCache) {
      if (val.userId === userId) sessionCache.delete(key);
    }

    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'wechat_unbind',
      目标ID: userId,
      结果: 'success',
      详情: {}
    });

    logger.info(`用户 ${userId} 解除微信绑定`);

    stopWeChatListenerForUser(userId);

    res.json({
      success: true,
      data: { status: 'unbound' }
    });
  } catch (e) {
    logger.error(`微信解绑失败 (${userId}):`, e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/wechat/enable - 启用微信通道
 */
router.post('/enable', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const result = await adminDb.collection('微信绑定').updateOne(
      { userId, status: 'bound' },
      { $set: { enabled: true, lastActiveAt: toLocalISOString() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: '未绑定微信' });
    }

    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'wechat_enable',
      目标ID: userId,
      结果: 'success',
      详情: {}
    });

    res.json({ success: true, data: { enabled: true } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/wechat/disable - 禁用微信通道
 */
router.post('/disable', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const result = await adminDb.collection('微信绑定').updateOne(
      { userId, status: 'bound' },
      { $set: { enabled: false } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: '未绑定微信' });
    }

    for (const [key, val] of sessionCache) {
      if (val.userId === userId) sessionCache.delete(key);
    }

    stopWeChatListenerForUser(userId);

    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'wechat_disable',
      目标ID: userId,
      结果: 'success',
      详情: {}
    });

    res.json({ success: true, data: { enabled: false } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
