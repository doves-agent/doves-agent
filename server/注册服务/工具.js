/**
 * 白鸽注册工具函数模块
 * 职责：鸽子ID生成、API密钥生成、饲料账户初始化、存储目录创建
 * 
 * 从 server/白鸽注册服务.js 拆分，遵循KISS原则
 */

import { getAdminDb, createTimestampFields } from '../db.js';
import { logger } from '../core.js';
import { 创建目录 } from '../storage-permission.js';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { 获取或生成机器标识, 生成分组标识 } from '../../common/机器标识.js';
import { DEFAULT_CONFIG } from '../registration/config.js';

/**
 * 生成鸽子ID
 * 使用统一设备前缀格式：{os}_{hash}_dove_{index}
 * 如 win_48e77d00_dove_0
 * 
 * @param {string} [machineId] - 机器标识，不传则自动获取
 * @param {number} [index=0] - 实例序号
 * @returns {string} 鸽子ID
 */
export function generateDoveId(machineId, index = 0) {
  const mid = machineId || 获取或生成机器标识();
  return 生成分组标识(mid, 'dove', index);
}

/**
 * 生成API密钥
 * 格式: sk_{doveId}_{secret}
 */
export function generateApiKey(doveId) {
  const secret = randomBytes(24).toString('hex');
  const apiKey = `sk_${doveId}_${secret}`;
  return {
    apiKey,
    keyId: doveId,
    keySecret: secret
  };
}

/**
 * 哈希密钥部分
 */
export async function hashKeySecret(secret) {
  const saltRounds = 12;
  return bcrypt.hash(secret, saltRounds);
}

/**
 * 创建鸽子饲料账户并赠送初始饲料
 */
export async function 初始化饲料账户(doveId, 初始饲料) {
  const adminDb = getAdminDb();
  const ts = createTimestampFields();
  
  try {
    const 交易ID = randomBytes(12).toString('hex');
    
    await adminDb.collection('饲料交易').insertOne({
      饲料ID: 交易ID,
      鸽子ID: doveId,
      类型: '赠送',
      数量: 初始饲料,
      来源: '新鸽子注册赠送',
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp
    });
    
    logger.info(`饲料账户初始化: 鸽子 ${doveId} 获赠 ${初始饲料} 点饲料`);
    return { 成功: true, 交易ID };
  } catch (错误) {
    logger.error(`初始化饲料账户失败: ${错误.message}`);
    return { 成功: false, 错误: 错误.message };
  }
}

/**
 * 创建鸽子Git存储空间（注册时自动初始化）
 */
export async function 创建鸽子存储目录(doveId, 饲养员ID, 配置 = {}) {
  // Git存储空间在首次访问时按需创建，注册时无需预创建
  logger.info(`鸽子 ${doveId} Git存储将在首次使用时自动初始化`);
  return { 成功: true, status: 'deferred', reason: 'Git存储按需初始化' };
}
