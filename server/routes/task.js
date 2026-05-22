/**
 * 任务执行协议
 * 
 * === 设计目标 ===
 * 标准化任务的生命周期管理，定义统一的状态机、进度上报、结果提交和取消协议。
 * 第三方鸽子/客户端只需遵循此协议即可接入白鸽系统。
 * 
 * === 任务生命周期 ===
 * pending → ready → running → completed/failed/terminated
 *                                  ↑
 *                              cancelled（任意阶段可取消）
 * 
 * === API 列表 ===
 * POST /api/task                    创建任务
 * POST /api/task/claim              领取任务（鸽子）
 * POST /api/task/:taskId/progress   上报进度
 * POST /api/task/:taskId/result     提交结果
 * POST /api/task/:taskId/cancel     取消任务
 * POST /api/task/:taskId/reply      CLI 回复 Dove（上传完成等）
 * GET  /api/task/:taskId            查询任务状态
 * GET  /api/task/list               列出任务
 * GET  /api/task/queue-health       排队诊断统计
 * GET  /api/task/:id/trace          获取任务完整执行轨迹树
 * GET  /api/task/:id/trace/:traceId 获取单个轨迹节点详情
 * GET  /api/task/:id/trace/stats    获取任务执行统计
 *
 * 子模块拆分：
 * - task/轨迹查询.js: 轨迹查询相关路由（trace/stats/detail）
 */

import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { logger } from '../core.js';
import { getUserDb, getAdminDb, getTimestamp, createTimestampFields } from '../db.js';
import { 记录审计 } from '../审计日志.js';
import { 触发验证 } from './verification.js';
import { 任务状态, 验证状态转换, 标准化任务文档 } from './task/状态.js';
import { 获取终止监控实例 } from './task/终止监控.js';
import 轨迹查询路由 from './task/轨迹查询.js';

const router = Router();

// 状态机定义已拆分到 ./task/状态.js

/**
 * POST /api/task
 * 创建标准任务
 */
router.post('/', async (req, res) => {
  const { 描述, 对话ID, 父任务ID, 执行配置, routing } = req.body;
  const userId = req.user.userId;
  
  if (!描述) {
    return res.status(400).json({ success: false, error: '任务描述必填' });
  }
  
  try {
    const db = getUserDb();
    const 任务 = 标准化任务文档({
      描述,
      对话ID,
      父任务ID,
      用户ID: userId,
      执行配置,
      routing
    });
    
    await db.collection('任务').insertOne(任务);
    
    res.status(201).json({ success: true, data: 任务 });
  } catch (e) {
    logger.error('创建任务失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/task/:taskId/progress
 * 上报任务执行进度
 * 
 * 请求体：{ 阶段: string, 百分比: number(0-100), 消息: string }
 */
router.post('/:taskId/progress', async (req, res) => {
  const { taskId } = req.params;
  const { 阶段, 百分比, 消息 } = req.body;
  const userId = req.user.userId;
  
  try {
    const db = getUserDb();
    const ts = createTimestampFields();
    
    // 查找任务并验证权限
    const 任务 = await db.collection('任务').findOne({ 任务ID: taskId });
    if (!任务) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }
    
    // 验证任务状态：只有 executing 状态可上报进度
    if (任务.状态 !== 任务状态.EXECUTING) {
      return res.status(409).json({ 
        success: false, 
        error: `任务状态为「${任务.状态}」，只有「executing」状态可上报进度` 
      });
    }
    
    // 更新进度
    const 进度 = {
      阶段: 阶段 || 任务.进度?.阶段 || '',
      百分比: Math.max(0, Math.min(100, 百分比 ?? 任务.进度?.百分比 ?? 0)),
      消息: 消息 || '',
      更新时间: ts.localTime
    };
    
    await db.collection('任务').updateOne(
      { 任务ID: taskId },
      { 
        $set: { 
          进度,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp
        }
      }
    );
    
    res.json({ success: true, data: { 任务ID: taskId, 进度 } });
  } catch (e) {
    logger.error('上报进度失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/task/:taskId/result
 * 提交任务结果
 * 
 * 请求体：{ 结果: any, 附件: array, 耗时: number }
 */
router.post('/:taskId/result', async (req, res) => {
  const { taskId } = req.params;
  const { 结果, 附件, 耗时 } = req.body;
  const userId = req.user.userId;
  
  try {
    const db = getUserDb();
    const ts = createTimestampFields();
    
    const 任务 = await db.collection('任务').findOne({ 任务ID: taskId });
    if (!任务) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }
    
    // 验证状态转换：executing/reporting → reporting
    if (!验证状态转换(任务.状态, 任务状态.REPORTING)) {
      return res.status(409).json({ 
        success: false, 
        error: `任务状态为「${任务.状态}」，无法提交结果` 
      });
    }
    
    // 更新任务：状态→reporting，记录结果
    await db.collection('任务').updateOne(
      { 任务ID: taskId },
      { 
        $set: { 
          状态: 任务状态.REPORTING,
          结果: 结果 || null,
          附件: 附件 || [],
          执行耗时: 耗时 || null,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp
        }
      }
    );
    
    // 触发验证调度
    const 验证配置 = 任务.验证配置 || { mode: 'auto_pass' };
    const 验证信息 = await 触发验证(taskId, 任务, 验证配置);
    
    记录审计({
      操作者ID: userId,
      操作者类型: req.user.authType === 'apikey' ? 'dove' : 'user',
      操作: 'submit_result',
      目标ID: taskId,
      结果: 'success',
      详情: { 耗时 }
    });
    
    res.json({ 
      success: true, 
      data: { 
        任务ID: taskId, 
        状态: 验证信息 ? 任务状态.VALIDATING : 任务状态.COMPLETED,
        验证状态: 验证信息 ? 'scheduled' : 'auto_completed',
        验证ID: 验证信息?.验证ID || null,
        验证模式: 验证信息?.验证模式 || null,
        完成时间: 验证信息 ? null : ts.localTime
      } 
    });
  } catch (e) {
    logger.error('提交结果失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/task/:taskId/cancel
 * 取消任务
 * 
 * 请求体：{ 原因: string }
 */
router.post('/:taskId/cancel', async (req, res) => {
  const { taskId } = req.params;
  const { 原因 } = req.body;
  const userId = req.user.userId;
  
  try {
    const db = getUserDb();
    const ts = createTimestampFields();
    
    const 任务 = await db.collection('任务').findOne({ 任务ID: taskId });
    if (!任务) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }
    
    // 已终态的任务不可取消
    if (!验证状态转换(任务.状态, 任务状态.CANCELLED)) {
      return res.status(409).json({ 
        success: false, 
        error: `任务状态为「${任务.状态}」，无法取消` 
      });
    }
    
    // 只有任务所属用户或管理员可取消
    if (任务.用户ID !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: '无权取消此任务' });
    }
    
    await db.collection('任务').updateOne(
      { 任务ID: taskId },
      { 
        $set: { 
          状态: 任务状态.CANCELLED,
          取消原因: 原因 || '用户取消',
          完成时间: ts.localTime,
          完成时间戳: ts.timestamp,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp
        }
      }
    );
    
    记录审计({
      操作者ID: userId,
      操作者类型: req.user.role === 'admin' ? 'admin' : 'user',
      操作: 'cancel_task',
      目标ID: taskId,
      结果: 'success',
      详情: { 原因 }
    });
    
    res.json({ 
      success: true, 
      data: { 任务ID: taskId, 状态: 任务状态.CANCELLED, 取消原因: 原因 } 
    });
  } catch (e) {
    logger.error('取消任务失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/task/:taskId/reply
 * CLI 回复 Dove（上传完成等），任务从 awaiting_cli 重新入队
 */
router.post('/:taskId/reply', async (req, res) => {
  const { taskId } = req.params;
  const { message } = req.body;
  const userId = req.user.userId;

  try {
    const db = getUserDb();
    const ts = createTimestampFields();

    const task = await db.collection('任务').findOne({ 任务ID: taskId, 状态: 'awaiting_cli' });
    if (!task) {
      return res.status(404).json({ success: false, error: '任务不存在或状态不是 awaiting_cli' });
    }

    const update = {
      $set: {
        状态: '等待中',
        更新时间: ts.localTime,
        更新时间戳: ts.timestamp,
      },
      $unset: { 响应: '', 执行者: '', 领取时间戳: '' },
    };
    if (message) {
      update.$set.消息 = (task.消息 || task.描述 || '') + '\n\n' + message;
    }
    await db.collection('任务').updateOne({ 任务ID: taskId }, update);

    logger.info(`[reply] 任务 ${taskId} 已回复，重新入队`);
    res.json({ success: true });
  } catch (e) {
    logger.error('reply 失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/task/list
 * 列出任务
 * 查询参数：?状态=executing&limit=20&skip=0
 */
router.get('/list', async (req, res) => {
  const userId = req.user.userId;
  const { 状态, limit, skip } = req.query;
  
  try {
    const db = getUserDb();
    const 查询条件 = { 用户ID: userId };
    if (状态) 查询条件.状态 = 状态;
    
    const 任务列表 = await db.collection('任务')
      .find(查询条件)
      .sort({ 创建时间戳: -1 })
      .skip(parseInt(skip) || 0)
      .limit(Math.min(parseInt(limit) || 20, 100))
      .toArray();
    
    const 总数 = await db.collection('任务').countDocuments(查询条件);
    
    res.json({ 
      success: true, 
      data: 任务列表,
      总数,
      限制: Math.min(parseInt(limit) || 20, 100)
    });
  } catch (e) {
    logger.error('列出任务失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/task/queue-health
 * 排队诊断统计 API
 * 查询当前用户所有 pending/ready 状态的子任务的排队诊断信息
 */
router.get('/queue-health', async (req, res) => {
  const userId = req.user.userId;
  
  try {
    const db = getUserDb();
    const ts = Date.now();
    
    // 查询所有 pending/ready 状态的子任务
    const 子任务列表 = await db.collection('任务')
      .find({
        用户ID: userId,
        状态: { $in: ['等待中', '已就绪'] },
        类型: { $in: ['subtask', 'subtask_d1', 'subtask_d2', 'subtask_d3'] }
      })
      .toArray();
    
    // 初始化统计
    const 统计 = {
      总计: 子任务列表.length,
      正常排队: 0,
      鸽子离线: 0,
      无鸽子具备能力: 0,
      队列拥挤: 0,
      未诊断: 0
    };
    
    // 处理详情
    const 详情 = 子任务列表.map(任务 => {
      const 等待时长 = 任务.创建时间戳 ? ts - 任务.创建时间戳 : 0;
      const 排队诊断 = 任务.排队诊断 || null;
      
      // 根据诊断结果分类统计（Branch执行器写入字母代码：A/B/C/D）
      if (!排队诊断 || !排队诊断.诊断结果) {
        统计.未诊断++;
      } else {
        switch (排队诊断.诊断结果) {
          case 'A':
            统计.正常排队++;
            break;
          case 'B':
            统计.鸽子离线++;
            break;
          case 'C':
            统计.无鸽子具备能力++;
            break;
          case 'D':
            统计.队列拥挤++;
            break;
          default:
            统计.未诊断++;
        }
      }
      
      return {
        任务ID: 任务.任务ID,
        状态: 任务.状态,
        等待时长,
        排队诊断
      };
    });
    
    res.json({
      success: true,
      data: {
        ...统计,
        详情
      }
    });
  } catch (e) {
    logger.error('查询排队诊断统计失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// 轨迹查询路由（已拆分到 task/轨迹查询.js）
router.use('/', 轨迹查询路由);

/**
 * GET /api/task/termination-monitor/report
 * 获取终止监控运行报告（必须在 /:taskId 之前注册）
 */
router.get('/termination-monitor/report', async (req, res) => {
  try {
    const 监控实例 = 获取终止监控实例();
    res.json({ success: true, data: 监控实例.生成报告() });
  } catch (e) {
    logger.error('获取终止监控报告失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/task/:taskId
 * 查询任务详情
 */
router.get('/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const userId = req.user.userId;
  
  try {
    const db = getUserDb();
    const 任务 = await db.collection('任务').findOne({ 任务ID: taskId });
    
    if (!任务) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }
    
    // 权限检查：只能查看自己的任务（管理员可查所有）
    if (任务.用户ID !== userId && req.user.role !== 'admin' && req.user.doveId !== 任务.执行者) {
      return res.status(403).json({ success: false, error: '无权查看此任务' });
    }
    
    res.json({ success: true, data: 任务 });
  } catch (e) {
    logger.error('查询任务失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/task/:taskId/termination-response
 * 用户对监工终止确认的响应：终止 或 继续
 * 
 * 请求体：{ action: '终止' | '继续' }
 */
router.post('/:taskId/termination-response', async (req, res) => {
  const { taskId } = req.params;
  const { action } = req.body;
  const userId = req.user.userId;

  if (!action || !['终止', '继续'].includes(action)) {
    return res.status(400).json({ success: false, error: 'action 必填，支持: "终止" 或 "继续"' });
  }

  try {
    const 监控实例 = 获取终止监控实例();
    const 结果 = await 监控实例.处理用户响应(taskId, action, userId);

    if (!结果.success) {
      const status = 结果.error === '任务不存在' ? 404 :
                     结果.error === '无权操作此任务' ? 403 : 400;
      return res.status(status).json(结果);
    }

    res.json(结果);
  } catch (e) {
    logger.error('处理终止确认响应失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});



// ==================== 启动终止监控扫描器 ====================
const 终止监控实例 = 获取终止监控实例();
终止监控实例.启动();

export default router;
