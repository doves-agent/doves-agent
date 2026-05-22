/**
 * 数据库初始化模块
 * 
 * 【KISS原则文档的一部分】
 * 
 * === 职责 ===
 * 服务端启动时自动检查并初始化数据库：
 * 1. 确保所有必需集合存在
 * 2. 创建/校验所有索引
 * 3. 初始化种子数据
 * 4. 校验数据一致性
 * 
 * === 设计原则 ===
 * - 幂等操作：重复执行不会产生副作用
 * - 优雅降级：权限不足时警告而非崩溃
 * - 全量管理：所有集合、索引、种子数据在此统一声明
 * - 中文字段：严格遵循中文字段命名规范
 * 
 * === 集合分配 ===
 * 管理库 (doves_admin):
 *   用户、鸽子身份、API密钥、饲料交易、信誉日志、
 *   能力、能力刷新记录、能力变更队列、目录权限、
 *   系统配置、管理员、审计日志
 * 
 * 用户库 (doves_user_data):
 *   任务、对话、技能、执行配置、执行轨迹、事件
 */

import { logger } from './core.js';
import { toLocalISOString, createTimestampFields } from '../common/时间工具.js';
import { ADMIN_COLLECTIONS, USER_COLLECTIONS } from './db-collections.js';

// 集合定义已提取到 db-collections.js
// 包含 ADMIN_COLLECTIONS, USER_COLLECTIONS

// ==================== 种子数据 ====================

/**
 * 必须存在的种子数据定义
 * 启动时检查，不存在则创建
 */
const SEED_DATA = {
  admin: [
    {
      集合: '管理员',
      查询: { 用户ID: 'system_dove' },
      数据: {
        用户ID: 'system_dove',
        用户名: 'system_dove',
        状态: '活跃',
        角色: 'admin',
        描述: '系统管理员（聚合模式自动创建）'
      }
    }
  ],
  user: []
};

// ==================== 核心函数 ====================

/**
 * 初始化数据库
 * 服务端启动时调用，确保所有集合、索引、种子数据就绪
 * 
 * @param {import('mongodb').Db} adminDb - 管理库实例
 * @param {import('mongodb').Db} userDb - 用户库实例
 * @returns {Object} 初始化结果统计
 */
export async function initializeDatabase(adminDb, userDb) {
  const result = {
    collections: { created: 0, existing: 0, errors: [] },
    indexes: { created: 0, existing: 0, errors: [] },
    seeds: { created: 0, existing: 0, errors: [] }
  };
  
  logger.info('=== 数据库初始化开始 ===');
  
  // 阶段1: 确保集合存在
  logger.info('[1/3] 检查集合...');
  await ensureCollections(adminDb, '管理库', ADMIN_COLLECTIONS, result);
  await ensureCollections(userDb, '用户库', USER_COLLECTIONS, result);
  
  // 阶段2: 创建/校验索引
  logger.info('[2/3] 检查索引...');
  await ensureAllIndexes(adminDb, '管理库', ADMIN_COLLECTIONS, result);
  await ensureAllIndexes(userDb, '用户库', USER_COLLECTIONS, result);
  
  // 阶段3: 初始化种子数据
  logger.info('[3/3] 检查种子数据...');
  await ensureSeedData(adminDb, '管理库', SEED_DATA.admin, result);
  await ensureSeedData(userDb, '用户库', SEED_DATA.user, result);
  
  // 输出结果摘要
  const totalErrors = [
    ...result.collections.errors,
    ...result.indexes.errors,
    ...result.seeds.errors
  ].filter(e => !e.includes('无权限'));
  
  if (totalErrors.length > 0) {
    logger.warn(`数据库初始化完成（有 ${totalErrors.length} 个非权限错误）`);
  } else {
    logger.info('=== 数据库初始化完成 ===');
  }
  
  if (result.collections.created > 0 || result.indexes.created > 0 || result.seeds.created > 0) {
    logger.info(`  集合: 新建${result.collections.created} 已有${result.collections.existing}`);
    logger.info(`  索引: 新建${result.indexes.created} 已有${result.indexes.existing}`);
    logger.info(`  种子: 新建${result.seeds.created} 已有${result.seeds.existing}`);
  } else {
    logger.info('  所有集合、索引、种子数据均已就绪');
  }
  
  return result;
}

/**
 * 确保集合存在
 */
async function ensureCollections(db, dbName, collectionsDef, result) {
  // 获取已有集合列表
  let existingNames = new Set();
  try {
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    existingNames = new Set(collections.map(c => c.name));
  } catch (e) {
    logger.warn(`  ${dbName}: 无法列出集合 - ${e.message}`);
  }
  
  for (const [name, def] of Object.entries(collectionsDef)) {
    if (existingNames.has(name)) {
      result.collections.existing++;
      continue;
    }
    
    try {
      await db.createCollection(name);
      result.collections.created++;
      logger.info(`  创建集合: ${dbName}.${name}`);
    } catch (e) {
      if (e.code === 48) { // CollectionAlreadyExists
        result.collections.existing++;
      } else {
        result.collections.errors.push(`${dbName}.${name}: ${e.message}`);
        logger.warn(`  创建集合失败: ${dbName}.${name} - ${e.message}`);
      }
    }
  }
}

/**
 * 确保索引存在
 */
async function ensureAllIndexes(db, dbName, collectionsDef, result) {
  for (const [collectionName, def] of Object.entries(collectionsDef)) {
    const indexes = def.索引;
    if (!indexes || indexes.length === 0) continue;
    
    const coll = db.collection(collectionName);
    let existingKeys = null;
    
    // 获取现有索引列表
    try {
      const existingIndexes = await coll.indexes();
      existingKeys = new Set(existingIndexes.map(idx => JSON.stringify(idx.key)));
    } catch (e) {
      if (e.code === 13) {
        logger.warn(`  ${dbName}.${collectionName}: 无权限查看索引，将尝试直接创建`);
      }
    }
    
    for (const indexDef of indexes) {
      const keyStr = JSON.stringify(indexDef.key);
      
      if (existingKeys && existingKeys.has(keyStr)) {
        result.indexes.existing++;
        continue;
      }
      
      try {
        await coll.createIndex(indexDef.key, indexDef.options || {});
        result.indexes.created++;
        logger.info(`  创建索引: ${dbName}.${collectionName}.${keyStr}`);
      } catch (e) {
        if (e.code === 85 || e.code === 86) { // IndexAlreadyExists / IndexOptionsConflict
          result.indexes.existing++;
        } else if (e.code === 13) {
          result.indexes.errors.push(`${collectionName}.${keyStr}: 无权限`);
        } else {
          result.indexes.errors.push(`${collectionName}.${keyStr}: ${e.message}`);
        }
      }
    }
  }
}

/**
 * 确保种子数据存在
 */
async function ensureSeedData(db, dbName, seedsDef, result) {
  const ts = createTimestampFields();
  
  for (const seed of seedsDef) {
    try {
      const existing = await db.collection(seed.集合).findOne(seed.查询);
      if (existing) {
        result.seeds.existing++;
        continue;
      }
      
      await db.collection(seed.集合).insertOne({
        ...seed.数据,
        创建时间: ts.localTime,
        创建时间戳: ts.timestamp
      });
      result.seeds.created++;
      logger.info(`  创建种子: ${dbName}.${seed.集合} - ${seed.查询.用户ID || JSON.stringify(seed.查询)}`);
    } catch (e) {
      if (e.code === 11000) { // DuplicateKey
        result.seeds.existing++;
      } else {
        result.seeds.errors.push(`${seed.集合}: ${e.message}`);
        logger.warn(`  创建种子失败: ${dbName}.${seed.集合} - ${e.message}`);
      }
    }
  }
}


// 导出（ADMIN_COLLECTIONS, USER_COLLECTIONS 从 db-collections.js 导入并透传）
export { ADMIN_COLLECTIONS, USER_COLLECTIONS };
