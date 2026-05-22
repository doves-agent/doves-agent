/**
 * 白鸽服务端数据库模块
 * 职责：MongoDB连接、配额管理、系统配置
 * 
 * 【KISS原则文档的一部分】
 * 
 * === 服务端设计 ===
 * 服务端只做三件事：
 * 
 * 1. 连接验证
 *    └── JWT/SessionKey 验证，获取用户身份
 * 
 * 2. MongoDB 操作代理
 *    ├── 验证操作合法性（只能操作自己的数据）
 *    ├── 自动注入 userId
 *    └── 转发操作，返回结果
 * 
 * 3. OSS 文件代理
 *    ├── 路径安全检查（必须在用户目录内）
 *    ├── 文件读取/写入/列表
 *    └── 防止路径穿越攻击
 * 
 * 不做：业务逻辑、数据转换、复杂处理
 * 代码量：300-500行（本模块约900行含配额+认证）
 * 
 * === MongoDB 操作代理 API ===
 * 
 * POST /db/:collection/:action
 * 
 * 请求体：
 * {
 *   "query": { ... },      // 查询条件（自动注入 userId）
 *   "update": { ... },     // 更新内容
 *   "options": { ... }     // 操作选项
 * }
 * 
 * 支持的 collection（中英文名均支持，见 core.js ALLOWED_COLLECTIONS）：
 * - 对话 / conversations
 * - 任务 / tasks
 * - 文件元数据 / file_meta
 * - 技能、执行配置、执行轨迹、事件 等
 * 
 * 支持的 action：
 * - findOne
 * - find
 * - insertOne
 * - updateOne
 * - deleteOne
 * - aggregate
 * - watch (Change Stream)
 * 
 * 响应：
 * {
 *   "success": true,
 *   "data": { ... }
 * }
 * 
 * === 配额管理 ===
 * 
 * 配额存储位置：
 * ├── 用户集合的 配额.已用 字段
 * ├── 每次增删操作时 $inc 更新
 * └── 登录时直接返回当前使用量
 * 
 * 配额配置：
 * ├── 任务: 1000 条
 * ├── 对话: 100 条
 * ├── 文件元数据: 500 条
 * ├── 单文档最大: 512KB
 * └── 总存储上限: 100MB
 * 
 * 配额检查时机：
 * ├── insertOne 操作前检查 users.quota.usage
 * ├── 登录时返回当前配额使用情况
 * └── 超限返回 HTTP 429 错误
 * 
 * === 数据库索引 ===
 * 服务端启动时会自动检查并创建所需索引，无需手动操作
 * 详见 ensureIndexes() 函数
 */

import { MongoClient } from 'mongodb';
import { toLocalISOString, getTimestamp, createTimestampFields } from '../common/时间工具.js';
import { CONFIG, QUOTAS, ALLOWED_COLLECTIONS, ALLOWED_ACTIONS, DEFAULT_SYSTEM_CONFIG, logger } from './core.js';
import { checkDocumentSize as _checkDocumentSize, checkCollectionQuota as _checkCollectionQuota, getUserQuotaStatsForUser as _getUserQuotaStatsForUser, updateUserQuota as _updateUserQuota, 检查配额告警 as _检查配额告警, 记录Token用量 as _记录Token用量, 查询Token用量 as _查询Token用量 } from './db-配额与用量.js';
import { 加载限流名单 } from './middleware/rate-limiter.js';

// ==================== MongoDB 连接 ====================

let mongoClient = null;
let adminDb = null;
let userDb = null;
let systemConfig = null;
let adminIpWhitelist = null;  // 管理员 IP 白名单（DB优先，首次从env导入）
let ossClient = null;

/**
 * 获取 MongoDB 客户端
 */
export async function getMongoClient() {
  if (mongoClient) return mongoClient;
  
  mongoClient = new MongoClient(CONFIG.mongoUri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000
  });
  
  await mongoClient.connect();
  adminDb = mongoClient.db(CONFIG.adminDb);
  userDb = mongoClient.db(CONFIG.userDb);
  logger.info('MongoDB 已连接:', CONFIG.adminDb, '+', CONFIG.userDb);
  return mongoClient;
}

/**
 * 获取管理员数据库
 */
export function getAdminDb() {
  return adminDb;
}

/**
 * 获取用户数据库
 */
export function getUserDb() {
  return userDb;
}

// ==================== 索引初始化 ====================

/**
 * 确保集合索引存在
 * 在服务端启动时调用，检查并创建所需索引
 * 
 * 注意：此函数不会阻止服务端启动
 */
export async function ensureIndexes() {
  if (!adminDb || !userDb) {
    logger.warn('数据库未连接，跳过索引检查');
    return;
  }
  
  // 委托给统一的数据库初始化模块
  const { initializeDatabase } = await import('./数据库初始化.js');
  return await initializeDatabase(adminDb, userDb);
}

// ==================== 配额管理（已拆分到 db-配额与用量.js） ====================
// 包装函数：注入模块作用域的 adminDb

export { checkDocumentSize } from './db-配额与用量.js';

export async function checkCollectionQuota(collection, userId) {
  return _checkCollectionQuota(adminDb, collection, userId);
}

export { getUserQuotaStatsForUser } from './db-配额与用量.js';

export async function updateUserQuota(userId, collection, delta) {
  return _updateUserQuota(adminDb, userId, collection, delta);
}

export async function 检查配额告警(userId) {
  return _检查配额告警(adminDb, userId);
}

// ==================== 集合访问 ====================

/**
 * 获取集合（统一使用共享集合，通过 userId 索引查询）
 * 所有集合不再区分用户专属，统一使用共享集合
 */
export async function getUserCollection(db, collectionName, userId) {
  // 所有集合统一使用共享集合
  return { coll: db.collection(collectionName), name: collectionName, isUserCollection: false };
}

// ==================== 任务归档 ====================

/**
 * 归档已完成的旧任务
 * 将48小时前已完成的任务迁移到备份集合
 */
export async function archiveOldTasks() {
  if (!userDb) return { archived: 0 };
  
  const now = Date.now();
  const archiveThreshold = now - 48 * 60 * 60 * 1000; // 48小时前
  
  // 查找需要归档的任务（已完成或已失败超过48小时）
  const tasksToArchive = await userDb.collection('任务')
    .find({
      状态: { $in: ['已完成', '失败', '已取消'] },
      完成时间戳: { $lt: archiveThreshold }
    })
    .toArray();
  
  if (tasksToArchive.length === 0) {
    return { archived: 0 };
  }
  
  // 按完成日期分组归档
  const tasksByDate = {};
  for (const task of tasksToArchive) {
    const completedDate = task.完成时间戳 || task.更新时间戳 || task.创建时间戳;
    if (!completedDate) continue;
    
    // 使用本地时间的年月日作为备份集合后缀
    const date = new Date(completedDate);
    const localDateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const backupCollName = `tasks_backup_${localDateStr}`;
    
    if (!tasksByDate[backupCollName]) {
      tasksByDate[backupCollName] = [];
    }
    tasksByDate[backupCollName].push(task);
  }
  
  let totalArchived = 0;
  const archivedIds = [];
  
  for (const [backupCollName, tasks] of Object.entries(tasksByDate)) {
    try {
      // 插入到备份集合
      if (tasks.length > 0) {
        await userDb.collection(backupCollName).insertMany(tasks);
        
        // 从原集合删除
        const ids = tasks.map(t => t._id);
        await userDb.collection('任务').deleteMany({ _id: { $in: ids } });
        
        totalArchived += tasks.length;
        archivedIds.push(...ids);
      }
    } catch (e) {
      logger.error(`归档任务到 ${backupCollName} 失败:`, e.message);
    }
  }
  
  if (totalArchived > 0) {
    logger.info(`已归档 ${totalArchived} 个旧任务到备份集合`);
  }
  
  return { archived: totalArchived };
}

/**
 * 启动任务归档定时器
 * 每天凌晨3点执行一次归档
 */
export function startTaskArchiveScheduler() {
  const runArchive = async () => {
    try {
      await archiveOldTasks();
    } catch (e) {
      logger.error('任务归档失败:', e.message);
    }
  };
  
  // 计算到下次凌晨3点的毫秒数
  const getNextRunDelay = () => {
    const now = new Date();
    const next3AM = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      3, 0, 0, 0
    );
    return next3AM.getTime() - now.getTime();
  };
  
  // 首次运行延迟
  const firstDelay = getNextRunDelay();
  
  setTimeout(() => {
    runArchive();
    // 之后每24小时运行一次
    setInterval(runArchive, 24 * 60 * 60 * 1000);
  }, firstDelay);
  
  logger.info(`任务归档定时器已启动，将在 ${Math.round(firstDelay / 3600000)} 小时后首次执行`);
}

// ==================== 系统配置管理 ====================

/**
 * 初始化系统配置（从 .env 迁移到数据库）
 */
export async function initializeSystemConfig() {
  const db = getAdminDb();
  const collection = db.collection('系统配置');
  
  const existing = await collection.findOne({ _id: 'credentials' });
  
  if (existing) {
    systemConfig = existing;
    logger.info('系统配置已从数据库加载');
    // 同时加载 admin IP 白名单
    await loadAdminIpWhitelist(collection);
    // 加载限流名单
    await 加载限流名单(collection);
    return;
  }
  
  logger.info('首次运行，从 .env 迁移凭证到数据库...');
  
  const newConfig = {
    _id: 'credentials',
    ...DEFAULT_SYSTEM_CONFIG,
    llm: {
      bailian: {
        enabled: true,
        apiKey: process.env.BAILIAN_API_KEY || '',
        models: DEFAULT_SYSTEM_CONFIG.llm.bailian.models
      },
      deepseek: {
        enabled: true,
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        models: DEFAULT_SYSTEM_CONFIG.llm.deepseek.models
      },
      glm: {
        enabled: true,
        apiKey: process.env.GLM_API_KEY || '',
        models: DEFAULT_SYSTEM_CONFIG.llm.glm.models
      }
    },
    oss: {
      enabled: !!(process.env.OSS_ACCESS_KEY_ID && process.env.OSS_ACCESS_KEY_SECRET),
      region: process.env.OSS_REGION || 'oss-cn-shanghai',
      accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
      bucket: process.env.OSS_BUCKET || ''
    },
    gitStorage: {
      enabled: true,
      reposPath: process.env.GIT_REPOS_PATH || ''
    },
    migratedAt: toLocalISOString(),
    migratedFrom: '.env'
  };
  
  await collection.insertOne(newConfig);
  systemConfig = newConfig;
  
  // 同时初始化 admin IP 白名单（从 env 首次导入）
  await initializeAdminIpWhitelist(collection);
  
  logger.info('系统配置已从 .env 迁移到数据库');
}

/**
 * 获取系统配置
 */
export function getSystemConfig() {
  return systemConfig || DEFAULT_SYSTEM_CONFIG;
}

/**
 * 获取 LLM 提供商配置
 */
export function getLLMConfig(provider) {
  const config = getSystemConfig();
  return config.llm?.[provider] || { enabled: false, apiKey: '' };
}

/**
 * 获取 OSS 配置
 */
export function getOSSConfig() {
  const config = getSystemConfig();
  return config.oss || { enabled: false };
}

/**
 * 更新系统配置缓存
 */
export function updateSystemConfigCache(category, provider, newConfig) {
  if (systemConfig) {
    if (!systemConfig[category]) systemConfig[category] = {};
    systemConfig[category][provider] = newConfig;
  }
}

// ==================== Admin IP 白名单管理 ====================

/**
 * 初始化 admin IP 白名单（首次运行时从 .env 导入到 DB）
 * @param {Collection} collection - 系统配置集合
 */
async function initializeAdminIpWhitelist(collection) {
  const envValue = (process.env.ADMIN_IP_WHITELIST || '').trim();
  
  if (envValue) {
    const ts = createTimestampFields();
    await collection.updateOne(
      { _id: 'admin_ip_whitelist' },
      {
        $set: { value: envValue, 更新时间: ts.localTime, 更新时间戳: ts.timestamp },
        $setOnInsert: { 创建时间: ts.localTime, 创建时间戳: ts.timestamp, 来源: 'env' }
      },
      { upsert: true }
    );
    adminIpWhitelist = envValue;
    logger.info(`[Admin IP白名单] 已从环境变量导入: ${envValue}`);
  } else {
    adminIpWhitelist = '';
    logger.warn('[Admin IP白名单] 未配置 ADMIN_IP_WHITELIST 环境变量，管理员接口将拒绝所有请求');
  }
}

/**
 * 从数据库加载 admin IP 白名单
 * @param {Collection} collection - 系统配置集合
 */
async function loadAdminIpWhitelist(collection) {
  const doc = await collection.findOne({ _id: 'admin_ip_whitelist' });
  
  if (doc && doc.value) {
    adminIpWhitelist = doc.value;
    logger.info(`[Admin IP白名单] 已从数据库加载: ${doc.value}`);
    return;
  }
  
  // DB 中没有，尝试从 env 导入
  await initializeAdminIpWhitelist(collection);
}

/**
 * 获取管理员 IP 白名单配置
 * 优先从数据库缓存读取，fallback 到环境变量
 * @returns {string} 白名单字符串（逗号分隔）
 */
export function getAdminIpWhitelist() {
  return adminIpWhitelist || '';
}

// ==================== OSS 客户端 ====================

/**
 * 获取 OSS 客户端
 */
export async function getOSSClient() {
  if (ossClient) return ossClient;
  
  const ossConfig = getOSSConfig();
  if (!ossConfig.enabled) return null;
  
  try {
    const OSS = (await import('ali-oss')).default;
    ossClient = new OSS({
      region: ossConfig.region,
      accessKeyId: ossConfig.accessKeyId,
      accessKeySecret: ossConfig.accessKeySecret,
      bucket: ossConfig.bucket,
      secure: true
    });
    logger.info('OSS 已连接:', ossConfig.bucket);
    return ossClient;
  } catch (e) {
    logger.error('OSS 初始化失败:', e.message);
    return null;
  }
}

/**
 * 重置 OSS 客户端
 */
export function resetOSSClient() {
  ossClient = null;
}

// ==================== 执行配置初始化 ====================

/**
 * 初始化内置执行配置到数据库（幂等操作）
 * 在服务端启动时调用
 */
export async function initializeExecutionProfiles() {
  if (!userDb) {
    logger.warn('数据库未连接，跳过执行配置初始化');
    return;
  }
  
  try {
    const { 内置配置列表 } = await import('../common/执行配置.js');
    const 集合 = userDb.collection('执行配置');
    
    let created = 0;
    let existing = 0;
    
    for (const 配置 of 内置配置列表) {
      const ts = createTimestampFields();
      const result = await 集合.updateOne(
        { 标识: 配置.标识 },
        { $setOnInsert: { ...配置, 创建时间: ts.localTime, 创建时间戳: ts.timestamp } },
        { upsert: true }
      );
      if (result.upsertedCount > 0) {
        created++;
      } else {
        existing++;
      }
    }
    
    logger.info(`执行配置初始化完成: 新建 ${created} 个, 已存在 ${existing} 个`);
  } catch (e) {
    logger.warn('执行配置初始化失败:', e.message);
  }
}

// ==================== Token 用量持久化（已拆分到 db-配额与用量.js） ====================
// 包装函数：注入模块作用域的 userDb

export async function 记录Token用量(记录) {
  return _记录Token用量(userDb, 记录);
}

export async function 查询Token用量(参数) {
  return _查询Token用量(userDb, 参数);
}

// ==================== 导出配置和常量 ====================

export { CONFIG, QUOTAS, ALLOWED_COLLECTIONS, ALLOWED_ACTIONS, logger };
export { toLocalISOString, getTimestamp, createTimestampFields };
