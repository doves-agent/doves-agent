/**
 * 饲料管理模块
 * 职责：饲料结算、交易记录
 * 
 * 【KISS原则文档的一部分】
 * 
 * === 饲料系统设计 ===
 * 
 * 饲料是白鸽平台的代币系统：
 * - 鸽子抢任务时检查余额是否充足（可用 = 余额 - 实际执行中任务数）
 * - 任务成功：获得奖励饲料
 * - 任务失败/超时/放弃：扣信誉分
 * 
 * 注意：饲料.锁定已废弃，不再通过存储计数器锁定饲料，
 * 而是直接从任务集合统计实际 executing 任务数来计算可用饲料。
 * 下方的 锁定饲料/解锁饲料/扣除锁定饲料 函数已废弃，仅供参考。
 * 
 * === 饲料交易类型 ===
 * - 锁定: 抢任务时锁定饲料
 * - 解锁: 任务取消时解锁饲料
 * - 奖励: 任务成功获得奖励
 * - 扣除: 任务失败扣除锁定
 * - 充值: 饲养员充值
 * - 提现: 鸽子提现
 * 
 * === 饲料结算 ===
 * 单鸽子独占原则：一个任务只有一只鸽子，结算时直接奖励该鸽子
 */

import { getAdminDb, createTimestampFields, getTimestamp } from './db.js';
import { ObjectId } from 'mongodb';
import { logger } from './core.js';

// ==================== 常量定义 ====================

/**
 * 饲料系统边界常量
 * 防止整数溢出和负数操作
 */
const FEED_LIMITS = {
  MIN_BALANCE: 0,        // 最小余额（不能为负）
  MAX_BALANCE: 1000000,  // 最大余额（100万，防止溢出）
  MAX_LOCKED: 10000,     // 最大锁定量
  MAX_TRANSACTION: 10000 // 单次交易上限
};

/**
 * 饲料交易类型
 */
export const 饲料交易类型 = {
  锁定: '锁定',       // 抢任务时锁定
  解锁: '解锁',       // 任务取消解锁
  奖励: '奖励',       // 任务成功奖励
  扣除: '扣除',       // 任务失败扣除
  充值: '充值',       // 饲养员充值
  提现: '提现',       // 鸽子提现
  赠送: '赠送'        // 新鸽子赠送
};

// ==================== 常量定义 ====================

/**
 * 默认锁定饲料量
 */
const 默认锁定量 = 1;

// ==================== 饲料账户操作 ====================

/**
 * 获取鸽子饲料账户信息
 * 注意：饲料.锁定已废弃，可用饲料由实际执行中的任务数决定
 * @param {string} 鸽子ID - 鸽子ID
 * @returns {Object|null} 饲料账户信息
 */
export async function 获取饲料账户(鸽子ID) {
  const adminDb = getAdminDb();
  const 鸽子 = await adminDb.collection('鸽子身份').findOne(
    { 鸽子ID },
    { projection: { 饲料: 1, 信誉分: 1 } }
  );
  
  if (!鸽子) {
    return null;
  }
  
  return {
    余额: 鸽子.饲料?.余额 || 0,
    累计获得: 鸽子.饲料?.累计获得 || 0,
    信誉分: 鸽子.信誉分 || 100
  };
}

/**
 * 检查饲料是否足够
 * 注意：可用饲料由实际执行中的任务数决定，此处仅检查余额
 * @param {string} 鸽子ID - 鸽子ID
 * @param {number} 数量 - 需要的数量
 * @returns {Object} { 可用: boolean, 余额: number }
 */
export async function 检查饲料(鸽子ID, 数量 = 默认锁定量) {
  const 账户 = await 获取饲料账户(鸽子ID);
  
  if (!账户) {
    return { 可用: false, 原因: '鸽子不存在' };
  }
  
  if (账户.余额 < 数量) {
    return { 
      可用: false, 
      原因: '饲料不足',
      余额: 账户.余额,
      需要: 数量
    };
  }
  
  return { 
    可用: true, 
    余额: 账户.余额
  };
}

/**
 * 锁定饲料（抢任务时调用）
 * 原子操作：直接 updateOne 条件判断+锁定，不依赖前置 findOne
 * @param {string} 鸽子ID - 鸽子ID
 * @param {string} 任务ID - 任务ID
 * @param {number} 数量 - 锁定数量
 * @returns {Object} { 成功: boolean, 交易ID?: string }
 */
export async function 锁定饲料(鸽子ID, 任务ID, 数量 = 默认锁定量) {
  const adminDb = getAdminDb();
  const ts = createTimestampFields();
  
  // 边界检查
  if (数量 <= 0) {
    return { 成功: false, 原因: '锁定数量必须大于0' };
  }
  if (数量 > FEED_LIMITS.MAX_TRANSACTION) {
    return { 成功: false, 原因: `锁定数量不能超过${FEED_LIMITS.MAX_TRANSACTION}` };
  }
  
  // 原子操作：条件判断+锁定一步完成
  // 条件1：余额 >= 数量（确认可用余额足够）
  // 条件2：锁定量+新增 <= MAX_LOCKED（防止锁定量溢出）
  const result = await adminDb.collection('鸽子身份').updateOne(
    { 
      鸽子ID,
      '饲料.余额': { $gte: 数量 },  // 余额足够
      $expr: { $lte: [{ $add: ['$饲料.锁定', 数量] }, FEED_LIMITS.MAX_LOCKED] }  // 防止锁定量溢出
    },
    {
      $inc: { '饲料.锁定': 数量 }
    }
  );
  
  if (result.matchedCount === 0) {
    return { 成功: false, 原因: '饲料不足或鸽子不存在' };
  }
  
  // 记录交易
  const 交易ID = new ObjectId().toString();
  await adminDb.collection('饲料交易').insertOne({
    饲料ID: 交易ID,
    鸽子ID,
    任务ID,
    类型: 饲料交易类型.锁定,
    数量,
    创建时间: ts.localTime,
    创建时间戳: ts.timestamp
  });
  
  logger.info(`饲料锁定: 鸽子 ${鸽子ID} 锁定 ${数量} 点饲料，任务 ${任务ID}`);
  
  return { 成功: true, 交易ID };
}

/**
 * 解锁饲料（任务取消时调用）
 * @param {string} 鸽子ID - 鸽子ID
 * @param {string} 任务ID - 任务ID
 * @param {number} 数量 - 解锁数量
 * @returns {Object} { 成功: boolean }
 */
export async function 解锁饲料(鸽子ID, 任务ID, 数量 = 默认锁定量) {
  const adminDb = getAdminDb();
  const ts = createTimestampFields();
  
  // 原子操作：解锁饲料（减少锁定，增加余额）
  const result = await adminDb.collection('鸽子身份').updateOne(
    { 
      鸽子ID,
      '饲料.锁定': { $gte: 数量 }
    },
    {
      $inc: { '饲料.锁定': -数量, '饲料.余额': 数量 }
    }
  );
  
  if (result.matchedCount === 0) {
    return { 成功: false, 原因: '锁定饲料不足' };
  }
  
  // 记录交易
  const 交易ID = new ObjectId().toString();
  await adminDb.collection('饲料交易').insertOne({
    饲料ID: 交易ID,
    鸽子ID,
    任务ID,
    类型: 饲料交易类型.解锁,
    数量,
    创建时间: ts.localTime,
    创建时间戳: ts.timestamp
  });
  
  logger.info(`饲料解锁: 鸽子 ${鸽子ID} 解锁 ${数量} 点饲料，任务 ${任务ID}`);
  
  return { 成功: true, 交易ID };
}

/**
 * 扣除锁定饲料（任务失败/超时/放弃时调用）
 * 原子操作：findOneAndUpdate 先获取当前锁定量再清零，避免并发读取过时数据
 * @param {string} 鸽子ID - 鸽子ID
 * @param {string} 任务ID - 任务ID
 * @param {string} 原因 - 扣除原因
 * @returns {Object} { 成功: boolean }
 */
export async function 扣除锁定饲料(鸽子ID, 任务ID, 原因 = '任务失败') {
  const adminDb = getAdminDb();
  const ts = createTimestampFields();
  
  // 原子操作：获取当前锁定量并清零
  const 鸽子 = await adminDb.collection('鸽子身份').findOneAndUpdate(
    { 鸽子ID, '饲料.锁定': { $gt: 0 } },
    { $set: { '饲料.锁定': 0 } },
    { returnDocument: 'before' }
  );
  
  if (!鸽子) {
    // 可能鸽子不存在，或无锁定饲料
    const exists = await adminDb.collection('鸽子身份').findOne({ 鸽子ID }, { projection: { '饲料.锁定': 1 } });
    if (!exists) return { 成功: false, 原因: '鸽子不存在' };
    if (!exists.饲料?.锁定) return { 成功: false, 原因: '无锁定饲料' };
    // 极端情况：并发导致锁定已被清零，视为成功
    return { 成功: true, 交易ID: null, 扣除数量: 0, 并发冲突: true };
  }
  
  const 锁定量 = 鸽子.饲料?.锁定 || 0;
  // 注意：余额不返还，直接扣除锁定部分
  
  // 记录交易
  const 交易ID = new ObjectId().toString();
  await adminDb.collection('饲料交易').insertOne({
    饲料ID: 交易ID,
    鸽子ID,
    任务ID,
    类型: 饲料交易类型.扣除,
    数量: 锁定量,
    原因,
    创建时间: ts.localTime,
    创建时间戳: ts.timestamp
  });
  
  logger.info(`饲料扣除: 鸽子 ${鸽子ID} 扣除 ${锁定量} 点锁定饲料，原因: ${原因}`);
  
  return { 成功: true, 交易ID, 扣除数量: 锁定量 };
}

// ==================== 饲料结算 ====================

/**
 * 结算任务饲料（任务成功完成时调用）
 * 原子操作：先 findOneAndUpdate 清零锁定获取锁定量，再 updateOne 原子加余额（带溢出保护）
 * @param {string} 鸽子ID - 鸽子ID
 * @param {string} 任务ID - 任务ID
 * @param {number} 奖励数量 - 奖励饲料数量
 * @param {string} 分配模式 - winner/split/tiered
 * @returns {Object} { 成功: boolean, 获得饲料: number }
 */
export async function 结算饲料(鸽子ID, 任务ID, 奖励数量) {
  const adminDb = getAdminDb();
  const ts = createTimestampFields();
  
  // 边界检查
  if (奖励数量 < 0) {
    return { 成功: false, 原因: '奖励数量不能为负' };
  }
  if (奖励数量 > FEED_LIMITS.MAX_TRANSACTION) {
    return { 成功: false, 原因: `奖励数量不能超过${FEED_LIMITS.MAX_TRANSACTION}` };
  }
  
  // 原子操作1：清零锁定并获取当前锁定量
  const 鸽子 = await adminDb.collection('鸽子身份').findOneAndUpdate(
    { 鸽子ID, '饲料.锁定': { $gte: 0 } },
    { $set: { '饲料.锁定': 0 } },
    { returnDocument: 'before' }
  );
  
  if (!鸽子) {
    return { 成功: false, 原因: '鸽子不存在' };
  }
  
  const 锁定量 = 鸽子.饲料?.锁定 || 0;
  const 获得饲料 = 锁定量 + 奖励数量;
  
  // 原子操作2：增加余额（带溢出保护）
  if (获得饲料 > 0) {
    const 余额更新 = await adminDb.collection('鸽子身份').updateOne(
      { 鸽子ID, '饲料.余额': { $lte: FEED_LIMITS.MAX_BALANCE - 获得饲料 } },
      {
        $inc: { 
          '饲料.余额': 获得饲料,
          '饲料.累计获得': 奖励数量
        }
      }
    );
    
    if (余额更新.matchedCount === 0) {
      // 余额溢出，只返还锁定不加奖励
      await adminDb.collection('鸽子身份').updateOne(
        { 鸽子ID },
        { $inc: { '饲料.余额': 锁定量 } }
      );
      logger.warn(`饲料结算警告: 鸽子 ${鸽子ID} 余额已达上限，奖励 ${奖励数量} 未发放`);
      return { 成功: true, 交易ID: null, 获得饲料: 锁定量, 奖励数量: 0, 解锁数量: 锁定量, 余额警告: true };
    }
  }
  
  // 记录交易
  const 交易ID = new ObjectId().toString();
  await adminDb.collection('饲料交易').insertOne({
    饲料ID: 交易ID,
    鸽子ID,
    任务ID,
    类型: 饲料交易类型.奖励,
    数量: 奖励数量,
    解锁数量: 锁定量,
    创建时间: ts.localTime,
    创建时间戳: ts.timestamp
  });
  
  logger.info(`饲料结算: 鸽子 ${鸽子ID} 获得饲料 ${获得饲料} 点（奖励 ${奖励数量} + 解锁 ${锁定量}）`);
  
  return { 成功: true, 交易ID, 获得饲料, 奖励数量, 解锁数量: 锁定量 };
}

// ==================== 饲料充值/提现 ====================

/**
 * 鸽子饲料充值
 * @param {string} 鸽子ID - 鸽子ID
 * @param {number} 数量 - 充值数量
 * @param {string} 来源 - 充值来源
 * @returns {Object} { 成功: boolean }
 */
export async function 充值饲料(鸽子ID, 数量, 来源 = '饲养员充值') {
  const adminDb = getAdminDb();
  const ts = createTimestampFields();
  
  // 边界检查
  if (数量 <= 0) {
    return { 成功: false, 原因: '充值数量必须大于0' };
  }
  if (数量 > FEED_LIMITS.MAX_TRANSACTION) {
    return { 成功: false, 原因: `单次充值不能超过${FEED_LIMITS.MAX_TRANSACTION}` };
  }
  
  // 原子操作 + 边界检查（防止溢出）
  const result = await adminDb.collection('鸽子身份').updateOne(
    { 
      鸽子ID,
      '饲料.余额': { $lte: FEED_LIMITS.MAX_BALANCE - 数量 }  // 防止溢出
    },
    {
      $inc: { 
        '饲料.余额': 数量,
        '饲料.累计获得': 数量
      }
    }
  );
  
  if (result.matchedCount === 0) {
    return { 成功: false, 原因: '余额已达上限或鸽子不存在' };
  }
  
  // 记录交易
  const 交易ID = new ObjectId().toString();
  await adminDb.collection('饲料交易').insertOne({
    饲料ID: 交易ID,
    鸽子ID,
    类型: 饲料交易类型.充值,
    数量,
    来源,
    创建时间: ts.localTime,
    创建时间戳: ts.timestamp
  });
  
  logger.info(`饲料充值: 鸽子 ${鸽子ID} 充值 ${数量} 点，来源: ${来源}`);
  
  return { 成功: true, 交易ID };
}

/**
 * 获取饲料交易记录
 * @param {string} 鸽子ID - 鸽子ID
 * @param {number} 限制 - 返回条数限制
 * @returns {Array} 交易记录列表
 */
export async function 获取饲料交易记录(鸽子ID, 限制 = 50) {
  const adminDb = getAdminDb();
  
  const 记录 = await adminDb.collection('饲料交易')
    .find({ 鸽子ID })
    .sort({ 创建时间戳: -1 })
    .limit(限制)
    .toArray();
  
  return 记录;
}

export default {
  饲料交易类型,
  FEED_LIMITS,
  获取饲料账户,
  检查饲料,
  锁定饲料,
  解锁饲料,
  扣除锁定饲料,
  结算饲料,
  充值饲料,
  获取饲料交易记录
};
