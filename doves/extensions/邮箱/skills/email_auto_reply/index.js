/**
 * 智能回复技能
 * 读取邮件→LLM分析意图→生成回复→用户确认→发送
 */
export default {
  name: 'email_auto_reply',
  description: '智能回复 - 分析邮件并生成回复内容',
  inputSchema: {
    type: 'object',
    properties: {
      configId: { type: 'string', description: '邮箱配置标识' },
      emailId: { type: 'number', description: '要回复的邮件ID' },
      tone: { type: 'string', enum: ['formal', 'casual', 'friendly', 'professional'], description: '回复语气', default: 'professional' },
      autoSend: { type: 'boolean', description: '是否自动发送（需用户确认，默认false）', default: false },
    },
    required: ['configId', 'emailId'],
  },
  async execute(args, context) {
    const { configId, emailId, tone = 'professional', autoSend = false } = args;

    const { handleExtTool } = await import('../tools/邮箱工具.js');

    // 读取原邮件
    const readResult = await handleExtTool('email_read', { configId, emailId, includeBody: true });
    if (readResult.isError) return readResult;

    const email = JSON.parse(readResult.content[0].text);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          originalEmail: {
            from: email.from,
            subject: email.subject,
            date: email.date,
            body: email.bodyPreview,
          },
          replyHint: `请根据以下信息生成${tone === 'formal' ? '正式' : tone === 'casual' ? '随意' : tone === 'friendly' ? '友好' : '专业'}语气的回复`,
          tone,
          autoSend,
          configId,
          emailId,
          needConfirm: !autoSend,
          confirmMessage: autoSend ? '自动发送已启用，将直接回复' : 'AI已生成回复内容，请确认后再发送'
        }, null, 2)
      }]
    };
  }
};
