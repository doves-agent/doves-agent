/**
 * 资源分配技能
 * 为新用户分配所需的各种资源
 * 
 * 功能（简化后）：
 * - 初始化Git记忆空间（可选）
 * - 初始化Git存储空间（可选）
 * - 创建 OSS 用户目录（可选）
 * 
 * 注意：使用共享集合 + userId 索引
 * 
 * 数据访问：通过鸽子代理访问数据，禁止直连数据库
 */

import { DovesProxy } from '../../doves_proxy/index.js';
import Git记忆 from '../../tools/Git存储/记忆仓库.js';
import Git数据 from '../../tools/Git存储/数据仓库.js';
import OSS存储 from '../../tools/oss存储.js';
import { toLocalISOString, getTimestamp, createTimestampFields } from '@dove/common/时间工具.js';
import { OSS_PREFIX } from '../../tools/oss存储/OSS路径配置.js';

import { 创建日志器 } from '@dove/common/日志管理器.js';

/**
 * 日志器
 */
const logger = 创建日志器('资源分配', { 前缀: '[资源分配]', 级别: 'debug', 显示调用位置: true });

/**
 * 获取数据库连接（通过鸽子代理）
 * @returns {Promise<{client: DovesProxy, db: Function}>}
 */
async function getDatabaseConnection() {
  const client = new DovesProxy({
    serverUrl: process.env.SERVER_URL,
    jwt: process.env.SERVER_JWT,
    apiKey: process.env.SERVER_API_KEY
  });
  
  const dbName = process.env.MONGODB_DB || 'dove_agent';
  
  return { client, db: client.db(dbName) };
}

/**
 * 确保共享集合索引存在
 * @param {Object} db - 数据库连接
 * @returns {Object} 结果
 */
async function 确保共享集合索引(db) {
  logger.info('检查共享集合索引...');
  
  const 集合列表 = ['任务', '对话', '文件元数据', '鸽子上下文'];
  const 结果列表 = [];
  
  for (const 集合名 of 集合列表) {
    try {
      const coll = db.collection(集合名);
      
      // 确保 用户ID 索引存在
      await coll.createIndex({ 用户ID: 1 });
      await coll.createIndex({ 创建时间戳: -1 });
      
      结果列表.push({ name: 集合名, status: 'indexed' });
    } catch (错误) {
      logger.error(`创建索引失败 ${集合名}:`, 错误.message);
      结果列表.push({ name: 集合名, status: 'error', error: 错误.message });
    }
  }
  
  return { 成功: true, 集合列表: 结果列表 };
}

/**
 * 初始化Git记忆空间
 * @param {string} userId - 用户ID
 * @returns {Object} 初始化结果
 */
async function 初始化记忆空间(userId) {
  logger.info(`为用户 ${userId} 初始化Git记忆空间...`);

  try {
    if (!Git记忆.是否可用()) {
      logger.warn('Git记忆系统未连接，跳过初始化');
      return { 成功: true, status: 'skipped', reason: 'Server未配置' };
    }

    const 记忆结果 = await Git记忆.添加记忆({
      用户ID: userId,
      类别: '用户画像',
      内容: `欢迎新用户 ${userId}！记忆空间已初始化完成。`,
      元数据: { type: 'initialization', userId, ...createTimestampFields() }
    });

    logger.info(`Git记忆空间初始化成功: ${userId}`);
    return { 成功: true, status: 'initialized', memoryId: 记忆结果?.id };
  } catch (错误) {
    logger.error('初始化记忆空间失败:', 错误.message);
    return { 成功: true, status: 'error', error: 错误.message };
  }
}

async function 初始化数据空间(userId) {
  logger.info(`为用户 ${userId} 初始化Git数据空间...`);

  try {
    if (!Git数据.是否可用()) {
      logger.warn('Git数据系统未连接，跳过初始化');
      return { 成功: true, status: 'skipped', reason: 'Server未配置' };
    }

    // 写一个初始化标记文件
    await Git数据.写入文件({ 路径: '.initialized', 内容: JSON.stringify({ userId, time: new Date().toISOString() }) });
    logger.info(`Git数据空间初始化成功: ${userId}`);
    return { 成功: true, status: 'initialized' };
  } catch (错误) {
    logger.error('初始化数据空间失败:', 错误.message);
    return { 成功: true, status: 'error', error: 错误.message };
  }
}

/**
 * 创建 OSS 用户目录
 * @param {string} userId - 用户ID
 * @returns {Object} 创建结果
 */
async function 创建OSS用户目录(userId) {
  logger.info(`为用户 ${userId} 创建 OSS 目录...`);
  
  try {
    // 检查 OSS 是否可用
    if (!OSS存储.是否可用()) {
      logger.warn('OSS 存储未启用，跳过创建目录');
      return { 成功: true, status: 'skipped', reason: 'OSS 存储未启用' };
    }
    
    // 在 OSS 创建用户目录（通过上传一个占位文件）
    const 占位内容 = Buffer.from(`User ${userId} workspace initialized at ${toLocalISOString()}`);
    const 用户路径 = `${OSS_PREFIX}/users/${userId}/.init`;
    
    const 上传结果 = await OSS存储.上传(占位内容, '.init', { 路径: 用户路径 });
    
    if (上传结果.成功) {
      logger.info(`OSS 用户目录创建成功: ${用户路径}`);
      return { 成功: true, status: 'created', path: 用户路径 };
    } else {
      logger.warn('OSS 上传失败:', 上传结果.错误);
      return { 成功: true, status: 'error', error: 上传结果.错误 };
    }
    
  } catch (错误) {
    logger.error('创建 OSS 用户目录失败:', 错误.message);
    return { 成功: true, status: 'error', error: 错误.message };
  }
}

/**
 * 更新用户资源状态
 * @param {Object} db - 数据库连接
 * @param {string} userId - 用户ID
 * @param {string} status - 新状态
 * @returns {Object} 更新结果
 */
async function 更新用户资源状态(db, userId, status) {
  logger.info(`更新用户 ${userId} 资源状态为 ${status}...`);
  
  try {
    const 结果 = await db.collection('用户').updateOne(
      { 用户ID: userId },
      { 
        $set: { 
          资源状态: status,
          ...createTimestampFields()
        } 
      }
    );
    
    if (结果.matchedCount > 0) {
      logger.info(`用户资源状态更新成功: ${userId} -> ${status}`);
      return { 成功: true };
    } else {
      logger.warn(`未找到用户 ${userId}`);
      return { 成功: false, error: '用户不存在' };
    }
    
  } catch (错误) {
    logger.error('更新用户资源状态失败:', 错误.message);
    return { 成功: false, error: 错误.message };
  }
}

/**
 * 执行资源分配
 * @param {Object} 参数 - 执行参数
 * @param {Object} 上下文 - 执行上下文
 * @returns {Object} 执行结果
 */
async function execute(参数, 上下文 = {}) {
  const { allocation, targetUserId } = 参数;
  
  logger.info('开始执行资源分配:', { targetUserId, allocation });
  
  // 验证参数
  if (!targetUserId) {
    return { 成功: false, 错误: '缺少目标用户ID' };
  }
  
  let client = null;
  
  try {
    // 获取数据库连接（优先使用上下文中的连接）
    let db;
    if (上下文.数据库连接) {
      db = 上下文.数据库连接.db(上下文.数据库名 || 'dove_agent');
    } else {
      const 连接结果 = await getDatabaseConnection();
      client = 连接结果.client;
      db = 连接结果.db;
    }
    
    // 更新用户状态为初始化中
    await 更新用户资源状态(db, targetUserId, 'initializing');
    
    // 执行结果收集
    const startTs = createTimestampFields();
    const 执行结果 = {
      userId: targetUserId,
      startedAt: startTs.localTime,
      startedAtTs: startTs.timestamp,
      steps: {}
    };
    
    // 1. 确保共享集合索引（替代创建用户专属集合）
    执行结果.steps.indexes = await 确保共享集合索引(db);
    
    // 2. 初始化记忆空间
    执行结果.steps.memory = await 初始化记忆空间(targetUserId);

    // 3. 初始化数据空间
    执行结果.steps.storage = await 初始化数据空间(targetUserId);
    
    // 4. 创建 OSS 用户目录
    执行结果.steps.oss = await 创建OSS用户目录(targetUserId);
    
    // 5. 更新用户资源状态为就绪
    const 状态更新结果 = await 更新用户资源状态(db, targetUserId, '已就绪');
    执行结果.steps.statusUpdate = 状态更新结果;
    
    const endTs = createTimestampFields();
    执行结果.完成时间 = endTs.localTime;
    执行结果.完成时间戳 = endTs.timestamp;
    执行结果.成功 = true;
    
    logger.info(`资源分配完成: ${targetUserId}`);
    
    return {
      成功: true,
      数据: 执行结果,
      message: `用户 ${targetUserId} 资源分配完成`
    };
    
  } catch (错误) {
    logger.error('资源分配执行失败:', 错误);
    
    // 尝试更新用户状态为失败
    try {
      if (上下文.数据库连接) {
        const db = 上下文.数据库连接.db(上下文.数据库名 || 'dove_agent');
        await 更新用户资源状态(db, targetUserId, '失败');
      }
    } catch (更新错误) {
      logger.error('更新失败状态时出错:', 更新错误.message);
    }
    
    return {
      成功: false,
      错误: 错误.message,
      userId: targetUserId
    };
    
  } finally {
    // 清理自主创建的鸽子代理（无需关闭，仅清空缓存）
    if (client) {
      client.close();
    }
  }
}

// 技能描述（用于 LLM 工具调用）
const 描述 = {
  name: '资源分配',
  description: '为新用户初始化资源：确保共享集合索引、初始化Git记忆/存储空间、创建 OSS 目录',
  parameters: {
    type: 'object',
    properties: {
      targetUserId: {
        type: 'string',
        description: '目标用户ID'
      },
      allocation: {
        type: 'object',
        description: '资源分配详情',
        properties: {
          userId: { type: 'string' },
          username: { type: 'string' },
          resources: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', description: '资源类型' },
                name: { type: 'string', description: '资源名称' },
                purpose: { type: 'string', description: '资源用途' }
              }
            }
          }
        }
      }
    },
    required: ['targetUserId']
  }
};

export default {
  name: '资源分配',
  description: 描述.description,

  // 内置技能，不需要拥有权检查
  需要拥有权: false,

  // 能力声明
  abilities: ['系统管理', '资源管理'],
  
  parameters: 描述.parameters,
  execute
};
