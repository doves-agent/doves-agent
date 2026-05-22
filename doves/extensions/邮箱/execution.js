/**
 * 邮箱代理执行增强
 * 发送/回复邮件前验证配置，操作后确认
 */
export default {
  conditionalPrompts: [
    {
      match: (任务, tools) => {
        const 能力需求 = 任务.能力需求 || [];
        return 能力需求.some(a => ['邮箱管理', '邮件处理', '邮件分类', '邮件发送'].includes(a));
      },
      prompt: `【邮箱工具优先级】
- 查看邮件 → email_list / email_read
- 搜索邮件 → email_search
- 分类邮件 → email_classify
- 邮件摘要 → email_summarize
- 发送邮件 → email_send（需用户确认）
- 回复邮件 → email_reply（需用户确认）
- 保存附件 → email_attachment_save

【安全规则】
- 发送/回复邮件前必须使用 询问用户 向用户确认内容和收件人
- 保存邮箱配置（含密码）前必须使用 询问用户 向用户确认`,
    },
  ],

  hooks: {
    afterToolCall: async (工具名, 工具结果, 任务) => {
      if (工具名 === 'email_config' && !工具结果.isError) {
        任务.emailConfigured = true;
      }
      return null;
    },
  },
};
