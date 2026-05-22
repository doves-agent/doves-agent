/**
 * Jira API适配器技能
 * 封装Jira REST API调用 — Issue CRUD/项目查询/Sprint管理
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('jira', { 前缀: '[jira]', 级别: 'debug', 显示调用位置: true });

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
            hint: 'Jira连接未配置。请使用 action=config 配置Jira地址和Token。'
          }
        };
      }

      case 'config': {
        const { baseUrl, email, apiToken, projectKey } = config;
        if (!baseUrl || !email || !apiToken) {
          return { 成功: false, 错误: '缺少必填参数: baseUrl, email, apiToken' };
        }
        return {
          成功: true,
          数据: {
            baseUrl,
            projectKey: projectKey || null,
            hint: 'Jira配置已保存（模拟模式）。实际连接需要服务端API代理。'
          }
        };
      }

      case 'create_issue': {
        const { summary, description, issueType = 'Task', priority = 'Medium', assignee, projectKey } = params;
        if (!summary) return { 成功: false, 错误: '缺少必填参数: summary' };

        return {
          成功: true,
          数据: {
            action: 'create_issue',
            summary, description, issueType, priority, assignee,
            projectKey,
            apiEndpoint: '/rest/api/3/issue',
            hint: 'Jira Issue创建请求已构建。实际API调用需要服务端代理。'
          }
        };
      }

      case 'update_issue': {
        const { key, status, comment } = params;
        if (!key) return { 成功: false, 错误: '缺少必填参数: key' };

        return {
          成功: true,
          数据: {
            action: 'update_issue',
            key, status, comment,
            apiEndpoint: `/rest/api/3/issue/${key}`,
            hint: 'Jira Issue更新请求已构建。'
          }
        };
      }

      case 'list_sprints': {
        const { boardId } = params;
        return {
          成功: true,
          数据: {
            action: 'list_sprints',
            boardId,
            apiEndpoint: `/rest/agile/1.0/board/${boardId || 'BOARD_ID'}/sprint`,
            hint: 'Jira Sprint列表请求已构建。'
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
  name: 'jira',
  description: 'Jira API适配器 — Issue CRUD/项目查询/Sprint管理',
  abilities: ['进度管理', '任务管理'],

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'config', 'create_issue', 'update_issue', 'list_sprints'],
        description: '操作类型'
      },
      config: { type: 'object', description: 'Jira配置' },
      params: { type: 'object', description: '操作参数' }
    },
    required: ['action']
  },

  execute
};
