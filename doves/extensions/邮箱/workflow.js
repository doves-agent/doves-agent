/**
 * 邮箱能力组声明
 * 扩展 = 能力组 + 流程案例
 */
export default {
  场景: ['收邮件', '发邮件', '读邮件', '回复邮件', '检查邮箱', '邮件分类', '邮件摘要'],

  能力组: [
    {
      名称: '连接配置',
      触发关键词: ['配置邮箱', '添加邮箱', '邮箱设置', '连接邮箱', '邮箱账号'],
      说明: '用 email_config 查看/添加邮箱配置，用 email_connect 验证连接',
      工具: ['email_config', 'email_connect'],
    },
    {
      名称: '邮件获取',
      触发关键词: ['收邮件', '读邮件', '未读邮件', '收件箱', '搜索邮件', '查看邮件'],
      说明: '用 email_list 浏览收件箱，email_read 阅读邮件，email_search 搜索邮件',
      工具: ['email_list', 'email_read', 'email_search'],
    },
    {
      名称: '分析处理',
      触发关键词: ['邮件分类', '邮件摘要', '总结邮件', '重要邮件', '垃圾邮件'],
      说明: '用 email_classify 分类邮件，email_summarize 生成摘要',
      工具: ['email_classify', 'email_summarize'],
    },
    {
      名称: '行动执行',
      触发关键词: ['发邮件', '回复邮件', '转发邮件', '写邮件', '草稿', '保存附件'],
      说明: '用 email_send 发送、email_reply 回复、email_forward 转发、email_draft 生成草稿',
      工具: ['email_send', 'email_reply', 'email_forward', 'email_draft', 'email_attachment_save'],
    },
  ],

  流程案例: [
    {
      名称: '查收邮件',
      适用场景: '用户说"收邮件"、"看看有没有新邮件"',
      流程: 'email_list(收件箱) → email_read(阅读)',
    },
    {
      名称: '邮件摘要',
      适用场景: '用户说"帮我总结邮件"、"最近邮件摘要"',
      流程: 'email_list → email_summarize',
    },
    {
      名称: '回复邮件',
      适用场景: '用户说"回复这封邮件"',
      流程: 'email_read(查看原邮件) → email_reply(回复)',
    },
  ],

  关键规则: [
    '流程案例仅供参考，根据用户实际需求灵活组合工具',
    '发送/回复邮件前建议获得用户确认',
    '删除邮件前建议展示邮件预览',
    '邮箱密码加密存储，不暴露给用户',
  ],
};
