/**
 * 任务队列 - 子任务管理 mixin
 * 从 任务队列.js 提取
 */

import { 任务状态 } from '../常量.js';
import { createTimestampFields } from '@dove/common/时间工具.js';
import { ObjectId } from '@dove/common/对象标识.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('队列-子任务', { 前缀: '[队列/子任务]', 级别: 'debug', 显示调用位置: true });

export function mixinSubtaskManagement(instance) {
  /**
   * 查询子任务
   */
  instance.获取子任务 = async function(父任务ID) {
    logger.debug(`获取任务 ${父任务ID} 的子任务`);
    const 状态 = await instance.查询子任务状态(父任务ID);
    return 状态.子任务列表 || [];
  };

  /**
   * 创建子任务（由主任务的鸽子调用）
   */
  instance.创建子任务 = async function(父任务ID, 子任务数据, 根任务ID = null) {
    logger.info(`为任务 ${父任务ID} 创建子任务`);
    const 子任务 = await instance.创建任务({
      ...子任务数据,
      父任务ID: 父任务ID,
      根任务ID: 根任务ID || 父任务ID,
      类型: 子任务数据.类型 || 'subtask',  // 子任务类型标记，防止被非子任务抢取条件匹配
      状态: 任务状态.PENDING
    });
    return 子任务;
  };

  /**
   * 批量创建子任务
   * 始终走 创建子任务 → 创建任务 路径，确保所有字段完整
   * （之前 bulkWrite 快捷路径绕过了 创建任务，缺失 类型 等关键字段，
   *  导致子任务匹配了非子任务的抢取条件，引发重复执行）
   */
  instance.批量创建子任务 = async function(父任务ID, 子任务列表, 根任务ID = null) {
    logger.info(`批量创建 ${子任务列表.length} 个子任务`);
    const 创建结果列表 = [];
    for (const 子任务数据 of 子任务列表) {
      const 子任务 = await instance.创建子任务(父任务ID, 子任务数据, 根任务ID);
      创建结果列表.push(子任务);
    }
    return 创建结果列表;
  };

  /**
   * 查询子任务状态（实时从 MongoDB 查询，不缓存）
   */
  instance.查询子任务状态 = async function(父任务ID) {
    let 子任务列表 = [];
    const collection = instance._获取集合();
    if (collection) {
      子任务列表 = await collection.find({ 父任务ID: 父任务ID }).toArray();
    }
    const 总数 = 子任务列表.length;
    const 完成数 = 子任务列表.filter(t => t.状态 === 任务状态.COMPLETED).length;
    const 失败数 = 子任务列表.filter(t => t.状态 === 任务状态.FAILED).length;
    const 全部完成 = 总数 > 0 && 完成数 + 失败数 === 总数;
    return { 全部完成, 完成数, 失败数, 总数, 子任务列表 };
  };

  /**
   * 检查子任务是否全部完成
   */
  instance.子任务是否全部完成 = async function(父任务ID) {
    const 状态 = await instance.查询子任务状态(父任务ID);
    return 状态.全部完成;
  };

  /**
   * 等待子任务全部完成（轮询 MongoDB）
   */
  instance.等待子任务 = async function(父任务ID, 轮询间隔 = 1000, 超时时间 = 300000) {
    const 开始时间 = Date.now();
    while (Date.now() - 开始时间 < 超时时间) {
      const 状态 = await instance.查询子任务状态(父任务ID);
      if (状态.全部完成) {
        return { 成功: true, 子任务状态: 状态 };
      }
      await new Promise(resolve => setTimeout(resolve, 轮询间隔));
    }
    return { 成功: false, 错误: '等待子任务超时' };
  };

  /**
   * 获取任务树（只读查询）
   */
  instance.获取任务树 = async function(根任务ID) {
    const collection = instance._获取集合();
    if (!collection) return null;
    const 根任务 = await instance.获取任务(根任务ID);
    if (!根任务) return null;
    const 所有任务 = await collection.find({ 根任务ID: 根任务ID }).toArray();
    const 构建子树 = (任务) => {
      const 子任务们 = 所有任务.filter(t => t.父任务ID === 任务.任务ID);
      return { ...任务, children: 子任务们.map(子任务 => 构建子树(子任务)) };
    };
    return 构建子树(根任务);
  };
}
