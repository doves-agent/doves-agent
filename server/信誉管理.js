/**
 * 信誉系统模块
 * 职责：信誉评分、等级计算、变更记录
 * 
 * 【KISS原则文档的一部分】
 * 
 * === 信誉系统设计 ===
 * 
 * 信誉分范围：0-100
 * - 初始分：100（优秀）
 * - 最低分：0（禁用）
 * 
 * === 信誉等级 ===
 * - 优秀: 90-100，优先抢任务
 * - 良好: 70-89，正常抢任务
 * - 一般: 50-69，正常抢任务
 * - 较差: 30-49，限制抢任务
 * - 禁用: < 30，禁止抢任务
 * 
 * === 加分项 ===
 * - 任务成功: +5
 * - 快速响应（低于平均时间50%）: +2
 * - 高质量结果（饲养员好评）: +3
 * 
 * === 扣分项 ===
 * - 任务失败: -3
 * - 超时: -5
 * - 放弃任务: -2
 * - 恶意行为: -50（触发禁用）
 * 
 * 相关文档：../白鸽文档/design/任务分发机制.md
 */

import { getAdminDb, createTimestampFields, getTimestamp } from './db.js';
import { ObjectId } from 'mongodb';
import { logger } from './core.js';

// ==================== 常量定义 ====================

/**
 * 信誉等级配置
 */
export const 信誉等级配置 = {
  优秀: { 最小分: 90, 最大分: 100, 抢任务优先级: 1, 限制: null },
  良好: { 最小分: 70, 最大分: 89, 抢任务优先级: 2, 限制: null },
  一般: { 最小分: 50, 最大分: 69, 抢任务优先级: 3, 限制: null },
  较差: { 最小分: 30, 最大分: 49, 抢任务优先级: 4, 限制: { 最大并发: 2 } },
  禁用: { 最小分: 0, 最大分: 29, 抢任务优先级: 99, 限制: { 禁止抢任务: true } }
};

/**
 * 信誉变更类型
 */
export const 信誉变更类型 = {
  任务成功: '任务成功',
  任务失败: '任务失败',
  超时: '超时',
  放弃任务: '放弃任务',
  快速响应: '快速响应',
  高质量结果: '高质量结果',
  恶意行为: '恶意行为',
  系统调整: '系统调整'
};

/**
 * 信誉分值配置
 */
export const 信誉分值 = {
  [信誉变更类型.任务成功]: 5,
  [信誉变更类型.任务失败]: -3,
  [信誉变更类型.超时]: -5,
  [信誉变更类型.放弃任务]: -2,
  [信誉变更类型.快速响应]: 2,
  [信誉变更类型.高质量结果]: 3,
  [信誉变更类型.恶意行为]: -50
};

// ==================== 信誉等级计算 ====================

/**
 * 根据信誉分计算等级
 * @param {number} 分值 - 信誉分
 * @returns {string} 等级名称
 */
export function 计算信誉等级(分值) {
  if (分值 >= 90) return '优秀';
  if (分值 >= 70) return '良好';
  if (分值 >= 50) return '一般';
  if (分值 >= 30) return '较差';
  return '禁用';
}

/**
 * 获取信誉等级配置
 * @param {string} 等级 - 等级名称
 * @returns {Object} 等级配置
 */
export function 获取等级配置(等级) {
  return 信誉等级配置[等级] || 信誉等级配置.一般;
}

/**
 * 检查鸽子是否可以抢任务
 * @param {number} 信誉分 - 信誉分
 * @returns {Object} { 可以抢: boolean, 原因?: string, 限制?: Object }
 */
export function 检查抢任务权限(信誉分) {
  const 等级 = 计算信誉等级(信誉分);
  const 配置 = 获取等级配置(等级);
  
  if (配置.限制?.禁止抢任务) {
    return { 
      可以抢: false, 
      原因: '信誉分过低，已被禁用',
      等级,
      当前分: 信誉分,
      需要分: 30
    };
  }
  
  return { 
    可以抢: true, 
    等级,
    优先级: 配置.抢任务优先级,
    限制: 配置.限制
  };
}

// ==================== 信誉分操作 ====================

/**
 * 获取鸽子信誉信息
 * @param {string} 鸽子ID - 鸽子ID
 * @returns {Object|null} 信誉信息
 */
export async function 获取信誉信息(鸽子ID) {
  const adminDb = getAdminDb();
  const 鸽子 = await adminDb.collection('鸽子身份').findOne(
    { 鸽子ID },
    { projection: { 信誉分: 1, 信誉等级: 1, 统计: 1 } }
  );
  
  if (!鸽子) {
    return null;
  }
  
  const 信誉分 = 鸽子.信誉分 ?? 100;
  const 等级 = 鸽子.信誉等级 || 计算信誉等级(信誉分);
  
  return {
    信誉分,
    等级,
    统计: 鸽子.统计 || {},
    权限: 检查抢任务权限(信誉分)
  };
}

/**
 * 变更信誉分（原子操作）
 * 使用 findOneAndUpdate + $inc 原子增减，避免并发丢失更新
 * 0-100 范围约束通过查询条件实现：
 *   - 加分时：信誉分 <= 100 - 分值（防溢出）
 *   - 扣分时：信誉分 >= -分值（即信誉分 + 分值 >= 0，防负数）
 * @param {string} 鸽子ID - 鸽子ID
 * @param {string} 变更类型 - 变更类型
 * @param {string} 任务ID - 关联任务ID
 * @param {string} 备注 - 备注
 * @returns {Object} { 成功: boolean, 新信誉分?: number }
 */
export async function 变更信誉(鸽子ID, 变更类型, 任务ID = null, 备注 = '') {
  const adminDb = getAdminDb();
  const ts = createTimestampFields();
  
  // 获取分值
  const 分值 = 信誉分值[变更类型] || 0;
  if (分值 === 0) {
    return { 成功: false, 原因: '未知变更类型' };
  }
  
  // 原子操作：$inc + 范围约束条件
  // 加分时防溢出：信誉分 <= 100 - 分值
  // 扣分时防负数：信誉分 >= -分值（即 信誉分 + 分值 >= 0）
  const 范围条件 = {};
  if (分值 > 0) {
    范围条件.信誉分 = { $lte: 100 - 分值 };
  } else {
    范围条件.信誉分 = { $gte: -分值 };
  }
  
  // 先原子 $inc，用 returnDocument: 'after' 获取变更后值
  const 更新后 = await adminDb.collection('鸽子身份').findOneAndUpdate(
    { 鸽子ID, ...范围条件 },
    { 
      $inc: { 信誉分: 分值 },
      $set: { '统计.最后信誉变更': ts.localTime }
    },
    { returnDocument: 'after' }
  );
  
  if (!更新后) {
    // 可能是鸽子不存在，或范围条件不满足（已在边界外）
    // 检查鸽子是否存在
    const exists = await adminDb.collection('鸽子身份').findOne({ 鸽子ID }, { projection: { 信誉分: 1 } });
    if (!exists) {
      return { 成功: false, 原因: '鸽子不存在' };
    }
    // 鸽子存在但范围条件不满足，说明已在边界（如信誉分已达100还加分，或已为0还扣分）
    // 此时仍然记录日志，但实际值不变
    const 当前分 = exists.信誉分 ?? 100;
    const 新分值 = Math.max(0, Math.min(100, 当前分 + 分值));
    const 新等级 = 计算信誉等级(新分值);
    
    logger.info(`信誉变更(边界截断): 鸽子 ${鸽子ID} ${变更类型} ${分值 > 0 ? '+' : ''}${分值}，${当前分}→${新分值}（${新等级}）`);
    
    return { 成功: true, 日志ID: null, 变更前: 当前分, 变更后: 新分值, 变更分值: 分值, 新等级, 边界截断: true };
  }
  
  const 变更前 = 更新后.信誉分 - 分值;  // 从变更后值反推变更前
  const 新分值 = 更新后.信誉分;
  const 新等级 = 计算信誉等级(新分值);
  
  // 更新信誉等级（单独一步，因为等级依赖变更后的信誉分）
  if (计算信誉等级(变更前) !== 新等级) {
    await adminDb.collection('鸽子身份').updateOne(
      { 鸽子ID },
      { $set: { 信誉等级: 新等级 } }
    );
  }
  
  // 记录日志
  const 日志ID = new ObjectId().toString();
  await adminDb.collection('信誉日志').insertOne({
    日志ID: 日志ID,
    鸽子ID,
    任务ID,
    类型: 变更类型,
    变更分值: 分值,
    变更前,
    变更后: 新分值,
    等级变更: 计算信誉等级(变更前) !== 新等级 ? { 前: 计算信誉等级(变更前), 后: 新等级 } : null,
    备注,
    创建时间: ts.localTime,
    创建时间戳: ts.timestamp
  });
  
  logger.info(`信誉变更: 鸽子 ${鸽子ID} ${变更类型} ${分值 > 0 ? '+' : ''}${分值}，${变更前}→${新分值}（${新等级}）`);
  
  return { 
    成功: true, 
    日志ID,
    变更前,
    变更后: 新分值,
    变更分值: 分值,
    新等级
  };
}

/**
 * 任务成功：增加信誉
 * @param {string} 鸽子ID - 鸽子ID
 * @param {string} 任务ID - 任务ID
 * @param {boolean} 快速响应 - 是否快速响应
 * @param {boolean} 高质量 - 是否高质量
 */
export async function 任务成功加分(鸽子ID, 任务ID, 快速响应 = false, 高质量 = false) {
  const 结果列表 = [];
  
  // 任务成功 +5
  const 结果1 = await 变更信誉(鸽子ID, 信誉变更类型.任务成功, 任务ID);
  结果列表.push(结果1);
  
  // 快速响应 +2
  if (快速响应) {
    const 结果2 = await 变更信誉(鸽子ID, 信誉变更类型.快速响应, 任务ID, '响应时间低于平均50%');
    结果列表.push(结果2);
  }
  
  // 高质量结果 +3
  if (高质量) {
    const 结果3 = await 变更信誉(鸽子ID, 信誉变更类型.高质量结果, 任务ID, '饲养员好评');
    结果列表.push(结果3);
  }
  
  return 结果列表;
}

/**
 * 任务失败：减少信誉
 * @param {string} 鸽子ID - 鸽子ID
 * @param {string} 任务ID - 任务ID
 * @param {string} 失败原因 - 失败原因
 */
export async function 任务失败扣分(鸽子ID, 任务ID, 失败原因 = '') {
  return await 变更信誉(鸽子ID, 信誉变更类型.任务失败, 任务ID, 失败原因);
}

/**
 * 任务超时：减少信誉
 * @param {string} 鸽子ID - 鸽子ID
 * @param {string} 任务ID - 任务ID
 */
export async function 任务超时扣分(鸽子ID, 任务ID) {
  return await 变更信誉(鸽子ID, 信誉变更类型.超时, 任务ID, '任务执行超时');
}

/**
 * 放弃任务：减少信誉
 * @param {string} 鸽子ID - 鸽子ID
 * @param {string} 任务ID - 任务ID
 * @param {string} 原因 - 放弃原因
 */
export async function 放弃任务扣分(鸽子ID, 任务ID, 原因 = '') {
  return await 变更信誉(鸽子ID, 信誉变更类型.放弃任务, 任务ID, 原因);
}

/**
 * 恶意行为：大幅扣分
 * @param {string} 鸽子ID - 鸽子ID
 * @param {string} 原因 - 恶意行为原因
 */
export async function 恶意行为扣分(鸽子ID, 原因) {
  const 结果 = await 变更信誉(鸽子ID, 信誉变更类型.恶意行为, null, 原因);
  
  // 如果信誉分降到禁用线以下，更新状态
  if (结果.新分值 < 30) {
    const adminDb = getAdminDb();
    await adminDb.collection('鸽子身份').updateOne(
      { 鸽子ID },
      { $set: { 状态: '禁用' } }
    );
    logger.warn(`鸽子 ${鸽子ID} 因恶意行为被禁用: ${原因}`);
  }
  
  return 结果;
}

// ==================== 信誉日志查询 ====================

/**
 * 获取信誉变更日志
 * @param {string} 鸽子ID - 鸽子ID
 * @param {number} 限制 - 返回条数
 * @returns {Array} 日志列表
 */
export async function 获取信誉日志(鸽子ID, 限制 = 50) {
  const adminDb = getAdminDb();
  
  const 日志 = await adminDb.collection('信誉日志')
    .find({ 鸽子ID })
    .sort({ 创建时间戳: -1 })
    .limit(限制)
    .toArray();
  
  return 日志;
}

/**
 * 获取信誉排行榜
 * @param {number} 限制 - 返回条数
 * @returns {Array} 排行榜
 */
export async function 获取信誉排行榜(限制 = 10) {
  const adminDb = getAdminDb();
  
  const 排行 = await adminDb.collection('鸽子身份')
    .find({ 状态: { $ne: '禁用' } })
    .sort({ 信誉分: -1 })
    .limit(限制)
    .project({ 鸽子ID: 1, 名称: 1, 信誉分: 1, 信誉等级: 1, '统计.完成任务数': 1 })
    .toArray();
  
  return 排行;
}

export default {
  信誉等级配置,
  信誉变更类型,
  信誉分值,
  计算信誉等级,
  获取等级配置,
  检查抢任务权限,
  获取信誉信息,
  变更信誉,
  任务成功加分,
  任务失败扣分,
  任务超时扣分,
  放弃任务扣分,
  恶意行为扣分,
  获取信誉日志,
  获取信誉排行榜
};
