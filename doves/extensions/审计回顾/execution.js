/**
 * 审计回顾执行器增强
 * 条件性系统提示词：当任务能力需求包含审计/回顾时注入工具选择指引
 */
export default {
  conditionalPrompts: [
    {
      // 匹配条件：任务能力需求包含审计/回顾/查询
      match: (任务, tools) => {
        const 能力需求 = 任务.能力需求 || [];
        return 能力需求.some(a => ['审计', '回顾', '查询', '对话查询', '轨迹查询', '使用统计'].includes(a));
      },
      // 注入到系统提示词末尾
      prompt: `【审计工具选择指引】
想看对话列表 → audit_conversation_list（支持关键词/时间过滤）
想看某个对话详情 → audit_conversation_detail（需要对话ID，显示每轮的routing决策、压缩上下文、分支摘要）
想看某个任务详情 → audit_task_detail（需要任务ID，显示状态/执行者/子任务树/执行结果）
想看执行轨迹 → audit_task_trace（需要任务ID，显示LLM调用链/工具调用链/耗时）
想看鸽子活动 → audit_dove_activity（显示哪只鸽子执行了什么、成功率）
想看使用统计 → audit_usage_stats（任务数/技能排行/模型排行/时间趋势）

查询策略：用户没给ID时，先用 audit_conversation_list 找对话，再逐步深入。
注意：所有查询只返回用户自己的数据，确保隐私安全。不要原样输出JSON，整理成人类可读的报告。`,
    },
  ],
};
