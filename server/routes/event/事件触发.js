/**
 * 事件触发 子路由
 * 职责：手动触发/条件检查/摘要触发 + 用户交互(ask/answer/stream)
 */

import { Router } from 'express';
import { getUserDb } from '../../db.js';
import { getEventScheduler } from '../../事件调度器.js';
import { createTimestampFields, toLocalISOString, getTimestamp } from '@dove/common/时间工具.js';
import { logger } from '../../core.js';

const router = Router();

/**
 * POST /api/event/trigger - 手动触发
 */
router.post('/trigger', async (req, res) => {
  const { task } = req.body;
  const userId = req.user.userId;
  
  if (!task || !task.用户消息) {
    return res.status(400).json({ success: false, error: '缺少任务模板或用户消息' });
  }
  
  try {
    const scheduler = getEventScheduler();
    const 任务 = await scheduler.外部触发(task, userId);
    res.json({ success: true, data: 任务 });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/event/check - 检查消息是否触发语义事件
 */
router.post('/check', async (req, res) => {
  const { message } = req.body;
  const userId = req.user.userId;
  
  if (!message) {
    return res.status(400).json({ success: false, error: '缺少参数: message' });
  }
  
  try {
    const scheduler = getEventScheduler();
    const 结果 = await scheduler.检查语义触发(message, userId, { 是否触发任务: true });
    
    res.json({
      success: true,
      data: {
        匹配事件数: 结果.匹配事件.length,
        匹配事件: 结果.匹配事件.map(m => ({
          事件ID: m.事件.事件ID,
          事件名称: m.事件.事件名称,
          触发条件: m.事件.触发条件,
          相似度: m.相似度,
          LLM判断: m.LLM判断,
          置信度: m.置信度
        })),
        触发结果: 结果.触发结果
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/event/trigger-by-summary - 摘要触发
 */
router.post('/trigger-by-summary', async (req, res) => {
  const { summary, keywords, conversationId, taskId } = req.body;
  const userId = req.user.userId;
  
  if (!summary) {
    return res.status(400).json({ success: false, error: '缺少参数: summary' });
  }
  
  try {
    const scheduler = getEventScheduler();
    const 结果 = await scheduler.摘要触发检查(summary, conversationId || '', userId, {
      任务ID: taskId || null,
      关键词列表: keywords || []
    });
    
    res.json({
      success: true,
      data: 结果
    });
  } catch (e) {
    logger.error('摘要触发检查失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 用户交互事件 ====================

/**
 * POST /api/event/ask - 鸽子发起用户交互
 */
router.post('/ask', async (req, res) => {
  const { 根任务ID, 问题 } = req.body;
  const userId = req.user.userId;
  
  if (!根任务ID || !问题) {
    return res.status(400).json({ success: false, error: '缺少参数: 根任务ID, 问题' });
  }
  
  try {
    const userDb = getUserDb();
    const ts = createTimestampFields();
    const 事件ID = 'ask-' + Math.random().toString(16).substr(2, 6);
    
    const 事件 = {
      事件ID,
      事件类型: 'user_interaction',
      事件名称: 问题.header || '用户交互',
      根任务ID,
      问题,
      状态: '等待中',
      用户ID: userId,
      答案: null,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp,
      更新时间: ts.localTime,
      更新时间戳: ts.timestamp
    };
    
    await userDb.collection('事件').insertOne(事件);
    
    logger.info(`[用户交互] 鸽子提问: ${事件ID}, 根任务: ${根任务ID}`);
    res.json({ success: true, data: { 事件ID, 状态: '等待中' } });
  } catch (e) {
    logger.error('创建用户交互事件失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/event/answer-by-question - 通过问题ID查找并提交交互答案（双通道回退）
 * 当流缓冲通道收到 user_question 但没有事件ID时，通过问题ID查找匹配的事件并提交答案
 */
router.post('/answer-by-question', async (req, res) => {
  const { questionId, answer } = req.body;
  const userId = req.user.userId;
  
  if (!questionId || answer === undefined) {
    return res.status(400).json({ success: false, error: 'questionId 和 answer 必填' });
  }
  
  try {
    const userDb = getUserDb();
    const ts = createTimestampFields();
    
    // 通过问题ID查找匹配的 pending 事件
    const result = await userDb.collection('事件').findOneAndUpdate(
      { '问题.id': questionId, 用户ID: userId, 状态: '等待中', 事件类型: 'user_interaction' },
      {
        $set: {
          状态: '已回复',
          答案: answer,
          回答时间: ts.localTime,
          回答时间戳: ts.timestamp,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp
        }
      },
      { returnDocument: 'after' }
    );
    
    if (!result) {
      return res.json({ success: false, error: '未找到匹配的待回答事件' });
    }
    
    logger.info(`[用户交互] 通过问题ID回答: ${questionId} -> 事件 ${result.事件ID}`);
    res.json({ success: true, data: { 事件ID: result.事件ID, 状态: '已回复' } });
  } catch (e) {
    logger.error('通过问题ID提交交互答案失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/event/:id/answer - 用户提交交互答案
 */
router.post('/:id/answer', async (req, res) => {
  const { id } = req.params;
  const { answer } = req.body;
  const userId = req.user.userId;
  
  if (answer === undefined) {
    return res.status(400).json({ success: false, error: 'answer 必填' });
  }
  
  try {
    const userDb = getUserDb();
    const ts = createTimestampFields();
    
    const result = await userDb.collection('事件').findOneAndUpdate(
      { 事件ID: id, 用户ID: userId, 状态: '等待中', 事件类型: 'user_interaction' },
      {
        $set: {
          状态: '已回复',
          答案: answer,
          回答时间: ts.localTime,
          回答时间戳: ts.timestamp,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp
        }
      },
      { returnDocument: 'after' }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, error: '事件不存在或已回答' });
    }
    
    logger.info(`[用户交互] 用户回答: ${id}`);
    res.json({ success: true, data: { 事件ID: id, 状态: '已回复' } });
  } catch (e) {
    logger.error('提交交互答案失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/event/stream - SSE 监听当前用户的交互事件
 */
router.get('/stream', async (req, res) => {
  const userId = req.user.userId;
  logger.info(`[事件SSE] 用户 ${userId} 建立事件流连接`);
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  
  try {
    const userDb = getUserDb();
    
    const pushedEvents = new Set();
    
    // 先推送已有的 pending 交互事件（含 cli_action）
    const pending = await userDb.collection('事件').find({
      事件类型: { $in: ['user_interaction', 'cli_action'] },
      用户ID: userId,
      状态: '等待中'
    }).sort({ 创建时间戳: 1 }).toArray();
    
    for (const evt of pending) {
      if (pushedEvents.has(evt.事件ID)) continue;
      pushedEvents.add(evt.事件ID);
      
      const payload = {
        事件ID: evt.事件ID,
        事件类型: evt.事件类型,
        根任务ID: evt.根任务ID,
        状态: evt.状态,
        创建时间戳: evt.创建时间戳
      };
      // user_interaction 携带问题字段，cli_action 携带操作请求字段
      if (evt.事件类型 === 'user_interaction') {
        payload.问题 = evt.问题;
      } else if (evt.事件类型 === 'cli_action') {
        payload.操作请求 = evt.操作请求;
      }
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
    
    // Change Stream 监听（含 cli_action 事件类型）
    const changeStream = userDb.collection('事件').watch(
      [{ $match: { 'fullDocument.用户ID': userId, 'fullDocument.事件类型': { $in: ['user_interaction', 'cli_action'] } } }],
      { fullDocument: 'updateLookup' }
    );
    
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);
    
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      changeStream.close();
    };
    
    changeStream.on('change', (change) => {
      if (settled) return;
      
      const evt = change.fullDocument;
      if (!evt || (evt.事件类型 !== 'user_interaction' && evt.事件类型 !== 'cli_action')) return;
      
      logger.info(`[事件SSE] Change Stream 触发: 事件ID=${evt.事件ID}, 状态=${evt.状态}, 用户ID=${evt.用户ID}`);
      
      if (evt.状态 === '等待中') {
        if (pushedEvents.has(evt.事件ID)) return;
        pushedEvents.add(evt.事件ID);
        
        const payload = {
          事件ID: evt.事件ID,
          事件类型: evt.事件类型,
          根任务ID: evt.根任务ID,
          状态: evt.状态,
          创建时间戳: evt.创建时间戳
        };
        // 按事件类型携带不同字段
        if (evt.事件类型 === 'user_interaction') {
          payload.问题 = evt.问题;
        } else if (evt.事件类型 === 'cli_action') {
          payload.操作请求 = evt.操作请求;
        }
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    });
    
    // Change Stream 错误处理：防止静默失败
    changeStream.on('error', (err) => {
      logger.error(`[事件SSE] Change Stream 错误: ${err.message}`);
      cleanup();
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: `事件流错误: ${err.message}` })}\n\n`);
        res.end();
      }
    });
    
    req.on('close', cleanup);
    
    setTimeout(() => {
      if (!settled) {
        cleanup();
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }, 30 * 60 * 1000);
    
  } catch (e) {
    logger.error('用户事件SSE失败:', e.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: e.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    }
  }
});

export default router;
