/**
 * 代码审查执行器增强
 * 条件性系统提示词 + 审查通过后的联动Hook
 */

import { 注册联动处理器 } from '../../tools/变更联动.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('代码审查', { 前缀: '[代码审查]', 级别: 'debug', 显示调用位置: true });

export default {
  conditionalPrompts: [
    {
      match: (任务, tools) => {
        const 能力需求 = 任务.能力需求 || [];
        return 能力需求.some(a => ['代码审查', '安全审查', '质量门禁'].includes(a));
      },
      prompt: [
        '【代码审查工具优先级】',
        '- PR审查 → review_pr',
        '- Diff审查 → review_diff',
        '- 规范检查 → review_checkstyle',
        '- 安全扫描 → review_security',
        '- 自动修复 → review_auto_fix',
        '- 质量门禁 → quality_gate（工具）或 quality_gate技能（配置+历史）',
        '- PR审查技能 → pr_review（review/full_diff/batch_review/preference_learn）',
        '- 复杂度分析 → review_complexity',
        '- 依赖审查 → review_dependencies',
        '- 历史分析 → review_history',
        '注意：审查后生成报告用 页面托管 托管，审查偏好存Git记忆',
      ].join('\n'),
    },
  ],

  hooks: {
    afterToolCall: async (工具名, 结果, 任务) => {
      // review_pr/quality_gate 审查通过后触发 review_pass 事件
      if (工具名 === 'review_pr' || 工具名 === 'quality_gate') {
        try {
          const text = 结果?.content?.[0]?.text || '';
          const parsed = JSON.parse(text);
          if (parsed.pass === true || parsed.score >= 80) {
            logger.info('审查通过，触发 review_pass 事件');
            // 触发审查通过事件
            try {
              const { 触发变更联动, 构建变更事件 } = await import('../../tools/变更联动.js');
              const event = 构建变更事件('review_pass', parsed, 任务);
              await 触发变更联动(event, { 任务 });
            } catch { /* 忽略 */ }
          }
        } catch { /* 忽略 */ }
      }
    }
  },
};

// 自动注册联动处理器
try {
  const { 注册联动处理器: 注册 } = await import('../../tools/变更联动.js');

  // commit后自动触发审查
  注册('code_review_on_commit', {
    match: (gitEvent) => gitEvent.type === 'commit',
    execute: async (gitEvent, 上下文) => {
      return { 建议: 'commit完成，建议使用 review_pr 进行代码审查' };
    }
  }, '代码审查');

  // merge后触发安全审查
  注册('code_review_on_merge', {
    match: (gitEvent) => gitEvent.type === 'merge',
    execute: async (gitEvent, 上下文) => {
      return { 建议: 'merge完成，建议使用 review_security 进行安全扫描' };
    }
  }, '代码审查');

} catch { /* 模块加载时可能还未初始化 */ }
