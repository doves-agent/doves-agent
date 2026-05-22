/**
 * 审计回顾规划策略
 * audit_query 走 simple_execution 直接执行，不需要复杂规划
 * 但如果用户的问题是复合型的（如"帮我看看最近一周的详细报告"），可能需要多步查询
 */
import { 生成策略提示词, 生成用户提示词 } from '../../prompts/strategy-base.js';

const 方法论段落 = [
  '【审计回顾能力组】',
  '',
  '本扩展提供以下原子工具，可独立调用、自由组合：',
  '',
  '1. 对话审计工具',
  '   audit_conversation_list：对话列表（支持关键词/时间过滤）',
  '   audit_conversation_detail：对话详情（需要对话ID）',
  '',
  '2. 任务审计工具',
  '   audit_task_detail：任务详情（需要任务ID）',
  '   audit_task_trace：执行轨迹，显示LLM调用/工具调用链（需要任务ID）',
  '',
  '3. 鸽子活动工具',
  '   audit_dove_activity：各鸽子执行统计',
  '',
  '4. 使用统计工具',
  '   audit_usage_stats：任务数/技能排行/模型排行/时间趋势',
  '',
  '【流程案例】（参考，非强制）',
  '- 查看最近对话：audit_conversation_list → audit_conversation_detail',
  '- 追溯任务执行：audit_conversation_list(找到对话) → audit_task_detail → audit_task_trace',
  '- 了解鸽子活动：audit_dove_activity',
  '- 使用趋势分析：audit_usage_stats',
  '',
  '【关键规则】',
  '- 根据用户实际需求灵活组合工具，流程案例仅为参考',
  '- 用户没有提供具体ID时，先用列表工具获取再查详情',
  '- 不要原样输出JSON，整理成人类可读的报告',
  '- 用表格、列表、时间线等方式组织信息，突出用户关心的重点',
].join('\n');

const 方法论指引 = '请根据用户实际需求，从审计回顾能力组中选择合适的工具组合。流程案例仅供参考，不必拘泥于固定流程。使用 audit_ 开头的审计工具查询，结果整理为人类可读报告。';

export default {
  strategies: {
    audit_query: {
      系统: (最大子任务数 = 5, 当前深度 = 0) => 生成策略提示词(
        '审计回顾任务',
        方法论段落,
        '',  // 无额外输出格式
        最大子任务数,
        当前深度
      ),
      用户: (任务描述, 能力列表, 可用技能 = []) => 生成用户提示词(
        任务描述,
        能力列表,
        可用技能,
        方法论指引
      ),
    },
  },
};
