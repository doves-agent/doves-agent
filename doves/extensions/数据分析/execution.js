/**
 * 数据统计执行器增强
 * 条件性系统提示词 + 定时统计联动
 */

export default {
  conditionalPrompts: [
    {
      match: (任务, tools) => {
        const 能力需求 = 任务.能力需求 || [];
        return 能力需求.some(a => ['数据分析', '数据查询', '数据可视化', '报表生成'].includes(a));
      },
      prompt: [
        '【数据分析工具优先级】',
        '- 数据查询 → data_query',
        '- 数据可视化 → data_visualize',
        '- 数据报告 → data_report',
        '- 数据源管理 → data_source_manage',
        '- 异常检测 → data_anomaly_check',
        '注意：数据查询只读优先，写入需确认。敏感信息加密存储。',
      ].join('\n'),
    },
  ],

  hooks: {}
};

// 注册联动处理器：定时事件 → 数据统计汇总
try {
  const { 注册联动处理器: 注册 } = await import('../../tools/变更联动.js');
  注册('data_analytics_on_scheduled', {
    match: (gitEvent) => gitEvent.type === 'scheduled',
    execute: async (gitEvent, 上下文) => {
      return { 建议: '定时事件触发，建议使用 data_report 生成数据统计汇总报表' };
    }
  }, '数据分析');
} catch { /* 模块加载时可能还未初始化 */ }
