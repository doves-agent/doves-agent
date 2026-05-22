/**
 * 验证系统 - 路由层
 * 
 * === 设计目标 ===
 * 验证即技能。支持多种验证模式确保任务完成质量，形成信誉闭环。
 * 验证结果影响信誉，信誉影响接单权重和验证资格。
 * 
 * === 6种验证模式 ===
 * 1. auto_pass    - 自动通过（信任模式），简单/低价值任务，免费
 * 2. official     - 官方验证，标准任务，任务报酬10%
 * 3. community    - 鸽友众包验证，中等复杂度任务，任务报酬5%
 * 4. specific_skill - 指定验证技能，专业领域任务，技能定价
 * 5. self         - 饲养员自验证，私有任务/高信任场景，免费
 * 6. multi_stage  - 多阶段验证（auto→community→skill），高价值复杂任务，按阶段累计
 * 
 * === 验证流程 ===
 * 任务完成 → 根据配置选择验证模式 → 执行验证 → 通过/不通过 → 结算
 * 
 * === 数据集合 ===
 * - 验证记录: 存储每次验证的详细信息
 * - 验证任务: community模式下的众包验证任务
 * - 验证市场: 可供鸽子领取的验证任务列表
 */

import { Router } from 'express';
import { logger } from '../core.js';
import { getMongoClient, getAdminDb, createTimestampFields } from '../db.js';
import { 记录审计 } from '../审计日志.js';
import {
  验证模式枚举,
  验证状态枚举,
  验证模式配置,
  toObjectId,
  检查众包共识,
  处理多阶段结果,
  更新验证者信誉,
  触发验证
} from './验证调度器.js';

const router = Router();

// 重新导出触发验证，供 task.js 导入
export { 触发验证 };

// ==================== 路由 ====================

/**
 * POST /api/verification/submit
 * 提交验证结果
 */
router.post('/submit', async (req, res) => {
  const 验证者ID = req.user.doveId || req.user.userId;
  const { 
    验证ID, 
    任务ID,
    passed, 
    score, 
    confidence, 
    reason, 
    details 
  } = req.body;
  
  if (!验证ID && !任务ID) {
    return res.status(400).json({ success: false, error: '必须提供验证ID或任务ID' });
  }
  
  if (typeof passed !== 'boolean') {
    return res.status(400).json({ success: false, error: 'passed 必须是布尔值' });
  }
  
  if (typeof score !== 'number' || score < 0 || score > 100) {
    return res.status(400).json({ success: false, error: 'score 必须是 0-100 的数字' });
  }
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    const ts = createTimestampFields();
    
    // 查找验证记录
    let query = {};
    if (验证ID) query._id = 验证ID;
    else query.任务ID = 任务ID;
    
    const 验证记录 = await db.collection('验证记录').findOne(query);
    
    if (!验证记录) {
      return res.status(404).json({ success: false, error: '验证记录不存在' });
    }
    
    if (验证记录.状态 === 验证状态枚举.PASSED || 验证记录.状态 === 验证状态枚举.FAILED) {
      return res.status(400).json({ success: false, error: '验证已完成，不可再次提交' });
    }
    
    const 验证结果 = { passed, score, confidence: confidence || 0.5, reason, details, 验证者ID, 提交时间: ts.localTime };
    
    // 根据验证模式处理结果（所有更新操作加入状态条件作为乐观锁）
    switch (验证记录.验证模式) {
      case 验证模式枚举.OFFICIAL:
      case 验证模式枚举.SPECIFIC_SKILL:
        // 单验证者模式：原子更新（状态必须是未终态）
        const officialResult = await db.collection('验证记录').updateOne(
          { _id: 验证记录._id, 状态: { $nin: [验证状态枚举.PASSED, 验证状态枚举.FAILED] } },
          { $set: {
            状态: passed ? 验证状态枚举.PASSED : 验证状态枚举.FAILED,
            验证结果,
            完成时间: ts.localTime
          },
          $push: { 验证者列表: { 验证者ID, 结果: 验证结果 } }
        });
        
        if (officialResult.matchedCount === 0) {
          return res.status(400).json({ success: false, error: '验证状态已变更，无法提交' });
        }
        
        await db.collection('任务').updateOne(
          { _id: 验证记录.任务ID },
          { $set: { 
            状态: passed ? '已完成' : '失败',
            验证状态: passed ? '已通过' : '失败',
            验证通过时间: passed ? ts.localTime : null
          }}
        );
        
        await db.collection('验证任务').updateOne(
          { 验证ID: 验证记录._id.toString() },
          { $set: { 状态: passed ? '已完成' : '已拒绝' } }
        );
        break;
        
      case 验证模式枚举.COMMUNITY:
        // 众包模式：追加验证者结果（状态必须是未终态），然后检查共识
        const communityResult = await db.collection('验证记录').updateOne(
          { _id: 验证记录._id, 状态: { $nin: [验证状态枚举.PASSED, 验证状态枚举.FAILED] } },
          { $push: { 验证者列表: { 验证者ID, 结果: 验证结果 } } }
        );
        
        if (communityResult.matchedCount === 0) {
          return res.status(400).json({ success: false, error: '验证状态已变更，无法提交' });
        }
        
        await db.collection('验证任务').updateOne(
          { 验证ID: 验证记录._id.toString() },
          { $inc: { 已领取数量: 1 }, $push: { 验证者列表: 验证者ID } }
        );
        
        // 重新获取最新记录进行共识检查
        const 更新后记录 = await db.collection('验证记录').findOne({ _id: 验证记录._id });
        await 检查众包共识(更新后记录);
        break;
        
      case 验证模式枚举.SELF:
        // 自验证：原子更新（状态必须是未终态）
        const selfResult = await db.collection('验证记录').updateOne(
          { _id: 验证记录._id, 状态: { $nin: [验证状态枚举.PASSED, 验证状态枚举.FAILED] } },
          { $set: {
            状态: passed ? 验证状态枚举.PASSED : 验证状态枚举.FAILED,
            验证结果,
            完成时间: ts.localTime
          },
          $push: { 验证者列表: { 验证者ID, 结果: 验证结果 } }
        });
        
        if (selfResult.matchedCount === 0) {
          return res.status(400).json({ success: false, error: '验证状态已变更，无法提交' });
        }
        
        await db.collection('任务').updateOne(
          { _id: 验证记录.任务ID },
          { $set: {
            状态: passed ? '已完成' : '失败',
            验证状态: passed ? '已通过' : '失败',
            验证通过时间: passed ? ts.localTime : null
          }}
        );
        break;
        
      case 验证模式枚举.MULTI_STAGE:
        // 多阶段：记录当前阶段结果，决定是否进入下一阶段
        await 处理多阶段结果(验证记录, 验证结果, 阶段索引);
        break;
        
      default:
        return res.status(400).json({ success: false, error: `不支持的验证模式: ${验证记录.验证模式}` });
    }
    
    // 更新验证者信誉（验证准确率追踪）
    await 更新验证者信誉(验证者ID, null, 验证结果);
    
    记录审计({
      操作者ID: 验证者ID,
      操作者类型: req.user.doveId ? 'dove' : 'user',
      操作: 'submit_verification',
      目标ID: 验证记录.任务ID,
      结果: 'success',
      详情: { 验证ID: 验证记录._id.toString(), passed, score, confidence }
    });
    
    res.json({
      success: true,
      data: {
        验证ID: 验证记录._id.toString(),
        任务ID: 验证记录.任务ID,
        passed,
        验证模式: 验证记录.验证模式
      }
    });
  } catch (e) {
    logger.error('提交验证结果失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * P3-3: 众包验证市场
 * 鸽子领取验证任务
 */
router.get('/market', async (req, res) => {
  const 鸽子ID = req.user.doveId;
  const { 类型, 页码 = 1, 每页数量 = 20 } = req.query;
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    
    const query = { 状态: '待领取' };
    if (类型) query.类型 = 类型;
    
    if (鸽子ID) {
      query.验证者列表 = { $ne: 鸽子ID };
    }
    
    const total = await db.collection('验证任务').countDocuments(query);
    const tasks = await db.collection('验证任务')
      .find(query)
      .sort({ 创建时间戳: -1 })
      .skip((页码 - 1) * 每页数量)
      .limit(每页数量)
      .toArray();
    
    res.json({
      success: true,
      data: {
        总数: total,
        页码: Number(页码),
        验证任务列表: tasks
      }
    });
  } catch (e) {
    logger.error('获取验证市场失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * P3-3: 领取验证任务
 */
router.post('/claim', async (req, res) => {
  const 验证者ID = req.user.doveId || req.user.userId;
  const { 验证任务ID } = req.body;
  
  if (!验证任务ID) {
    return res.status(400).json({ success: false, error: '必须提供验证任务ID' });
  }
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    const ts = createTimestampFields();
    
    // 原子领取：条件检查+更新一步完成，避免 findOne→检查→updateOne 的竞态
    const result = await db.collection('验证任务').findOneAndUpdate(
      {
        _id: 验证任务ID,
        状态: '待领取',
        验证者列表: { $ne: 验证者ID },
        $expr: {
          $or: [
            { $ne: ['$类型', 'community'] },
            { $lt: ['$已领取数量', { $ifNull: ['$需要验证者数量', 1] }] }
          ]
        }
      },
      {
        $inc: { 已领取数量: 1 },
        $push: { 验证者列表: 验证者ID }
      },
      { returnDocument: 'after' }
    );
    
    if (!result) {
      // 区分失败原因（仅用于用户提示，不影响数据一致性）
      const 验证任务 = await db.collection('验证任务').findOne({ _id: 验证任务ID });
      if (!验证任务) {
        return res.status(404).json({ success: false, error: '验证任务不存在' });
      }
      if (验证任务.状态 !== '待领取') {
        return res.status(400).json({ success: false, error: '验证任务已关闭' });
      }
      if (验证任务.验证者列表?.includes(验证者ID)) {
        return res.status(400).json({ success: false, error: '你已经领取了该验证任务' });
      }
      return res.status(400).json({ success: false, error: '验证任务已满' });
    }
    
    // 检查是否需要更新状态为 in_progress（原子条件更新）
    if (result.已领取数量 >= (result.需要验证者数量 || 1) && result.状态 === '待领取') {
      await db.collection('验证任务').updateOne(
        { _id: result._id, 状态: '待领取' },
        { $set: { 状态: '进行中' } }
      );
    }
    
    const 任务 = await db.collection('任务').findOne({ _id: result.任务ID });
    
    记录审计({
      操作者ID: 验证者ID,
      操作者类型: req.user.doveId ? 'dove' : 'user',
      操作: 'claim_verification_task',
      目标ID: 验证任务ID,
      结果: 'success',
      详情: { 任务ID: result.任务ID }
    });
    
    res.json({
      success: true,
      data: {
        验证任务ID,
        任务ID: result.任务ID,
        任务标题: 任务?.标题,
        任务描述: 任务?.描述,
        验证模式: result.类型
      }
    });
  } catch (e) {
    logger.error('领取验证任务失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * P3-4: 计算验证费用
 */
router.get('/fee-estimate', async (req, res) => {
  const { mode, 任务报酬, validators } = req.query;
  
  if (!mode) {
    return res.status(400).json({ success: false, error: '必须提供验证模式' });
  }
  
  const modeConfig = 验证模式配置[mode];
  if (!modeConfig) {
    return res.status(400).json({ success: false, error: `不支持的验证模式: ${mode}` });
  }
  
  const 报酬 = Number(任务报酬) || 0;
  let 验证费用 = 0;
  let 平台手续费 = 0;
  let 鸽子报酬 = 报酬;
  let 费用明细 = {};
  
  switch (mode) {
    case 验证模式枚举.AUTO_PASS:
    case 验证模式枚举.SELF:
      验证费用 = 0;
      平台手续费 = 0;
      鸽子报酬 = 报酬;
      费用明细 = { 说明: '免费验证模式', 鸽子报酬 };
      break;
      
    case 验证模式枚举.OFFICIAL:
      平台手续费 = Math.floor(报酬 * 0.02);
      验证费用 = Math.floor(报酬 * 0.10);
      鸽子报酬 = 报酬 - 平台手续费 - 验证费用;
      费用明细 = { 平台手续费: `${平台手续费} Feed (2%)`, 验证费: `${验证费用} Feed (10%)`, 鸽子报酬: `${鸽子报酬} Feed` };
      break;
      
    case 验证模式枚举.COMMUNITY:
      const numValidators = Number(validators) || 3;
      平台手续费 = Math.floor(报酬 * 0.02);
      验证费用 = Math.floor(报酬 * 0.05);
      const 每人验证费 = Math.floor(验证费用 / numValidators);
      鸽子报酬 = 报酬 - 平台手续费 - 验证费用;
      费用明细 = { 
        平台手续费: `${平台手续费} Feed (2%)`, 
        验证费总计: `${验证费用} Feed (5%)`,
        每位验证者: `${每人验证费} Feed × ${numValidators}`,
        鸽子报酬: `${鸽子报酬} Feed`
      };
      break;
      
    case 验证模式枚举.SPECIFIC_SKILL:
      费用明细 = { 说明: '费用由技能定价决定，请联系技能提供者' };
      break;
      
    case 验证模式枚举.MULTI_STAGE:
      平台手续费 = Math.floor(报酬 * 0.02);
      验证费用 = Math.floor(报酬 * 0.15);
      鸽子报酬 = 报酬 - 平台手续费 - 验证费用;
      费用明细 = { 说明: '多阶段验证，费用按实际执行阶段累计', 预估上限: `${验证费用} Feed (15%)`, 鸽子报酬: `${鸽子报酬} Feed (保底)` };
      break;
  }
  
  res.json({
    success: true,
    data: {
      验证模式: mode,
      任务报酬: 报酬,
      验证费用,
      平台手续费,
      鸽子报酬,
      费用明细
    }
  });
});

/**
 * P3-5: 查询验证结果
 */
router.get('/result/:taskId', async (req, res) => {
  const { taskId } = req.params;
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    
    const 验证记录 = await db.collection('验证记录').findOne({ 任务ID: taskId });
    
    if (!验证记录) {
      return res.status(404).json({ success: false, error: '未找到验证记录' });
    }
    
    res.json({
      success: true,
      data: {
        验证ID: 验证记录._id.toString(),
        任务ID: 验证记录.任务ID,
        验证模式: 验证记录.验证模式,
        状态: 验证记录.状态,
        验证结果: 验证记录.验证结果,
        验证者数量: 验证记录.验证者列表?.length || 0,
        验证费用: 验证记录.验证费用,
        创建时间: 验证记录.创建时间,
        完成时间: 验证记录.完成时间,
        阶段记录: 验证记录.阶段记录,
        申诉记录: 验证记录.申诉记录
      }
    });
  } catch (e) {
    logger.error('查询验证结果失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * P3-5: 查询验证记录列表
 */
router.get('/list', async (req, res) => {
  const { 状态, 验证模式, 页码 = 1, 每页数量 = 20 } = req.query;
  const 用户ID = req.user.userId;
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    
    const query = {};
    if (状态) query.状态 = 状态;
    if (验证模式) query.验证模式 = 验证模式;
    
    const 用户任务 = await db.collection('任务').find({
      $or: [
        { 用户ID },
        { 执行者: req.user.doveId }
      ]
    }).project({ _id: 1 }).toArray();
    
    const 任务ID列表 = 用户任务.map(t => t._id.toString());
    query.任务ID = { $in: 任务ID列表 };
    
    const total = await db.collection('验证记录').countDocuments(query);
    const records = await db.collection('验证记录')
      .find(query)
      .sort({ 创建时间戳: -1 })
      .skip((页码 - 1) * 每页数量)
      .limit(Number(每页数量))
      .toArray();
    
    res.json({
      success: true,
      data: {
        总数: total,
        页码: Number(页码),
        验证记录列表: records
      }
    });
  } catch (e) {
    logger.error('查询验证列表失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 申诉验证结果
 */
router.post('/dispute', async (req, res) => {
  const { 验证ID, 原因, 证据 } = req.body;
  
  if (!验证ID) {
    return res.status(400).json({ success: false, error: '必须提供验证ID' });
  }
  
  try {
    await getMongoClient();
    const db = getAdminDb();
    const ts = createTimestampFields();
    
    const 验证记录 = await db.collection('验证记录').findOne({ _id: toObjectId(验证ID) });
    
    if (!验证记录) {
      return res.status(404).json({ success: false, error: '验证记录不存在' });
    }
    
    if (验证记录.状态 !== 验证状态枚举.FAILED && 验证记录.状态 !== 验证状态枚举.DISPUTED) {
      return res.status(400).json({ success: false, error: '只能对失败或争议状态的验证提出申诉' });
    }
    
    const 申诉 = {
      申诉者: req.user.userId || req.user.doveId,
      原因,
      证据: 证据 || {},
      状态: '等待中',
      提交时间: ts.localTime
    };
    
    await db.collection('验证记录').updateOne(
      { _id: toObjectId(验证ID) },
      { 
        $set: { 状态: 验证状态枚举.DISPUTED },
        $push: { 申诉记录: 申诉 }
      }
    );
    
    记录审计({
      操作者ID: req.user.userId || req.user.doveId,
      操作者类型: req.user.doveId ? 'dove' : 'user',
      操作: 'dispute_verification',
      目标ID: 验证ID,
      结果: 'success',
      详情: { 原因 }
    });
    
    res.json({ success: true, data: { 验证ID, 申诉状态: '等待中' } });
  } catch (e) {
    logger.error('提交申诉失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
