/**
 * 验证调度器
 * 根据任务验证配置，创建对应的验证记录并调度执行
 * 
 * 6种验证模式：
 * 1. auto_pass    - 自动通过（信任模式）
 * 2. official     - 官方验证
 * 3. community    - 鸽友众包验证
 * 4. specific_skill - 指定验证技能
 * 5. self         - 饲养员自验证
 * 6. multi_stage  - 多阶段验证
 */

import { ObjectId } from 'mongodb';
import { getAdminDb, createTimestampFields } from '../db.js';
import { 记录审计 } from '../审计日志.js';
import { logger } from '../core.js';

// ==================== 常量定义 ====================

export const 验证模式枚举 = {
  AUTO_PASS: 'auto_pass',
  OFFICIAL: 'official',
  COMMUNITY: 'community',
  SPECIFIC_SKILL: 'specific_skill',
  SELF: 'self',
  MULTI_STAGE: 'multi_stage'
};

export const 验证状态枚举 = {
  PENDING: '等待中',
  IN_PROGRESS: '进行中',
  PASSED: '已通过',
  FAILED: '失败',
  DISPUTED: '争议中',
  TIMEOUT: '已超时',
  CANCELLED: '已取消'
};

export const 验证模式配置 = {
  [验证模式枚举.AUTO_PASS]: {
    名称: '自动通过',
    费率: 0,
    默认超时: 0,
    需要验证者: false
  },
  [验证模式枚举.OFFICIAL]: {
    名称: '官方验证',
    费率: 0.10,  // 10%
    默认超时: 3600000,  // 1小时
    需要验证者: true
  },
  [验证模式枚举.COMMUNITY]: {
    名称: '鸽友众包验证',
    费率: 0.05,  // 5%
    默认超时: 7200000,  // 2小时
    需要验证者: true,
    默认验证者数量: 3,
    默认共识阈值: 0.66  // 3人中2人通过
  },
  [验证模式枚举.SPECIFIC_SKILL]: {
    名称: '指定验证技能',
    费率: null,  // 由技能定价
    默认超时: 3600000,
    需要验证者: true
  },
  [验证模式枚举.SELF]: {
    名称: '饲养员自验证',
    费率: 0,
    默认超时: 86400000,  // 24小时
    需要验证者: false
  },
  [验证模式枚举.MULTI_STAGE]: {
    名称: '多阶段验证',
    费率: null,  // 按阶段累计
    默认超时: 10800000,  // 3小时
    需要验证者: true,
    默认阶段: [
      { type: 'auto', threshold: 0.9, fallback: 'community' },
      { type: 'community', validators: 3, consensus: 0.66, fallback: 'skill' },
      { type: 'skill', skillId: null }
    ]
  }
};

/**
 * 安全转换为 MongoDB ObjectId
 */
export function toObjectId(id) {
  if (!id) return id;
  if (ObjectId.isValid(id) && typeof id === 'string') return new ObjectId(id);
  return id;
}

// ==================== 调度核心 ====================

/**
 * 验证调度器核心逻辑
 * 根据任务验证配置，创建对应的验证记录并调度执行
 */
async function 调度验证(任务ID, 任务, 验证配置) {
  const db = getAdminDb();
  const ts = createTimestampFields();
  
  const mode = 验证配置.mode || 验证模式枚举.AUTO_PASS;
  const modeConfig = 验证模式配置[mode];
  
  if (!modeConfig) {
    throw new Error(`不支持的验证模式: ${mode}`);
  }
  
  // 计算验证费用
  const 任务报酬 = 任务.饲料?.数量 || 0;
  const 验证费率 = modeConfig.费率;
  const 验证费用 = 验证费率 !== null ? Math.floor(任务报酬 * 验证费率) : 0;
  
  // 创建验证记录
  const 验证记录 = {
    任务ID,
    验证模式: mode,
    状态: 验证状态枚举.PENDING,
    验证配置: 验证配置.config || {},
    验证费用,
    验证者列表: [],
    验证结果: null,
    创建时间: ts.localTime,
    创建时间戳: ts.timestamp,
    超时时间: new Date(ts.timestamp + (验证配置.config?.timeout || modeConfig.默认超时)).toISOString(),
    阶段记录: [],
    申诉记录: []
  };
  
  const result = await db.collection('验证记录').insertOne(验证记录);
  const 验证ID = result.insertedId.toString();
  
  // 根据模式执行调度
  switch (mode) {
    case 验证模式枚举.AUTO_PASS:
      await 执行自动通过(验证ID, 任务ID);
      break;
    case 验证模式枚举.OFFICIAL:
      await 调度官方验证(验证ID, 任务ID, 验证配置.config);
      break;
    case 验证模式枚举.COMMUNITY:
      await 调度众包验证(验证ID, 任务ID, 验证配置.config);
      break;
    case 验证模式枚举.SPECIFIC_SKILL:
      await 调度技能验证(验证ID, 任务ID, 验证配置.config);
      break;
    case 验证模式枚举.SELF:
      await 调度自验证(验证ID, 任务ID, 任务.用户ID);
      break;
    case 验证模式枚举.MULTI_STAGE:
      await 调度多阶段验证(验证ID, 任务ID, 验证配置.config);
      break;
  }
  
  记录审计({
    操作者ID: 'system',
    操作者类型: 'system',
    操作: 'schedule_verification',
    目标ID: 任务ID,
    结果: 'success',
    详情: { 验证ID, 验证模式: mode, 验证费用 }
  });
  
  return { 验证ID, 验证模式: mode, 验证费用 };
}

/**
 * 执行自动通过
 */
async function 执行自动通过(验证ID, 任务ID) {
  const db = getAdminDb();
  const ts = createTimestampFields();
  
  await db.collection('验证记录').updateOne(
    { _id: toObjectId(验证ID) },
    { $set: {
      状态: 验证状态枚举.PASSED,
      验证结果: { passed: true, score: 100, confidence: 1.0, reason: '自动通过模式' },
      完成时间: ts.localTime
    }}
  );
  
  await db.collection('任务').updateOne(
    { _id: 任务ID },
    { $set: { 状态: '已完成', 验证状态: '已通过', 验证通过时间: ts.localTime } }
  );
}

/**
 * 调度官方验证
 */
async function 调度官方验证(验证ID, 任务ID, config) {
  const db = getAdminDb();
  const ts = createTimestampFields();
  
  const 验证任务 = {
    验证ID,
    任务ID,
    类型: 'official',
    状态: '等待中',
    优先级: config?.priority || 'normal',
    创建时间: ts.localTime,
    创建时间戳: ts.timestamp,
    超时时间: new Date(ts.timestamp + (config?.timeout || 3600000)).toISOString()
  };
  
  await db.collection('验证任务').insertOne(验证任务);
}

/**
 * 调度众包验证
 */
async function 调度众包验证(验证ID, 任务ID, config) {
  const db = getAdminDb();
  const ts = createTimestampFields();
  
  const 验证者数量 = config?.validators || 验证模式配置.community.默认验证者数量;
  const 共识阈值 = config?.consensus || 验证模式配置.community.默认共识阈值;
  
  const 验证任务 = {
    验证ID,
    任务ID,
    类型: 'community',
    状态: '待领取',
    需要验证者数量: 验证者数量,
    已领取数量: 0,
    共识阈值,
    验证者列表: [],
    创建时间: ts.localTime,
    创建时间戳: ts.timestamp,
    超时时间: new Date(ts.timestamp + (config?.timeout || 7200000)).toISOString(),
    报酬: config?.reward || null
  };
  
  await db.collection('验证任务').insertOne(验证任务);
}

/**
 * 调度技能验证
 */
async function 调度技能验证(验证ID, 任务ID, config) {
  const db = getAdminDb();
  const ts = createTimestampFields();
  
  if (!config?.skillId) {
    throw new Error('specific_skill 模式必须指定 skillId');
  }
  
  const skillPigeons = await db.collection('能力').find({
    名称: config.skillId,
    状态: '活跃'
  }).toArray();
  
  const 验证任务 = {
    验证ID,
    任务ID,
    类型: 'specific_skill',
    状态: skillPigeons.length > 0 ? '已分配' : '等待中',
    技能ID: config.skillId,
    候选验证者: skillPigeons.map(p => p.鸽子ID),
    创建时间: ts.localTime,
    创建时间戳: ts.timestamp,
    超时时间: new Date(ts.timestamp + (config?.timeout || 3600000)).toISOString()
  };
  
  await db.collection('验证任务').insertOne(验证任务);
}

/**
 * 调度自验证
 */
async function 调度自验证(验证ID, 任务ID, 饲养员ID) {
  const db = getAdminDb();
  const ts = createTimestampFields();
  
  const 验证任务 = {
    验证ID,
    任务ID,
    类型: 'self',
    状态: 'waiting_owner',
    饲养员ID,
    创建时间: ts.localTime,
    创建时间戳: ts.timestamp,
    超时时间: new Date(ts.timestamp + 86400000).toISOString()
  };
  
  await db.collection('验证任务').insertOne(验证任务);
  
  await db.collection('验证记录').updateOne(
    { _id: toObjectId(验证ID) },
    { $set: { 状态: 验证状态枚举.IN_PROGRESS } }
  );
}

/**
 * 调度多阶段验证
 */
async function 调度多阶段验证(验证ID, 任务ID, config) {
  const db = getAdminDb();
  const ts = createTimestampFields();
  
  const stages = config?.stages || 验证模式配置.multi_stage.默认阶段;
  
  if (!stages || stages.length === 0) {
    throw new Error('multi_stage 模式必须指定 stages 配置');
  }
  
  const 第一阶段 = stages[0];
  
  await db.collection('验证记录').updateOne(
    { _id: toObjectId(验证ID) },
    { $set: { 
      状态: 验证状态枚举.IN_PROGRESS,
      当前阶段: 0,
      阶段配置: stages
    }}
  );
  
  await 执行多阶段步骤(验证ID, 任务ID, 0, 第一阶段);
}

/**
 * 执行多阶段验证的某个步骤
 */
export async function 执行多阶段步骤(验证ID, 任务ID, 阶段索引, 阶段配置) {
  const db = getAdminDb();
  const ts = createTimestampFields();
  
  const 阶段记录 = {
    阶段: 阶段索引,
    类型: 阶段配置.type,
    状态: '进行中',
    开始时间: ts.localTime,
    结果: null
  };
  
  await db.collection('验证记录').updateOne(
    { _id: toObjectId(验证ID) },
    { $push: { 阶段记录 } }
  );
  
  switch (阶段配置.type) {
    case 'auto':
      break;
    case 'community':
      await 调度众包验证(验证ID, 任务ID, {
        validators: 阶段配置.validators || 3,
        consensus: 阶段配置.consensus || 0.66
      });
      break;
    case 'skill':
      if (阶段配置.skillId) {
        await 调度技能验证(验证ID, 任务ID, { skillId: 阶段配置.skillId });
      }
      break;
    case 'official':
      await 调度官方验证(验证ID, 任务ID, { priority: 阶段配置.priority });
      break;
  }
}

/**
 * 检查众包验证共识
 * 当足够数量的验证者提交结果后，根据共识阈值判定最终结果
 */
export async function 检查众包共识(验证记录) {
  const db = getAdminDb();
  const ts = createTimestampFields();
  
  // 原子获取最新验证记录（避免基于过期数据判断）
  const 验证记录ID = 验证记录._id;
  const 最新记录 = await db.collection('验证记录').findOne({ _id: 验证记录ID });
  if (!最新记录) return;
  
  // 已终态则跳过（防止并发重复处理）
  if (最新记录.状态 === 验证状态枚举.PASSED || 最新记录.状态 === 验证状态枚举.FAILED) return;
  
  const 验证者列表 = 最新记录.验证者列表;
  const 验证任务 = await db.collection('验证任务').findOne({ 验证ID: 验证记录ID.toString() });
  
  if (!验证任务) return;
  
  const 需要数量 = 验证任务.需要验证者数量;
  const 共识阈值 = 验证任务.共识阈值;
  
  if (!验证者列表 || 验证者列表.length < 需要数量) return;
  
  const 通过数 = 验证者列表.filter(v => v.结果.passed).length;
  const 通过率 = 通过数 / 验证者列表.length;
  const 最终通过 = 通过率 >= 共识阈值;
  
  const 平均分 = 验证者列表.reduce((sum, v) => sum + v.结果.score, 0) / 验证者列表.length;
  const 平均置信度 = 验证者列表.reduce((sum, v) => sum + (v.结果.confidence || 0.5), 0) / 验证者列表.length;
  
  const 最终结果 = {
    passed: 最终通过,
    score: 平均分,
    confidence: 平均置信度,
    reason: 最终通过 
      ? `众包验证通过 (${通过数}/${验证者列表.length}, 阈值${共识阈值})`
      : `众包验证未通过 (${通过数}/${验证者列表.length}, 阈值${共识阈值})`,
    通过率,
    验证者数量: 验证者列表.length
  };
  
  // 原子更新：状态必须是未终态（乐观锁，防止并发重复处理）
  const updateResult = await db.collection('验证记录').updateOne(
    { _id: 验证记录ID, 状态: { $nin: [验证状态枚举.PASSED, 验证状态枚举.FAILED] } },
    { $set: {
      状态: 最终通过 ? 验证状态枚举.PASSED : 验证状态枚举.FAILED,
      验证结果: 最终结果,
      完成时间: ts.localTime
    }}
  );
  
  // 如果 matchedCount === 0，说明已被其他并发调用处理，跳过后续操作
  if (updateResult.matchedCount === 0) return;
  
  await db.collection('任务').updateOne(
    { _id: 最新记录.任务ID },
    { $set: {
      状态: 最终通过 ? '已完成' : '失败',
      验证状态: 最终通过 ? '已通过' : '失败',
      验证通过时间: 最终通过 ? ts.localTime : null
    }}
  );
  
  await db.collection('验证任务').updateOne(
    { 验证ID: 验证记录ID.toString() },
    { $set: { 状态: 最终通过 ? '已完成' : '已拒绝' } }
  );
  
  // 检查是否是争议
  if (Math.abs(通过率 - 共识阈值) < 0.15 && !最终通过) {
    await db.collection('验证记录').updateOne(
      { _id: 验证记录ID },
      { $set: { 状态: 验证状态枚举.DISPUTED } }
    );
  }
  
  // 更新所有验证者信誉
  for (const 验证者 of 验证者列表) {
    await 更新验证者信誉(验证者.验证者ID, 最终通过, 验证者.结果);
  }
}

/**
 * 处理多阶段验证结果
 */
export async function 处理多阶段结果(验证记录, 验证结果, 当前阶段索引) {
  const db = getAdminDb();
  const ts = createTimestampFields();
  
  const 阶段配置 = 验证记录.阶段配置;
  const 当前阶段 = 阶段配置[当前阶段索引 || 验证记录.当前阶段];
  
  // 更新阶段记录
  await db.collection('验证记录').updateOne(
    { _id: 验证记录._id, '阶段记录.阶段': 当前阶段索引 || 验证记录.当前阶段 },
    { $set: { '阶段记录.$.结果': 验证结果, '阶段记录.$.状态': '已完成', '阶段记录.$.完成时间': ts.localTime } }
  );
  
  if (验证结果.passed) {
    await db.collection('验证记录').updateOne(
      { _id: 验证记录._id },
      { $set: {
        状态: 验证状态枚举.PASSED,
        验证结果,
        完成时间: ts.localTime
      }}
    );
    
    await db.collection('任务').updateOne(
      { _id: 验证记录.任务ID },
      { $set: { 状态: '已完成', 验证状态: '已通过', 验证通过时间: ts.localTime } }
    );
  } else {
    const 当前索引 = 当前阶段索引 ?? 验证记录.当前阶段;
    const fallback = 当前阶段.fallback;
    
    if (fallback && 当前索引 + 1 < 阶段配置.length) {
      const 下一阶段 = 阶段配置[当前索引 + 1];
      await db.collection('验证记录').updateOne(
        { _id: 验证记录._id },
        { $set: { 当前阶段: 当前索引 + 1 } }
      );
      await 执行多阶段步骤(验证记录._id, 验证记录.任务ID, 当前索引 + 1, 下一阶段);
    } else {
      await db.collection('验证记录').updateOne(
        { _id: 验证记录._id },
        { $set: {
          状态: 验证状态枚举.FAILED,
          验证结果,
          完成时间: ts.localTime
        }}
      );
      
      await db.collection('任务').updateOne(
        { _id: 验证记录.任务ID },
        { $set: { 状态: '失败', 验证状态: '失败' } }
      );
    }
  }
}

// ==================== 内部辅助函数 ====================

/**
 * 更新验证者信誉
 * 追踪验证准确率，影响未来验证资格和权重
 */
async function 更新验证者信誉(验证者ID, 最终判定, 验证者结果) {
  try {
    const db = getAdminDb();
    const ts = createTimestampFields();
    
    let 判断正确 = null;
    if (最终判定 !== null && 最终判定 !== undefined) {
      判断正确 = 验证者结果.passed === 最终判定;
    }
    
    const updateFields = {
      更新时间: ts.localTime,
      更新时间戳: ts.timestamp
    };
    
    if (判断正确 !== null) {
      if (判断正确) {
        updateFields.$inc = { '信誉.验证正确数': 1 };
      } else {
        updateFields.$inc = { '信誉.验证错误数': 1 };
      }
    }
    
    updateFields.$inc = updateFields.$inc || {};
    updateFields.$inc['信誉.验证总数'] = 1;
    
    await db.collection('鸽子身份').updateOne(
      { 鸽子ID: 验证者ID },
      { $set: { 更新时间: ts.localTime }, $inc: updateFields.$inc }
    );
  } catch (e) {
    logger.warn('更新验证者信誉失败:', e.message);
  }
}

/**
 * 触发验证（由任务路由调用）
 * 当任务进入 reporting 状态后，自动触发验证流程
 */
export async function 触发验证(任务ID, 任务, 验证配置) {
  return await 调度验证(任务ID, 任务, 验证配置);
}

export { 更新验证者信誉 };
