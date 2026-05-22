/**
 * 审计查询技能
 *
 * 智能审计查询：根据用户自然语言问题，自动选择合适的审计工具组合查询，
 * 将结果组织成人类可读的回顾报告。
 *
 * 使用场景：
 * - "我最近都在干嘛" → audit_conversation_list → audit_usage_stats
 * - "昨天那个对话的详细过程" → audit_conversation_detail → audit_task_trace
 * - "那只鸽子在干活" → audit_dove_activity
 * - "我这周用了多少token" → audit_usage_stats
 * - "帮我看看这个任务怎么执行的" → audit_task_detail → audit_task_trace
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('审计查询', { 前缀: '[audit_query]', 级别: 'debug', 显示调用位置: true });

/**
 * 技能元数据（供技能管理器注册）
 */
export const meta = {
  name: 'audit_query',
  description: '智能审计查询 - 自然语言查询对话记录、任务执行轨迹、鸽子活动、使用统计',
  abilities: ['审计', '回顾', '查询', '对话查询', '轨迹查询'],
  category: 'audit',
};

/**
 * 执行技能
 * 注意：audit_query 是纯 LLM 工具调用型技能，不需要自定义执行逻辑。
 * 它通过意图识别路由到 simple_execution，然后 LLM 会自动选择合适的审计工具。
 * 
 * 技能的价值在于：
 * 1. 注册审计意图到路由器，让"查看记录/回顾/审计"类消息路由到审计路径
 * 2. 通过扩展包的 execution.js 注入审计工具选择指引到系统提示词
 * 3. 通过 intent.js 注册审计意图关键词
 */
export async function execute(task, context) {
  // 此技能不需要自定义执行器，由 LLM 工具调用直接处理
  // 返回 null 表示使用默认的 llm_tool_call 路径
  return null;
}

export default { meta, execute };
