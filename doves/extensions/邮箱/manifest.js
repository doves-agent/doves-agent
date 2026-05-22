/**
 * 邮箱代理扩展包 manifest
 * 基于 POP3/SMTP 的邮箱智能体
 */
export default {
  name: '邮箱',
  version: '1.0.0',
  description: '邮箱代理 - AI帮你管邮箱：收取/阅读/分类/摘要/发送/回复邮件',
  abilities: ['邮箱管理', '邮件处理', '邮件分类', '邮件摘要', '邮件发送', '收件箱管理'],

  dependencies: ['nodemailer'],

  intent: './intent.js',
  strategy: './strategy.js',
  roles: './roles.js',
  execution: './execution.js',
  review: './review.js',
  workflow: './workflow.js',

  skills: './skills',
  tools: './tools',

  // ===== 开发者凭证 =====
  developer: {
    id: 'dev_official',
    signature: 'hmac-sha256:10440182b16604222ea6b91feb664d6324f30e324c331139c1ce9c0965f9e481',
  },

  // ===== 接口底座：权限声明 =====
  permissions: {
    storage: {
      oss: { actions: ['read', 'write'], scope: 'user_scoped' },
    },
    apis: {
      'dove:config': 'read',
    },
  },

  // Web 页面声明
  web: {
    nav: { icon: '📧', label: '邮箱' },
    pages: {
      'email-inbox':   { title: '收件箱',   entry: './web/inbox.html' },
      'email-compose': { title: '写邮件',   entry: './web/compose.html' },
    },
  },
};
