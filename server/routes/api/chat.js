/**
 * 对话 + 消息 子路由
 * 职责：发送消息（对话）、对话列表、获取对话
 */

import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { logger } from '../../core.js';
import { 
  getMongoClient, getUserDb,
  updateUserQuota, createTimestampFields
} from '../../db.js';
import { mapTaskFields } from './helpers.js';

const router = Router();

/**
 * 发送消息（对话）
 */
router.post('/chat', async (req, res) => {
  const { message, conversationId, profile, constraints, requestId, attachments } = req.body;
  const userId = req.user.userId;
  
  if (!message) {
    return res.status(400).json({ success: false, error: '消息内容必填' });
  }
  
  try {
    await getMongoClient();
    const db = getUserDb();
    
    // ==================== requestId 幂等检查 ====================
    // 多 Server 开发测试模式：CLI 扇出发送同一请求到多个 Server
    // 只有第一个 Server 会创建任务，其余 Server 返回已有任务
    // 使用 updateOne + upsert 保证原子性，消除 findOne+insertOne 的竞态条件
    
    // 解析执行配置
    let 执行配置 = null;
    if (profile || constraints) {
      try {
        const { 解析执行配置 } = await import('../../执行配置管理.js');
        执行配置 = 解析执行配置(profile || null, constraints || {});
      } catch (e) {
        logger.warn(`执行配置解析失败: ${e.message}`);
      }
    }
    
    let convId = conversationId;
    if (!convId) {
      const ts = createTimestampFields();
      convId = new ObjectId().toString();
      const conv = {
        _id: convId,
        对话ID: convId,
        标题: message.slice(0, 50),
        对话轮次: [],  // 修复: 使用 '对话轮次' 而非 '消息列表'，与智能体更新逻辑保持一致
        用户ID: userId,
        创建时间: ts.localTime,
        创建时间戳: ts.timestamp
      };
      await db.collection('对话').insertOne(conv);
      // 更新配额
      await updateUserQuota(userId, '对话', 1);
    } else {
      // conversationId 已提供：检查对话是否已存在（幂等）
      const existingConv = await db.collection('对话').findOne({ 对话ID: convId });
      if (!existingConv) {
        // 对话不存在，创建新对话
        const ts = createTimestampFields();
        const conv = {
          _id: convId,
          对话ID: convId,
          标题: message.slice(0, 50),
          对话轮次: [],
          用户ID: userId,
          创建时间: ts.localTime,
          创建时间戳: ts.timestamp
        };
        try {
          await db.collection('对话').insertOne(conv);
          await updateUserQuota(userId, '对话', 1);
        } catch (e) {
          // 并发插入冲突：另一个 Server 可能已先创建了该对话，忽略
          if (e.code !== 11000) throw e;
        }
      }
    }
    
    const ts = createTimestampFields();
    const task = {
      任务ID: new ObjectId().toString(),
      描述: message,
      类型: 'routing',  // FLASH路由预处理任务
      状态: '已就绪',  // routing 任务直接就绪，无需 Flash 填充能力
      阶段: '等待中',
      对话ID: convId,
      根任务ID: null,
      父任务ID: null,
      子任务列表: [],
      子任务状态: { 总数: 0, 已完成: 0, 已失败: 0 },
      执行者: null,
      执行提供商: null,
      心跳时间: null,
      流缓冲: [],
      结果: null,
      错误: null,
      用户ID: userId,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp,
      更新时间: ts.localTime,
      更新时间戳: ts.timestamp,

      // 任务执行字段（routing 任务也需要，否则 submit-result 无法正确更新状态）
      优先级策略: 'speed',
      超时时间: 300000,
      饲料奖励: 1,
      信誉要求: 0,

      // 来源渠道（用于渠道权限约束）
      来源: req.headers['x-channel'] || req.body.channel || 'remote',  // CLI 通过 header 或 body 指定，默认 remote

      // 附件（CLI 上传的文件 URL 列表，如图片 OSS URL）
      附件: Array.isArray(attachments) ? attachments : [],
    };
    
    // 写入 requestId（如果提供，用于幂等去重及原子 upsert 匹配）
    if (requestId) {
      task.requestId = requestId;
    }
    
    // 写入执行配置到任务
    if (执行配置) {
      task.执行配置 = 执行配置;
    }
    
    if (requestId) {
      // 原子操作：用 updateOne + $setOnInsert + upsert，即检查与插入一步完成
      // - 无匹配文档 → 创建新任务（upsertedCount === 1）
      // - 已有匹配文档 → 幂等返回（upsertedCount === 0），$setOnInsert 不修改已有数据
      const result = await db.collection('任务').updateOne(
        { requestId },
        { $setOnInsert: task },
        { upsert: true }
      );
      
      if (result.upsertedCount === 0) {
        // 已有相同 requestId 的任务 → 幂等返回
        const existingTask = await db.collection('任务').findOne({ requestId });
        return res.json({
          success: true,
          data: { taskId: existingTask.任务ID, conversationId: existingTask.对话ID },
          idempotent: true
        });
      }
    } else {
      // 无 requestId：普通插入
      await db.collection('任务').insertOne(task);
    }
    // 更新配额
    await updateUserQuota(userId, '任务', 1);
    
    res.json({ success: true, data: { taskId: task.任务ID, conversationId: convId } });
  } catch (e) {
    logger.error('发送消息失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 对话列表
 */
router.get('/conversations', async (req, res) => {
  const userId = req.user.userId;
  
  try {
    await getMongoClient();
    const db = getUserDb();
    
    const conversations = await db.collection('对话').find({ 用户ID: userId })
      .sort({ 创建时间戳: -1 })
      .limit(50)
      .toArray();

    res.json({ success: true, data: conversations });
  } catch (e) {
    logger.error('获取对话列表失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 获取对话
 */
router.get('/conversations/:conversationId', async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user.userId;
  
  try {
    await getMongoClient();
    const db = getUserDb();
    
    // _id 与 对话ID 统一，直接按 对话ID 查询即可
    const conv = await db.collection('对话').findOne({ 对话ID: conversationId, 用户ID: userId });
    if (!conv) {
      return res.status(404).json({ success: false, error: '对话不存在' });
    }
    
    res.json({ success: true, data: conv });
  } catch (e) {
    logger.error('获取对话失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
