/**
 * 邮件摘要技能
 * 每天定时收取→LLM分类→生成摘要→推送
 */
export default {
  name: 'email_digest',
  description: '邮件摘要日报 - 收取邮件并生成摘要',
  inputSchema: {
    type: 'object',
    properties: {
      configId: { type: 'string', description: '邮箱配置标识' },
      maxEmails: { type: 'number', description: '最大处理邮件数，默认20', default: 20 },
      summaryType: { type: 'string', enum: ['brief', 'detailed', 'action_items'], description: '摘要类型', default: 'brief' },
      includeUnreadOnly: { type: 'boolean', description: '仅处理未读邮件', default: true },
    },
    required: ['configId'],
  },
  async execute(args, context) {
    const { configId, maxEmails = 20, summaryType = 'brief', includeUnreadOnly = true } = args;

    // 调用邮箱工具
    const { handleExtTool } = await import('../tools/邮箱工具.js');

    const listResult = await handleExtTool('email_list', { configId, maxCount: maxEmails });
    if (listResult.isError) return listResult;

    const emails = JSON.parse(listResult.content[0].text).emails || [];

    if (emails.length === 0) {
      return { content: [{ type: 'text', text: '📭 收件箱为空，没有新邮件需要处理' }] };
    }

    // 邮件分类
    const classifyResult = await handleExtTool('email_classify', { emails });
    // 邮件摘要
    const summaryResult = await handleExtTool('email_summarize', { emails, summaryType });

    const classifyData = JSON.parse(classifyResult.content[0].text);
    const summaryData = JSON.parse(summaryResult.content[0].text);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          summary: `📧 邮件日报 — 共 ${emails.length} 封新邮件`,
          totalCount: emails.length,
          emails: emails.map(e => ({
            from: e.from, subject: e.subject, date: e.date, snippet: e.snippet
          })),
          categories: classifyData.categories,
          needAction: true,
          hint: '以上是邮件摘要和分类结果。请继续处理：回复重要邮件、创建待办任务或归档普通邮件'
        }, null, 2)
      }]
    };
  }
};
