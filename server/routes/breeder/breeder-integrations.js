/**
 * 外部集成 子路由
 * 职责：列出可用集成/注册/删除集成
 */

import { Router } from 'express';
import { logger } from '../../core.js';
import { 
  getMongoClient, getAdminDb, createTimestampFields
} from '../../db.js';
import { 记录审计 } from '../../审计日志.js';
import { toObjectId } from './breeder-helpers.js';

const router = Router();

/**
 * GET /api/breeder/integrations
 * 列出可用的外部集成类型
 */
router.get('/integrations', async (req, res) => {
  const 可用集成 = [
    {
      类型: 'webhook',
      名称: 'Webhook 通知',
      描述: '事件触发时向指定 URL 发送 HTTP 请求',
      配置字段: ['url', 'secret']
    },
    {
      类型: 'email',
      名称: '邮件通知',
      描述: '事件触发时发送邮件通知',
      配置字段: ['email']
    },
    {
      类型: 'dingtalk',
      名称: '钉钉机器人',
      描述: '事件触发时发送钉钉群消息',
      配置字段: ['webhook_url', 'secret']
    },
    {
      类型: 'wechat_work',
      名称: '企业微信机器人',
      描述: '事件触发时发送企业微信群消息',
      配置字段: ['webhook_url']
    },
    {
      类型: 'feishu',
      名称: '飞书机器人',
      描述: '事件触发时发送飞书群消息',
      配置字段: ['webhook_url', 'secret']
    }
  ];
  
  res.json({ success: true, data: 可用集成 });
});

/**
 * POST /api/breeder/integrations
 * 注册外部集成
 */
router.post('/integrations', async (req, res) => {
  const userId = req.user.userId;
  const { 类型, 名称, 配置, 订阅事件 } = req.body;
  
  if (!类型 || !名称 || !配置) {
    return res.status(400).json({ success: false, error: '类型、名称和配置不能为空' });
  }
  
  if (!Array.isArray(订阅事件) || 订阅事件.length === 0) {
    return res.status(400).json({ success: false, error: '必须指定订阅事件' });
  }
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    const ts = createTimestampFields();
    
    const integration = {
      用户ID: userId,
      类型,
      名称,
      配置,  // 加密存储应由上层处理
      订阅事件,
      状态: '活跃',
      失败次数: 0,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp,
      更新时间: ts.localTime
    };
    
    const result = await db.collection('饲养员集成').insertOne(integration);
    
    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'register_integration',
      目标ID: result.insertedId.toString(),
      结果: 'success',
      详情: { 类型, 名称 }
    });
    
    res.status(201).json({
      success: true,
      data: {
        integrationId: result.insertedId.toString(),
        类型,
        名称,
        状态: '活跃'
      }
    });
  } catch (e) {
    logger.error('注册集成失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * DELETE /api/breeder/integrations/:id
 * 删除集成
 */
router.delete('/integrations/:id', async (req, res) => {
  const userId = req.user.userId;
  const { id } = req.params;
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    
    const result = await db.collection('饲养员集成').deleteOne({ _id: toObjectId(id), 用户ID: userId });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: '集成不存在' });
    }
    
    res.json({ success: true, data: { deleted: true } });
  } catch (e) {
    logger.error('删除集成失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
