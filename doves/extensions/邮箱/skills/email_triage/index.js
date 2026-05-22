/**
 * 邮件分诊技能
 * 收取→LLM分类→标记优先级→待办提醒
 */
export default {
  name: 'email_triage',
  description: '邮件分诊 - 自动分类邮件并标记优先级',
  inputSchema: {
    type: 'object',
    properties: {
      configId: { type: 'string', description: '邮箱配置标识' },
      maxEmails: { type: 'number', description: '最大处理邮件数，默认30', default: 30 },
      priorityThreshold: {
        type: 'string', enum: ['high_only', 'high_medium', 'all'],
        description: '优先级过滤：high_only=仅高优先级，high_medium=高+中，all=全部',
        default: 'high_medium'
      },
    },
    required: ['configId'],
  },
  async execute(args, context) {
    const { configId, maxEmails = 30, priorityThreshold = 'high_medium' } = args;

    const { handleExtTool } = await import('../tools/邮箱工具.js');

    const listResult = await handleExtTool('email_list', { configId, maxCount: maxEmails });
    if (listResult.isError) return listResult;

    const emails = JSON.parse(listResult.content[0].text).emails || [];

    if (emails.length === 0) {
      return { content: [{ type: 'text', text: '✅ 没有新邮件需要分诊' }] };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          triageSummary: `📋 邮件分诊报告 — ${emails.length} 封待处理`,
          totalCount: emails.length,
          emails: emails.map(e => ({
            id: e.id,
            from: e.from,
            subject: e.subject,
            date: e.date,
            snippet: e.snippet,
            priority: '待评估',
            action: '待决定',
          })),
          priorityThreshold,
          categories: ['重要（需立即处理）', '待办（今天内处理）', '通知（可稍后阅读）', '普通', '垃圾'],
          needAction: true,
          hint: '请对以上邮件逐一评估优先级并确定处理动作（回复/归档/删除/标记）'
        }, null, 2)
      }]
    };
  }
};
