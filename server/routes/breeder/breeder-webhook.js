/**
 * Webhook 管理 + 触发引擎 子路由
 * 职责：Webhook CRUD + 事件触发/规则执行/集成通知
 */

import { Router } from 'express';
import { logger } from '../../core.js';
import { 
  getMongoClient, getAdminDb, createTimestampFields, getTimestamp
} from '../../db.js';
import { 记录审计 } from '../../审计日志.js';
import { toLocalISOString } from '@dove/common/时间工具.js';
import { toObjectId, 支持的事件 } from './breeder-helpers.js';

const router = Router();

// ==================== Webhook 管理 ====================

/**
 * POST /api/breeder/webhook
 * 注册 Webhook
 */
router.post('/webhook', async (req, res) => {
  const userId = req.user.userId;
  const { url, events, secret, 描述 } = req.body;
  
  if (!url) {
    return res.status(400).json({ success: false, error: 'Webhook URL 不能为空' });
  }
  
  // 验证 URL 格式
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ success: false, error: 'URL 格式无效' });
  }
  
  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ success: false, error: '必须指定至少一个事件' });
  }
  
  // 验证事件类型
  const invalidEvents = events.filter(e => !支持的事件.includes(e));
  if (invalidEvents.length > 0) {
    return res.status(400).json({ 
      success: false, 
      error: `不支持的事件类型: ${invalidEvents.join(', ')}`,
      支持的事件
    });
  }
  
  // 限制每个用户最多 20 个 Webhook
  try {
    await getMongoClient();
    const db = getAdminDb();
    const ts = createTimestampFields();
    
    const count = await db.collection('饲养员Webhook').countDocuments({ 用户ID: userId });
    if (count >= 20) {
      return res.status(400).json({ success: false, error: '每个饲养员最多注册 20 个 Webhook' });
    }
    
    const webhook = {
      用户ID: userId,
      url,
      events,
      secret: secret || null,
      描述: 描述 || '',
      状态: '活跃',
      失败次数: 0,
      最后触发时间: null,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp,
      更新时间: ts.localTime
    };
    
    const result = await db.collection('饲养员Webhook').insertOne(webhook);
    
    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'register_webhook',
      目标ID: result.insertedId.toString(),
      结果: 'success',
      详情: { url, events }
    });
    
    res.status(201).json({
      success: true,
      data: {
        webhookId: result.insertedId.toString(),
        url,
        events,
        状态: '活跃'
      }
    });
  } catch (e) {
    logger.error('注册 Webhook 失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/breeder/webhook
 * 列出当前用户的所有 Webhook
 */
router.get('/webhook', async (req, res) => {
  const userId = req.user.userId;
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    
    const webhooks = await db.collection('饲养员Webhook')
      .find({ 用户ID: userId })
      .sort({ 创建时间戳: -1 })
      .toArray();
    
    // 不返回 secret 字段
    const safeWebhooks = webhooks.map(({ secret, ...rest }) => ({
      ...rest,
      secret: secret ? '***' : null  // 脱敏
    }));
    
    res.json({ success: true, data: safeWebhooks });
  } catch (e) {
    logger.error('获取 Webhook 列表失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * DELETE /api/breeder/webhook/:id
 * 删除 Webhook
 */
router.delete('/webhook/:id', async (req, res) => {
  const userId = req.user.userId;
  const { id } = req.params;
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    
    const result = await db.collection('饲养员Webhook').deleteOne({ 
      _id: toObjectId(id), 
      用户ID: userId 
    });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Webhook 不存在' });
    }
    
    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'delete_webhook',
      目标ID: id,
      结果: 'success'
    });
    
    res.json({ success: true, data: { deleted: true } });
  } catch (e) {
    logger.error('删除 Webhook 失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== Webhook 触发引擎 ====================

/**
 * 触发 Webhook（由事件系统调用）
 * 遍历匹配的 Webhook 并异步发送 HTTP 请求
 */
export async function 触发Webhook事件(事件类型, 事件数据) {
  try {
    await getMongoClient();
    const db = getAdminDb();
    
    // 查找订阅了该事件的所有 Webhook
    const webhooks = await db.collection('饲养员Webhook').find({
      events: 事件类型,
      状态: '活跃'
    }).toArray();
    
    // 查找订阅了该事件的所有集成
    const integrations = await db.collection('饲养员集成').find({
      订阅事件: 事件类型,
      状态: '活跃'
    }).toArray();
    
    // 异步发送 Webhook 请求（不阻塞主流程）
    for (const webhook of webhooks) {
      发送Webhook(webhook, 事件类型, 事件数据).catch(err => {
        logger.warn(`Webhook 发送失败 [${webhook._id}]:`, err.message);
      });
    }
    
    // 异步触发集成通知
    for (const integration of integrations) {
      触发集成通知(integration, 事件类型, 事件数据).catch(err => {
        logger.warn(`集成通知失败 [${integration._id}]:`, err.message);
      });
    }
    
    // 检查是否有匹配的自动化规则
    const rules = await db.collection('饲养员规则').find({
      '触发条件.事件': 事件类型,
      启用: true
    }).toArray();
    
    for (const rule of rules) {
      执行自动化规则(rule, 事件类型, 事件数据).catch(err => {
        logger.warn(`规则执行失败 [${rule._id}]:`, err.message);
      });
    }
    
  } catch (e) {
    // Webhook 触发不应阻塞主流程
    logger.warn('触发 Webhook 事件失败:', e.message);
  }
}

/**
 * 发送 HTTP Webhook 请求
 */
async function 发送Webhook(webhook, 事件类型, 事件数据) {
  const payload = {
    event: 事件类型,
    timestamp: Date.now(),
    data: 事件数据
  };
  
  const headers = { 'Content-Type': 'application/json' };
  
  // 如果有 secret，生成签名
  if (webhook.secret) {
    const crypto = await import('crypto');
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(JSON.stringify(payload))
      .digest('hex');
    headers['X-Dove-Signature'] = `sha256=${signature}`;
  }
  
  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)  // 10秒超时
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    // 重置失败计数
    const db = getAdminDb();
    await db.collection('饲养员Webhook').updateOne(
      { _id: webhook._id },
      { $set: { 最后触发时间: toLocalISOString(), 最后触发时间戳: getTimestamp(), 失败次数: 0 } }
    );
  } catch (err) {
    // 增加失败计数，超过5次自动禁用
    const db = getAdminDb();
    const newFailCount = (webhook.失败次数 || 0) + 1;
    const updateFields = { 失败次数: newFailCount };
    
    if (newFailCount >= 5) {
      updateFields.状态 = 'disabled';
      logger.warn(`Webhook ${webhook._id} 已因连续失败5次被禁用`);
    }
    
    await db.collection('饲养员Webhook').updateOne(
      { _id: webhook._id },
      { $set: updateFields }
    );
    
    throw err;
  }
}

/**
 * 触发集成通知
 */
async function 触发集成通知(integration, 事件类型, 事件数据) {
  const { 类型, 配置 } = integration;
  
  switch (类型) {
    case 'dingtalk':
    case 'wechat_work':
    case 'feishu':
      // 通用群机器人 Webhook 模式
      if (配置.webhook_url) {
        await 发送群机器人消息(配置.webhook_url, 类型, 事件类型, 事件数据, 配置.secret);
      }
      break;
    case 'email':
      // 邮件通知 - 需要邮件服务支持，这里仅记录
      logger.info(`邮件通知: ${配置.email} - ${事件类型}`);
      break;
    default:
      logger.warn(`不支持的集成类型: ${类型}`);
  }
}

/**
 * 发送群机器人消息
 */
async function 发送群机器人消息(url, 平台, 事件类型, 事件数据, secret) {
  const message = {
    msgtype: 'text',
    text: { content: `[白鸽通知] ${事件类型}: ${JSON.stringify(事件数据).slice(0, 200)}` }
  };
  
  const headers = { 'Content-Type': 'application/json' };
  
  // 钉钉签名
  if (平台 === 'dingtalk' && secret) {
    const crypto = await import('crypto');
    const timestamp = Date.now();
    const sign = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}\n${secret}`)
      .digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    url += `&timestamp=${timestamp}&sign=${sign}`;
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(10000)
  });
  
  if (!response.ok) {
    throw new Error(`群机器人发送失败: HTTP ${response.status}`);
  }
}

/**
 * 执行自动化规则
 */
async function 执行自动化规则(rule, 事件类型, 事件数据) {
  const { 执行动作 } = rule;
  const db = getAdminDb();
  const ts = createTimestampFields();
  
  switch (执行动作.类型) {
    case 'create_task': {
      // 基于模板创建新任务
      const 任务配置 = 执行动作.参数 || {};
      const 任务 = {
        ...任务配置,
        任务ID: 任务配置.任务ID || new (await import('mongodb')).ObjectId().toString(),
        用户ID: rule.userId,
        状态: '等待中',
        创建时间: ts.localTime,
        创建时间戳: ts.timestamp,
        更新时间: ts.localTime,
        更新时间戳: ts.timestamp,
        触发规则ID: rule._id.toString()
      };
      await db.collection('任务').insertOne(任务);
      break;
    }
    case 'send_notification':
      // 发送通知（通过 Webhook 或其他方式）
      logger.info(`规则 ${rule._id} 发送通知: ${执行动作.参数?.消息 || ''}`);
      break;
    case 'call_webhook':
      // 调用自定义 Webhook
      if (执行动作.参数?.url) {
        await fetch(执行动作.参数.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 事件类型, data: 事件数据, ruleId: rule._id.toString() }),
          signal: AbortSignal.timeout(10000)
        });
      }
      break;
  }
  
  // 更新规则触发统计
  await db.collection('饲养员规则').updateOne(
    { _id: rule._id },
    { 
      $inc: { 触发次数: 1 },
      $set: { 最后触发时间: ts.localTime }
    }
  );
}

export default router;
