/**
 * 禅道API适配器技能
 * 封装禅道API调用 — 任务CRUD/项目查询/迭代管理
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('zentao', { 前缀: '[zentao]', 级别: 'debug', 显示调用位置: true });

// 禅道API端点映射
const ZENTAO_API_MAP = {
  createTask: '/tasks',
  updateTask: '/tasks/{id}',
  getTask: '/tasks/{id}',
  listTasks: '/tasks',
  createStory: '/stories',
  getProject: '/projects/{id}',
  listProjects: '/projects',
  listExecutions: '/executions',
  getExecution: '/executions/{id}',
};

async function execute(args, context) {
  const { action = 'status', config = {}, params = {} } = args;

  logger.info(`执行: ${action}`);

  try {
    switch (action) {

      case 'status': {
        return {
          成功: true,
          数据: {
            connected: false,
            hint: '禅道连接未配置。请使用 action=config 配置禅道地址和Token。'
          }
        };
      }

      case 'config': {
        const { 地址, Token, 项目ID } = config;
        if (!地址 || !Token) {
          return { 成功: false, 错误: '缺少必填参数: 地址 和 Token' };
        }
        return {
          成功: true,
          数据: {
            地址,
            项目ID: 项目ID || null,
            hint: '禅道配置已保存（模拟模式）。实际连接需要服务端API代理。'
          }
        };
      }

      case 'create_task': {
        const { title, description, type = 'task', assignedTo, pri = 3 } = params;
        if (!title) return { 成功: false, 错误: '缺少必填参数: title' };

        return {
          成功: true,
          数据: {
            action: 'create_task',
            title, description, type, assignedTo, pri,
            apiEndpoint: ZENTAO_API_MAP.createTask,
            hint: '禅道任务创建请求已构建。实际API调用需要服务端代理。'
          }
        };
      }

      case 'update_task': {
        const { id, status, progress, comment } = params;
        if (!id) return { 成功: false, 错误: '缺少必填参数: id' };

        return {
          成功: true,
          数据: {
            action: 'update_task',
            id, status, progress, comment,
            apiEndpoint: ZENTAO_API_MAP.updateTask.replace('{id}', id),
            hint: '禅道任务更新请求已构建。'
          }
        };
      }

      case 'list_projects': {
        return {
          成功: true,
          数据: {
            action: 'list_projects',
            apiEndpoint: ZENTAO_API_MAP.listProjects,
            hint: '禅道项目列表请求已构建。'
          }
        };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'zentao',
  description: '禅道API适配器 — 任务CRUD/项目查询/迭代管理',
  abilities: ['进度管理', '任务管理'],

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'config', 'create_task', 'update_task', 'list_projects'],
        description: '操作类型'
      },
      config: { type: 'object', description: '禅道配置（config时使用）' },
      params: { type: 'object', description: '操作参数' }
    },
    required: ['action']
  },

  execute
};
