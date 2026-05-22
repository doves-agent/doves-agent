/**
 * 任务轨迹查询路由
 * 
 * API 列表：
 * GET  /api/task/:id/trace/stats    获取任务执行统计
 * GET  /api/task/:id/trace/:traceId 获取单个轨迹节点详情
 * GET  /api/task/:id/trace          获取任务完整执行轨迹树
 */

import { Router } from 'express';
import { logger } from '../../core.js';
import { getUserDb } from '../../db.js';

const router = Router();

/**
 * GET /api/task/:id/trace/stats
 * 获取任务执行统计（Task 4.4）
 * 必须在 /:id/trace/:traceId 之前注册，否则 stats 会被当作 traceId
 */
router.get('/:id/trace/stats', async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;
  
  try {
    const db = getUserDb();
    
    const 轨迹文档 = await db.collection('执行轨迹').findOne({ 根任务ID: id });
    if (!轨迹文档) {
      return res.status(404).json({ success: false, error: '未找到该任务的执行轨迹' });
    }
    
    const 节点列表 = 轨迹文档.轨迹节点 || [];
    
    const 总步骤数 = 节点列表.length;
    const 成功数 = 节点列表.filter(n => n.状态 === '已完成').length;
    const 失败数 = 节点列表.filter(n => n.状态 === '失败').length;
    
    let 总耗时 = null;
    const 根节点 = 节点列表.find(n => !n.父轨迹ID);
    if (根节点 && 根节点.耗时) {
      总耗时 = 根节点.耗时;
    } else {
      const 开始时间列表 = 节点列表.filter(n => n.开始时间).map(n => new Date(n.开始时间).getTime()).filter(t => !isNaN(t));
      const 结束时间列表 = 节点列表.filter(n => n.结束时间).map(n => new Date(n.结束时间).getTime()).filter(t => !isNaN(t));
      if (开始时间列表.length > 0 && 结束时间列表.length > 0) {
        总耗时 = Math.max(...结束时间列表) - Math.min(...开始时间列表);
      }
    }
    
    const 类型分布 = {};
    for (const 节点 of 节点列表) {
      const 类型 = 节点.类型 || 'unknown';
      类型分布[类型] = (类型分布[类型] || 0) + 1;
    }
    
    const 工具调用频次 = 节点列表.filter(n => n.类型 === 'tool_call').length;
    const LLM调用次数 = 节点列表.filter(n => n.类型 === 'llm_call').length;
    
    let token总消耗 = 0;
    for (const 节点 of 节点列表) {
      if (节点.token消耗) {
        token总消耗 += (节点.token消耗.输入 || 0) + (节点.token消耗.输出 || 0);
      }
    }
    
    res.json({
      success: true,
      data: { 总步骤数, 成功数, 失败数, 总耗时, 类型分布, 工具调用频次, LLM调用次数, token总消耗 }
    });
  } catch (e) {
    logger.error('查询轨迹统计失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/task/:id/trace/:traceId
 * 获取单个轨迹节点详情（Task 4.2）
 */
router.get('/:id/trace/:traceId', async (req, res) => {
  const { id, traceId } = req.params;
  const userId = req.user.userId;
  
  try {
    const db = getUserDb();
    
    const 轨迹文档 = await db.collection('执行轨迹').findOne({ 根任务ID: id });
    if (!轨迹文档) {
      return res.status(404).json({ success: false, error: '未找到该任务的执行轨迹' });
    }
    
    const 节点 = (轨迹文档.轨迹节点 || []).find(n => n.轨迹ID === traceId);
    if (!节点) {
      return res.status(404).json({ success: false, error: '未找到该轨迹节点' });
    }
    
    res.json({ success: true, data: 节点 });
  } catch (e) {
    logger.error('查询轨迹节点详情失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/task/:id/trace
 * 获取任务完整执行轨迹树（Task 4.2）
 */
router.get('/:id/trace', async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;
  
  try {
    const db = getUserDb();
    
    const 轨迹文档 = await db.collection('执行轨迹').findOne({ 根任务ID: id });
    if (!轨迹文档) {
      return res.status(404).json({ success: false, error: '未找到该任务的执行轨迹' });
    }
    
    const 节点列表 = 轨迹文档.轨迹节点 || [];
    
    // 将扁平节点重建为树形结构
    const 节点映射 = new Map();
    for (const 节点 of 节点列表) {
      节点映射.set(节点.轨迹ID, { ...节点, children: [] });
    }
    
    const 轨迹树 = [];
    for (const 节点 of 节点映射.values()) {
      if (节点.父轨迹ID && 节点映射.has(节点.父轨迹ID)) {
        节点映射.get(节点.父轨迹ID).children.push(节点);
      } else {
        轨迹树.push(节点);
      }
    }
    
    res.json({
      success: true,
      data: {
        根任务ID: 轨迹文档.根任务ID,
        用户ID: 轨迹文档.用户ID,
        创建时间: 轨迹文档.创建时间,
        轨迹树
      }
    });
  } catch (e) {
    logger.error('查询执行轨迹失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
