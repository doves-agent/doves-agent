/**
 * Demo展示执行器增强
 * 条件性系统提示词 + 前端变更联动
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('Demo展示', { 前缀: '[Demo展示]', 级别: 'debug', 显示调用位置: true });

export default {
  conditionalPrompts: [
    {
      match: (任务, tools) => {
        const 能力需求 = 任务.能力需求 || [];
        return 能力需求.some(a => ['Demo展示', '页面生成', 'Demo模板'].includes(a));
      },
      prompt: [
        '【Demo展示工具优先级】',
        '- 创建Demo → demo_create',
        '- 更新Demo → demo_update',
        '- 数据→Demo → demo_from_data',
        '- 模板列表 → demo_template_list',
        '- 分享链接 → demo_share',
        '注意：Demo页面必须完整自包含（内联CSS/JS或CDN），自动托管到OSS',
      ].join('\n'),
    },
  ],

  hooks: {
    afterToolCall: async (工具名, 结果, 任务) => {
      // 前端文件变更后提示Demo更新
      if (工具名 === 'code_edit' && 结果?.path?.match(/\.(vue|jsx|tsx|css|scss)$/)) {
        logger.info('检测到前端文件变更，可考虑更新相关Demo页面');
      }
    }
  }
};

// 注册联动处理器：merge（前端变更）→ Demo更新
try {
  const { 注册联动处理器: 注册 } = await import('../../tools/变更联动.js');
  注册('demo_showcase_on_merge', {
    match: (gitEvent) => gitEvent.type === 'merge',
    execute: async (gitEvent, 上下文) => {
      return { 建议: 'merge完成，如果涉及前端变更，建议使用 demo_update 更新相关Demo页面' };
    }
  }, 'Demo展示');
} catch { /* 模块加载时可能还未初始化 */ }
