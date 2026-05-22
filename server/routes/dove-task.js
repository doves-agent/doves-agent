/**
 * 鸽子任务分发路由
 * 职责：抢任务（claim-task）
 * 
 * 从 dove.js 拆分，保持 /api/dove 前缀
 * 其他任务操作路由见 dove-task/任务操作.js
 */

import { Router } from 'express';
import { logger } from '../core.js';
import { 
  getMongoClient, getAdminDb, getUserDb, createTimestampFields
} from '../db.js';
import { claimTaskLimiter } from '../middleware/rate-limiter.js';
import { 异步验证同机器 } from './dove-task/任务操作.js';
import 任务操作路由 from './dove-task/任务操作.js';
import { 提取机器标识 } from '../../common/机器标识.js';

const router = Router();

// 挂载任务操作子路由（submit-result, heartbeat, abandon-task, release-stale-tasks）
router.use(任务操作路由);

// 诊断日志节流映射（避免刷屏）
const claimDiagMap = {};

/**
 * 原子抢任务 API
 * 
 * 原则：一个任务永远只被一只鸽子独占执行
 * 多鸽子横向对比场景 → 创建多个任务，而非多鸽子抢同一任务
 * 
 * 请求参数：
 * - capabilities: 鸽子能力列表
 * - doveId: 指定领取任务的鸽子ID（同机器不同实例，如 win_xxx_dove_1）
 * 
 * 子实例支持：
 * - 子实例（同机器但 index > 0）可能没有完整 鸽子身份 记录
 * - 此时回退到主鸽子身份（authDoveId）做信誉/饲料检查
 * - 并发限制按实例独立计算
 * 
 * 限制：1分钟内最多10次请求
 */
router.post('/claim-task', claimTaskLimiter, async (req, res) => {
  const { capabilities = [], doveId: requestDoveId } = req.body;
  const authDoveId = req.user.doveId || req.user.userId;
  
  // 确定实际执行者：支持同机器不同实例的鸽子
  // - 不传 doveId 或与 authDoveId 相同 → 使用 authDoveId（主鸽子）
  // - 传了 doveId 且同机器前缀 → 使用 requestDoveId（子实例）
  // - 传了 doveId 但不同机器 → 拒绝
  let doveId = authDoveId;
  if (requestDoveId && requestDoveId !== authDoveId) {
    if (!(await 异步验证同机器(requestDoveId, authDoveId))) {
      return res.status(403).json({ 
        success: false, 
        error: '请求的鸽子ID与认证身份不属于同一台机器',
        requestDoveId,
        authDoveId
      });
    }
    doveId = requestDoveId;
  }
  
  if (!doveId) {
    return res.status(401).json({ success: false, error: '鸽子身份未认证' });
  }
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    const userDb = getUserDb();
    const ts = createTimestampFields();
    
    // 1. 检查鸽子基本资格
    // 条件：未禁用、信誉>=30、余额>=1（可用饲料由实际执行数决定，步骤2检查）
    let 鸽子 = await adminDb.collection('鸽子身份').findOne({
      鸽子ID: doveId,
      状态: { $ne: '禁用' },
      信誉分: { $gte: 30 },
      '饲料.余额': { $gte: 1 }
    });
    
    // 子实例回退：doveId 是子实例但没有完整 鸽子身份 记录时，
    // 使用主鸽子身份（authDoveId）做信誉/饲料检查
    let 身份来源 = doveId;
    if (!鸽子 && doveId !== authDoveId) {
      鸽子 = await adminDb.collection('鸽子身份').findOne({
        鸽子ID: authDoveId,
        状态: { $ne: '禁用' },
        信誉分: { $gte: 30 },
        '饲料.余额': { $gte: 1 }
      });
      if (鸽子) {
        身份来源 = authDoveId;
        logger.debug(`[claim-task] 子实例 ${doveId} 回退使用主鸽子 ${authDoveId} 身份`);
      }
    }
    
    if (!鸽子) {
      // 区分失败原因（仅用于用户提示）
      // 先查 doveId，再查 authDoveId
      let 鸽子信息 = await adminDb.collection('鸽子身份').findOne(
        { 鸽子ID: doveId },
        { projection: { 信誉分: 1, 饲料: 1, 状态: 1 } }
      );
      if (!鸽子信息 && doveId !== authDoveId) {
        鸽子信息 = await adminDb.collection('鸽子身份').findOne(
          { 鸽子ID: authDoveId },
          { projection: { 信誉分: 1, 饲料: 1, 状态: 1 } }
        );
      }
      if (!鸽子信息) {
        return res.status(404).json({ success: false, error: '鸽子未注册' });
      }
      if (鸽子信息.状态 === '禁用') {
        return res.status(403).json({ success: false, error: '鸽子已被禁用' });
      }
      const 信誉分 = 鸽子信息.信誉分 ?? 100;
      if (信誉分 < 30) {
        return res.status(403).json({ success: false, error: '信誉分过低，无法抢任务', 信誉分, 需要: 30 });
      }
      const 余额 = 鸽子信息.饲料?.余额 || 0;
      if (余额 < 1) {
        return res.status(403).json({ success: false, error: '饲料不足', 余额, 需要: 1 });
      }
      return res.status(403).json({ success: false, error: '无法抢任务' });
    }
    
    const 信誉分 = 鸽子.信誉分 ?? 100;
    
    // 2. 并发上限检查：按实例独立计算
    // 每个鸽子实例（包括子实例）独立追踪并发，互不影响
    const 当前执行数 = await userDb.collection('任务').countDocuments({
      执行者: doveId,
      状态: { $in: ['执行中', '等待子任务'] }
    });
    const 最大并发数 = 鸽子.限制?.最大并发数 || 5;
    
    if (当前执行数 >= 最大并发数) {
      logger.warn(`[claim-task] 鸽子 ${doveId} 已达并发上限: 当前执行数=${当前执行数}, 最大并发数=${最大并发数}`);
      return res.status(429).json({ 
        success: false, 
        error: '已达并发上限', 
        当前执行数, 
        最大并发数,
        提示: '可能有历史残留任务未清理，请检查任务列表或等待超时回收'
      });
    }
    
    // 饲料检查：子实例共享主鸽子的饲料余额，需统计同机器所有实例的执行数
    let 全实例执行数 = 当前执行数;
    if (doveId !== 身份来源) {
      // 子实例：统计同机器所有鸽子实例的执行中任务数
      const machinePrefix = 提取机器标识(doveId);
      if (machinePrefix) {
        全实例执行数 = await userDb.collection('任务').countDocuments({
          执行者: { $regex: '^' + machinePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_dove_' },
          状态: { $in: ['执行中', '等待子任务'] }
        });
      }
    }
    const 可用饲料 = 鸽子.饲料.余额 - 全实例执行数;
    if (可用饲料 < 1) {
      return res.status(403).json({ success: false, error: '饲料不足', 余额: 鸽子.饲料.余额, 执行中: 全实例执行数, 需要: 1 });
    }
    
    // 3. 原子抢任务：findOneAndUpdate
    // 原则：一个任务只能被一只鸽子领取。状态从 pending/ready → running，
    // 原子操作保证不会有两只鸽子同时抢到同一个任务
    // 注意：不做账号隔离，所有鸽子根据自己的策略和能力抢任何用户的任务
    const 任务 = await userDb.collection('任务').findOneAndUpdate(
      {
        $and: [
          // 状态：ready 或 pending（非子任务类型的 pending）
          {
            $or: [
              { 状态: '已就绪' },
              { 状态: '工具筛选中' },
              { 状态: '等待中', 类型: { $nin: ['subtask', 'subtask_d1', 'subtask_d2', 'subtask_d3'] } }
            ]
          },
          // 能力匹配
          {
            $or: [
              { requiredCapabilities: { $exists: false } },
              { requiredCapabilities: { $size: 0 } },
              { requiredCapabilities: { $all: capabilities } },
              { 所需能力: { $exists: false } },
              { 所需能力: { $size: 0 } },
              ...(capabilities.length > 0 ? [{ 所需能力: { $all: capabilities } }] : [])
            ]
          },
          // 信誉要求：未设置或低于鸽子信誉
          {
            $or: [
              { 信誉要求: { $exists: false } },
              { 信誉要求: null },
              { 信誉要求: { $lte: 信誉分 } }
            ]
          },
          // 无执行者（确保未被其他鸽子领取）
          {
            $or: [
              { 执行者: { $exists: false } },
              { 执行者: null },
              { 执行者: '' }
            ]
          }
        ]
      },
      [{
        $set: {
          // TOOL_FILTERING 任务保持原状态（由工具筛选处理器转为 READY）
          // 其他状态统一转为执行中
          状态: { $cond: { if: { $eq: ['$状态', '工具筛选中'] }, then: '工具筛选中', else: '执行中' } },
          执行者: doveId,
          领取时间: ts.localTime,
          领取时间戳: ts.timestamp,
          心跳时间: ts.localTime,
          心跳时间戳: ts.timestamp,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp
        }
      }],
      {
        returnDocument: 'after',
        sort: { 创建时间戳: 1 }
      }
    );
    
    if (!任务) {
      // 诊断日志：每60秒最多打印一次，避免刷屏
      const now = Date.now();
      if (!claimDiagMap._lastLog || now - claimDiagMap._lastLog > 60000) {
        claimDiagMap._lastLog = now;
        const readyCount = await userDb.collection('任务').countDocuments({ 状态: '已就绪' });
        const pendingCount = await userDb.collection('任务').countDocuments({ 状态: '等待中' });
        logger.info(`[claim-task] 鸽子 ${doveId} 暂无可领取的任务 (ready=${readyCount}, pending=${pendingCount})`);
      }
      
      return res.json({ 
        success: true, 
        data: null,
        message: '暂无可领取的任务' 
      });
    }
    
    // 4. 返回完整任务信息（鸽子需要完整数据来执行）
    logger.info(`任务领取: 鸽子 ${doveId} 领取任务 ${任务.任务ID}`);
    
    res.json({
      success: true,
      data: 任务
    });
  } catch (e) {
    logger.error('抢任务失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
