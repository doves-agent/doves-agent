/**
 * 任务流式监听 + 轨迹 子路由
 * 职责：SSE 实时推送 + 执行轨迹树
 */

import { Router } from 'express';
import { logger } from '../../core.js';
import { 
  getMongoClient, getUserDb
} from '../../db.js';
import { mapTaskFields } from './helpers.js';

const router = Router();

/**
 * 任务流式监听（SSE）
 */
router.get('/task/stream/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const userId = req.user.userId;
  
  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  
  try {
    await getMongoClient();
    const db = getUserDb();
    const tasksColl = db.collection('任务');
    
    // 先检查任务是否存在（使用中文字段名查询）
    const task = await tasksColl.findOne({ 任务ID: taskId });
    if (!task) {
      res.write(`data: ${JSON.stringify({ error: '任务不存在' })}\n\n`);
      return res.end();
    }
    // 检查用户ID是否匹配
    // 规则：任务的 用户ID 必须匹配请求用户；但对于 branch/subtask 类型，
    // 也允许通过根任务（routing任务）的用户ID来验证权限
    let hasAccess = task.用户ID === userId;
    if (!hasAccess && task.根任务ID) {
      // 查找根任务的用户ID
      const rootTask = await tasksColl.findOne({ 任务ID: task.根任务ID });
      if (rootTask && rootTask.用户ID === userId) {
        hasAccess = true;
      }
    }
    if (!hasAccess && task.父任务ID) {
      // 查找父任务的用户ID
      const parentTask = await tasksColl.findOne({ 任务ID: task.父任务ID });
      if (parentTask && parentTask.用户ID === userId) {
        hasAccess = true;
      }
    }
    if (!hasAccess) {
      res.write(`data: ${JSON.stringify({ error: '任务不存在' })}\n\n`);
      return res.end();
    }
    
    // 如果任务已完成，直接返回结果（带字段映射）
    const mappedTask = mapTaskFields(task);
    if (mappedTask.status === '已完成' || mappedTask.status === '已完成(部分失败)' || mappedTask.status === '失败') {
      res.write(`data: ${JSON.stringify({ task: mappedTask })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    
    // 监听任务变化（使用中文字段名）
    const changeStream = tasksColl.watch(
      [{ $match: { 'fullDocument.任务ID': taskId } }],
      { fullDocument: 'updateLookup' }
    );
    
    // 超时处理：可续期租约（超时不是死刑，有进展就续期）
    // 核心原则：Pipeline/Interleaved等复杂任务可能需要很长时间，
    // 只要任务还在进展（Change Stream有事件 = 有进展），就续期
    const SSE_LEASE_MS = 5 * 60 * 1000;  // 每个租约周期5分钟
    const SSE_MAX_RENEWALS = 20;          // 最多续期20次（5+100=105分钟总上限，防无限）
    let sseRenewalCount = 0;
    let sseSettled = false;
    
    const startSseLease = () => {
      sseTimer = setTimeout(() => {
        if (sseSettled) return;
        
        // 超时触发：检查任务是否还在进展
        // Change Stream 有事件 = 有进展（在 on('change') 中续期）
        // 如果租约到期但没收到change事件，查DB确认是否还活着
        checkTaskProgress().then(alive => {
          if (sseSettled) return;
          if (alive && sseRenewalCount < SSE_MAX_RENEWALS) {
            sseRenewalCount++;
            logger.info(`[SSE] 任务 ${taskId} 租约到期但有进展，续期 (${sseRenewalCount}/${SSE_MAX_RENEWALS})`);
            startSseLease();
          } else {
            // 确认无进展或达最大续期，真正超时
            sseSettled = true;
            changeStream.close();
            res.write(`data: ${JSON.stringify({ error: '监听超时（任务无进展）' })}\n\n`);
            res.end();
          }
        }).catch(() => {
          if (sseSettled) return;
          sseSettled = true;
          changeStream.close();
          res.write(`data: ${JSON.stringify({ error: '监听超时' })}\n\n`);
          res.end();
        });
      }, SSE_LEASE_MS);
    };
    
    // 查DB确认任务是否还在进展（心跳/子任务完成等）
    async function checkTaskProgress() {
      try {
        const freshTask = await tasksColl.findOne({ 任务ID: taskId });
        if (!freshTask) return false;
        const status = freshTask.状态;
        // 任务已终态（含 terminated：监控超时终止）
        if (status === '已完成' || status === '已完成(部分失败)' || status === '失败' || status === '已取消' || status === '已终止') return false;
        // 心跳2分钟内更新过 = 还活着
        const 心跳时间戳 = freshTask.心跳时间戳 || 0;
        if (心跳时间戳 > 0 && (Date.now() - 心跳时间戳) < 120000) return true;
        // Branch任务：检查子任务是否有进展
        if (freshTask.类型 === 'branch') {
          const recentSubCompleted = await tasksColl.findOne({
            父任务ID: taskId, 状态: { $in: ['已完成', '已完成(部分失败)'] },
            完成时间戳: { $gt: Date.now() - 300000 }  // 5分钟内有子任务完成
          });
          if (recentSubCompleted) return true;
          const runningSub = await tasksColl.findOne({ 父任务ID: taskId, 状态: '执行中' });
          if (runningSub) return true;
        }
        return false;
      } catch (e) { logger.warn(`任务进展检查失败(${taskId}): ${e.message}`); return false; }
    }
    
    let sseTimer = null;
    startSseLease();
    
    // 处理变化事件
    changeStream.on('change', (change) => {
      const updatedTask = change.fullDocument;
      const mappedUpdatedTask = mapTaskFields(updatedTask);
      res.write(`data: ${JSON.stringify({ task: mappedUpdatedTask })}\n\n`);
      
      // 任务终态时结束 SSE（含 terminated：监控超时终止）
      if (mappedUpdatedTask.status === '已完成' || mappedUpdatedTask.status === '已完成(部分失败)' || mappedUpdatedTask.status === '失败' || mappedUpdatedTask.status === '已取消' || mappedUpdatedTask.status === '已终止') {
        sseSettled = true;
        clearTimeout(sseTimer);
        changeStream.close();
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      
      // 非终态变化 = 有进展，续期
      if (!sseSettled) {
        sseRenewalCount = 0;  // 重置续期计数（真正有事件=真正有进展）
        clearTimeout(sseTimer);
        startSseLease();
      }
    });
    
    // 连接关闭时清理
    req.on('close', () => {
      sseSettled = true;
      clearTimeout(sseTimer);
      changeStream.close();
    });
    
  } catch (e) {
    logger.error('监听任务失败:', e.message);
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

/**
 * 获取任务执行轨迹树
 * GET /api/task/:taskId/trace
 */
router.get('/task/:taskId/trace', async (req, res) => {
  const { taskId } = req.params;
  const userId = req.user.userId;
  
  try {
    await getMongoClient();
    const db = getUserDb();
    
    // 1. 查找任务（支持根任务ID或任务ID）
    const task = await db.collection('任务').findOne({ 
      任务ID: taskId, 
      用户ID: userId 
    });
    
    if (!task) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }
    
    // 2. 确定根任务ID
    const 根任务ID = task.根任务ID || task.任务ID;
    
    // 3. 查询轨迹文档（一个根任务一条文档，轨迹节点内嵌数组）
    const traceDoc = await db.collection('执行轨迹').findOne({ 根任务ID });
    const traces = traceDoc?.轨迹节点 || [];
    
    // 4. 构建树结构（轨迹节点以扁平数组存储，通过 父轨迹ID 构建父子关系）
    const nodeMap = new Map();
    const rootNodes = [];
    
    for (const trace of traces) {
      const node = {
        轨迹ID: trace.轨迹ID,
        类型: trace.类型,
        名称: trace.名称,
        状态: trace.状态,
        序号: trace.序号,
        耗时: trace.耗时,
        输入: trace.输入,
        输出: trace.输出,
        错误: trace.错误,
        元数据: trace.元数据,
        开始时间: trace.开始时间,
        结束时间: trace.结束时间,
        子节点: []
      };
      nodeMap.set(trace.轨迹ID, node);
      
      if (!trace.父轨迹ID) {
        rootNodes.push(node);
      }
    }
    
    // 链接父子关系
    for (const trace of traces) {
      if (trace.父轨迹ID && nodeMap.has(trace.父轨迹ID)) {
        nodeMap.get(trace.父轨迹ID).子节点.push(nodeMap.get(trace.轨迹ID));
      }
    }
    
    // 5. 统计
    const stats = {
      总耗时: 0,
      工具调用数: 0,
      技能触发数: 0,
      子任务数: 0,
      子任务成功: 0,
      子任务失败: 0,
      事件触发数: 0
    };
    
    for (const trace of traces) {
      if (trace.耗时) stats.总耗时 = Math.max(stats.总耗时, trace.耗时);
      if (trace.类型 === 'tool_call') stats.工具调用数++;
      if (trace.类型 === 'skill_trigger') stats.技能触发数++;
      if (trace.类型 === 'subtask') {
        stats.子任务数++;
        if (trace.状态 === '已完成') stats.子任务成功++;
        if (trace.状态 === '失败') stats.子任务失败++;
      }
      if (trace.类型 === 'event_trigger') stats.事件触发数++;
    }
    
    res.json({
      success: true,
      data: {
        根任务ID,
        任务信息: {
          描述: task.描述 || task.用户消息 || '',
          状态: task.状态,
          类型: task.类型,
          routing: task.routing || null
        },
        轨迹树: rootNodes,
        统计: stats
      }
    });
  } catch (e) {
    logger.error('获取任务轨迹失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
