/**
 * @file tools/分支工具-查询汇总
 * @description Branch Task 查询、子任务获取、结果汇总方法
 * @generated 由 分支工具.js 拆分，KISS 原则
 */

import { toLocalISOString, getTimestamp } from '@dove/common/时间工具.js';
import { 任务状态, 任务类型 } from '../常量.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('分支工具查询', { 前缀: '[分支工具]', 级别: 'debug', 显示调用位置: true });

/**
 * 分支工具查询汇总 Mixin
 * 包含所有只读查询和聚合方法
 */
export const 查询汇总Mixin = {
  /**
   * 获取 Branch Task
   */
  async getBranchTask(taskId, userId) {
    if (!this.database) return null;
    const db = this.database.db(this.用户数据库名);
    return await db.collection('任务').findOne({ 
      任务ID: taskId,
      类型: 任务类型.分支
    });
  }

  /**
   * 获取 SubTask
   * 支持查询所有深度的子任务（subtask, subtask_d1, subtask_d2...）
   */,
  async getSubTask(taskId, userId) {
    if (!this.database) return null;
    const db = this.database.db(this.用户数据库名);
    return await db.collection('任务').findOne({ 
      任务ID: taskId,
      类型: { $regex: "^subtask(_d\\d+)?$" }
    });
  }

  /**
   * 等待子任务完成
   */,
  async waitForChildren(branchTaskId, userId, 选项 = {}) {
    const timeout = 选项.timeout || 60000;
    const interval = 选项.interval || 1000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const branch = await this.getBranchTask(branchTaskId, userId);
      if (!branch) throw new Error('Branch Task 不存在');

      const { 总数, 已完成, 已失败 } = branch.子任务状态;
      
      if (已完成 + 已失败 >= 总数) {
        return { 完成: true, 总数, 已完成, 已失败, 子任务: branch.子任务 };
      }

      await new Promise(resolve => setTimeout(resolve, interval));
    }

    const branch = await this.getBranchTask(branchTaskId, userId);
    return { 完成: false, 超时: true, ...branch.子任务状态 };
  }

  /**
   * 获取 Branch 的所有 SubTask
   * 支持查询任意父任务的子任务（不限于Branch），用于递归拆分场景
   */,
  async getSubTasks(parentTaskId, userId, 选项 = {}) {
    if (!this.database) return [];
    const db = this.database.db(this.用户数据库名);
    // 默认只查第一层子任务；包含子子任务时，匹配所有深度类型
    const 类型条件 = 选项.包含子子任务 
      ? { $regex: "^subtask(_d\\d+)?$" }
      : 任务类型.子任务;
    const query = { 父任务ID: parentTaskId, 类型: 类型条件 };
    logger.debug(`getSubTasks 查询条件: ${JSON.stringify(query)}`);
    const results = await db.collection('任务')
      .find(query)
      .sort({ 创建时间戳: 1 })
      .toArray();
    logger.debug(`getSubTasks 结果数量: ${results.length}`);
    return results;
  }

  /**
   * 获取 SubTask 的结果
   */,
  async getSubTaskResults(branchTaskId, userId) {
    const subTasks = await this.getSubTasks(branchTaskId, userId);
    return subTasks.map(task => ({
      任务ID: task.任务ID,
      技能: task.技能,
      状态: task.状态,
      结果: task.结果,
      错误: task.错误
    }));
  }

  /**
   * 获取可执行的子任务（依赖已满足）
   */,
  async getExecutableSubTasks(branchTaskId, userId) {
    const subTasks = await this.getSubTasks(branchTaskId, userId);
    
    // 可执行的子任务 = READY 状态（已完成能力准备）
    return subTasks.filter(task => task.状态 === 任务状态.READY);
  }

  /**
   * 按依赖顺序获取执行计划
   */,
  async getExecutionPlan(branchTaskId, userId) {
    const subTasks = await this.getSubTasks(branchTaskId, userId);
    const taskMap = new Map(subTasks.map(t => [t.任务ID, t]));
    const 阶段 = [];
    const assigned = new Set();
    
    logger.debug(`getExecutionPlan: 共 ${subTasks.length} 个子任务`);
    for (const task of subTasks) {
      logger.debug(`  - ${task.任务ID.slice(-12)}: 依赖=[${(task.依赖 || []).map(d => d.slice(-8)).join(', ')}], 状态=${task.状态}`);
    }
        
    while (assigned.size < subTasks.length) {
      const currentPhase = subTasks.filter(task => {
        if (assigned.has(task.任务ID)) return false;
        if (!task.依赖 || task.依赖.length === 0) return true;
        return task.依赖.every(depId => assigned.has(depId));
      });
      
      logger.debug(`阶段 ${阶段.length + 1}: ${currentPhase.length} 个任务可执行`);
          
      if (currentPhase.length === 0) {
        const remaining = subTasks.filter(t => !assigned.has(t.任务ID));
        if (remaining.length > 0) {
          logger.warn(`可能存在循环依赖，剩余 ${remaining.length} 个任务强制并行`);
          阶段.push(remaining.map(t => t.任务ID));
          remaining.forEach(t => assigned.add(t.任务ID));
        }
        break;
      }
          
      阶段.push(currentPhase.map(t => t.任务ID));
      currentPhase.forEach(t => assigned.add(t.任务ID));
    }
    
    logger.debug(`执行计划: ${阶段.length} 个阶段`);
    for (let i = 0; i < 阶段.length; i++) {
      logger.debug(`  阶段${i + 1}: [${阶段[i].map(id => id.slice(-8)).join(', ')}]`);
    }
    
    return { 阶段, 总数: subTasks.length };
  }

  /**
   * 汇总子任务结果
   */,
  async aggregateResults(branchTaskId, userId) {
    const subTasks = await this.getSubTasks(branchTaskId, userId);
    
    const 成功任务 = subTasks.filter(t => t.状态 === 任务状态.COMPLETED);
    const 失败任务 = subTasks.filter(t => t.状态 === 任务状态.FAILED);
    
    // 按技能分类结果
    const resultsBySkill = {};
    for (const task of 成功任务) {
      const skillKey = task.技能;
      if (!resultsBySkill[skillKey]) {
        resultsBySkill[skillKey] = [];
      }
      resultsBySkill[skillKey].push({
        任务ID: task.任务ID,
        描述: task.描述,
        结果: task.结果
      });
    }
    
    return {
      总数: subTasks.length,
      成功数: 成功任务.length,
      失败数: 失败任务.length,
      resultsBySkill,
      失败详情: 失败任务.map(t => ({
        任务ID: t.任务ID,
        技能: t.技能,
        错误: t.错误
      }))
    };
  }
};
