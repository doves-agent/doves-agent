/**
 * 飞书 Webhook 子路由
 * 职责：接收飞书事件回调 / 签名验证 / 消息处理 / 监听器诊断
 */

import { Router } from 'express';
import crypto from 'crypto';
import { logger } from '../../core.js';
import { getAdminDb, getMongoClient } from '../../db.js';
import { decryptSecret } from './加密工具.js';
import { toLocalISOString } from '@dove/common/时间工具.js';
import { feishuListenerManager } from './shared.js';

const router = Router();

/**
 * POST /api/feishu/webhook - 接收飞书事件回调（无需 JWT 认证）
 */
/**
 * 飞书 Webhook 处理函数（无需JWT认证，供路由配置直接挂载）
 * 第三方回调无法提供 JWT token，因此需要独立挂载在认证中间件之外
 */
export async function handleFeishuWebhook(req, res) {
  try {
    const body = req.body;
    const headers = req.headers;

    // 1. URL Verification
    if (body.type === 'url_verification') {
      logger.info('[飞书 Webhook] 收到 URL Verification 请求');

      const 配置 = await _findConfigByVerificationToken(body.token);
      if (!配置) {
        return res.status(401).json({ error: '验证 Token 不匹配' });
      }

      return res.json({ challenge: body.challenge });
    }

    // 2. 签名验证
    const timestamp = headers['x-lark-signature-timestamp'];
    const signature = headers['x-lark-signature'];

    if (timestamp && signature) {
      const rawBody = JSON.stringify(body);
      const 配置 = await _findConfigBySignature(timestamp, signature, rawBody);
      if (!配置) {
        logger.warn('[飞书 Webhook] 签名验证失败');
      }
    }

    // 3. 处理事件回调
    const event = body.event || (body.header ? body : null);

    if (event) {
      const eventType = body.header?.event_type || event.event?.type || '';
      const appId = body.header?.app_id || '';

      logger.info(`[飞书 Webhook] 收到事件: ${eventType} (app: ${appId})`);

      if (eventType === 'im.message.receive_v1') {
        await _handleMessageEvent(body);
      } else if (eventType === 'card_action.callback') {
        await _handleCardAction(body);
      }
    }

    res.json({ code: 0, msg: 'success' });
  } catch (err) {
    logger.error('[飞书 Webhook] 处理回调失败:', err);
    res.json({ code: 0, msg: 'success' });
  }
}

// 路由也保留一份（供 /api/feishu 认证路径下的访问）
router.post('/webhook', handleFeishuWebhook);

/**
 * GET /api/feishu/listener/status - 诊断接口
 */
router.get('/listener/status', async (req, res) => {
  const userId = req.user.userId;

  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const 配置 = await adminDb.collection('飞书配置').findOne({ 用户ID: userId });
    const isListenerRunning = feishuListenerManager.listeners.has(userId);
    const allListenerCount = feishuListenerManager.listeners.size;

    res.json({
      success: true,
      data: {
        配置存在: !!配置,
        启用: 配置?.启用 || false,
        appId: 配置?.appId ? `${配置.appId.slice(0, 4)}***` : '',
        监听器运行中: isListenerRunning,
        全部监听器数: allListenerCount,
        timestamp: toLocalISOString(),
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 事件处理辅助函数 ====================

/**
 * 处理飞书消息事件
 */
async function _handleMessageEvent(body) {
  try {
    const event = body.event || {};
    const message = event.message || {};
    const sender = event.sender || {};

    const senderId = sender.sender_id?.open_id || sender.sender_id?.user_id || '';
    const chatId = message.chat_id || '';
    const messageType = message.message_type || 'text';
    const content = message.content ? JSON.parse(message.content) : {};

    let text = '';
    let mediaInfo = null;
    const messageId = message.message_id || '';

    if (messageType === 'text') {
      text = content.text || '';
    } else if (messageType === 'post') {
      const contentObj = content.content || [];
      for (const line of contentObj) {
        for (const elem of line) {
          if (elem.tag === 'text') text += elem.text || '';
          if (elem.tag === 'at') text += elem.user_id ? `@${elem.user_id} ` : '';
        }
        text += '\n';
      }
      text = text.trim();
    } else if (messageType === 'interactive') {
      text = content.header?.title?.content || content.content?.map(c => c.text).join('') || '[卡片消息]';
    } else if (messageType === 'image') {
      const imageKey = content.image_key || '';
      if (imageKey) {
        mediaInfo = { msg_type: 'image', image_key: imageKey, message_id: messageId };
        text = '';
      } else {
        text = '[图片消息，无法获取图片数据]';
      }
    } else if (messageType === 'file') {
      const fileKey = content.file_key || '';
      const fileName = content.file_name || content.filename || '';
      if (fileKey) {
        mediaInfo = { msg_type: 'file', file_key: fileKey, message_id: messageId, file_name: fileName };
        text = '';
      } else {
        text = '[文件消息，无法获取文件数据]';
      }
    } else if (messageType === 'video') {
      const imageKey = content.image_key || content.video_key || '';
      if (imageKey) {
        mediaInfo = { msg_type: 'video', image_key: imageKey, message_id: messageId };
        text = '';
      } else {
        text = '[视频消息，无法获取视频数据]';
      }
    } else if (messageType === 'audio') {
      const fileKey = content.file_key || '';
      if (fileKey) {
        mediaInfo = { msg_type: 'audio', file_key: fileKey, message_id: messageId };
        text = '';
      } else {
        text = '[音频消息，无法获取音频数据]';
      }
    } else {
      text = `[${messageType}类型消息]`;
    }

    if ((!text && !mediaInfo) || !senderId) return;

    const appId = body.header?.app_id || '';
    await getMongoClient();
    const adminDb = getAdminDb();
    const 配置 = await adminDb.collection('飞书配置').findOne({ appId, 启用: true });

    if (!配置) {
      logger.warn(`[飞书 Webhook] 未找到 appId=${appId} 的配置`);
      return;
    }

    await feishuListenerManager._handleCallbackEvent(配置.用户ID, {
      senderId,
      chatId,
      text,
      messageType,
      mediaInfo,
      原始消息: body,
    });

  } catch (err) {
    logger.error(`[飞书 Webhook] 处理消息事件失败: ${err.message}`);
  }
}

/**
 * 处理飞书卡片回调
 */
async function _handleCardAction(body) {
  try {
    const action = body.action || {};
    const value = action.value || {};
    const userId = body.open_id || '';

    if (value.action === 'approve' || value.action === 'reject') {
      logger.info(`[飞书 Webhook] 卡片审批: action=${value.action}, taskId=${value.taskId}, userId=${userId}`);

      const appId = body.app_id || '';
      await getMongoClient();
      const adminDb = getAdminDb();
      const 配置 = await adminDb.collection('飞书配置').findOne({ appId, 启用: true });

      if (配置) {
        await feishuListenerManager._handleCallbackEvent(配置.用户ID, {
          senderId: userId,
          chatId: '',
          text: value.action === 'approve' ? '确认' : '拒绝',
          messageType: 'text',
          原始消息: body,
        });
      }
    }
  } catch (err) {
    logger.error(`[飞书 Webhook] 处理卡片回调失败: ${err.message}`);
  }
}

/**
 * 通过 verificationToken 查找配置
 */
async function _findConfigByVerificationToken(token) {
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    return await adminDb.collection('飞书配置').findOne({ verificationToken: token });
  } catch {
    return null;
  }
}

/**
 * 通过签名验证查找配置
 */
async function _findConfigBySignature(timestamp, signature, rawBody) {
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    const configs = await adminDb.collection('飞书配置').find({ 启用: true }).toArray();

    for (const 配置 of configs) {
      const encryptKey = decryptSecret(配置.encryptedEncryptKey);
      if (!encryptKey) continue;

      const content = timestamp + rawBody;
      const computedSign = crypto.createHmac('sha256', encryptKey)
        .update(content)
        .digest('base64');

      if (computedSign === signature) {
        return 配置;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export default router;
