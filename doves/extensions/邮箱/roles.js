/**
 * 邮箱代理角色定义
 */
export default {
  roles: {
    email_connector: {
      description: '邮箱连接者 - 配置和连接邮箱账号（POP3/SMTP）',
      abilities: ['邮箱管理'],
    },
    email_collector: {
      description: '邮件收集者 - 收取、阅读、搜索电子邮件',
      abilities: ['邮件处理', '邮箱管理'],
    },
    email_analyst: {
      description: '邮件分析者 - 邮件分类、摘要、意图识别',
      abilities: ['邮件分类', '邮件摘要', '邮件处理'],
    },
    email_operator: {
      description: '邮件执行者 - 发送、回复、转发邮件',
      abilities: ['邮件发送', '邮箱管理'],
    },
  },
};
