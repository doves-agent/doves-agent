/**
 * 飞书配置管理 子路由
 * 职责：配置CRUD / 启用禁用 / 连接测试 / 文件发送
 */

import { Router } from 'express';
import { CONFIG, logger } from '../../core.js';
import { getAdminDb, getMongoClient } from '../../db.js';
import { 记录审计 } from '../../审计日志.js';
import { 验证文件大小, 判断媒体类型 } from '../../im/媒体服务.js';
import { existsSync, statSync } from 'fs';
import { encryptSecret, decryptSecret, sessionCache } from './加密工具.js';
import {
  feishuListenerManager,
  startFeishuListenerForUser,
  stopFeishuListenerForUser
} from './shared.js';

const router = Router();

/**
 * POST /api/feishu/config - 配置飞书企业应用凭证
 */
router.post('/config', async (req, res) => {
  const userId = req.user.userId;
  const { appId, appSecret, verificationToken, encryptKey } = req.body;

  if (!appId || !appSecret) {
    return res.status(400).json({
      success: false,
      error: '飞书 App ID 和 App Secret 不能为空'
    });
  }

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const 配置文档 = {
      用户ID: userId,
      appId,
      encryptedAppSecret: encryptSecret(appSecret),
      verificationToken: verificationToken || '',
      encryptedEncryptKey: encryptKey ? encryptSecret(encryptKey) : '',
      更新时间: new Date(),
    };

    const existing = await adminDb.collection('飞书配置').findOne({ 用户ID: userId });
    if (!existing) {
      配置文档.启用 = true;
    }

    await adminDb.collection('飞书配置').updateOne(
      { 用户ID: userId },
      {
        $set: 配置文档,
        $setOnInsert: { 创建时间: new Date() }
      },
      { upsert: true }
    );

    // 启动监听
    if (existing?.启用 !== false) {
      startFeishuListenerForUser(userId, appId, appSecret, verificationToken, encryptKey);
    }

    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'feishu_config',
      目标ID: userId,
      结果: 'success',
      详情: { appId }
    });

    logger.info(`用户 ${userId} 配置飞书成功`);

    res.json({
      success: true,
      message: existing ? '配置已更新' : '配置已创建',
      data: { 启用: 配置文档.启用 ?? existing?.启用 ?? true }
    });
  } catch (err) {
    logger.error(`飞书配置失败 (${userId}):`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/feishu/config - 获取飞书配置状态
 */
router.get('/config', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const 配置 = await adminDb.collection('飞书配置').findOne({ 用户ID: userId });

    if (!配置) {
      return res.json({
        success: true,
        data: { 已配置: false, 启用: false }
      });
    }

    res.json({
      success: true,
      data: {
        已配置: true,
        启用: 配置.启用 || false,
        appId: 配置.appId ? `${配置.appId.slice(0, 4)}***` : '',
        verificationToken: 配置.verificationToken ? `${配置.verificationToken.slice(0, 4)}***` : '',
        创建时间: 配置.创建时间,
        更新时间: 配置.更新时间,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/feishu/config - 删除飞书配置
 */
router.delete('/config', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const result = await adminDb.collection('飞书配置').deleteOne({ 用户ID: userId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: '未找到飞书配置' });
    }

    for (const [key, val] of sessionCache) {
      if (val.userId === userId) sessionCache.delete(key);
    }

    stopFeishuListenerForUser(userId);

    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'feishu_config_delete',
      目标ID: userId,
      结果: 'success',
      详情: {}
    });

    logger.info(`用户 ${userId} 删除飞书配置`);

    res.json({ success: true, data: { status: '已删除' } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/feishu/enable - 启用飞书通道
 */
router.post('/enable', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const 配置 = await adminDb.collection('飞书配置').findOneAndUpdate(
      { 用户ID: userId },
      { $set: { 启用: true, 更新时间: new Date() } },
      { returnDocument: 'after' }
    );

    if (!配置) {
      return res.status(404).json({ success: false, error: '未配置飞书' });
    }

    const appSecret = decryptSecret(配置.encryptedAppSecret);
    const encryptKey = decryptSecret(配置.encryptedEncryptKey);
    if (appSecret) {
      startFeishuListenerForUser(userId, 配置.appId, appSecret, 配置.verificationToken, encryptKey);
    }

    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'feishu_enable',
      目标ID: userId,
      结果: 'success',
      详情: {}
    });

    res.json({ success: true, data: { enabled: true } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/feishu/disable - 禁用飞书通道
 */
router.post('/disable', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const result = await adminDb.collection('飞书配置').updateOne(
      { 用户ID: userId },
      { $set: { 启用: false, 更新时间: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: '未配置飞书' });
    }

    for (const [key, val] of sessionCache) {
      if (val.userId === userId) sessionCache.delete(key);
    }

    stopFeishuListenerForUser(userId);

    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'feishu_disable',
      目标ID: userId,
      结果: 'success',
      详情: {}
    });

    res.json({ success: true, data: { enabled: false } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/feishu/test - 测试飞书连接
 */
router.post('/test', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const 配置 = await adminDb.collection('飞书配置').findOne({ 用户ID: userId });

    if (!配置) {
      return res.status(404).json({ success: false, error: '未配置飞书' });
    }

    const { 飞书适配器 } = await import('../../im/飞书适配器.js');
    const appSecret = decryptSecret(配置.encryptedAppSecret);
    const encryptKey = decryptSecret(配置.encryptedEncryptKey);

    const adapter = new 飞书适配器({
      appId: 配置.appId,
      appSecret,
      verificationToken: 配置.verificationToken,
      encryptKey,
    });

    await adapter.初始化();
    const 测试结果 = await adapter.测试连接();

    res.json({
      success: true,
      data: {
        连接成功: 测试结果,
        消息: 测试结果 ? '连接正常（access_token 有效）' : '连接失败',
      }
    });
  } catch (err) {
    logger.error(`飞书连接测试失败 (${userId}):`, err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      data: { 连接成功: false, 消息: err.message }
    });
  }
});

/**
 * POST /api/feishu/sendfile - 发送本地文件到飞书
 */
router.post('/sendfile', async (req, res) => {
  const userId = req.user.userId;
  const { filePath, fileName, toUserId, caption } = req.body;
  if (!filePath) { return res.status(400).json({ success: false, error: 'filePath 必填' }); }
  try {
    const normalizedPath = filePath.replace(/\\/g, '/');
    if (normalizedPath.includes('..') || normalizedPath.includes('//')) { return res.status(403).json({ success: false, error: '文件路径不允许包含 .. 或双斜杠' }); }
    if (!existsSync(filePath)) { return res.status(404).json({ success: false, error: '文件不存在: ' + filePath }); }
    const stat = statSync(filePath);
    const mediaType = 判断媒体类型(fileName || filePath);
    const sizeCheck = 验证文件大小(stat.size, mediaType);
    if (!sizeCheck.ok) { return res.status(413).json({ success: false, error: '文件过大' }); }
    const state = feishuListenerManager.listeners.get(userId);
    if (!state) { return res.status(400).json({ success: false, error: '飞书监听器未运行' }); }
    const targetUserId = toUserId;
    if (!targetUserId) { return res.status(400).json({ success: false, error: '未指定目标用户 (toUserId，飞书 open_id)' }); }
    await feishuListenerManager._sendFeishuMediaMessage(state, targetUserId, filePath, caption || '');
    记录审计({ 操作者ID: userId, 操作者类型: 'user', 操作: 'feishu_send_file', 目标ID: targetUserId, 结果: 'success', 详情: { fileName: fileName || filePath.split(/[/\\]/).pop(), filePath } });
    res.json({ success: true, data: { platform: 'feishu', toUserId: targetUserId } });
  } catch (err) {
    logger.error(`[飞书] 发送文件失败 (${userId}): ${err.message}`);
    res.status(500).json({ success: false, error: '发送文件失败: ' + err.message });
  }
});

export default router;
