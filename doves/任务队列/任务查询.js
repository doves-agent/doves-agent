/**
 * 任务队列 - 任务查询 mixin
 * 从 任务队列.js 提取
 */

import { 任务状态 } from '../常量.js';

export function mixinTaskQuery(instance) {
  /**
   * 按状态查询任务
   */
  instance.按状态查询 = async function(状态, 过滤条件 = {}) {
    const collection = instance._获取集合();
    if (collection) {
      return await collection.find({ 状态: 状态, ...过滤条件 }).toArray();
    }
    return [];
  };

  /**
   * 获取待处理任务数量
   */
  instance.获取待处理数量 = async function() {
    const 任务列表 = await instance.按状态查询(任务状态.PENDING);
    return 任务列表.length;
  };

  /**
   * 获取用户的所有任务
   */
  instance.获取用户任务 = async function(用户ID) {
    const collection = instance._获取集合();
    if (collection) {
      return await collection.find({
        $or: [{ 用户ID }, { userId: 用户ID }]
      }).sort({ 创建时间戳: -1 }).toArray();
    }
    return [];
  };
}
