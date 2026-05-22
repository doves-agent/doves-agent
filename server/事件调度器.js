/**
 * 事件调度器（Server 端）
 * 扫描事件集合 → 原子抢锁到期事件 → 创建 Branch Task
 * 鸽子侧零改动：事件触发的任务在 `任务` 集合中，鸽子正常抢
 * 
 * 四种事件类型：
 * 1. scheduled  - 定时触发（cron表达式）
 * 2. data_change - 数据变更监听（Change Stream）
 * 3. external   - 外部API触发
 * 4. semantic   - 语义触发（自然语言条件 → Git记忆关键词匹配 + LLM精判）
 */

import { getUserDb, getAdminDb } from './db.js';
import { createTimestampFields, toLocalISOString, getTimestamp } from '../common/时间工具.js';
import { logger } from './core.js';
import * as 记忆服务 from './Git存储/记忆服务.js';
import { ObjectId } from 'mongodb';
import { 默认快速模型 } from '../common/模型配置.js';

// 从子模块导入
import { 计算下次触发时间 } from './事件调度/cron工具.js';
import { initIntentDriven, 检查事件限额 as _检查事件限额, 注册意图驱动事件 as _注册意图驱动事件, 追加事件处理动作 as _追加事件处理动作 } from './事件调度/意图驱动事件.js';
import { 注册语义事件 as _注册语义事件, 检查语义触发 as _检查语义触发, LLM精判语义触发 as _LLM精判语义触发 } from './事件调度/语义触发.js';
import { 摘要触发检查 as _摘要触发检查, LLM精判事件匹配 as _LLM精判事件匹配, LLM精判摘要触发 as _LLM精判摘要触发 } from './事件调度/摘要触发.js';

// Server 实例标识（多实例区分）
const SERVER_INSTANCE_ID = 'srv-' + Math.random().toString(16).substr(2, 6);

// 初始化意图驱动事件模块
initIntentDriven({
  serverInstanceId: SERVER_INSTANCE_ID,
  createTaskDoc: null  // 将在构造函数中设置为 this._创建任务文档.bind(this)
});

export class 事件调度器 {
  constructor(配置 = {}) {
    this.运行中 = false;
    this.扫描间隔 = 配置.扫描间隔 || 60000;  // 默认每分钟扫描
    this.changeStreams = [];
    this.定时器 = null;
  }

  /**
   * 初始化：创建索引
   */
  async 初始化() {
    try {
      const userDb = getUserDb();
      const 事件集合 = userDb.collection('事件');
      await 事件集合.createIndex({ 状态: 1, 下次触发时间: 1 });
      await 事件集合.createIndex({ 事件类型: 1, 状态: 1 });
      await 事件集合.createIndex({ userId: 1, 状态: 1 });
      // 语义事件索引：按用户+类型快速查询活跃语义事件
      await 事件集合.createIndex({ 事件类型: 1, 状态: 1, userId: 1 });
      logger.info('[事件调度器] 初始化完成');
    } catch (e) {
      logger.error('[事件调度器] 初始化失败:', e.message);
    }
  }

  /**
   * 启动调度器
   */
  async 启动() {
    this.运行中 = true;
    logger.info(`[事件调度器] 启动定时扫描 (间隔 ${this.扫描间隔 / 1000}s, 实例 ${SERVER_INSTANCE_ID})`);
    
    this._定时扫描循环();
    await this._启动变更监听();
    await this._启动意图事件变更监听();
  }

  /**
   * 停止调度器
   */
  async 停止() {
    this.运行中 = false;
    if (this.定时器) clearTimeout(this.定时器);
    
    // 关闭意图事件专用 Stream（如果未被 changeStreams 包含）
    if (this._意图事件Stream) {
      try { await this._意图事件Stream.close(); } catch (e) { logger.warn('事件调度器关闭意图事件Stream异常:', e.message); }
    }
    
    // 关闭所有 Change Stream（含变更监听和意图事件监听）
    for (const stream of this.changeStreams) {
      try { await stream.close(); } catch (e) { logger.warn('事件调度器关闭Stream异常:', e.message); }
    }
    this.changeStreams = [];
    logger.info('[事件调度器] 已停止');
  }

  // ==================== 定时触发（核心） ====================

  /**
   * 定时扫描循环
   * 关键：findOneAndUpdate 原子抢锁，多 Server 实例安全
   */
  async _定时扫描循环() {
    if (!this.运行中) return;
    
    try {
      const userDb = getUserDb();
      const 事件集合 = userDb.collection('事件');
      const 任务集合 = userDb.collection('任务');
      const 当前时间ISO = toLocalISOString(new Date());
      const 当前时间戳 = getTimestamp();
      
      let 抢到事件数 = 0;
      while (true) {
        // 原子抢锁：active + 到期 → triggered
        const result = await 事件集合.findOneAndUpdate(
          {
            事件类型: 'scheduled',
            状态: '活跃',
            下次触发时间: { $lte: 当前时间ISO }
          },
          {
            $set: {
              状态: '已触发',
              触发者实例: SERVER_INSTANCE_ID,
              触发时间: 当前时间ISO,
              更新时间: 当前时间ISO,
              更新时间戳: 当前时间戳
            }
          },
          { returnDocument: 'after', sort: { 下次触发时间: 1 } }
        );
        
        if (!result) break;
        
        const 事件 = result;
        抢到事件数++;
        
        try {
          const 任务 = this._创建任务文档(事件.任务模板, 事件.userId, 事件.事件ID);
          await 任务集合.insertOne(任务);
          
          logger.info(`[事件调度器] 事件 ${事件.事件ID} 触发 → 创建任务 ${任务.任务ID}`);

          this._事件触发后通知(事件, 1);

          const 更新操作 = {
            $set: {
              生成的任务ID: 任务.任务ID,
              更新时间: toLocalISOString(new Date()),
              更新时间戳: getTimestamp()
            }
          };
          
          if (事件.重复 && 事件.cron表达式) {
            const 下次 = this._计算下次触发时间(事件.cron表达式);
            更新操作.$set.状态 = '活跃';
            更新操作.$set.上次触发时间 = 当前时间ISO;
            更新操作.$set.下次触发时间 = 下次;
          } else {
            更新操作.$set.状态 = '已完成';
            更新操作.$set.完成时间 = toLocalISOString(new Date());
          }
          
          await 事件集合.updateOne({ 事件ID: 事件.事件ID }, 更新操作);
          
        } catch (e) {
          logger.error(`[事件调度器] 创建任务失败:`, e.message);
          await 事件集合.updateOne(
            { 事件ID: 事件.事件ID },
            { $set: { 状态: '活跃', 触发者实例: null, 触发时间: null } }
          );
        }
      }
      
      if (抢到事件数 > 0) {
        logger.info(`[事件调度器] 本轮触发 ${抢到事件数} 个事件`);
      }
      
    } catch (e) {
      logger.error('[事件调度器] 扫描失败:', e.message);
    }
    
    this.定时器 = setTimeout(() => this._定时扫描循环(), this.扫描间隔);
  }

  // ==================== 数据变更触发 ====================

  /**
   * 注册数据变更监听
   */
  async 注册变更监听(名称, 集合名, 条件, 任务模板, userId, 监听事件ID) {
    const userDb = getUserDb();
    const collection = userDb.collection(集合名);
    
    const pipeline = 条件 ? [{ $match: 条件 }] : [];
    const changeStream = collection.watch(pipeline);
    
    changeStream.on('change', async (change) => {
      logger.info(`[事件调度器] 检测到 ${集合名} 变更: ${change.operationType}`);
      
      try {
        const 抢锁结果 = await userDb.collection('事件').findOneAndUpdate(
          { 事件ID: 监听事件ID, 状态: '活跃' },
          { $set: { 状态: '已触发', 触发者实例: SERVER_INSTANCE_ID, 触发时间: toLocalISOString(new Date()) } },
          { returnDocument: 'after' }
        );
        if (!抢锁结果) return;
        
        const 任务 = this._创建任务文档(任务模板, userId);
        任务.routing.触发类型 = 'data_change';
        任务.routing.监听集合 = 集合名;
        任务.routing.变更类型 = change.operationType;
        任务.routing.变更文档ID = change.documentKey?._id?.toString();
        
        await userDb.collection('任务').insertOne(任务);

        await userDb.collection('事件').updateOne(
          { 事件ID: 监听事件ID },
          { $set: { 状态: '活跃', 触发者实例: null, 生成的任务ID: 任务.任务ID } }
        );

        this._事件触发后通知({ 事件ID: 监听事件ID, 事件名称: 名称, 事件类型: 'data_change', userId }, 1);

        logger.info(`[事件调度器] 数据变更事件 → 创建任务 ${任务.任务ID}`);
        
      } catch (e) {
        logger.error(`[事件调度器] 处理变更事件失败:`, e.message);
        await userDb.collection('事件').updateOne(
          { 事件ID: 监听事件ID },
          { $set: { 状态: '活跃', 触发者实例: null } }
        );
      }
    });
    
    this.changeStreams.push(changeStream);
    logger.info(`[事件调度器] 注册变更监听: ${名称} (集合: ${集合名})`);
  }

  /**
   * 启动已注册的变更监听
   */
  async _启动变更监听() {
    try {
      const userDb = getUserDb();
      const 事件集合 = userDb.collection('事件');
      
      const 监听列表 = await 事件集合.find({
        事件类型: 'data_change',
        状态: '活跃'
      }).toArray();
      
      for (const 监听 of 监听列表) {
        await this.注册变更监听(
          监听.事件名称,
          监听.触发源.监听集合,
          监听.触发源.监听条件,
          监听.任务模板,
          监听.userId,
          监听.事件ID
        );
      }
      
      if (监听列表.length > 0) {
        logger.info(`[事件调度器] 恢复 ${监听列表.length} 个变更监听`);
      }
    } catch (e) {
      logger.error('[事件调度器] 启动变更监听失败:', e.message);
    }
  }

  // ==================== 意图驱动事件 ====================

  async _启动意图事件变更监听() {
    try {
      const userDb = getUserDb();
      const 事件集合 = userDb.collection('事件');
      
      const changeStream = 事件集合.watch(
        [{
          $match: {
            operationType: 'update',
            'updateDescription.updatedFields.待处理触发': { $exists: true }
          }
        }],
        { fullDocument: 'updateLookup' }
      );
      
      changeStream.on('change', async (change) => {
        const 事件 = change.fullDocument;
        if (!事件) return;
        if (事件.事件类型 !== 'intent_driven') return;
        if (事件.状态 !== '活跃' && 事件.状态 !== '已耗尽') return;
        
        try {
          await this._处理意图事件触发(事件);
        } catch (e) {
          logger.error(`[事件调度器] 意图事件触发处理失败: ${e.message}`);
        }
      });
      
      changeStream.on('error', (e) => {
        logger.error(`[事件调度器] 意图事件Change Stream错误: ${e.message}`);
      });
      
      this.changeStreams.push(changeStream);
      this._意图事件Stream = changeStream;
      logger.info('[事件调度器] 意图事件变更监听已启动');
      
    } catch (e) {
      logger.error('[事件调度器] 启动意图事件变更监听失败:', e.message);
    }
  }

  async _处理意图事件触发(事件) {
    const { default: _处理意图事件触发_impl } = await import('./事件调度/意图事件触发处理.js');
    return _处理意图事件触发_impl.call(this, 事件, SERVER_INSTANCE_ID);
  }

  // ==================== 意图驱动事件公共方法 ====================

  async 检查事件限额(userId) {
    return _检查事件限额(userId);
  }

  async 注册意图驱动事件(条件描述, 动作描述, userId, 配置 = {}) {
    return _注册意图驱动事件(条件描述, 动作描述, userId, 配置, this);
  }

  async 追加事件处理动作(用户消息, 动作描述, userId) {
    return _追加事件处理动作(用户消息, 动作描述, userId, this);
  }

  // ==================== 语义触发 ====================

  async 注册语义事件(条件描述, 任务模板, userId, 配置 = {}) {
    return _注册语义事件(条件描述, 任务模板, userId, 配置);
  }

  async 检查语义触发(用户消息, userId, 配置 = {}) {
    return _检查语义触发(this, 用户消息, userId, 配置);
  }

  async _LLM精判语义触发(用户消息, 候选事件) {
    return _LLM精判语义触发(用户消息, 候选事件);
  }

  // ==================== 摘要触发 ====================

  async 摘要触发检查(对话摘要, 对话ID, userId, 上下文 = {}) {
    return _摘要触发检查(this, 对话摘要, 对话ID, userId, 上下文);
  }

  async _LLM精判事件匹配(用户消息, 候选事件) {
    return _LLM精判事件匹配(用户消息, 候选事件);
  }

  async _LLM精判摘要触发(对话摘要, 候选事件) {
    return _LLM精判摘要触发(对话摘要, 候选事件);
  }

  // ==================== 外部触发 ====================

  /**
   * 外部触发：直接创建 Branch Task
   */
  async 外部触发(任务模板, userId, 触发者 = null) {
    const userDb = getUserDb();
    const ts = createTimestampFields();
    
    const 任务 = this._创建任务文档(任务模板, userId);
    await userDb.collection('任务').insertOne(任务);
    
    await userDb.collection('事件').insertOne({
      事件ID: new ObjectId().toString(),
      事件类型: 'external',
      事件名称: 任务模板.名称 || '外部触发',
      触发源: { 类型: 'api', 触发者: 触发者 || userId },
      任务模板,
      状态: '已完成',
      生成的任务ID: 任务.任务ID,
      触发者实例: SERVER_INSTANCE_ID,
      触发时间: ts.localTime,
      userId,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp
    });
    
    logger.info(`[事件调度器] 外部触发 → 创建任务 ${任务.任务ID}`);
    this._事件触发后通知({ 事件ID: new ObjectId().toString(), 事件名称: 任务模板.名称 || '外部触发', 事件类型: 'external', userId }, 1);
    return 任务;
  }

  // ==================== 辅助方法 ====================

  /**
   * 事件触发后投递通知（异步，不阻塞触发流程）
   */
  _事件触发后通知(事件, 任务数量 = 1) {
    import('./通知服务.js').then(({ 投递通知 }) => {
      投递通知({
        userId: 事件.userId,
        来源类型: 'event',
        来源ID: 事件.事件ID,
        来源名称: 事件.事件名称 || '',
        标题: `事件触发: ${事件.事件名称 || 事件.事件类型}`,
        摘要: `${事件.事件类型}事件「${事件.事件名称 || ''}」已触发，创建了 ${任务数量} 个任务`,
      }).catch(e => logger.warn(`[事件调度器] 通知投递失败: ${e.message}`));
    }).catch(e => logger.warn(`[事件调度器] 通知服务加载失败: ${e.message}`));
  }

  /**
   * 创建任务文档（纯模板填值）
   */
  _创建任务文档(模板, userId, 事件ID = null) {
    const ts = createTimestampFields();
    
    if (!模板.用户消息) {
      throw new Error('任务模板缺少必需字段：用户消息');
    }
    
    return {
      任务ID: new ObjectId().toString(),
      类型: 'branch',
      用户消息: 模板.用户消息,
      描述: 模板.用户消息,
      routing: {
        category: 模板.分类 || '系统任务',
        complexity: 模板.复杂度 || 'medium',
        abilities: 模板.能力需求 || [],
        strategy: 模板.策略 || '探索调研',
        secondaryStrategy: 模板.辅助策略 || null,
        executionMode: 模板.执行模式 || '先规划后执行',
        来源: 'event',
        事件ID: 事件ID
      },
      状态: '等待中',
      userId: userId || 'system',
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp,
      更新时间: ts.localTime,
      更新时间戳: ts.timestamp
    };
  }

  /**
   * 计算下次触发时间
   */
  _计算下次触发时间(cron表达式) {
    return 计算下次触发时间(cron表达式);
  }
}

// 单例
let 调度器实例 = null;

/**
 * 获取事件调度器单例
 */
export function getEventScheduler() {
  if (!调度器实例) {
    调度器实例 = new 事件调度器();
  }
  return 调度器实例;
}

export default 事件调度器;
