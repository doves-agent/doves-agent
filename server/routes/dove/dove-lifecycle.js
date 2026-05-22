/**
 * 鸽子生命周期管理 子路由
 * 职责：注册/查询/注销/身份管理/下线/离线消息暂存
 */

import { Router } from 'express';
import { logger } from '../../core.js';
import { 
  getMongoClient, getAdminDb, getUserDb,
  createTimestampFields
} from '../../db.js';
import 注册服务 from '../../白鸽注册服务.js';
const { 注册白鸽账号, 获取白鸽信息, 列出饲养员鸽子, 注销白鸽账号, 重新生成API密钥, DEFAULT_CONFIG } = 注册服务;
import { 记录审计 } from '../../审计日志.js';
import { default as authMiddleware } from '../dove-auth.js';

const router = Router();

// ==================== 离线消息暂存常量 ====================

/** 暂存消息过期时间（毫秒） */
const MESSAGE_BUFFER_TTL = 24 * 60 * 60 * 1000; // 24 小时

/** 单鸽子最大暂存消息数 */
const MAX_BUFFERED_MESSAGES = 100;

// ==================== 白鸽注册 API ====================

/**
 * POST /api/dove/register
 * 注册新的白鸽账号
 */
router.post('/register', authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  const { 名称, 类型, 能力列表, 配置, directEndpoint, machineId } = req.body;
  
  if (!名称) {
    return res.status(400).json({ 
      success: false, 
      error: '鸽子名称必填' 
    });
  }
  
  try {
    const 结果 = await 注册白鸽账号({
      名称,
      类型: 类型 || 'private',
      饲养员ID: userId,
      能力列表: 能力列表 || [],
      配置,
      machineId
    });
    
    // 如果提供了直连端点信息，额外更新
    if (directEndpoint && 结果.成功) {
      try {
        const adminDb = getAdminDb();
        await adminDb.collection('鸽子身份').updateOne(
          { 鸽子ID: 结果.鸽子.doveId },
          { $set: { directEndpoint } }
        );
        结果.鸽子.directEndpoint = directEndpoint;
      } catch (epErr) {
        logger.warn(`注册时更新直连端点失败: ${epErr.message}`);
      }
    }
    
    if (结果.成功) {
      logger.info(`用户 ${userId} 注册白鸽账号: ${结果.鸽子.doveId}`);
      res.status(201).json({
        success: true,
        data: 结果.鸽子
      });
    } else {
      res.status(400).json({
        success: false,
        error: 结果.错误
      });
    }
  } catch (e) {
    logger.error('注册白鸽账号失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/dove/my-doves
 * 列出当前用户的所有鸽子
 */
router.get('/my-doves', authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  
  try {
    const 结果 = await 列出饲养员鸽子(userId);
    
    if (结果.成功) {
      res.json({
        success: true,
        data: 结果.鸽子列表
      });
    } else {
      res.status(500).json({
        success: false,
        error: 结果.错误
      });
    }
  } catch (e) {
    logger.error('列出鸽子失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/dove/info/:doveId
 * 获取鸽子详细信息
 */
router.get('/info/:doveId', authMiddleware, async (req, res) => {
  const { doveId } = req.params;
  const userId = req.user.userId;
  
  try {
    const 结果 = await 获取白鸽信息(doveId);
    
    if (!结果.成功) {
      return res.status(404).json({
        success: false,
        error: 结果.错误
      });
    }
    
    // 验证权限：只有饲养员可以查看
    if (结果.鸽子.饲养员ID !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: '无权查看此鸽子信息'
      });
    }
    
    res.json({
      success: true,
      data: 结果.鸽子
    });
  } catch (e) {
    logger.error('获取鸽子信息失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * DELETE /api/dove/:doveId
 * 注销鸽子账号
 */
router.delete('/:doveId', authMiddleware, async (req, res) => {
  const { doveId } = req.params;
  const userId = req.user.userId;
  
  try {
    const 结果 = await 注销白鸽账号(doveId, userId);
    
    if (结果.成功) {
      logger.info(`用户 ${userId} 注销鸽子账号: ${doveId}`);
      res.json({
        success: true,
        message: '鸽子账号已注销'
      });
    } else {
      res.status(400).json({
        success: false,
        error: 结果.错误
      });
    }
  } catch (e) {
    logger.error('注销鸽子失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/dove/:doveId/regenerate-key
 * 重新生成 API 密钥
 */
router.post('/:doveId/regenerate-key', authMiddleware, async (req, res) => {
  const { doveId } = req.params;
  const userId = req.user.userId;
  
  try {
    const 结果 = await 重新生成API密钥(doveId, userId);
    
    if (结果.成功) {
      logger.info(`用户 ${userId} 重新生成鸽子 API 密钥: ${doveId}`);
      res.json({
        success: true,
        data: {
          doveId,
          apiKey: 结果.apiKey,
          message: '新API密钥已生成，旧密钥已失效'
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: 结果.错误
      });
    }
  } catch (e) {
    logger.error('重新生成API密钥失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 获取鸽子身份
 */
router.get('/identity/:doveId', async (req, res) => {
  const { doveId } = req.params;
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    
    const dove = await adminDb.collection('鸽子身份').findOne(
      { 鸽子ID: doveId },
      { projection: { _id: 0, 鸽子ID: 1, 名称: 1, 状态: 1, 类型: 1, 配置: 1, doveType: 1 } }
    );
    
    if (!dove) {
      return res.status(404).json({ success: false, error: '鸽子不存在' });
    }
    
    res.json({
      success: true,
      data: dove
    });
  } catch (e) {
    logger.error('获取鸽子身份失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 更新鸽子身份信息
 * PUT /api/dove/identity/:doveId
 */
router.put('/identity/:doveId', async (req, res) => {
  const { doveId } = req.params;
  const name = req.body.名称;
  const type = req.body.类型;
  const capabilities = req.body.能力列表;
  const status = req.body.状态;
  const 实例标识 = req.body.实例标识;
  const 当前任务ID = req.body.当前任务ID;
  const 最后见到时间 = req.body.最后见到时间;
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    const ts = createTimestampFields();
    
    const updateFields = {
      最后心跳时间: ts.localTime,
      最后心跳时间戳: ts.timestamp
    };
    
    if (name !== undefined) updateFields.名称 = name;
    if (type !== undefined) updateFields.类型 = type;
    if (capabilities !== undefined) updateFields.能力列表 = capabilities;
    if (status !== undefined) updateFields.状态 = status;
    if (实例标识 !== undefined) updateFields.实例标识 = 实例标识;
    if (当前任务ID !== undefined) updateFields.当前任务ID = 当前任务ID;
    if (最后见到时间 !== undefined) updateFields.最后见到时间 = 最后见到时间;
    if (req.body.directEndpoint !== undefined) updateFields.directEndpoint = req.body.directEndpoint;
    if (req.body.encryptedEndpoint !== undefined) updateFields.encryptedEndpoint = req.body.encryptedEndpoint;
    
    if (Object.keys(updateFields).length <= 2) {
      return res.status(400).json({ success: false, error: '无有效更新字段' });
    }
    
    const result = await adminDb.collection('鸽子身份').updateOne(
      { 鸽子ID: doveId },
      { $set: updateFields },
      { upsert: true }
    );
    
    const isNew = result.upsertedCount > 0;
    
    if (isNew) {
      记录审计({
        操作者ID: doveId,
        操作者类型: 'dove',
        操作: 'dove_identity_created',
        目标ID: doveId,
        结果: 'success',
        详情: { name, type }
      });
    }
    
    if (isNew && !name) {
      return res.json({
        success: true,
        data: {
          doveId,
          upserted: true,
          isNew: true,
          warning: '新鸽子已注册，但未提供名称'
        }
      });
    }
    
    res.json({
      success: true, 
      data: { 
        doveId, 
        upserted: isNew,
        modified: result.modifiedCount > 0,
        isNew,
        初始饲料: isNew ? 10 : undefined
      } 
    });
  } catch (e) {
    logger.error('更新鸽子身份失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 鸽子下线 API
 */
router.post('/offline', async (req, res) => {
  const doveId = req.user.doveId || req.user.userId;
  const { 原因 = 'shutdown', 预计恢复时间 } = req.body;
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    const userDb = getUserDb();
    const ts = createTimestampFields();
    
    const updateFields = {
      状态: '离线',
      下线时间: ts.localTime,
      下线原因: 原因,
      最后心跳时间: ts.localTime,
      最后心跳时间戳: ts.timestamp
    };
    
    if (预计恢复时间) {
      updateFields.预计恢复时间 = 预计恢复时间;
    }
    
    await adminDb.collection('鸽子身份').updateOne(
      { 鸽子ID: doveId },
      { $set: updateFields }
    );
    
    // 如果有执行中的任务，标记为中断状态
    const executingTasks = await userDb.collection('任务').find({
      执行者: doveId,
      状态: { $in: ['执行中', '等待子任务'] }
    }).toArray();
    
    if (executingTasks.length > 0) {
      const taskIds = executingTasks.map(t => t._id.toString());
      await userDb.collection('任务').updateMany(
        { _id: { $in: executingTasks.map(t => t._id) } },
        { $set: { 状态: 'interrupted', 中断时间: ts.localTime, 中断原因: `鸽子下线: ${原因}` } }
      );
      
      记录审计({
        操作者ID: doveId,
        操作者类型: 'dove',
        操作: 'dove_offline_interrupt_tasks',
        目标ID: doveId,
        结果: 'success',
        详情: { 原因, 中断任务数: taskIds.length, 任务ID列表: taskIds }
      });
    }
    
    记录审计({
      操作者ID: doveId,
      操作者类型: 'dove',
      操作: 'dove_offline',
      目标ID: doveId,
      结果: 'success',
      详情: { 原因, 预计恢复时间, 中断任务数: executingTasks.length }
    });
    
    res.json({
      success: true,
      data: {
        状态: '离线',
        下线时间: ts.localTime,
        中断任务数: executingTasks.length
      }
    });
  } catch (e) {
    logger.error('下线处理失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 离线消息暂存 API ====================

/**
 * POST /api/dove/message-buffer
 * CLI 在鸽子离线时将消息暂存到 Server
 * 鸽子上线后通过 GET 拉取
 * 
 * 安全：
 * - 需要 JWT 认证（CLI 用户身份）
 * - 消息只能暂存到自己账号的鸽子
 * - Server 只存不读，不解密消息内容
 */
router.post('/message-buffer', authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  const { doveId, message, conversationId, profile, constraints } = req.body;
  
  if (!doveId) {
    return res.status(400).json({ success: false, error: '鸽子ID必填' });
  }
  if (!message) {
    return res.status(400).json({ success: false, error: '消息内容必填' });
  }
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    
    // 安全检查：只能暂存到自己账号的鸽子
    const 鸽子 = await adminDb.collection('鸽子身份').findOne({ 鸽子ID: doveId });
    if (!鸽子) {
      return res.status(404).json({ success: false, error: '鸽子不存在' });
    }
    if (鸽子.饲养员ID !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: '无权向此鸽子暂存消息' });
    }
    
    // 检查暂存消息数量上限
    const ts = createTimestampFields();
    const bufferCount = await adminDb.collection('离线消息暂存').countDocuments({
      鸽子ID: doveId,
      过期时间: { $gt: ts.timestamp }
    });
    
    if (bufferCount >= MAX_BUFFERED_MESSAGES) {
      return res.status(429).json({ 
        success: false, 
        error: `暂存消息已达上限(${MAX_BUFFERED_MESSAGES})`,
        当前数量: bufferCount
      });
    }
    
    // 存入暂存队列
    await adminDb.collection('离线消息暂存').insertOne({
      鸽子ID: doveId,
      用户ID: userId,
      message,
      conversationId: conversationId || null,
      profile: profile || null,
      constraints: constraints || null,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp,
      过期时间: ts.timestamp + MESSAGE_BUFFER_TTL
    });
    
    // 创建过期索引（幂等操作）
    try {
      await adminDb.collection('离线消息暂存').createIndex(
        { 过期时间: 1 },
        { expireAfterSeconds: 0, name: 'ttl_expiry' }
      );
    } catch (e) {
      logger.warn('创建TTL索引失败:', e.message);
    }
    
    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'dove_message_buffer',
      目标ID: doveId,
      结果: 'success',
      详情: { conversationId }
    });
    
    res.json({ success: true, data: { 已暂存: true, 鸽子ID: doveId } });
  } catch (e) {
    logger.error('暂存消息失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/dove/message-buffer
 * 鸽子上线后拉取暂存消息
 * 
 * 安全：
 * - 需要 API Key 认证（鸽子身份）
 * - 只能拉取自己的暂存消息
 * - 拉取后自动删除（单消费者模式）
 */
router.get('/message-buffer', authMiddleware, async (req, res) => {
  const doveId = req.user.doveId || req.user.userId;
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    const ts = createTimestampFields();
    
    // 原子操作：查找并删除（保证单消费者）
    const messages = await adminDb.collection('离线消息暂存').find({
      鸽子ID: doveId,
      过期时间: { $gt: ts.timestamp }
    }).sort({ 创建时间戳: 1 }).toArray();
    
    if (messages.length > 0) {
      // 批量删除已拉取的消息
      const ids = messages.map(m => m._id);
      await adminDb.collection('离线消息暂存').deleteMany({ _id: { $in: ids } });
      
      记录审计({
        操作者ID: doveId,
        操作者类型: 'dove',
        操作: 'dove_message_buffer_fetch',
        目标ID: doveId,
        结果: 'success',
        详情: { 消息数: messages.length }
      });
    }
    
    res.json({ 
      success: true, 
      data: messages.map(m => ({
        message: m.message,
        conversationId: m.conversationId,
        profile: m.profile,
        constraints: m.constraints,
        userId: m.用户ID,
        创建时间: m.创建时间
      }))
    });
  } catch (e) {
    logger.error('拉取暂存消息失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/dove/direct-audit
 * 鸽子直连服务的审计日志转发
 * 鸽子通过 DovesProxy 将直连审计记录转发到 Server
 */
router.post('/direct-audit', authMiddleware, async (req, res) => {
  const record = req.body;
  
  try {
    记录审计({
      ...record,
      详情: { ...record.详情, 来源: 'direct_connection' }
    });
    res.json({ success: true });
  } catch (e) {
    logger.error('直连审计转发失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
