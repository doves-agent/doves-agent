/**
 * 审计日志模块
 * 
 * 职责：记录所有权限代理操作的审计日志
 * 
 * === 设计原则 ===
 * - 批量写入优化：内存缓冲 + 定时刷盘
 * - 不阻塞主流程：写入失败只记录警告
 * - 最小权限审计：只记录关键操作（认证、数据访问、权限变更）
 * 
 * === 审计记录结构 ===
 * {
 *   操作者ID: string,         // 用户ID或鸽子ID
 *   操作者类型: string,       // 'user' | 'dove' | 'admin'
 *   操作: string,             // 操作类型（login/find/insertOne/updateOne/deleteOne等）
 *   集合: string,             // 访问的集合名
 *   目标ID: string|null,      // 操作目标文档ID
 *   结果: string,             // 'success' | 'denied' | 'error'
 *   时间戳: number,           // 毫秒时间戳
 *   时间: string,             // ISO本地时间
 *   详情: object|null         // 额外信息（错误原因等）
 * }
 */

import { getAdminDb } from './db.js';
import { toLocalISOString, getTimestamp } from '../common/时间工具.js';
import { logger } from './core.js';

// ==================== 配置 ====================

/** 缓冲区最大条数（达到此数量立即刷盘） */
const MAX_BUFFER_SIZE = 100;

/** 定时刷盘间隔（毫秒） */
const FLUSH_INTERVAL = 5000;

// ==================== 缓冲区 ====================

/** 内存缓冲区 */
const buffer = [];

/** 定时器引用 */
let flushTimer = null;

/** 是否已初始化 */
let initialized = false;

// ==================== 核心函数 ====================

/**
 * 初始化审计日志模块
 * - 启动定时刷盘
 * - 索引由 数据库初始化.js 统一管理，此处不再重复创建
 */
export async function 初始化审计日志() {
  if (initialized) return;
  
  try {
    // 启动定时刷盘
    flushTimer = setInterval(刷盘, FLUSH_INTERVAL);
    // 允许进程正常退出（定时器不阻止退出）
    if (flushTimer.unref) flushTimer.unref();
    
    initialized = true;
    logger.info(`[审计日志] 初始化完成（缓冲区上限 ${MAX_BUFFER_SIZE}，刷盘间隔 ${FLUSH_INTERVAL / 1000}s）`);
  } catch (e) {
    logger.error('[审计日志] 初始化失败:', e.message);
  }
}

/**
 * 记录审计日志（写入缓冲区）
 * 
 * @param {Object} 记录 - 审计记录
 * @param {string} 记录.操作者ID - 操作者ID
 * @param {string} 记录.操作者类型 - 'user' | 'dove' | 'admin'
 * @param {string} 记录.操作 - 操作类型
 * @param {string} [记录.集合] - 集合名
 * @param {string} [记录.目标ID] - 目标文档ID
 * @param {string} 记录.结果 - 'success' | 'denied' | 'error'
 * @param {Object} [记录.详情] - 额外信息
 */
export function 记录审计(记录) {
  const now = Date.now();
  buffer.push({
    操作者ID: 记录.操作者ID || 'unknown',
    操作者类型: 记录.操作者类型 || 'user',
    操作: 记录.操作 || 'unknown',
    集合: 记录.集合 || null,
    目标ID: 记录.目标ID || null,
    结果: 记录.结果 || 'success',
    时间戳: now,
    时间: toLocalISOString(new Date(now)),
    详情: 记录.详情 || null
  });
  
  // 缓冲区满则立即刷盘
  if (buffer.length >= MAX_BUFFER_SIZE) {
    刷盘();
  }
}

/**
 * 批量刷盘：将缓冲区中的审计日志写入 MongoDB
 */
export async function 刷盘() {
  if (buffer.length === 0) return;
  
  // 取出缓冲区内容（非阻塞交换）
  const 批次 = buffer.splice(0, buffer.length);
  if (批次.length === 0) return;
  
  try {
    const db = getAdminDb();
    await db.collection('审计日志').insertMany(批次);
  } catch (e) {
    logger.warn('[审计日志] 刷盘失败（%d条）: %s', 批次.length, e.message);
    // 刷盘失败：丢弃这批日志（不回写缓冲区，避免内存泄漏）
    // 审计日志不是业务关键路径，丢失可接受
  }
}

/**
 * 关闭审计日志模块（刷盘剩余日志）
 */
export async function 关闭审计日志() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await 刷盘();
  initialized = false;
}

/**
 * 查询审计日志
 * 
 * @param {Object} 查询条件 - { 操作者ID, 操作, 集合, 结果, 起始时间, 结束时间 }
 * @param {number} 限制 - 返回条数，默认100
 * @returns {Promise<Array>} 审计日志列表
 */
export async function 查询审计日志(查询条件 = {}, 限制 = 100) {
  try {
    const db = getAdminDb();
    const filter = {};
    
    if (查询条件.操作者ID) filter.操作者ID = 查询条件.操作者ID;
    if (查询条件.操作) filter.操作 = 查询条件.操作;
    if (查询条件.集合) filter.集合 = 查询条件.集合;
    if (查询条件.结果) filter.结果 = 查询条件.结果;
    if (查询条件.起始时间 || 查询条件.结束时间) {
      filter.时间戳 = {};
      if (查询条件.起始时间) filter.时间戳.$gte = 查询条件.起始时间;
      if (查询条件.结束时间) filter.时间戳.$lte = 查询条件.结束时间;
    }
    
    return await db.collection('审计日志')
      .find(filter)
      .sort({ 时间戳: -1 })
      .limit(限制)
      .toArray();
  } catch (e) {
    logger.error('[审计日志] 查询失败:', e.message);
    return [];
  }
}

export default {
  初始化审计日志,
  记录审计,
  刷盘,
  关闭审计日志,
  查询审计日志
};
