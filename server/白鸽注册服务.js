/**
 * 白鸽注册服务模块
 * 
 * 【KISS原则文档的一部分】
 * 
 * === 功能说明 ===
 * 为新注册的白鸽（鸽子）账号自动分配所需资源：
 * - 饲料赠送（默认10点，可配置）
 * - Git存储空间初始化（按需）
 * - 信誉初始化
 * 
 * === 配置项 ===
 * 通过 DEFAULT_CONFIG 可配置：
 * - 初始饲料数量
 * 
 * === 使用方法 ===
 * import { 注册白鸽账号 } from './白鸽注册服务.js';
 * const 结果 = await 注册白鸽账号({
 *   名称: '我的鸽子',
 *   类型: 'private',
 *   饲养员ID: 'user_xxx'
 * });
 */

import { getAdminDb, getUserDb, createTimestampFields, getTimestamp } from './db.js';
import { toLocalISOString } from '../common/时间工具.js';
import { logger } from './core.js';
import { DEFAULT_CONFIG } from './registration/config.js';
import { generateDoveId, generateApiKey, hashKeySecret, 初始化饲料账户, 创建鸽子存储目录 } from './注册服务/工具.js';
import { 更新渠道权限, 重置渠道权限 } from './注册服务/渠道权限.js';

// DEFAULT_CONFIG 已提取到 registration/config.js

// 核心函数已拆分到 注册服务/工具.js 和 注册服务/渠道权限.js

/**
 * 注册白鸽账号
 * @param {object} 注册信息 - 注册信息
 * @param {string} 注册信息.名称 - 鸽子名称
 * @param {string} 注册信息.类型 - 类型 (official/community/private)
 * @param {string} 注册信息.饲养员ID - 饲养员ID
 * @param {string[]} 注册信息.能力列表 - 能力列表
 * @param {object} 注册信息.配置 - 自定义配置
 * @returns {Promise<{成功: boolean, 鸽子?: object, 错误?: string}>}
 */
export async function 注册白鸽账号(注册信息) {
  const { 名称, 类型 = 'private', 饲养员ID, 能力列表 = [], 配置 = {}, machineId } = 注册信息;
  
  // 验证必填字段
  if (!名称) {
    return { 成功: false, 错误: '鸽子名称必填' };
  }
  if (!饲养员ID) {
    return { 成功: false, 错误: '饲养员ID必填' };
  }
  
  // 合并配置
  const 最终配置 = {
    ...DEFAULT_CONFIG,
    ...配置,
    Git存储: { ...DEFAULT_CONFIG.Git存储, ...配置.Git存储 },
    注册门槛: { ...DEFAULT_CONFIG.注册门槛, ...配置.注册门槛 }
  };
  
  const adminDb = getAdminDb();
  const ts = createTimestampFields();
  
  // 生成鸽子ID和API密钥（使用客户端传入的 machineId 生成统一前缀ID）
  const doveId = generateDoveId(machineId, 0);
  const keyInfo = generateApiKey(doveId);
  
  try {
    // ==================== 野鸽子注册门槛检查 ====================
    const 门槛配置 = 最终配置.注册门槛;
    let 抵押记录 = null;
    
    if (门槛配置.enabled && 类型 !== 'official') {
      // 原子操作：条件判断+锁定一步完成
      // 条件：余额-锁定 >= 抵押饲料（可用余额足够）
      const 锁定结果 = await adminDb.collection('用户').updateOne(
        { 
          用户ID: 饲养员ID,
          '饲料.余额': { $gte: 门槛配置.抵押饲料 },
          $expr: { $gte: [{ $subtract: ['$饲料.余额', '$饲料.锁定'] }, 门槛配置.抵押饲料] }  // 可用余额>=抵押
        },
        { $inc: { '饲料.余额': -门槛配置.抵押饲料, '饲料.锁定': 门槛配置.抵押饲料 } }
      );
      
      if (锁定结果.matchedCount === 0) {
        // 可能用户不存在或余额不足，精确化错误信息
        const 饲养员 = await adminDb.collection('用户').findOne({ 用户ID: 饲养员ID });
        if (!饲养员) {
          return { 成功: false, 错误: '饲养员账号不存在' };
        }
        const 饲养员余额 = 饲养员.饲料?.余额 || 0;
        const 饲养员锁定 = 饲养员.饲料?.锁定 || 0;
        const 可用余额 = 饲养员余额 - 饲养员锁定;
        return { 
          成功: false, 
          错误: `野鸽子注册需要${门槛配置.抵押饲料}饲料抵押，当前可用余额不足`,
          需要: 门槛配置.抵押饲料,
          当前余额: 饲养员余额,
          当前锁定: 饲养员锁定,
          可用余额
        };
      }
      
      // 记录抵押交易
      抵押记录 = {
        饲料ID: new ObjectId().toString(),
        类型: '抵押',
        鸽子ID: doveId,
        饲养员ID,
        数量: 门槛配置.抵押饲料,
        创建时间: ts.localTime,
        创建时间戳: ts.timestamp
      };
      
      await adminDb.collection('饲料交易').insertOne(抵押记录);
      
      logger.info(`野鸽子注册抵押: 饲养员 ${饲养员ID} 抵押 ${门槛配置.抵押饲料} 饲料，鸽子 ${doveId}`);
    }
    // 构建鸽子身份记录（数据库字段统一使用中文命名）
    const 鸽子身份 = {
      鸽子ID: doveId,
      名称,
      鸽子类型: 类型,
      饲养员ID,
      
      // 能力
      能力列表: 能力列表,
      
      // 状态
      状态: '离线',
      
      // 信誉系统
      信誉分: 最终配置.初始信誉分,
      信誉等级: 最终配置.初始信誉等级,
      
      // 饲料账户
      饲料: {
        余额: 最终配置.初始饲料,
        锁定: 0,
        累计获得: 最终配置.初始饲料
      },
      
      // 统计数据
      统计: {
        完成任务数: 0,
        失败任务数: 0,
        放弃任务数: 0,
        超时任务数: 0,
        成功率: 1,
        平均耗时: 0
      },
      
      // 并发限制
      限制: {
        最大并发数: 最终配置.默认最大并发数
      },
      
      // 权限策略
      权限策略: {
        数据访问范围: 类型 === 'official' ? 'user_all' : 'task_only',  // 官方鸽子可访问用户所有数据，其他只能访问任务关联数据
        最大单次查询量: 类型 === 'official' ? 500 : 100
      },
      
      // 渠道权限（鸽主+授权双模型）
      渠道权限: 最终配置.渠道权限 || DEFAULT_CONFIG.渠道权限,
      
      // 时间戳
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp,
      更新时间: ts.localTime,
      更新时间戳: ts.timestamp,
      最后心跳时间: null,
      最后心跳时间戳: null
    };
    
    // 插入鸽子身份记录
    await adminDb.collection('鸽子身份').insertOne(鸽子身份);
    
    // 初始化饲料账户（记录交易）
    const 饲料结果 = await 初始化饲料账户(doveId, 最终配置.初始饲料);
    
    // 初始化Git存储空间
    const 存储结果 = await 创建鸽子存储目录(doveId, 饲养员ID, 最终配置.Git存储);
    
    // 存储API密钥（keyId 明文存储用于查找，keySecret 哈希存储用于验证）
    const hashedKeySecret = await hashKeySecret(keyInfo.keySecret);
    const keyTs = createTimestampFields();
    // 默认有效期90天，超期后自动标记已过期
    const 有效期天数 = 配置.API密钥有效期天数 || 90;
    const 过期时间 = new Date(Date.now() + 有效期天数 * 24 * 60 * 60 * 1000);
    await adminDb.collection('API密钥').insertOne({
      keyId: keyInfo.keyId,      // 明文存储，用于快速查找
      keySecret: hashedKeySecret, // 哈希存储，用于验证
      鸽子ID: doveId,
      用户ID: 饲养员ID,
      role: 'dove',
      权限列表: [
        'tasks:claim',
        'tasks:read',
        'tasks:input',
        'tasks:result',
        'skills:read',
        'dove:heartbeat'
      ],
      状态: '活跃',
      有效期天数,
      过期时间,
      创建时间: keyTs.localTime,
      创建时间戳: keyTs.timestamp
    });
    
    logger.info(`白鸽账号注册成功: ${名称} (${doveId})，饲料: ${最终配置.初始饲料}点`);
    
    // 返回结果（包含完整API密钥，仅此一次）
    return {
      成功: true,
      鸽子: {
        doveId,
        名称,
        类型,
        饲养员ID,
        apiKey: keyInfo.apiKey,  // 完整密钥，仅返回一次
        初始饲料: 最终配置.初始饲料,
        信誉分: 最终配置.初始信誉分,
        存储目录: 存储结果.目录?.路径,
        创建时间: ts.localTime
      }
    };
    
  } catch (错误) {
    logger.error(`注册白鸽账号失败: ${错误.message}`);
    
    // 尝试清理已创建的资源
    try {
      await adminDb.collection('鸽子身份').deleteOne({ 鸽子ID: doveId });
      await adminDb.collection('饲料交易').deleteMany({ 鸽子ID: doveId });
      await adminDb.collection('API密钥').deleteOne({ 鸽子ID: doveId });
    } catch (清理错误) {
      logger.error(`清理资源失败: ${清理错误.message}`);
    }
    
    return { 成功: false, 错误: 错误.message };
  }
}

/**
 * 获取白鸽账号信息
 * @param {string} doveId - 鸽子ID
 * @returns {Promise<{成功: boolean, 鸽子?: object, 错误?: string}>}
 */
export async function 获取白鸽信息(doveId) {
  const adminDb = getAdminDb();
  
  try {
    const 鸽子 = await adminDb.collection('鸽子身份').findOne(
      { 鸽子ID: doveId },
      {
        projection: {
          鸽子ID: 1,
          名称: 1,
          鸽子类型: 1,
          饲养员ID: 1,
          能力列表: 1,
          状态: 1,
          信誉分: 1,
          信誉等级: 1,
          饲料: 1,
          统计: 1,
          限制: 1,
          渠道权限: 1,
          创建时间: 1,
          最后心跳时间: 1,
          directEndpoint: 1
        }
      }
    );
    
    if (!鸽子) {
      return { 成功: false, 错误: '鸽子不存在' };
    }
    
    // 获取存储目录信息（历史数据兼容）
    const 目录列表 = await adminDb.collection('瑶池目录')
      .find({ 拥有者ID: 鸽子.饲养员ID, 路径: { $regex: `^/doves/${doveId}` } })
      .toArray();
    
    return {
      成功: true,
      鸽子: {
        ...鸽子,
        存储目录列表: 目录列表
      }
    };
  } catch (错误) {
    logger.error(`获取白鸽信息失败: ${错误.message}`);
    return { 成功: false, 错误: 错误.message };
  }
}

/**
 * 列出饲养员的所有鸽子
 * @param {string} 饲养员ID - 饲养员ID
 * @returns {Promise<{成功: boolean, 鸽子列表?: Array, 错误?: string}>}
 */
export async function 列出饲养员鸽子(饲养员ID) {
  const adminDb = getAdminDb();
  
  try {
    const 鸽子列表 = await adminDb.collection('鸽子身份')
      .find({ 饲养员ID })
      .project({
        鸽子ID: 1,
        名称: 1,
        鸽子类型: 1,
        状态: 1,
        信誉分: 1,
        '饲料.余额': 1,
        '统计.完成任务数': 1,
        创建时间: 1,
        directEndpoint: 1
      })
      .sort({ 创建时间戳: -1 })
      .toArray();
    
    return { 成功: true, 鸽子列表 };
  } catch (错误) {
    logger.error(`列出饲养员鸽子失败: ${错误.message}`);
    return { 成功: false, 错误: 错误.message };
  }
}

/**
 * 重新生成 API 密钥
 * @param {string} doveId - 鸽子ID
 * @param {string} 操作者ID - 操作者ID
 * @returns {Promise<{成功: boolean, apiKey?: string, 错误?: string}>}
 */
export async function 重新生成API密钥(doveId, 操作者ID) {
  const adminDb = getAdminDb();
  const ts = createTimestampFields();
  
  try {
    // 检查鸽子是否存在
    const 鸽子 = await adminDb.collection('鸽子身份').findOne({ 鸽子ID: doveId });
    if (!鸽子) {
      return { 成功: false, 错误: '鸽子不存在' };
    }
    
    // 验证权限：只有饲养员可以操作
    if (鸽子.饲养员ID !== 操作者ID) {
      return { 成功: false, 错误: '无权操作此鸽子' };
    }
    
    // 生成新的 API 密钥
    const keyInfo = generateApiKey(doveId);
    const hashedKeySecret = await hashKeySecret(keyInfo.keySecret);
    
    // 禁用旧密钥
    await adminDb.collection('API密钥').updateMany(
      { 鸽子ID: doveId, 状态: '活跃' },
      { $set: { 状态: '已撤销' } }
    );
    
    // 创建新密钥
    const keyTs = createTimestampFields();
    const 有效期天数 = 90;
    const 过期时间 = new Date(Date.now() + 有效期天数 * 24 * 60 * 60 * 1000);
    await adminDb.collection('API密钥').insertOne({
      keyId: keyInfo.keyId,
      keySecret: hashedKeySecret,
      鸽子ID: doveId,
      用户ID: 操作者ID,
      role: 'dove',
      权限列表: [
        'tasks:claim',
        'tasks:read',
        'tasks:input',
        'tasks:result',
        'skills:read',
        'dove:heartbeat'
      ],
      状态: '活跃',
      有效期天数,
      过期时间,
      创建时间: keyTs.localTime,
      创建时间戳: keyTs.timestamp
    });
    
    logger.info(`API密钥已重新生成: ${doveId}`);
    
    return { 
      成功: true, 
      apiKey: keyInfo.apiKey  // 仅返回一次
    };
  } catch (错误) {
    logger.error(`重新生成API密钥失败: ${错误.message}`);
    return { 成功: false, 错误: 错误.message };
  }
}

/**
 * 注销白鸽账号（软删除）
 * @param {string} doveId - 鸽子ID
 * @param {string} 操作者ID - 操作者ID
 * @returns {Promise<{成功: boolean, 错误?: string}>}
 */
export async function 注销白鸽账号(doveId, 操作者ID) {
  const adminDb = getAdminDb();
  const ts = createTimestampFields();
  
  try {
    // 原子操作1：检查权限+标记disabled一步完成
    // 条件：鸽子存在 + 饲养员ID匹配 + 状态非禁用
    // 注意：并发任务检查改为基于实际任务状态（不依赖存储的计数器）
    const userDb = getUserDb();
    const 实际执行数 = await userDb.collection('任务').countDocuments({
      执行者: doveId,
      状态: { $in: ['执行中', '等待子任务'] }
    });
    
    if (实际执行数 > 0) {
      return { 成功: false, 错误: '鸽子有进行中的任务，无法注销', 实际执行数 };
    }
    
    const 注销结果 = await adminDb.collection('鸽子身份').findOneAndUpdate(
      { 鸽子ID: doveId, 饲养员ID: 操作者ID, 状态: { $ne: '禁用' } },
      { $set: { 状态: '禁用', 注销时间: ts.localTime, 注销时间戳: ts.timestamp, 注销者ID: 操作者ID } },
      { returnDocument: 'before' }
    );
    
    if (!注销结果) {
      // 精确化错误信息
      const 鸽子 = await adminDb.collection('鸽子身份').findOne({ 鸽子ID: doveId });
      if (!鸽子) return { 成功: false, 错误: '鸽子不存在' };
      if (鸽子.饲养员ID !== 操作者ID) return { 成功: false, 错误: '无权注销此鸽子' };
      if (鸽子.状态 === '禁用') return { 成功: false, 错误: '鸽子已注销' };
      return { 成功: false, 错误: '无法注销此鸽子' };
    }
    
    const 鸽子 = 注销结果;  // 变更前的鸽子数据
    
    // ==================== 抵押返还逻辑 ====================
    const 门槛配置 = DEFAULT_CONFIG.注册门槛;
    
    // 检查是否满足返还条件
    if (门槛配置.enabled && 鸽子.鸽子类型 !== 'official') {
      const 运行天数 = Math.floor((Date.now() - 鸽子.创建时间戳) / (24 * 60 * 60 * 1000));
      
      if (门槛配置.返还条件.注销时返还 && 运行天数 >= 门槛配置.返还条件.最少运行天数) {
        // 查找抵押记录
        const 抵押记录 = await adminDb.collection('饲料交易').findOne({
          鸽子ID: doveId,
          类型: '抵押'
        });
        
        if (抵押记录) {
          // 返还抵押
          await adminDb.collection('用户').updateOne(
            { 用户ID: 鸽子.饲养员ID },
            { $inc: { '饲料.余额': 抵押记录.数量, '饲料.锁定': -抵押记录.数量 } }
          );
          
          // 记录返还交易
          await adminDb.collection('饲料交易').insertOne({
            饲料ID: new ObjectId().toString(),
            类型: '返还',
            鸽子ID: doveId,
            饲养员ID: 鸽子.饲养员ID,
            数量: 抵押记录.数量,
            创建时间: ts.localTime,
            创建时间戳: ts.timestamp
          });
          
          logger.info(`鸽子注销返还抵押: ${抵押记录.数量} 饲料返还给 ${鸽子.饲养员ID}`);
        }
      } else {
        logger.info(`鸽子注销不满足返还条件: 仅运行${运行天数}天，需要${门槛配置.返还条件.最少运行天数}天`);
      }
    }
    
    // 禁用API密钥
    await adminDb.collection('API密钥').updateMany(
      { 鸽子ID: doveId },
      { $set: { 状态: '已撤销' } }
    );
    
    logger.info(`白鸽账号已注销: ${doveId}`);
    
    return { 成功: true };
  } catch (错误) {
    logger.error(`注销白鸽账号失败: ${错误.message}`);
    return { 成功: false, 错误: 错误.message };
  }
}



export default {
  DEFAULT_CONFIG,
  注册白鸽账号,
  获取白鸽信息,
  列出饲养员鸽子,
  注销白鸽账号,
  重新生成API密钥,
  更新渠道权限,
  重置渠道权限
};
