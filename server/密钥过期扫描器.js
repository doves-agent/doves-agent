/**
 * API 密钥过期扫描器
 * 
 * 职责：
 * - 定期扫描即将过期/已过期的 API 密钥
 * - 自动标记已过期密钥
 * - 即将过期（7天内）通过日志预警
 */

import { getAdminDb } from './db.js';
import { logger } from './core.js';

let scanInterval = null;

/**
 * 执行一次过期扫描
 */
export async function scanExpiredKeys() {
  try {
    const adminDb = getAdminDb();
    const now = new Date();

    // 1. 标记已过期但状态仍为"活跃"的密钥
    const expiredResult = await adminDb.collection('API密钥').updateMany(
      { 状态: '活跃', 过期时间: { $lt: now } },
      { $set: { 状态: '已过期' } }
    );

    if (expiredResult.modifiedCount > 0) {
      logger.warn(`[密钥扫描] ${expiredResult.modifiedCount} 个API密钥已过期并标记`);
    }

    // 2. 查找即将过期（7天内）的密钥，记录预警
    const warningDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const expiringKeys = await adminDb.collection('API密钥').find({
      状态: '活跃',
      过期时间: { $gt: now, $lt: warningDate }
    }).project({ keyId: 1, 鸽子ID: 1, 用户ID: 1, 过期时间: 1 })
      .toArray();

    for (const key of expiringKeys) {
      const daysLeft = Math.ceil((new Date(key.过期时间) - now) / (24 * 60 * 60 * 1000));
      logger.warn(`[密钥扫描] 鸽子 ${key.鸽子ID} 的API密钥将在${daysLeft}天后过期`);
    }

  } catch (e) {
    logger.error(`[密钥扫描] 扫描失败: ${e.message}`);
  }
}

/**
 * 启动定期扫描
 * @param {number} intervalMs - 扫描间隔（默认1小时）
 */
export function startKeyExpiryScanner(intervalMs = 60 * 60 * 1000) {
  // 立即执行一次
  scanExpiredKeys();

  scanInterval = setInterval(scanExpiredKeys, intervalMs);
  // 不阻止进程退出
  if (scanInterval.unref) scanInterval.unref();

  logger.info(`[密钥扫描] 已启动，间隔 ${intervalMs / 1000 / 60} 分钟`);
}

/**
 * 停止扫描
 */
export function stopKeyExpiryScanner() {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
}

export default { scanExpiredKeys, startKeyExpiryScanner, stopKeyExpiryScanner };
