/**
 * 文档执行器增强
 * 条件性系统提示词 + 代码变更→文档联动Hook
 */

import { 注册联动处理器 } from '../../tools/变更联动.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('文档', { 前缀: '[文档]', 级别: 'debug', 显示调用位置: true });

export default {
  conditionalPrompts: [
    {
      match: (任务, tools) => {
        const 能力需求 = 任务.能力需求 || [];
        return 能力需求.some(a => ['文档管理', '文档生成', '知识检索'].includes(a));
      },
      prompt: [
        '【文档工具优先级】',
        '- 生成文档 → doc_generate',
        '- 同步检查 → doc_sync_check',
        '- 同步修复 → doc_sync_fix',
        '- 模板管理 → doc_template',
        '- 语义搜索 → doc_search_semantic',
        '注意：文档生成前先扫描代码（code_read_file/code_symbols），映射关系存Git记忆',
      ].join('\n'),
    },
  ],

  hooks: {
    afterToolCall: async (工具名, 结果, 任务) => {
      // merge后触发文档同步建议
      if (工具名 === 'git_merge') {
        logger.info('检测到merge，建议检查文档是否需要同步');
      }
    }
  }
};

// 注册联动处理器：merge后建议文档同步
try {
  const { 注册联动处理器: 注册 } = await import('../../tools/变更联动.js');
  注册('document_on_merge', {
    match: (gitEvent) => gitEvent.type === 'merge',
    execute: async (gitEvent, 上下文) => {
      return { 建议: 'merge完成，建议使用 doc_sync_check 检查文档是否需要同步，使用 changelog 生成变更日志' };
    }
  }, '文档');
} catch { /* 模块加载时可能还未初始化 */ }
