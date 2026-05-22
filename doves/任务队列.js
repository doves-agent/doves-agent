/**
 * @file 任务队列
 * @description MongoDB 原子抢锁实现的任务队列
 * 
 * 【KISS原则文档的一部分】
 * 
 * === 状态完全解耦 ===
 * 核心理念：进程无状态化，状态全存储于 MongoDB
 * 
 * 传统架构：
 * 进程内存 → 状态 → 进程崩溃 → 状态丢失
 * 
 * 白鸽架构：
 * MongoDB ← 状态 → 进程崩溃 → 新进程从MongoDB恢复
 * 
 * 这意味着：
 * - 任何能连接 MongoDB 的客户端都可以获取完整的系统状态
 * - 支持崩溃恢复、分布式协作、实时监控
 * - 可随时启停实例，不影响任务状态
 * - 任务状态跟随数据库，不受单机限制
 * 
 * === 支持功能 ===
 * ├── 原子抢锁获取任务
 * ├── 任务树关系管理
 * ├── 流式内容缓冲
 * ├── 检查点保存
 * └── Change Stream 监听
 * 
 * === 任务状态流转 ===
 * pending → ready (Flash能力填充) → running → completed
 *                                        → failed → 自愈规划 → 新子任务
 *                                        → terminated (监控终止)
 *                     → waiting_children → completed (所有子任务完成)
 *                     → cancelled
 * blocked → pending/ready (依赖任务完成后自动激活，有能力需求则直接ready)
 * routing/branch 任务直接创建为 ready（无需 Flash 填充）
 *
 * === 任务类型 ===
 * - branch: Branch任务（推理模型执行单元）
 * - subtask: SubTask任务（执行层原子单元）
 * 
 * 注意：Router (FLASH) 不是 Task，是每轮对话的路由/守门人
 * 
 * === 数据访问方式 ===
 * 遵循"统一代理"原则，所有鸽子通过鸽子代理访问数据，禁止直连数据库
 * - 用户模式：通过服务端 JWT 认证
 * - 鸽子模式：通过服务端 API Key 认证（HTTP/apiKey + 加密TCP 双通道）
 */

import { DovesProxy } from './doves_proxy/index.js';
import { 任务状态, 任务阶段 } from './常量.js';
import { getTimestamp, createTimestampFields, toLocalISOString } from '@dove/common/时间工具.js';
import { ObjectId } from '@dove/common/对象标识.js';
import { mixinAPITaskDistribution } from './任务队列/API任务分发.js';
import { mixinSubtaskManagement } from './任务队列/子任务管理.js';
import { mixinTaskRelease } from './任务队列/任务释放.js';
import { mixinStreamContent } from './任务队列/流式内容.js';
import { mixinTaskCancellation } from './任务队列/任务取消.js';
import { mixinCheckpoint } from './任务队列/检查点.js';
import { mixinTaskQuery } from './任务队列/任务查询.js';
import { mixinTaskClaiming } from './任务队列/任务获取.js';
import { mixinClusterHealth } from './任务队列/集群巡检.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('任务队列', { 前缀: '[任务队列]', 级别: 'debug', 显示调用位置: true });

/**
 * 任务类型定义
 * 注意：任务类型和能力类型是不同的概念：
 * - 任务类型：任务分类标签，用于统计和路由
 * - 能力类型：动态发现，由鸽子自行声明，存储在能力状态集合中
 * 
 * 任务创建时可以指定 requiredCapabilities（所需能力列表），
 * 系统会自动匹配具备这些能力的鸽子。
 */
export const 任务类型 = {
  REASONING: 'reasoning',       // 推理任务
  VISION: 'vision',             // 视觉理解任务
  IMAGE_GEN: 'image_gen',       // 图片生成任务
  WEB_SEARCH: '网络搜索',     // 网络搜索任务
  BROWSER: 'browser',           // 浏览器操作任务
  FILE_OP: 'file_op',           // 文件操作任务
  CODE: 'code',                 // 代码任务
  SYSTEM: 'system',             // 系统管理任务
  REMOTE: 'remote',             // 远程执行任务
  MATH: 'math',                 // 数学计算任务
  GENERAL: 'general',           // 通用任务
  CUSTOM: 'custom'              // 自定义任务（能力由创建者指定）
};

/**
 * 任务队列类 - 通过服务端访问数据库
 * 
 * 构造方式：
 * 1. 传入 鸽子代理 实例（推荐）
 * 2. 传入服务端配置对象，自动创建代理
 * 
 * 示例：
 * const queue = new 任务队列(代理实例);
 * const queue = new 任务队列(dovesProxy, null, cryptoClient, doveId);
 */
export class 任务队列 {
  constructor(连接或配置, 数据库名 = null, 加密客户端 = null, 鸽子ID = null) {
    if (!(连接或配置 instanceof DovesProxy)) {
      throw new Error('任务队列 需要 DovesProxy 实例');
    }
    this.代理 = 连接或配置;
    
    // 加密客户端（关键操作走加密通道）
    this.加密客户端 = 加密客户端;
    this.鸽子ID = 鸽子ID;
    
    this.数据库名 = 数据库名 || process.env.MONGODB_USER_DB || 'doves_user_data';
    this.集合名 = '任务';
    this.活跃监听流 = new Map();  // 追踪活跃的 changeStream
    
    // 混入 API 任务分发方法
    mixinAPITaskDistribution(this);
    // 混入子任务管理方法
    mixinSubtaskManagement(this);
    // 混入任务释放与心跳方法
    mixinTaskRelease(this);
    // 混入流式内容方法
    mixinStreamContent(this);
    // 混入任务取消方法
    mixinTaskCancellation(this);
    // 混入检查点方法
    mixinCheckpoint(this);
    // 混入任务查询方法
    mixinTaskQuery(this);
    // 混入任务获取（原子抢锁）方法
    mixinTaskClaiming(this);
    // 混入集群健康度巡检方法
    mixinClusterHealth(this);
  }

  /**
   * 获取集合（通过代理）
   */
  _获取集合() {
    return this.代理.db(this.数据库名).collection(this.集合名);
  }

  /**
   * 创建任务
   * @param {Object} 任务数据 - 任务数据
   * @returns {Object} 创建的任务
   * 
   * 原则：一个任务永远只被一只鸽子独占执行
   * 多鸽子横向对比场景 → 创建多个任务，而非多鸽子抢同一任务
   * 
   * 任务参数：
   * - 饲料奖励: 完成任务的饲料奖励（默认 1）
   * - 超时时间: 执行超时（毫秒，默认 300000）
   * - 信誉要求: 最低信誉分要求（默认 0）
   * - requiredCapabilities: 需要的能力列表
   * - taskType: 任务类型（和能力类型对应）
   */
  async 创建任务(任务数据) {
    const _t0 = Date.now();
    logger.info(`→ 创建任务: 类型=${任务数据.任务类型 || 'general'}, 能力=[${(任务数据.能力要求 || []).join(',')}]`);

    const ts = createTimestampFields();
    
    const 任务类型值 = 任务数据.任务类型 || 任务类型.GENERAL;
    
    const 所需能力 = 任务数据.能力要求 || [];
    
    const 任务 = {
      任务ID: new ObjectId().toString(),
      状态: 任务状态.PENDING,
      阶段: 任务阶段.WAITING,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp,
      
      // 任务类型（分类标签）
      任务类型: 任务类型值,
      
      // 能力占用管理（能力类型动态发现，非硬编码）
      能力占用: {
        所需能力: 所需能力,      // 所需能力列表，由意图识别或调用者指定
        已预留: false,
        预留时间: null,
        释放时间: null,
        预留者: null        // 占用能力的鸽子ID
      },
      
      // 任务执行参数（默认值）
      饲料奖励: 任务数据.饲料奖励 || 1,
      超时时间: 任务数据.超时时间 || 300000,
      信誉要求: 任务数据.信誉要求 || 0,
      所需能力: 所需能力,
      
      // 合并用户数据
      ...任务数据,
      根任务ID: 任务数据.根任务ID || null,
      父任务ID: 任务数据.父任务ID || null,
      子任务列表: [],
      流缓冲: []
    };

    // 【依赖阻塞机制】如果有依赖且未被覆盖，初始状态为 BLOCKED
    // 任务完成后会自动激活依赖它的任务（将 BLOCKED -> PENDING）
    const 依赖数组 = 任务.依赖 || [];
    if (依赖数组.length > 0 && 任务数据.状态 === undefined && 任务数据.status === undefined) {
      任务.状态 = 任务状态.BLOCKED;
      logger.debug(`任务 ${任务.任务ID} 有依赖 [${依赖数组.join(', ')}]，初始状态为 BLOCKED`);
    }

    // 通过鸽子代理插入
    const collection = this._获取集合();
    if (collection) {
      await collection.insertOne(任务);
    }

    logger.info(`← 任务已创建: ID=${任务.任务ID}, 状态=${任务.状态} (${Date.now() - _t0}ms)`);
    return 任务;
  }

  /**
   * 更新任务状态
   * 【状态保护】不允许从终态回退到运行态，使用原子条件更新避免竞态
   * @param {string} 任务ID - 任务ID
   * @param {string} 状态 - 新状态
   * @param {Object} 附加数据 - 附加更新数据
   */
  async 更新状态(任务ID, 状态, 附加数据 = {}) {
    const _t0 = Date.now();
    logger.info(`更新任务 ${任务ID} 状态为 ${状态}`);

    // 通过鸽子代理更新
    const collection = this._获取集合();
    if (collection) {
      const ts = createTimestampFields();
      const updateData = {
        状态: 状态,
        更新时间: ts.localTime,
        更新时间戳: ts.timestamp,
        ...附加数据
      };

      // 【状态保护】如果要更新为 RUNNING，用原子条件更新确保终态不可回退
      let query = { $or: [{ 任务ID }, { id: 任务ID }, { _id: 任务ID }] };
      if (状态 === 任务状态.RUNNING) {
        query = {
          $or: [{ 任务ID }, { id: 任务ID }, { _id: 任务ID }],
          状态: { $nin: [任务状态.COMPLETED, 任务状态.COMPLETED_WITH_ERRORS, 任务状态.FAILED, 任务状态.CANCELLED, 任务状态.TERMINATED] }
        };
      }

      const result = await collection.updateOne(query, { $set: updateData });

      if (状态 === 任务状态.RUNNING && result.matchedCount === 0) {
        // 区分是终态保护还是任务不存在
        const existing = await collection.findOne({ $or: [{ 任务ID }, { id: 任务ID }, { _id: 任务ID }] });
        if (!existing) {
            logger.warn(`任务 ${任务ID} 不存在于DB，忽略更新为 ${状态}`);
        } else {
            logger.warn(`状态保护: 任务 ${任务ID} 已处于终态(${existing.状态})，忽略更新为 ${状态}`);
        }
        return false;
      }

      // 【依赖激活】任务完成时，自动激活依赖它的 BLOCKED 任务
      if (状态 === 任务状态.COMPLETED || 状态 === 任务状态.COMPLETED_WITH_ERRORS) {
        await this.激活依赖任务(任务ID);
      }
    }

    logger.debug(`状态更新完成 (${Date.now() - _t0}ms)`);
    return true;
  }

  /**
   * 激活依赖指定任务的 BLOCKED 任务
   * 当一个任务完成时，检查哪些任务依赖它，如果所有依赖都满足则激活
   * 
   * 激活逻辑：
   * - 如果子任务已有能力需求（规划器/Flash已填充），直接激活为 READY
   * - 如果子任务没有能力需求，激活为 PENDING，等待 Flash 填充
   * 
   * @param {string} 任务ID - 刚完成的任务ID
   */
  async 激活依赖任务(任务ID) {
    const collection = this._获取集合();
    if (!collection) return;

    // 查找所有依赖此任务且状态为 BLOCKED 的任务
    const 阻塞任务列表 = await collection.find({
      状态: 任务状态.BLOCKED,
      依赖: 任务ID
    }).toArray();

    if (阻塞任务列表.length === 0) return;

    logger.debug(`任务 ${任务ID} 完成，检查 ${阻塞任务列表.length} 个依赖它的 BLOCKED 任务`);

    for (const 阻塞任务 of 阻塞任务列表) {
      // 检查该任务的所有依赖是否都已满足
      // 使用聚合查询一次性检查所有依赖状态，避免 N 次 findOne
      const 所有依赖 = 阻塞任务.依赖 || [];
      const 已完成依赖数 = await collection.countDocuments({
        任务ID: { $in: 所有依赖 },
        状态: { $in: [任务状态.COMPLETED, 任务状态.COMPLETED_WITH_ERRORS] }
      });

      if (已完成依赖数 < 所有依赖.length) {
            logger.debug(`任务 ${阻塞任务.任务ID} 的依赖尚未全部完成 (${已完成依赖数}/${所有依赖.length})，保持 BLOCKED`);
        continue;
      }

      // 根据能力需求决定激活目标状态
      const 已有能力 = 阻塞任务.能力需求 && 阻塞任务.能力需求.length > 0;
      const 目标状态 = 已有能力 ? 任务状态.READY : 任务状态.PENDING;
      
      // 原子操作：使用状态条件作为乐观锁，避免竞态条件
      // 遵循安全规范：条件中含状态（乐观锁），不用 findOne→JS→updateOne
      await collection.updateOne(
        { 任务ID: 阻塞任务.任务ID, 状态: 任务状态.BLOCKED },  // 乐观锁：只在仍为BLOCKED时才更新
        { $set: { 状态: 目标状态, 更新时间: toLocalISOString(), 更新时间戳: getTimestamp() } }
      );
          logger.info(`任务 ${阻塞任务.任务ID} 所有依赖已满足，已激活为 ${目标状态.toUpperCase()}`);
    }
  }

  /**
   * 将失败的任务放回待执行队列（重试机制）
   * 仅对可重试错误生效（限流、网络、超时等），不可恢复错误直接标记FAILED
   * 
   * @param {string} 任务ID - 任务ID
   * @param {Error|string} 错误 - 失败原因
   * @param {number} 最大重试次数 - 默认3次
   * @returns {boolean} 是否成功放回队列
   */
  async 重试任务(任务ID, 错误, 最大重试次数 = 3) {
    const _t0 = Date.now();
    const 错误消息 = typeof 错误 === 'string' ? 错误 : (错误.message || String(错误));
    
    // 判断是否为可重试错误
    const 可重试 = this._判断可重试错误(错误消息);
    
    const collection = this._获取集合();
    if (!collection) return false;
    
    if (可重试) {
      // 原子操作：增加重试计数，如果未超限则放回 ready（重试任务已有能力需求，无需再 Flash 填充）
      const ts = createTimestampFields();
      const result = await collection.findOneAndUpdate(
        { 
          $or: [{ 任务ID }, { id: 任务ID }, { _id: 任务ID }],
          重试次数: { $lt: 最大重试次数 }  // 未超重试上限
        },
        {
          $inc: { 重试次数: 1 },
          $set: {
            状态: 任务状态.READY,
            执行者: null,
            更新时间: ts.localTime,
            更新时间戳: ts.timestamp,
            最后失败原因: 错误消息,
            最后重试时间: ts.localTime
          }
        },
        { returnDocument: 'after' }
      );
      
      if (result) {
        const 检查点信息 = result.步骤检查点?.已完成步骤?.length > 0 ? ` (有${result.步骤检查点.已完成步骤.length}步检查点，可断点续传)` : '';
        logger.warn(`任务 ${任务ID} 放回队列（第${result.重试次数}/${最大重试次数}次重试，原因: ${错误消息.slice(0, 50)}）${检查点信息} (${Date.now() - _t0}ms)`);
        return true;
      } else {
        // 重试次数用完，标记为真正失败
        logger.warn(`任务 ${任务ID} 重试次数已用完，标记为FAILED`);
        await this.更新状态(任务ID, 任务状态.FAILED, { 
          error: `重试${最大重试次数}次后仍失败: ${错误消息}`,
          重试耗尽: true
        });
        return false;
      }
    } else {
      // 不可重试错误，直接标记失败
      logger.warn(`任务 ${任务ID} 不可重试错误，标记FAILED: ${错误消息.slice(0, 50)}`);
      await this.更新状态(任务ID, 任务状态.FAILED, { error: 错误消息 });
      return false;
    }
  }
  
  /**
   * 判断错误是否可重试
   * @private
   * @param {string} 错误消息
   * @returns {boolean}
   */
  _判断可重试错误(错误消息) {
    const 小写 = 错误消息.toLowerCase();
    // 可重试的错误类型
    const 可重试关键词 = [
      'rate limit', '429', 'too many requests',   // API限流
      '503', 'service unavailable', 'overloaded',    // 服务过载
      '502', 'bad gateway',                            // 网关错误
      'timeout', 'timed out', '超时',                  // 超时
      'econnreset', 'econnrefused', 'etimedout',       // 网络断连
      'network', 'fetch failed', '网络',               // 网络错误
      'api请求过于频繁', '稍后再试',                     // 服务端限流
      'socket hang up', 'premature close',             // 连接中断
      '重试'                                           // 显式标记重试
    ];
    
    // 不可恢复的错误
    const 不可恢复关键词 = [
      'syntaxerror', 'cannot find module',   // 代码错误
      'permission', '权限', 'forbidden',      // 权限错误
      'invalid api key', '未配置',            // 配置错误
      'validation', '参数错误'                // 校验错误
    ];
    
    // 先检查不可恢复
    if (不可恢复关键词.some(k => 小写.includes(k))) {
      return false;
    }
    
    // 再检查可重试
    return 可重试关键词.some(k => 小写.includes(k));
  }

  /**
   * 写入流式内容到任务缓冲区
   * @param {string} 任务ID - 任务ID
   * @param {string} 内容 - 流式内容
   */
  async 写入流式内容(任务ID, 内容) {
    // 流式写入极高频，静默处理
    // 调用追加流式内容
    await this.追加流式内容(任务ID, 内容, 'text');
  }

  /**
   * 写入任务结果
   * @param {string} 任务ID - 任务ID
   * @param {Object} 结果 - 执行结果
   */
  async 写入结果(任务ID, 结果) {
    const _t0 = Date.now();
    logger.info(`写入任务 ${任务ID} 结果`);

    if (!this.加密客户端?.connected || !this.鸽子ID) {
      throw new Error('加密通道未建立，无法提交任务结果');
    }

    const result = await this.加密客户端.submitResult(任务ID, this.鸽子ID, 结果);
    if (result?.success) {
      logger.info(`通过加密通道提交任务 ${任务ID} 结果 (${Date.now() - _t0}ms)`);
      return true;
    }
    throw new Error(`提交任务结果失败: ${JSON.stringify(result)}`);
  }

  /**
   * 监听任务变化 (Change Stream)
   * @param {string} 任务ID - 任务ID
   * @param {Function} 回调 - 变化回调函数
   */
  async 监听任务(任务ID, 回调) {
    logger.debug(`监听任务 ${任务ID} 变化`);

    // 关闭该任务已有的监听流（避免重复监听）
    if (this.活跃监听流.has(任务ID)) {
      await this.关闭监听(任务ID);
    }

    const collection = this._获取集合();
    if (collection) {
      const changeStream = collection.watch([
        { $match: { $or: [{ 'fullDocument.任务ID': 任务ID }, { 'fullDocument.id': 任务ID }] } }
      ]);
      changeStream.on('change', (change) => {
        回调(change.fullDocument);
      });
      changeStream.on('error', (error) => {
        logger.error(`监听流错误 ${任务ID}: ${error.message}`);
        this.活跃监听流.delete(任务ID);
      });
      this.活跃监听流.set(任务ID, changeStream);
    }
  }

  /**
   * 关闭任务监听流
   * @param {string} [任务ID] - 不传则关闭所有监听流
   */
  async 关闭监听(任务ID) {
    if (任务ID) {
      const stream = this.活跃监听流.get(任务ID);
      if (stream) {
        await stream.close();
        this.活跃监听流.delete(任务ID);
        logger.debug(`关闭监听 ${任务ID}`);
      }
    } else {
      for (const [id, stream] of this.活跃监听流) {
        await stream.close();
        logger.debug(`关闭监听 ${id}`);
      }
      this.活跃监听流.clear();
    }
  }

  /**
   * 获取任务详情
   * @param {string} 任务ID - 任务ID
   * @returns {Object|null} 任务对象
   */
  async 获取任务(任务ID, 静默 = false) {
    if (!静默) logger.debug(`获取任务 ${任务ID}`);

    // 通过鸽子代理查询任务
    const collection = this._获取集合();
    if (collection) {
      return await collection.findOne({ $or: [{ 任务ID }, { id: 任务ID }, { _id: 任务ID }] });
    }

    return null;
  }
}

export default 任务队列;
