/**
 * 钉钉企业应用通道管理路由（服务端）
 * 
 * 已拆分为子模块：
 * - 加密工具.js: 加密解密函数
 * - 消息监听器.js: DingTalkListenerManager 类
 */

import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { CONFIG, logger } from '../core.js';
import { getAdminDb, getMongoClient } from '../db.js';
import { 记录审计 } from '../审计日志.js';
import { createTimestampFields, getUserDb } from '../db.js';
import { 保存媒体文件, 验证文件大小, 判断媒体类型 } from '../im/媒体服务.js';
import { existsSync, statSync } from 'fs';
import { toLocalISOString } from '@dove/common/时间工具.js';
import { encryptSecret, decryptSecret, sessionCache } from './dingtalk/加密工具.js';
import { dingTalkListenerManager, startDingTalkListeners, startDingTalkListenerForUser, stopDingTalkListenerForUser } from './dingtalk/消息监听器.js';

const router = Router();

// ==================== API 路由 ====================

/**
 * POST /api/dingtalk/config
 * 配置钉钉企业应用凭证
 */
router.post('/config', async (req, res) => {
  const userId = req.user.userId;
  const { appKey, appSecret, agentId, webhookUrl, secret } = req.body;

  // 参数校验：至少配置一种模式
  const 企业模式 = !!(appKey && appSecret);
  const 群机器人模式 = !!webhookUrl;

  if (!企业模式 && !群机器人模式) {
    return res.status(400).json({
      success: false,
      error: '请至少配置企业应用（appKey+appSecret）或群机器人（webhookUrl）'
    });
  }

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const 配置文档 = {
      用户ID: userId,
      更新时间: new Date(),
    };

    if (企业模式) {
      配置文档.模式 = 'enterprise';
      配置文档.appKey = appKey;
      配置文档.encryptedAppSecret = encryptSecret(appSecret);
      配置文档.agentId = agentId || '';
    } else {
      配置文档.模式 = 'webhook';
    }

    if (webhookUrl) 配置文档.webhookUrl = webhookUrl;
    if (secret) 配置文档.encryptedSecret = encryptSecret(secret);

    // 如果是首次配置，设置启用状态
    const existing = await adminDb.collection('钉钉配置').findOne({ 用户ID: userId });
    if (!existing) {
      配置文档.启用 = true;
      配置文档.创建时间 = new Date();
    }

    await adminDb.collection('钉钉配置').updateOne(
      { 用户ID: userId },
      {
        $set: 配置文档,
        $setOnInsert: { 创建时间: new Date() }
      },
      { upsert: true }
    );

    // 如果是企业模式，启动监听
    if (企业模式 && (existing?.启用 !== false)) {
      startDingTalkListenerForUser(userId, appKey, appSecret, agentId);
    }

    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'dingtalk_config',
      目标ID: userId,
      结果: 'success',
      详情: { 模式: 配置文档.模式 }
    });

    logger.info(`用户 ${userId} 配置钉钉成功 (模式: ${配置文档.模式})`);

    res.json({
      success: true,
      message: existing ? '配置已更新' : '配置已创建',
      data: { 模式: 配置文档.模式, 启用: 配置文档.启用 ?? existing?.启用 ?? true }
    });
  } catch (err) {
    logger.error(`钉钉配置失败 (${userId}):`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/dingtalk/config
 * 获取钉钉配置状态
 */
router.get('/config', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const 配置 = await adminDb.collection('钉钉配置').findOne({ 用户ID: userId });

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
        模式: 配置.模式,
        启用: 配置.启用 || false,
        appKey: 配置.appKey ? `${配置.appKey.slice(0, 4)}***` : '',
        agentId: 配置.agentId || '',
        webhookUrl: 配置.webhookUrl ? 脱敏URL(配置.webhookUrl) : '',
        创建时间: 配置.创建时间,
        更新时间: 配置.更新时间,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/dingtalk/config
 * 删除钉钉配置
 */
router.delete('/config', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const result = await adminDb.collection('钉钉配置').deleteOne({ 用户ID: userId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: '未找到钉钉配置' });
    }

    // 清除会话令牌
    for (const [key, val] of sessionCache) {
      if (val.userId === userId) sessionCache.delete(key);
    }

    // 停止监听
    stopDingTalkListenerForUser(userId);

    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'dingtalk_config_delete',
      目标ID: userId,
      结果: 'success',
      详情: {}
    });

    logger.info(`用户 ${userId} 删除钉钉配置`);

    res.json({ success: true, data: { status: '已删除' } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/dingtalk/enable
 * 启用钉钉通道
 */
router.post('/enable', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const 配置 = await adminDb.collection('钉钉配置').findOneAndUpdate(
      { 用户ID: userId },
      { $set: { 启用: true, 更新时间: new Date() } },
      { returnDocument: 'after' }
    );

    if (!配置) {
      return res.status(404).json({ success: false, error: '未配置钉钉' });
    }

    // 启动监听
    if (配置.模式 === 'enterprise' && 配置.appKey) {
      const appSecret = decryptSecret(配置.encryptedAppSecret);
      if (appSecret) {
        startDingTalkListenerForUser(userId, 配置.appKey, appSecret, 配置.agentId);
      }
    }

    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'dingtalk_enable',
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
 * POST /api/dingtalk/disable
 * 禁用钉钉通道
 */
router.post('/disable', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const result = await adminDb.collection('钉钉配置').updateOne(
      { 用户ID: userId },
      { $set: { 启用: false, 更新时间: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: '未配置钉钉' });
    }

    // 清除会话令牌
    for (const [key, val] of sessionCache) {
      if (val.userId === userId) sessionCache.delete(key);
    }

    // 停止监听
    stopDingTalkListenerForUser(userId);

    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'dingtalk_disable',
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
 * POST /api/dingtalk/test
 * 测试钉钉连接
 */
router.post('/test', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const 配置 = await adminDb.collection('钉钉配置').findOne({ 用户ID: userId });

    if (!配置) {
      return res.status(404).json({ success: false, error: '未配置钉钉' });
    }

    // 动态创建临时适配器实例测试
    const { 钉钉适配器 } = await import('../im/钉钉适配器.js');

    let adapterConfig = {};
    if (配置.模式 === 'enterprise') {
      const appSecret = decryptSecret(配置.encryptedAppSecret);
      adapterConfig = {
        appKey: 配置.appKey,
        appSecret,
        agentId: 配置.agentId,
      };
    } else {
      adapterConfig = {
        webhookUrl: 配置.webhookUrl,
        secret: decryptSecret(配置.encryptedSecret),
      };
    }

    const adapter = new 钉钉适配器(adapterConfig);
    await adapter.初始化();
    const 测试结果 = await adapter.测试连接();

    res.json({
      success: true,
      data: {
        模式: 配置.模式,
        连接成功: 测试结果,
        消息: 测试结果 ? '连接正常' : '连接失败',
      }
    });
  } catch (err) {
    logger.error(`钉钉连接测试失败 (${userId}):`, err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      data: { 连接成功: false, 消息: err.message }
    });
  }
});

/**
 * POST /api/dingtalk/webhook
 * 接收钉钉回调事件（无需 JWT 认证）
 * 钉钉 Stream API 或 HTTP 回调会将事件推送到此端点
 */
/**
 * 钉钉 Webhook 处理函数（无需JWT认证，供路由配置直接挂载）
 * 第三方回调无法提供 JWT token，因此需要独立挂载在认证中间件之外
 */
export async function handleDingTalkWebhook(req, res) {
  try {
    const body = req.body;

    logger.info(`[钉钉 Webhook] 收到回调事件`);

    // 钉钉回调验证
    if (body.encrypt) {
      // 加密回调，需要解密
      // 此处暂不实现解密逻辑，后续可通过钉钉适配器处理
    }

    // 处理钉钉 Stream 事件回调
    const eventType = body.type || body.eventType || '';
    const data = body.data || body;

    // 根据 userId 查找对应的钉钉配置
    // 钉钉回调中包含 corpId 和 conversationId 等信息
    if (eventType === 'conversation' || body.msgtype || body.text) {
      // 消息事件
      const senderId = data.senderId || data.senderStaffId || body.senderStaffId || '';
      const conversationId = data.conversationId || body.conversationId || '';
      const content = data.text || body.text?.content || body.content || '';
      const corpId = data.corpId || body.corpId || '';

      if (content && senderId) {
        // 查找匹配的用户
        await getMongoClient();
        const adminDb = getAdminDb();

        // 通过 appKey 或 corpId 匹配用户
        const 配置 = await adminDb.collection('钉钉配置').findOne({
          启用: true,
          ...(corpId ? { corpId } : {}),
        });

        if (配置) {
          // 将消息转发给监听器处理
          dingTalkListenerManager._handleCallbackEvent(配置.用户ID, {
            senderId,
            conversationId,
            content: typeof content === 'string' ? content : JSON.stringify(content),
            msgtype: body.msgtype || 'text',
            原始消息: body,
          }).catch(err => {
            logger.warn(`[钉钉 Webhook] 处理回调消息失败: ${err.message}`);
          });
        }
      }
    }

    // 钉钉要求返回成功
    res.json({ errcode: 0, errmsg: 'ok' });
  } catch (err) {
    logger.error('[钉钉 Webhook] 处理回调失败:', err);
    // 即使失败也返回成功，避免钉钉重试
    res.json({ errcode: 0, errmsg: 'ok' });
  }
}

// 路由也保留一份（供 /api/dingtalk 认证路径下的访问）
router.post('/webhook', handleDingTalkWebhook);

/**
 * GET /api/dingtalk/listener/status
 * 诊断接口：查看钉钉监听器状态
 */
router.get('/listener/status', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const 配置 = await adminDb.collection('钉钉配置').findOne({ 用户ID: userId });
    const isListenerRunning = dingTalkListenerManager.listeners.has(userId);
    const allListenerCount = dingTalkListenerManager.listeners.size;

    res.json({
      success: true,
      data: {
        配置存在: !!配置,
        模式: 配置?.模式 || 'none',
        启用: 配置?.启用 || false,
        appKey: 配置?.appKey ? `${配置.appKey.slice(0, 4)}***` : '',
        监听器运行中: isListenerRunning,
        全部监听器数: allListenerCount,
        timestamp: toLocalISOString(),
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 工具函数 ====================

function 脱敏URL(url) {
  if (!url || typeof url !== 'string') return '';
  if (url.length <= 12) return url;
  return url.substring(0, 8) + '***' + url.substring(url.length - 4);
}

// ==================== 文件发送 API ====================

/**
 * POST /api/dingtalk/sendfile
 * 发送本地文件到钉钉
 * 
 * 请求体：
 * {
 *   filePath: string,     // 本地文件路径（必须）
 *   fileName: string,     // 文件名（可选，默认取路径末尾）
 *   toUserId: string,     // 目标用户钉钉ID（可选，默认用上次对话用户）
 *   caption: string,      // 附加文字说明（可选）
 * }
 * 
 * 安全：
 * - 需 JWT 认证
 * - 验证文件存在
 * - 防止路径穿越
 * - 文件大小检查
 */
router.post('/sendfile', async (req, res) => {
  const userId = req.user.userId;
  const { filePath, fileName, toUserId, caption } = req.body;

  if (!filePath) {
    return res.status(400).json({ success: false, error: 'filePath 必填' });
  }

  try {
    // 安全检查：路径穿越防护
    const normalizedPath = filePath.replace(/\\/g, '/');
    if (normalizedPath.includes('..') || normalizedPath.includes('//')) {
      return res.status(403).json({ success: false, error: '文件路径不允许包含 .. 或双斜杠' });
    }

    // 验证文件存在
    if (!existsSync(filePath)) {
      return res.status(404).json({ success: false, error: `文件不存在: ${filePath}` });
    }

    // 检查文件大小
    const stat = statSync(filePath);
    const mediaType = 判断媒体类型(fileName || filePath);
    const sizeCheck = 验证文件大小(stat.size, mediaType);
    if (!sizeCheck.ok) {
      return res.status(413).json({
        success: false,
        error: `文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，${mediaType}限制 ${sizeCheck.limit / 1024 / 1024}MB`
      });
    }

    // 获取钉钉监听器状态
    const state = dingTalkListenerManager.listeners.get(userId);
    if (!state) {
      return res.status(400).json({ success: false, error: '钉钉监听器未运行，请先配置并启用钉钉通道' });
    }

    // 确定目标用户
    const targetUserId = toUserId;
    if (!targetUserId) {
      return res.status(400).json({ success: false, error: '未指定目标用户 (toUserId)' });
    }

    // 发送文件
    const result = await dingTalkListenerManager._sendDingTalkMediaMessage(
      state,
      targetUserId,
      filePath,
      caption || ''
    );

    // 审计日志
    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'dingtalk_send_file',
      目标ID: targetUserId,
      结果: 'success',
      详情: { fileName: fileName || filePath.split(/[/\\]/).pop(), filePath }
    });

    res.json({
      success: true,
      data: {
        platform: 'dingtalk',
        toUserId: targetUserId,
      }
    });
  } catch (err) {
    logger.error(`[钉钉] 发送文件失败 (${userId}): ${err.message}`);
    res.status(500).json({ success: false, error: `发送文件失败: ${err.message}` });
  }
});

export { dingTalkListenerManager } from './dingtalk/消息监听器.js';
export default router;
export { startDingTalkListeners };
