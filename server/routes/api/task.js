/**
 * 任务 CRUD + 操作 子路由
 * 职责：创建/查询/取消/回答任务
 */

import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { logger } from '../../core.js';
import { 
  getMongoClient, getUserDb, getAdminDb,
  updateUserQuota, createTimestampFields
} from '../../db.js';
import { mapTaskFields } from './helpers.js';

const router = Router();

/**
 * 创建任务
 * 支持普通任务、技能任务和执行参数
 * 
 * 基础参数：
 * - description: 任务描述
 * - conversationId: 对话ID
 * - type: 任务类型
 * - params: 技能参数
 * 
 * 任务执行参数：
 * - 优先级策略: speed/reputation/cost/random
 * - 超时时间: 执行超时（毫秒，默认300000）
 * - 饲料奖励: 任务奖励饲料（默认1）
 * - 信誉要求: 最低信誉要求（默认0）
 */
router.post('/task', async (req, res) => {
  const { 
    description, 
    conversationId, 
    parentId, 
    type, 
    params,
    // 任务执行参数
    优先级策略 = 'speed',
    超时时间 = 300000,
    饲料奖励 = 1,
    信誉要求 = 0,
    // 机器亲和调度
    machineId,
    机器亲和 = false
  } = req.body;
  const userId = req.user.userId;
  const userRole = req.user.role || 'user';
  
  // 技能任务可以没有 description，但必须有 type
  if (!description && !type) {
    return res.status(400).json({ success: false, error: '任务描述或类型必填' });
  }
  
  // 参数验证
  if (!['speed', 'reputation', 'cost', 'random'].includes(优先级策略)) {
    return res.status(400).json({ success: false, error: '优先级策略必须是 speed/reputation/cost/random' });
  }
  
  try {
    await getMongoClient();
    const db = getUserDb();
    const adminDb = getAdminDb();
    
    // 获取用户的 拥有技能 数据
    let 拥有技能 = [];
    const 用户数据 = await adminDb.collection('用户').findOne({ 用户ID: userId }, { projection: { 拥有技能: 1 } });
    if (用户数据 && 用户数据.拥有技能) {
      拥有技能 = 用户数据.拥有技能;
    }
    
    const ts = createTimestampFields();
    const task = {
      任务ID: new ObjectId().toString(),
      描述: description || (type ? `执行技能: ${type}` : ''),
      状态: '等待中',
      阶段: '等待中',
      类型: type || 'chat',
      对话ID: conversationId || null,
      根任务ID: parentId || null,
      父任务ID: parentId || null,
      子任务列表: [],
      子任务状态: { 总数: 0, 已完成: 0, 已失败: 0 },
      执行者: null,
      执行提供商: null,
      心跳时间: null,
      流缓冲: [],
      结果: null,
      错误: null,
      用户ID: userId,
      用户角色: userRole,
      拥有技能,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp,
      更新时间: ts.localTime,
      更新时间戳: ts.timestamp,
      
      // 任务执行字段
      优先级策略,
      超时时间,
      饲料奖励,
      信誉要求,
      
      // 机器亲和调度字段
      machineId: machineId || req.headers['x-machine-id'] || null,
      机器亲和: 机器亲和 || false,
      
      // 来源渠道（用于渠道权限约束）
      来源: req.headers['x-channel'] || req.body.channel || 'remote'  // CLI 请求时通过 header 或 body 指定，默认 remote
    };
    
    // 如果是技能任务，添加参数
    if (type && type.startsWith('skill_')) {
      task.参数 = params || {};
    }
    
    // 写入全局任务队列（供鸽子抢取）
    await db.collection('任务').insertOne(task);
    
    // 更新配额
    await updateUserQuota(userId, '任务', 1);
    
    logger.info(`任务创建: ${task.任务ID} - ${description || type}`);
    
    res.json({ success: true, data: mapTaskFields(task) });
  } catch (e) {
    logger.error('创建任务失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 获取任务
 */
router.get('/task/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const userId = req.user.userId;
  
  try {
    await getMongoClient();
    const db = getUserDb();
    
    const task = await db.collection('任务').findOne({ 任务ID: taskId, 用户ID: userId });
    if (!task) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }

    res.json({ success: true, data: mapTaskFields(task) });
  } catch (e) {
    logger.error('获取任务失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 获取任务子任务列表
 * 用于 CLI 进度 TUI 展示任务树
 */
router.get('/task/:taskId/children', async (req, res) => {
  const { taskId } = req.params;
  const userId = req.user.userId;
  
  try {
    await getMongoClient();
    const db = getUserDb();
    const tasksColl = db.collection('任务');
    
    // 先验证父任务存在且有权限
    const parentTask = await tasksColl.findOne({ 任务ID: taskId });
    if (!parentTask) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }
    
    // 权限检查：父任务的 用户ID 或根任务的 用户ID
    let hasAccess = parentTask.用户ID === userId;
    if (!hasAccess && parentTask.根任务ID) {
      const rootTask = await tasksColl.findOne({ 任务ID: parentTask.根任务ID });
      if (rootTask && rootTask.用户ID === userId) hasAccess = true;
    }
    if (!hasAccess) {
      return res.status(403).json({ success: false, error: '无权访问此任务' });
    }
    
    // 查询子任务（父任务ID 匹配）
    const subtasks = await tasksColl.find({ 父任务ID: taskId })
      .sort({ 创建时间戳: 1 })
      .toArray();
    
    // 映射关键字段
    const children = subtasks.map(sub => ({
      id: sub.任务ID || sub.id,
      description: sub.描述 || sub.description || '',
      status: sub.状态 || sub.status || '等待中',
      progress: sub.进度 || sub.progress || 0,
      assignedTo: sub.执行者 || sub.assignedTo || null,
      model: sub.模型 || sub.model || null,
      provider: sub.提供商 || sub.provider || null,
      toolLevel: sub.工具权限 || sub.toolLevel || '安全',
      phase: sub.阶段 || sub.phase || null,
      duration: sub.耗时 || sub.duration || null,
      startedAt: sub.开始时间 || sub.startedAt || null,
      completedAt: sub.完成时间 || sub.completedAt || null,
      createdAt: sub.创建时间 || sub.createdAt || null,
    }));
    
    res.json({ success: true, data: children });
  } catch (e) {
    logger.error('获取子任务失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 任务列表
 */
router.get('/task/list', async (req, res) => {
  const userId = req.user.userId;
  const { status, limit = 20 } = req.query;
  
  try {
    await getMongoClient();
    const db = getUserDb();
    
    const query = { 用户ID: userId };
    if (status) query.状态 = status;

    const tasks = await db.collection('任务').find(query)
      .sort({ 创建时间戳: -1 })
      .limit(parseInt(limit))
      .toArray();

    // 对所有任务应用字段映射
    const mappedTasks = tasks.map(t => mapTaskFields(t));
    res.json({ success: true, data: mappedTasks });
  } catch (e) {
    logger.error('获取任务列表失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 取消任务
 */
router.post('/task/:taskId/cancel', async (req, res) => {
  const { taskId } = req.params;
  const userId = req.user.userId;
  
  try {
    await getMongoClient();
    const db = getUserDb();
    
    const result = await db.collection('任务').updateOne(
      { 任务ID: taskId, 用户ID: userId, 状态: { $in: ['等待中', '已就绪', '执行中'] } },
      { $set: { 状态: '已取消' } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(400).json({ success: false, error: '任务不存在或无法取消' });
    }
    
    res.json({ success: true, data: { taskId, status: '已取消' } });
  } catch (e) {
    logger.error('取消任务失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 提交用户答案（用于 interaction_ask 工具）
 */
router.post('/task/:taskId/answer', async (req, res) => {
  const { taskId } = req.params;
  const { questionId, answer } = req.body;
  const userId = req.user.userId;
  
  if (!questionId || answer === undefined) {
    return res.status(400).json({ success: false, error: 'questionId 和 answer 必填' });
  }
  
  try {
    await getMongoClient();
    const db = getUserDb();
    const tasksColl = db.collection('任务');
    
    // 将答案写入指定任务的 流缓冲
    const ts = createTimestampFields();
    const 答案条目 = {
      类型: 'user_answer',
      questionId,
      answer,
      时间: ts.localTime,
      时间戳: ts.timestamp
    };
    const result = await tasksColl.updateOne(
      { 任务ID: taskId, 用户ID: userId },
      { $push: { 流缓冲: 答案条目 } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }
    
    // 如果提交目标是 Branch 任务，查找来源子任务并同步写入答案
    // Branch 流缓冲中的 user_question 携带 来源子任务ID，答案需同步到子任务
    const branchTask = await tasksColl.findOne({ 任务ID: taskId, 用户ID: userId });
    if (branchTask?.流缓冲) {
      const 问题项 = branchTask.流缓冲.find(
        item => item.类型 === 'user_question' && item.问题数据?.id === questionId
      );
      if (问题项?.来源子任务ID) {
        await tasksColl.updateOne(
          { 任务ID: 问题项.来源子任务ID },
          { $push: { 流缓冲: 答案条目 } }
        );
        logger.info(`答案已同步到子任务 ${问题项.来源子任务ID}`);
      }
    }
    
    logger.info(`用户答案已提交: 任务 ${taskId}, 问题 ${questionId}`);
    res.json({ success: true, data: { taskId, questionId, submitted: true } });
  } catch (e) {
    logger.error('提交答案失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
