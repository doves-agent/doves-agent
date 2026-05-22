/**
 * 进度双向同步技能
 * 白鸽任务状态 ↔ 禅道/Jira 双向同步
 * 
 * 映射关系：
 * - Branch → Epic
 * - SubTask → Story
 * - READY → 开发中/In Progress
 * - COMPLETED → 已完成/Done
 * - FAILED → 已关闭/Closed
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('progress_sync', { 前缀: '[progress_sync]', 级别: 'debug', 显示调用位置: true });

// 白鸽状态 ↔ 外部状态 映射表
const STATUS_MAP = {
  zentao: {
    PENDING: '未开始',
    READY: '开发中',
    IN_PROGRESS: '开发中',
    COMPLETED: '已完成',
    FAILED: '已关闭',
  },
  jira: {
    PENDING: 'To Do',
    READY: 'In Progress',
    IN_PROGRESS: 'In Progress',
    COMPLETED: 'Done',
    FAILED: 'Closed',
  }
};

// 白鸽任务类型 ↔ 外部类型 映射表
const TYPE_MAP = {
  zentao: {
    Branch: 'epic',
    SubTask: 'story',
  },
  jira: {
    Branch: 'Epic',
    SubTask: 'Story',
  }
};

async function execute(args, context) {
  const { action = 'sync', platform = 'zentao', doveTask, externalTask, mapping } = args;

  logger.info(`执行: ${action}, platform: ${platform}`);

  try {
    switch (action) {

      case 'sync': {
        const result = {
          action: 'sync',
          platform,
          synced: false,
          hint: '同步操作已构建，实际同步需要外部系统API连接。'
        };

        // 白鸽→外部
        if (doveTask) {
          const doveStatus = doveTask.status || 'PENDING';
          const doveType = doveTask.type || 'SubTask';
          result.doveToExternal = {
            doveTaskId: doveTask.id,
            doveStatus,
            doveType,
            mappedExternalStatus: STATUS_MAP[platform]?.[doveStatus] || doveStatus,
            mappedExternalType: TYPE_MAP[platform]?.[doveType] || 'task',
          };
        }

        // 外部→白鸽
        if (externalTask) {
          result.externalToDove = {
            externalId: externalTask.id,
            externalStatus: externalTask.status,
            externalType: externalTask.type,
          };
        }

        return { 成功: true, 数据: result };
      }

      case 'mapping': {
        return {
          成功: true,
          数据: {
            statusMap: STATUS_MAP,
            typeMap: TYPE_MAP,
            description: '白鸽任务状态与外部系统的映射关系'
          }
        };
      }

      case 'register': {
        // 注册任务映射关系
        if (!mapping?.doveTaskId || !mapping?.externalId) {
          return { 成功: false, 错误: '缺少映射信息: doveTaskId 和 externalId' };
        }

        return {
          成功: true,
          数据: {
            action: 'register',
            mapping: {
              doveTaskId: mapping.doveTaskId,
              externalId: mapping.externalId,
              platform,
              registeredAt: new Date().toISOString()
            },
            hint: '任务映射已注册（模拟模式）'
          }
        };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}，支持: sync / mapping / register` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'progress_sync',
  description: '进度双向同步技能 — 白鸽任务状态与禅道/Jira双向同步',
  abilities: ['进度管理'],

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['sync', 'mapping', 'register'],
        description: '操作类型：sync=执行同步 / mapping=查看映射 / register=注册映射'
      },
      platform: { type: 'string', enum: ['zentao', 'jira'], description: '目标平台' },
      doveTask: { type: 'object', description: '白鸽任务信息' },
      externalTask: { type: 'object', description: '外部任务信息' },
      mapping: { type: 'object', description: '映射关系（register使用）' }
    },
    required: ['action']
  },

  execute
};
