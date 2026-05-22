/**
 * 进度管理执行器增强
 * 条件性系统提示词 + commit→任务状态联动
 */

import { 注册联动处理器 } from '../../tools/变更联动.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('进度管理', { 前缀: '[进度管理]', 级别: 'debug', 显示调用位置: true });

export default {
  conditionalPrompts: [
    {
      match: (任务, tools) => {
        const 能力需求 = 任务.能力需求 || [];
        return 能力需求.some(a => ['进度管理', '任务管理', '项目跟踪'].includes(a));
      },
      prompt: [
        '【进度管理工具优先级】',
        '- 创建任务 → task_create',
        '- 更新任务 → task_update',
        '- 查询任务 → pm_task_query',
        '- 状态同步 → task_sync',
        '- 进度报告 → progress_report',
        '- 里程碑管理 → milestone_manage',
        '注意：白鸽任务与禅道/Jira双向同步，不替代内部状态机。外部Token加密存储。',
      ].join('\n'),
    },
  ],

  hooks: {
    afterToolCall: async (工具名, 结果, 任务) => {
      // commit后触发任务状态同步建议
      if (工具名 === 'Git操作' && 结果?.action === 'commit') {
        logger.info('检测到commit，建议同步任务状态到禅道/Jira');
      }
    }
  }
};

// 注册联动处理器：commit后建议任务状态同步
try {
  const { 注册联动处理器: 注册 } = await import('../../tools/变更联动.js');
  注册('project_mgmt_on_commit', {
    match: (gitEvent) => gitEvent.type === 'commit',
    execute: async (gitEvent, 上下文) => {
      return { 建议: 'commit完成，建议使用 task_sync 同步任务状态到禅道/Jira' };
    }
  }, '进度管理');
} catch { /* 模块加载时可能还未初始化 */ }
