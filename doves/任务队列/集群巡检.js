/**
 * 任务队列 - 集群健康度巡检 mixin
 * 从 任务队列.js 提取
 */

import { 任务状态 } from '../常量.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('集群巡检', { 前缀: '[集群巡检]', 级别: 'debug', 显示调用位置: true });

export function mixinClusterHealth(instance) {
  /**
   * 获取集群能力快照
   * 查询管理库鸽子身份集合，统计在线鸽子的能力分布
   */
  instance.获取集群能力快照 = async function(能力列表, 管理数据库连接 = null) {
    const 快照 = {
      在线鸽子数: 0,
      具备能力鸽子数: 0,
      具备能力且空闲鸽子数: 0,
      队列中同需求任务数: 0,
      能力分布: {},
      鸽子详情: []
    };

    try {
      let 在线鸽子 = [];

      if (管理数据库连接) {
        const adminDb = 管理数据库连接.db(process.env.MONGODB_ADMIN_DB || 'doves_admin');
        在线鸽子 = await adminDb.collection('鸽子身份')
          .find({ 状态: '在线' }, {
            projection: { 鸽子ID: 1, 能力列表: 1, 限制: 1, 统计: 1, 当前任务ID: 1 }
          })
          .toArray();
      } else if (instance.代理 && instance.代理.adminDbOperation) {
        const 结果 = await instance.代理.adminDbOperation('鸽子身份', 'find', {
          query: { 状态: '在线' },
          projection: { 鸽子ID: 1, 能力列表: 1, 限制: 1, 统计: 1, 当前任务ID: 1 }
        });
        在线鸽子 = 结果?.data || [];
      }

      快照.在线鸽子数 = 在线鸽子.length;

      const 能力集合 = new Set(能力列表);
      for (const 鸽子 of 在线鸽子) {
        const 鸽子能力 = 鸽子.能力列表 || [];
        const 最大并发数 = 鸽子.限制?.最大并发数 || 1;
        const 当前忙碌 = 鸽子.当前任务ID ? 1 : 0;

        const 详情 = { 鸽子ID: 鸽子.鸽子ID, 能力列表: 鸽子能力, 当前任务数: 当前忙碌, 最大并发数 };
        快照.鸽子详情.push(详情);

        const 具备所需能力 = 能力集合.size === 0 || 能力列表.some(能力 => 鸽子能力.includes(能力));
        if (具备所需能力) {
          快照.具备能力鸽子数++;
          if (当前忙碌 === 0) {
            快照.具备能力且空闲鸽子数++;
          }
        }

        for (const 能力 of 鸽子能力) {
          快照.能力分布[能力] = (快照.能力分布[能力] || 0) + 1;
        }
      }

      try {
        const collection = instance._获取集合();
        if (collection) {
          const 排队查询 = 能力列表.length > 0
            ? { 状态: { $in: [任务状态.PENDING, 任务状态.READY] }, 所需能力: { $in: 能力列表 } }
            : { 状态: { $in: [任务状态.PENDING, 任务状态.READY] } };
          快照.队列中同需求任务数 = await collection.countDocuments(排队查询);
        }
      } catch (e) { logger.warn(`查询排队任务数失败: ${e.message}`); }
    } catch (e) {
      logger.warn(`获取集群能力快照失败: ${e.message}`);
    }

    return 快照;
  };
}
