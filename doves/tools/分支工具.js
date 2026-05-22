/**
 * @file tools/分支工具
 * @description Branch Task 和 SubTask 的操作方法
 */

import { toLocalISOString, getTimestamp } from '@dove/common/时间工具.js';
import { 任务状态, 任务类型, 最大拆分深度, 获取深度任务类型, 是否子任务类型 } from '../常量.js';
import { ObjectId } from '@dove/common/对象标识.js';
import { 查询汇总Mixin } from './分支工具-查询汇总.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('分支工具', { 前缀: '[分支工具]', 级别: 'debug', 显示调用位置: true });

/**
 * 分支工具类
 */
export class BranchTools {
  constructor(配置 = {}) {
    this.database = 配置.database;
    this.用户数据库名 = 配置.用户数据库名 || 'doves_user_data';
  }

  /**
   * 创建 Branch Task
   */
  async createBranchTask({
    conversationId,
    turnId,
    routing,
    userId,
    userMessage,
    attachments = []
  }) {
    if (!this.database) {
      throw new Error('数据库未连接');
    }

    const db = this.database.db(this.用户数据库名);
    const tasks = db.collection('任务');

    const now = toLocalISOString();
    const nowTs = getTimestamp();

    const taskId = new ObjectId().toString();
    const task = {
      任务ID: taskId,  // 业务 ID
      类型: 任务类型.分支,
      状态: 任务状态.READY,  // Branch 任务不需要 Flash 填充能力，直接就绪
      用户ID: userId,  // 用于隔离不同用户的任务
          
      对话ID: conversationId,
      轮次ID: turnId,
      routing,
      用户消息: userMessage,
      attachments,
          
      计划: null,
      子任务列表: [],
      子任务状态: { 总数: 0, 已完成: 0, 已失败: 0 },
      摘要: null,
          
      执行模型: null,
      执行者: null,
      心跳时间: null,
      心跳时间戳: null,
          
      创建时间: now,
      创建时间戳: nowTs,
      更新时间: now,
      更新时间戳: nowTs,
      完成时间: null,
      完成时间戳: null
    };

    await tasks.insertOne(task);
    
    logger.info(`创建 Branch Task: ${task._id}, userId: ${userId}`);

    return task;
  }

  /**
   * 创建 SubTask
   * @param {Object} 参数 - 创建参数
   * @param {number} 参数.拆分深度 - 递归拆分深度（0=Branch下第一层，1=第二层，2=第三层）
   * @param {boolean} 参数.needsDecomposition - 是否需要继续拆分
   */
  async createSubTask({
    parentTaskId,
    conversationId,
    turnId,
    userId,
    skill,
    params,
    model,
    description,
    role = '',
    abilities,
    toolRiskLevel = '谨慎',
    dependencies = [],
    拆分深度 = 0,
    needsDecomposition = false,
    执行配置 = null,
    来源 = 'remote',
    IM上下文 = null,
    压缩上下文 = null,
    机器亲和 = false,
    串行保障 = false,
    策略 = null,
    suggestedDirection = null,
  }) {
    if (!this.database) {
      throw new Error('数据库未连接');
    }

    const db = this.database.db(this.用户数据库名);
    const tasks = db.collection('任务');

    const now = toLocalISOString();
    const nowTs = getTimestamp();

    // 根据深度选择任务类型：深度0→subtask，深度1→subtask_d1，深度2→subtask_d2...
    const taskType = 获取深度任务类型(拆分深度);
    const taskId = new ObjectId().toString();

    // 查找根任务ID（沿父链向上查找）
    const parentTask = await tasks.findOne({ 任务ID: parentTaskId });
    const rootTaskId = parentTask?.根任务ID || parentTaskId;

    const task = {
      任务ID: taskId,  // 业务 ID
      类型: taskType,
      状态: 任务状态.PENDING,
      用户ID: userId,  // 用于隔离不同用户的任务
          
      父任务ID: parentTaskId,
      根任务ID: rootTaskId,  // 一直指向最顶层的 routing 任务
      对话ID: conversationId,
      轮次ID: turnId,
          
      技能: skill,
      描述: description || `执行 ${skill}`,
      role,                          // 子任务角色感知（collector/analyst/aggregator/validator/creator）
      能力需求: abilities || [],
      工具安全级别: toolRiskLevel,
      机器亲和,                   // 来自路由器的机器亲和标识，SubTask执行时用于自动提升安全级别
      串行保障,                   // 来自路由器的串行保障标识，SubTask执行时用于决定工具调用并行/串行
      策略,                       // 来自路由器的执行策略，SubTask执行时用于判断是否需要系统级工具
      suggestedDirection,
      参数: params || {},
      依赖: dependencies || [],  // 依赖的其他子任务ID
      
      拆分深度,               // 递归深度
      needsDecomposition,     // 是否需要继续拆分
      子任务列表: [],          // 递归子任务ID列表
      子任务状态: { 总数: 0, 已完成: 0, 已失败: 0 },  // 递归子任务状态
          
      结果: null,
      错误: null,
          
      执行模型: model,
      执行者: null,
      心跳时间: null,
      心跳时间戳: null,
          
      创建时间: now,
      创建时间戳: nowTs,
      更新时间: now,
      更新时间戳: nowTs,
      完成时间: null,
      
      来源,  // 来源渠道（全链路传递）
      
      完成时间戳: null,

      // IM 上下文（从父任务继承，让技能感知 IM 平台信息）
      IM上下文,

      // 对话历史压缩上下文（从父任务routing继承，让子任务感知对话历史）
      压缩上下文,
    };

    // 传递执行配置到子任务
    if (执行配置) {
      task.执行配置 = 执行配置;
    }

    await tasks.insertOne(task);

    // 更新父任务的 子任务列表
    // 只用 任务ID 查询父任务，不传 用户ID 避免与 Server injectUserId 冲突
    const updateResult = await tasks.updateOne(
      { 任务ID: parentTaskId },
      {
        $push: { 子任务列表: task.任务ID },
        $inc: { '子任务状态.总数': 1 }
      }
    );
    logger.debug(`更新父任务 ${parentTaskId} 结果: ${updateResult.modifiedCount}`);

    return task;
  }

  /**
   * 批量创建 SubTask
   * @param {string} parentTaskId - 父任务ID
   * @param {Array} subTaskDefs - 子任务定义列表
   * @param {Object} context - 上下文
   * @param {number} 拆分深度 - 递归深度
   */
  async createSubTasks(parentTaskId, subTaskDefs, context, 拆分深度 = 0, 执行配置 = null) {
    const tasks = [];
    for (const def of subTaskDefs) {
      const task = await this.createSubTask({
        parentTaskId,
        conversationId: context.对话ID,
        turnId: context.轮次ID,
        userId: context.用户ID,
        skill: def.skill,
        params: def.params,
        model: def.model,
        description: def.description,
        role: def.role || '',
        abilities: def.abilities,
        toolRiskLevel: def.toolRiskLevel || '谨慎',
        dependencies: def.dependencies,
        拆分深度,
        needsDecomposition: def.needsDecomposition || false,
        执行配置,
        来源: context.来源 || 'remote',
        IM上下文: context.IM上下文 || null,
        压缩上下文: context.压缩上下文 || null,
        机器亲和: context.机器亲和 || false,
        串行保障: context.串行保障 || false,
        策略: context.策略 || null,
        suggestedDirection: context.suggestedDirection || null,
      });
      tasks.push(task);
    }
    return tasks;
  }

  /**
   * 更新 Branch 状态（含心跳）
   * @param {string} taskId - 任务ID
   * @param {string} userId - 用户ID
   * @param {string} status - 任务状态
   * @param {Object} extra - 附加更新字段（如 执行模型）
   */
  async updateBranchStatus(taskId, userId, status, extra = {}) {
    if (!this.database) return;
    const db = this.database.db(this.用户数据库名);
    const updateFields = {
      状态: status,
      心跳时间: toLocalISOString(),
      心跳时间戳: getTimestamp(),
      更新时间: toLocalISOString(),
      更新时间戳: getTimestamp(),
      ...extra
    };
    await db.collection('任务').updateOne(
      { 任务ID: taskId },
      { $set: updateFields }
    );
  }

  /**
   * 更新 Branch 摘要
   * @param {string} taskId - 任务ID
   * @param {string} userId - 用户ID
   * @param {string} summary - 执行摘要
   */
  async updateBranchSummary(taskId, userId, summary) {
    if (!this.database) return;
    const db = this.database.db(this.用户数据库名);
    await db.collection('任务').updateOne(
      { 任务ID: taskId },
      { $set: { 摘要: summary, 更新时间: toLocalISOString(), 更新时间戳: getTimestamp() } }
    );
  }

  /**
   * 更新 Branch 规划结果
   * @param {string} taskId - 任务ID
   * @param {string} userId - 用户ID
   * @param {Object} planResult - 规划结果
   */
  async updateBranchPlan(taskId, userId, planResult) {
    if (!this.database) return;
    const db = this.database.db(this.用户数据库名);
    const 计划 = {
      subTasks: (planResult.subTasks || []).map(st => ({
        id: st.id,
        description: st.description,
        skill: st.skill,
        dependencies: st.dependencies || []
      })),
      策略信息: planResult.策略信息 || null,
      管线阶段: planResult.管线阶段 || null,
      收敛条件: planResult.收敛条件 || null
    };
    await db.collection('任务').updateOne(
      { 任务ID: taskId },
      { $set: { 计划, 更新时间: toLocalISOString(), 更新时间戳: getTimestamp() } }
    );
  }

  /**
   * 更新 SubTask 状态和结果
   * @param {string} taskId - 子任务ID
   * @param {string} userId - 用户ID
   * @param {string} status - 任务状态
   * @param {Object} result - 任务结果（成功时）或错误信息（失败时）
   */
  async updateSubTaskResult(taskId, userId, status, result = null) {
    if (!this.database) return;
    const db = this.database.db(this.用户数据库名);
    const now = toLocalISOString();
    const nowTs = getTimestamp();

    const updateFields = {
      状态: status,
      更新时间: now,
      更新时间戳: nowTs
    };

    // 终态时设置完成时间
    if (status === 任务状态.COMPLETED || status === 任务状态.FAILED || status === 任务状态.CANCELLED) {
      updateFields.完成时间 = now;
      updateFields.完成时间戳 = nowTs;
    }

    // 运行中状态更新心跳
    if (status === 任务状态.RUNNING || status === 任务状态.WAITING_CHILDREN) {
      updateFields.心跳时间 = now;
      updateFields.心跳时间戳 = nowTs;
    }

    // 写入结果或错误
    if (result !== null && result !== undefined) {
      if (status === 任务状态.FAILED) {
        updateFields.错误 = result;
      } else {
        updateFields.结果 = result;
      }
    }

    await db.collection('任务').updateOne(
      { 任务ID: taskId },
      { $set: updateFields }
    );

    // 更新父任务的子任务状态计数
    const subTask = await db.collection('任务').findOne({ 任务ID: taskId });
    if (subTask?.父任务ID) {
      const parentUpdate = {};
      if (status === 任务状态.COMPLETED) {
        parentUpdate['子任务状态.已完成'] = 1;
      } else if (status === 任务状态.FAILED) {
        parentUpdate['子任务状态.已失败'] = 1;
      }
      if (Object.keys(parentUpdate).length > 0) {
        await db.collection('任务').updateOne(
          { 任务ID: subTask.父任务ID },
          { $inc: parentUpdate }
        );
      }
    }
  }

  // 查询与汇总方法由 查询汇总Mixin 注入（见 分支工具-查询汇总.js）
}

// 注入查询汇总 Mixin
Object.assign(BranchTools.prototype, 查询汇总Mixin);

export default BranchTools;
