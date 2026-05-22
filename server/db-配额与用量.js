/**
 * @file server/db-配额与用量
 * @description 数据库配额管理与 Token 用量持久化
 * 
 * 从 db.js 拆分，KISS 原则
 * 职责：
 * 1. 用户资源配额管理（查询/检查/更新/告警）
 * 2. Token 用量记录与查询
 */

import { createTimestampFields } from '../common/时间工具.js';
import { QUOTAS, logger } from './core.js';

// ==================== 配额管理 ====================

/**
 * 获取用户资源使用统计（从用户记录读取）
 * @param {Object} adminDb - 管理员数据库实例
 * @param {string} userId - 用户ID
 */
export async function getUserQuotaStats(adminDb, userId) {
  if (!adminDb) {
    return {
      usage: {},
      totalDocs: 0,
      limits: QUOTAS.documents,
      percentages: {}
    };
  }
  
  const user = await adminDb.collection('用户').findOne({ 用户ID: userId });
  if (!user) {
    return {
      usage: {},
      totalDocs: 0,
      limits: QUOTAS.documents,
      percentages: {}
    };
  }
  
  const quotaData = user.配额 || { 已用: {}, 上限: {} };
  const usage = quotaData.已用 || {};
  const limits = quotaData.上限 || QUOTAS.documents;
  
  return {
    usage,
    totalDocs: Object.values(usage).reduce((a, b) => a + b, 0),
    limits,
    percentages: Object.fromEntries(
      Object.entries(usage).map(([k, v]) => [k, limits[k] ? Math.round(v / limits[k] * 100) : 0])
    )
  };
}

/**
 * 检查文档大小是否超限
 */
export function checkDocumentSize(doc) {
  const size = Buffer.byteLength(JSON.stringify(doc));
  if (size > QUOTAS.maxDocumentSize) {
    return { ok: false, size, limit: QUOTAS.maxDocumentSize };
  }
  return { ok: true, size };
}

/**
 * 检查用户配额（从用户记录读取）
 */
export async function checkCollectionQuota(adminDb, collection, userId) {
  if (!adminDb) return { ok: true, collection };
  
  const user = await adminDb.collection('用户').findOne({ 用户ID: userId });
  if (!user) return { ok: true, collection };
  
  const usage = user.配额?.已用?.[collection] || 0;
  const limit = user.配额?.上限?.[collection] || QUOTAS.documents[collection] || 1000;
  
  if (usage >= limit) {
    return {
      ok: false,
      collection,
      current: usage,
      limit,
      error: `配额已满: ${collection} 最多 ${limit} 条`
    };
  }
  
  return { ok: true, current: usage, limit, collection };
}

/**
 * 从用户记录获取配额统计（不再查询集合）
 */
export async function getUserQuotaStatsForUser(db, userId, adminDb) {
  const user = await adminDb.collection('用户').findOne({ 用户ID: userId });
  if (!user) {
    return {
      usage: { '任务': 0, '对话': 0, '文件元数据': 0 },
      totalDocs: 0,
      limits: QUOTAS.documents,
      percentages: { '任务': 0, '对话': 0, '文件元数据': 0 }
    };
  }
  
  const quotaData = user.配额 || { 已用: {}, 上限: {} };
  const usage = quotaData.已用 || { '任务': 0, '对话': 0, '文件元数据': 0 };
  const limits = quotaData.上限 || QUOTAS.documents;
  
  return {
    usage,
    totalDocs: Object.values(usage).reduce((a, b) => a + b, 0),
    limits,
    percentages: Object.fromEntries(
      Object.entries(usage).map(([k, v]) => [k, limits[k] ? Math.round(v / limits[k] * 100) : 0])
    )
  };
}

/**
 * 更新用户配额使用量
 * @param {string} userId - 用户ID
 * @param {string} collection - 集合名（tasks/conversations/file_meta/dove_contexts）
 * @param {number} delta - 变化量（+1 或 -1）
 */
export async function updateUserQuota(adminDb, userId, collection, delta) {
  if (!adminDb) return;
  
  const fieldName = `配额.已用.${collection}`;
  await adminDb.collection('用户').updateOne(
    { 用户ID: userId },
    { $inc: { [fieldName]: delta } }
  );
}

/**
 * 检查用户配额是否触发告警
 * @param {string} userId - 用户ID
 * @returns {Promise<Array>} 告警列表 [{ type, category, percentage, message }]
 */
export async function 检查配额告警(adminDb, userId) {
  if (!adminDb) return [];
  
  const 告警阈值 = [80, 90, 95, 100];
  const 告警列表 = [];
  
  try {
    const user = await adminDb.collection('用户').findOne(
      { 用户ID: userId },
      { projection: { 配额: 1 } }
    );
    
    if (!user?.配额) return [];
    
    const { 已用 = {}, 上限 = {} } = user.配额;
    
    for (const [category, usage] of Object.entries(已用)) {
      const limit = 上限[category];
      if (!limit || limit <= 0) continue;
      
      const percentage = Math.round(usage / limit * 100);
      
      // 找到触发的最高阈值
      for (const threshold of 告警阈值) {
        if (percentage >= threshold) {
          告警列表.push({
            type: threshold >= 100 ? 'quota_exceeded' : 'quota_warning',
            category,
            percentage,
            usage,
            limit,
            threshold,
            message: threshold >= 100
              ? `${category}配额已超限（${usage}/${limit}）`
              : `${category}配额已达${percentage}%（${usage}/${limit}）`
          });
          break; // 每个类别只取最高阈值
        }
      }
    }
  } catch (e) {
    logger.error('检查配额告警失败:', e.message);
    throw e;
  }
  
  return 告警列表;
}

// ==================== Token 用量持久化 ====================

/**
 * 记录一次 Token 用量到 用量记录 集合
 * @param {Object} userDb - 用户数据库实例
 * @param {Object} 记录 - { userId, doveId, taskId, model, provider, inputTokens, outputTokens, cost, timestamp }
 * @returns {Promise<boolean>}
 */
export async function 记录Token用量(userDb, 记录) {
  if (!userDb) return false;

  try {
    const ts = createTimestampFields();
    await userDb.collection('用量记录').insertOne({
      ...记录,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp,
    });
    return true;
  } catch (e) {
    logger.error('记录Token用量失败:', e.message);
    return false;
  }
}

/**
 * 查询 Token 用量（按 用户/模型/时间段 聚合）
 * @param {Object} userDb - 用户数据库实例
 * @param {Object} 参数 - { userId, startDate, endDate, groupBy }
 *   groupBy: 'model' | 'provider' | 'day' | null(明细)
 * @returns {Promise<Object>}
 */
export async function 查询Token用量(userDb, 参数) {
  if (!userDb) return { success: false, error: '数据库未连接' };

  const { userId, startDate, endDate, groupBy } = 参数;
  const match = {};

  if (userId) match.userId = userId;
  if (startDate || endDate) {
    match.创建时间戳 = {};
    if (startDate) match.创建时间戳.$gte = startDate;
    if (endDate) match.创建时间戳.$lte = endDate;
  }

  try {
    // 无分组时返回明细
    if (!groupBy) {
      const records = await userDb.collection('用量记录')
        .find(match)
        .sort({ 创建时间戳: -1 })
        .limit(100)
        .toArray();
      return { success: true, data: records, total: records.length };
    }

    // 按指定维度聚合
    let groupId;
    switch (groupBy) {
      case 'model':
        groupId = { provider: '$provider', model: '$model' };
        break;
      case 'provider':
        groupId = '$provider';
        break;
      case 'day':
        groupId = { $dateToString: { format: '%Y-%m-%d', date: '$创建时间' } };
        break;
      default:
        groupId = '$model';
    }

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: groupId,
          totalInput: { $sum: '$inputTokens' },
          totalOutput: { $sum: '$outputTokens' },
          totalCost: { $sum: '$cost' },
          callCount: { $sum: 1 },
        },
      },
      { $sort: { totalCost: -1 } },
    ];

    const results = await userDb.collection('用量记录').aggregate(pipeline).toArray();
    return { success: true, data: results };
  } catch (e) {
    logger.error('查询Token用量失败:', e.message);
    return { success: false, error: e.message };
  }
}
