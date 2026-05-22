/**
 * 经验管理 API 路由
 * 提供经验列表查询、经验详情获取、经验删除、经验搜索、统计、手动提取等功能
 *
 * API 端点：
 * - GET    /api/experience/list           获取用户经验列表（分页+标记过滤）
 * - GET    /api/experience/search         语义搜索经验
 * - GET    /api/experience/stats          获取经验统计概览
 * - GET    /api/experience/:id            获取经验详情
 * - DELETE /api/experience/:id            删除经验
 * - POST   /api/experience/extract        手动触发经验提取
 * - POST   /api/experience/forget         手动触发经验遗忘清理
 */

import { Router } from 'express';
import { logger } from '../core.js';
import { getUserDb } from '../db.js';
import { 经验检索配置 } from '@dove/common/常量.js';
import { toLocalISOString, getTimestamp } from '@dove/common/时间工具.js';

const router = Router();

/**
 * GET /api/experience/list
 * 获取用户经验列表
 *
 * 查询参数：
 * - page: 页码（默认1）
 * - limit: 每页数量（默认20，最大100）
 * - 标记: 按标记过滤（成功/失败）
 */
router.get('/list', async (req, res) => {
  try {
    const userId = req.user.userId;
    const db = getUserDb();

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    // 构建查询条件
    const 查询条件 = { 用户ID: userId };
    if (req.query.标记) {
      查询条件.标记 = req.query.标记;
    }

    // 查询列表（按创建时间倒序）
    let 列表 = [];
    try {
      列表 = await db.collection('经验')
        .find(查询条件)
        .sort({ 创建时间戳: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
    } catch (e) {
      // 集合可能不存在，返回空列表
    }

    // 查询总数
    let 总数 = 0;
    try {
      总数 = await db.collection('经验').countDocuments(查询条件);
    } catch (e) {
      // 集合可能不存在
    }

    res.json({
      success: true,
      data: {
        列表,
        总数,
        页码: page,
        每页数量: limit
      }
    });
  } catch (err) {
    logger.error('[经验API] 获取经验列表失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/experience/search
 * 语义搜索经验
 *
 * 查询参数：
 * - q: 搜索查询文本（必填）
 * - 能力需求: 逗号分隔的能力标签
 * - 包含失败: 是否包含失败经验（默认true）
 * - limit: 返回数量（默认5，最大20）
 */
router.get('/search', async (req, res) => {
  try {
    const userId = req.user.userId;
    const db = getUserDb();
    const 查询文本 = req.query.q || '';

    if (!查询文本) {
      return res.status(400).json({ success: false, error: '缺少搜索查询文本 q' });
    }

    const 能力需求 = req.query.能力需求 ? req.query.能力需求.split(',').filter(Boolean) : [];
    const 包含失败 = req.query.包含失败 !== 'false';
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 5));

    // 构建查询条件：文本搜索
    const filter = { 用户ID: userId };
    if (!包含失败) {
      filter.标记 = '成功';
    }
    if (能力需求.length > 0) {
      filter.能力需求 = { $in: 能力需求 };
    }

    let 结果 = [];
    try {
      // 尝试 MongoDB 文本搜索
      结果 = await db.collection('经验').find(
        { $text: { $search: 查询文本 }, ...filter },
        { score: { $meta: 'textScore' } }
      )
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit)
        .toArray();
    } catch {
      // 没有文本索引时，降级为正则搜索
      const 关键词 = 查询文本.substring(0, 50).split(/\s+/).filter(w => w.length > 1);
      if (关键词.length > 0) {
        const regex = 关键词.map(w => `(?=.*${w})`).join('');
        filter.任务描述摘要 = { $regex: regex, $options: 'i' };
        结果 = await db.collection('经验').find(filter)
          .sort({ 可信度: -1, 更新时间: -1 })
          .limit(limit)
          .toArray();
      }
    }

    // 应用时效衰减排序
    const now = Date.now();
    结果.sort((a, b) => {
      const 时效A = a.创建时间 ? (now - new Date(a.创建时间).getTime()) / (1000 * 60 * 60 * 24) > 经验检索配置.衰减天数 ? 经验检索配置.衰减系数 : 1.0 : 1.0;
      const 时效B = b.创建时间 ? (now - new Date(b.创建时间).getTime()) / (1000 * 60 * 60 * 24) > 经验检索配置.衰减天数 ? 经验检索配置.衰减系数 : 1.0 : 1.0;
      const 得分A = (a.相似度 || a.score || 0) * (a.成功率 || 0.5) * 时效A * ((a.可信度 || 50) / 100);
      const 得分B = (b.相似度 || b.score || 0) * (b.成功率 || 0.5) * 时效B * ((b.可信度 || 50) / 100);
      return 得分B - 得分A;
    });

    res.json({
      success: true,
      data: 结果.slice(0, limit)
    });
  } catch (err) {
    logger.error('[经验API] 搜索经验失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/experience/stats
 * 获取经验统计概览
 */
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user.userId;
    const db = getUserDb();

    const [总数, 成功数, 失败数, 可信度统计] = await Promise.all([
      db.collection('经验').countDocuments({ 用户ID: userId }).catch(() => 0),
      db.collection('经验').countDocuments({ 用户ID: userId, 标记: '成功' }).catch(() => 0),
      db.collection('经验').countDocuments({ 用户ID: userId, 标记: '失败' }).catch(() => 0),
      db.collection('经验').aggregate([
        { $match: { 用户ID: userId } },
        { $group: { _id: null, 平均可信度: { $avg: '$可信度' }, 最高可信度: { $max: '$可信度' }, 平均成功率: { $avg: '$成功率' } } }
      ]).toArray().catch(() => [])
    ]);

    const 统计 = 可信度统计[0] || {};

    res.json({
      success: true,
      data: {
        总数,
        成功数,
        失败数,
        平均可信度: Math.round(统计.平均可信度 || 0),
        最高可信度: 统计.最高可信度 || 0,
        平均成功率: Math.round((统计.平均成功率 || 0) * 100) / 100
      }
    });
  } catch (err) {
    logger.error('[经验API] 获取经验统计失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/experience/extract
 * 手动触发经验提取
 *
 * 请求体：
 * - rootTaskId: 根任务ID（必填）
 * - 任务描述: 任务描述
 * - 能力需求: 能力标签数组
 * - 成功: 是否成功
 */
router.post('/extract', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { rootTaskId, 任务描述, 能力需求, 成功 } = req.body;

    if (!rootTaskId) {
      return res.status(400).json({ success: false, error: '缺少 rootTaskId' });
    }

    // 这里需要从服务器端的经验管理器调用
    // 由于经验管理器在鸽子进程中，这里通过直接操作MongoDB实现简化版
    const db = getUserDb();

    // 查找执行轨迹
    const 轨迹文档 = await db.collection('执行轨迹').findOne({ 根任务ID: rootTaskId });
    if (!轨迹文档?.轨迹节点?.length) {
      return res.json({ success: true, data: null, message: '未找到执行轨迹，无法提取经验' });
    }

    // 简化提取：直接从轨迹提取关键节点
    const 关键节点类型 = ['planning', 'subtask', 'tool_call', 'skill_trigger'];
    const 关键节点 = 轨迹文档.轨迹节点.filter(n => 关键节点类型.includes(n.类型));

    if (!关键节点.length) {
      return res.json({ success: true, data: null, message: '轨迹中无关键节点' });
    }

    const 执行路径 = 关键节点.map(n => ({
      技能: n.名称 || n.类型,
      参数模式: n.输入 ? JSON.stringify(n.输入).substring(0, 100) : '',
      结果摘要: n.输出 ? JSON.stringify(n.输出).substring(0, 100) : (n.状态 || '')
    }));

    const 是失败 = 成功 === false;
    const 失败节点 = 是失败 ? 关键节点.find(n => n.状态 === '失败' || n.错误) : null;

    const 经验文档 = {
      经验ID: new (await import('mongodb')).ObjectId().toString(),
      任务描述摘要: 任务描述 || '手动提取',
      能力需求: 能力需求 || [],
      执行路径,
      总耗时: 关键节点.reduce((sum, n) => sum + (n.耗时 || 0), 0),
      成功率: 是失败 ? 0.0 : 1.0,
      执行次数: 1,
      用户ID: userId,
      创建时间: toLocalISOString(),
      创建时间戳: getTimestamp(),
      更新时间: toLocalISOString(),
      更新时间戳: getTimestamp(),
      标记: 是失败 ? '失败' : '成功',
      失败原因: 失败节点?.错误 || null,
      失败步骤: 失败节点 ? 关键节点.indexOf(失败节点) : null,
      可信度: 是失败 ? 40 : 60,
      合并来源数: 1,
      版本: 1
    };

    await db.collection('经验').insertOne(经验文档);

    res.json({
      success: true,
      data: 经验文档
    });
  } catch (err) {
    logger.error('[经验API] 手动提取经验失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/experience/forget
 * 手动触发经验遗忘清理
 *
 * 请求体（可选）：
 * - 阈值: 可信度阈值
 * - 最大年龄天: 过期天数
 */
router.post('/forget', async (req, res) => {
  try {
    const userId = req.user.userId;
    const db = getUserDb();

    const 阈值 = req.body?.阈值 ?? 30;
    const 最大年龄天 = req.body?.最大年龄天 ?? 90;
    const 截止时间 = new Date(Date.now() - 最大年龄天 * 24 * 60 * 60 * 1000);

    // 查找需要遗忘的经验
    const 遗忘条件 = {
      用户ID: userId,
      $or: [
        { 可信度: { $lt: 阈值 } },
        { 创建时间: { $lt: 截止时间.toISOString() }, 成功率: { $lt: 0.3 } }
      ]
    };

    const 待遗忘 = await db.collection('经验').find(遗忘条件)
      .project({ 经验ID: 1 })
      .limit(50)
      .toArray();

    let 遗忘数 = 0;
    for (const 经验 of 待遗忘) {
      try {
        await db.collection('经验').deleteOne({ 经验ID: 经验.经验ID });
        遗忘数++;
      } catch (e) { logger.warn(`删除经验失败(${经验.经验ID}): ${e.message}`); }
    }

    res.json({
      success: true,
      data: { 遗忘数, 清理条件: { 阈值, 最大年龄天 } }
    });
  } catch (err) {
    logger.error('[经验API] 遗忘清理失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/experience/:id
 * 获取经验详情
 */
router.get('/:id', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const db = getUserDb();

    const 经验 = await db.collection('经验').findOne({ 经验ID: id, 用户ID: userId });

    if (!经验) {
      return res.status(404).json({ success: false, error: '经验不存在' });
    }

    res.json({
      success: true,
      data: 经验
    });
  } catch (err) {
    logger.error('[经验API] 获取经验详情失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/experience/:id
 * 删除经验
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const db = getUserDb();

    const result = await db.collection('经验').deleteOne({ 经验ID: id, 用户ID: userId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: '经验不存在' });
    }

    res.json({
      success: true,
      message: '经验已删除'
    });
  } catch (err) {
    logger.error('[经验API] 删除经验失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
