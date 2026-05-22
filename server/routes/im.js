/**
 * IM (即时通讯) 管理 API 路由
 * 提供 IM 平台 Webhook 接收、配置管理、连接测试、文件发送等功能
 *
 * API 端点：
 * - POST   /api/im/:platform/webhook  接收 IM 平台回调（无需认证）
 * - GET    /api/im/config             获取用户 IM 配置（需认证）
 * - POST   /api/im/config             配置 IM 通道（需认证）
 * - POST   /api/im/test               测试 IM 连接（需认证）
 * - POST   /api/im/sendfile           统一文件发送入口（需认证）
 */

import { Router } from 'express';
import { logger } from '../core.js';
import { getUserDb } from '../db.js';
import { 验证文件大小, 判断媒体类型 } from '../im/媒体服务.js';
import { existsSync, statSync } from 'fs';
import { 记录审计 } from '../审计日志.js';

const router = Router();

/**
 * Webhook URL 脱敏处理
 * 只显示前 8 个字符，其余用 *** 代替
 * @param {string} url - 原始 Webhook URL
 * @returns {string} - 脱敏后的 URL
 */
function 脱敏WebhookUrl(url) {
  if (!url || typeof url !== 'string') return '';
  if (url.length <= 12) return url;
  return url.substring(0, 8) + '***' + url.substring(url.length - 4);
}

/**
 * POST /api/im/:platform/webhook
 * 接收 IM 平台回调（无需 JWT 认证）
 *
 * 路径参数：
 * - platform: 平台名称（dingtalk/wechat/lark 等）
 *
 * 安全校验：
 * - 验证请求签名（平台特定）
 */
router.post('/:platform/webhook', async (req, res) => {
  try {
    const { platform } = req.params;
    const 原始消息 = req.body;

    logger.info(`[IM Webhook] 收到 ${platform} 平台回调`);

    // 动态导入适配器注册表（避免循环依赖）
    let 适配器注册表;
    try {
      const imModule = await import('../im/适配器.js');
      适配器注册表 = imModule.适配器注册表;
    } catch (e) {
      logger.warn('[IM Webhook] 适配器模块未找到:', e.message);
      return res.status(503).json({
        success: false,
        error: 'IM 适配器模块尚未初始化'
      });
    }

    // 获取对应平台的适配器
    const 适配器 = 适配器注册表.获取(platform);
    if (!适配器) {
      logger.warn(`[IM Webhook] 未找到 ${platform} 平台的适配器`);
      return res.status(404).json({
        success: false,
        error: `不支持的平台: ${platform}`
      });
    }

    // 安全校验：验证请求签名（平台特定）
    try {
      const 签名有效 = await 适配器.验证签名(req);
      if (!签名有效) {
        logger.warn(`[IM Webhook] ${platform} 签名验证失败`);
        return res.status(401).json({
          success: false,
          error: '签名验证失败'
        });
      }
    } catch (e) {
      // 如果适配器没有实现签名验证，继续处理
      logger.debug(`[IM Webhook] ${platform} 签名验证跳过:`, e.message);
    }

    // 解析回调消息
    const 解析结果 = await 适配器.解析回复(原始消息);
    logger.info(`[IM Webhook] ${platform} 消息解析成功:`, {
      用户ID: 解析结果.用户ID,
      类型: 解析结果.类型
    });

    // 返回 200 表示处理成功
    res.json({
      success: true,
      message: '消息已接收'
    });
  } catch (err) {
    logger.error('[IM Webhook] 处理回调失败:', err);
    // 即使处理失败也返回 200，避免 IM 平台重试
    res.json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/im/config
 * 获取用户的 IM 配置（需要认证）
 *
 * 返回：
 * - 用户配置的 IM 通道列表（平台、是否启用、Webhook URL 脱敏显示）
 */
router.get('/config', async (req, res) => {
  try {
    const userId = req.user.userId;
    const db = getUserDb();

    // 查询 IM 配置集合
    let 配置列表 = [];
    try {
      配置列表 = await db.collection('IM配置')
        .find({ 用户ID: userId })
        .toArray();
    } catch (e) {
      // 集合可能不存在，返回空列表
      logger.debug('[IM Config] 集合不存在或查询失败:', e.message);
    }

    // 脱敏处理：不暴露 secret，URL 只显示前几个字符
    const 脱敏配置列表 = 配置列表.map(配置 => ({
      平台: 配置.平台,
      启用: 配置.启用 ?? false,
      webhookUrl: 脱敏WebhookUrl(配置.webhookUrl),
      // 不返回 secret 字段
      创建时间: 配置.创建时间,
      更新时间: 配置.更新时间
    }));

    res.json({
      success: true,
      data: {
        配置列表: 脱敏配置列表,
        总数: 脱敏配置列表.length
      }
    });
  } catch (err) {
    logger.error('[IM Config] 获取配置失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/im/config
 * 配置 IM 通道（需要认证）
 *
 * 请求体：
 * - 平台: 'dingtalk' | 'wechat' | 'lark' 等
 * - webhookUrl: Webhook 地址
 * - secret: 密钥（可选）
 * - 启用: boolean
 */
router.post('/config', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { 平台, webhookUrl, secret, 启用 } = req.body;

    // 参数校验
    if (!平台) {
      return res.status(400).json({
        success: false,
        error: '平台名称不能为空'
      });
    }

    if (!webhookUrl) {
      return res.status(400).json({
        success: false,
        error: 'webhookUrl 不能为空'
      });
    }

    const db = getUserDb();

    // 构建配置文档
    const 配置文档 = {
      用户ID: userId,
      平台,
      webhookUrl,
      启用: 启用 !== undefined ? 启用 : true,
      更新时间: new Date()
    };

    // 如果提供了 secret，则更新
    if (secret !== undefined) {
      配置文档.secret = secret;
    }

    // upsert 模式：按平台名更新或插入
    const result = await db.collection('IM配置').updateOne(
      { 用户ID: userId, 平台 },
      {
        $set: 配置文档,
        $setOnInsert: { 创建时间: new Date() }
      },
      { upsert: true }
    );

    logger.info(`[IM Config] 用户 ${userId} 更新 ${平台} 配置成功`);

    res.json({
      success: true,
      message: result.upsertedCount > 0 ? '配置已创建' : '配置已更新',
      data: {
        平台,
        启用: 配置文档.启用
      }
    });
  } catch (err) {
    logger.error('[IM Config] 保存配置失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/im/test
 * 测试 IM 连接（需要认证）
 *
 * 请求体：
 * - 平台: 'dingtalk' | 'wechat' | 'lark' 等
 */
router.post('/test', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { 平台 } = req.body;

    if (!平台) {
      return res.status(400).json({
        success: false,
        error: '平台名称不能为空'
      });
    }

    const db = getUserDb();

    // 从用户配置中读取该平台的配置
    const 配置 = await db.collection('IM配置').findOne({
      用户ID: userId,
      平台
    });

    if (!配置) {
      return res.status(404).json({
        success: false,
        error: `未找到 ${平台} 的配置，请先配置`
      });
    }

    // 动态导入适配器注册表
    let 适配器注册表;
    try {
      const imModule = await import('../im/适配器.js');
      适配器注册表 = imModule.适配器注册表;
    } catch (e) {
      logger.warn('[IM Test] 适配器模块未找到:', e.message);
      return res.status(503).json({
        success: false,
        error: 'IM 适配器模块尚未初始化'
      });
    }

    // 根据平台类型动态导入并创建临时适配器实例
    let 适配器实例;
    try {
      if (平台 === 'dingtalk') {
        const { 钉钉适配器 } = await import('../im/钉钉适配器.js');
        适配器实例 = new 钉钉适配器({
          webhookUrl: 配置.webhookUrl,
          secret: 配置.secret,
          appKey: 配置.appKey,
          appSecret: 配置.appSecret,
          agentId: 配置.agentId,
        });
      } else if (平台 === 'feishu') {
        const { 飞书适配器 } = await import('../im/飞书适配器.js');
        适配器实例 = new 飞书适配器({
          appId: 配置.appId,
          appSecret: 配置.appSecret,
          verificationToken: 配置.verificationToken,
          encryptKey: 配置.encryptKey,
        });
      } else {
        return res.status(404).json({
          success: false,
          error: `不支持的平台: ${平台}`
        });
      }
    } catch (e) {
      logger.error('[IM Test] 创建适配器实例失败:', e.message);
      return res.status(500).json({
        success: false,
        error: `创建适配器失败: ${e.message}`
      });
    }

    // 调用测试连接方法
    const 测试结果 = await 适配器实例.测试连接();

    logger.info(`[IM Test] 用户 ${userId} 测试 ${平台} 连接:`, 测试结果);

    res.json({
      success: true,
      data: {
        平台,
        连接成功: 测试结果.成功 ?? false,
        消息: 测试结果.消息 || '测试完成',
        详情: 测试结果.详情
      }
    });
  } catch (err) {
    logger.error('[IM Test] 测试连接失败:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      data: {
        平台: req.body.平台,
        连接成功: false,
        消息: err.message
      }
    });
  }
});

// ==================== 统一文件发送 API ====================

/**
 * POST /api/im/sendfile
 * 统一文件发送入口（支持微信/钉钉/飞书）
 *
 * 请求体：
 * {
 *   filePath: string,     // 本地文件路径（必须）
 *   fileName: string,     // 文件名（可选，默认取路径末尾）
 *   platform: string,     // IM平台名称: 'wechat' | 'dingtalk' | 'feishu'（必须）
 *   toUserId: string,     // 目标用户ID（可选，默认用上次对话用户）
 *   contextToken: string, // 上下文令牌（可选，仅微信需要）
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
  const { filePath, fileName, platform, toUserId, contextToken, caption } = req.body;

  // 参数校验
  if (!filePath) {
    return res.status(400).json({ success: false, error: 'filePath 必填' });
  }
  if (!platform) {
    return res.status(400).json({ success: false, error: 'platform 必填 (wechat/dingtalk/feishu)' });
  }

  const supportedPlatforms = ['wechat', 'dingtalk', 'feishu'];
  if (!supportedPlatforms.includes(platform)) {
    return res.status(400).json({ success: false, error: `不支持的平台: ${platform}，支持: ${supportedPlatforms.join('/')}` });
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

    // 根据平台路由到对应的监听器发送文件
    let result;

    if (platform === 'wechat') {
      // 微信：使用微信监听器
      const wechatModule = await import('./wechat.js');
      const wechatListenerManager = wechatModule.wechatListenerManager;
      if (!wechatListenerManager) {
        return res.status(400).json({ success: false, error: '微信监听器模块不可用' });
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
      result = await wechatListenerManager._sendWeChatMediaMessage(state, targetUserId, filePath, targetContextToken, caption || '');
      result = { clientId: result.clientId, mediaType: result.mediaType, fileName: result.fileName, toUserId: targetUserId };
    } else if (platform === 'dingtalk') {
      // 钉钉：使用钉钉监听器
      const dingtalkModule = await import('./dingtalk.js');
      const dingtalkListenerManager = dingtalkModule.dingTalkListenerManager;
      if (!dingtalkListenerManager) {
        return res.status(400).json({ success: false, error: '钉钉监听器模块不可用' });
      }
      const state = dingtalkListenerManager.listeners.get(userId);
      if (!state) {
        return res.status(400).json({ success: false, error: '钉钉监听器未运行，请先配置并启用钉钉通道' });
      }
      const targetUserId = toUserId;
      if (!targetUserId) {
        return res.status(400).json({ success: false, error: '未指定目标用户 (toUserId)' });
      }
      await dingtalkListenerManager._sendDingTalkMediaMessage(state, targetUserId, filePath, caption || '');
      result = { platform: 'dingtalk', toUserId: targetUserId };
    } else if (platform === 'feishu') {
      // 飞书：使用飞书监听器
      const feishuModule = await import('./feishu.js');
      const feishuListenerManager = feishuModule.feishuListenerManager;
      if (!feishuListenerManager) {
        return res.status(400).json({ success: false, error: '飞书监听器模块不可用' });
      }
      const state = feishuListenerManager.listeners.get(userId);
      if (!state) {
        return res.status(400).json({ success: false, error: '飞书监听器未运行，请先配置并启用飞书通道' });
      }
      const targetUserId = toUserId;
      if (!targetUserId) {
        return res.status(400).json({ success: false, error: '未指定目标用户 (toUserId，飞书 open_id)' });
      }
      await feishuListenerManager._sendFeishuMediaMessage(state, targetUserId, filePath, caption || '');
      result = { platform: 'feishu', toUserId: targetUserId };
    }

    // 审计日志
    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: `${platform}_send_file`,
      目标ID: result?.toUserId || toUserId,
      结果: 'success',
      详情: { fileName: fileName || filePath.split(/[/\\]/).pop(), filePath, platform }
    });

    res.json({
      success: true,
      data: {
        platform,
        ...result,
      }
    });
  } catch (err) {
    logger.error(`[IM] 统一发送文件失败 (${userId}, ${platform}): ${err.message}`);
    res.status(500).json({ success: false, error: `发送文件失败: ${err.message}` });
  }
});

export default router;
