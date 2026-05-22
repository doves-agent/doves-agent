/**
 * 人类分身扩展包 manifest
 * 聊天记录导入Git记忆 → 语气学习 → 分身自动回复
 *
 * 利用已有能力：Git记忆存储+检索、性格/画像系统、IM适配器
 * 
 * 2026-04-25: 已补全 tools（9个工具）、skills（4个技能）、parsers（3个平台）
 */
export default {
  name: '分身',
  version: '1.0.0',
  description: '人类分身 - 导入聊天记录学会你的语气，AI替你回消息',
  abilities: ['分身', '语气学习', '聊天记录', '自动回复', '人格模拟'],

  dependencies: [],

  intent: './intent.js',
  strategy: './strategy.js',
  roles: './roles.js',
  execution: './execution.js',
  review: './review.js',
  workflow: './workflow.js',

  parsers: './parsers',
  skills: './skills',
  tools: './tools',

  // ===== 开发者凭证 =====
  developer: {
    id: 'dev_official',
    signature: 'hmac-sha256:8962e3cc678494eadca55fcf5b6c4d2d57332c3b735367938b5f19df3323fe28',
  },

  // ===== 接口底座：权限声明 =====
  permissions: {
    storage: {
      memory: { actions: ['search', 'write'], scope: 'user_scoped' },
      oss: { actions: ['read', 'write'], scope: 'user_scoped' },
    },
    apis: {
      'dove:config': 'read',
    },
  },

  // Web 页面声明
  web: {
    nav: { icon: '👤', label: '分身' },
    pages: {
      'avatar-dashboard': { title: '分身管理', entry: './web/dashboard.html' },
      'avatar-reply':     { title: '回复面板', entry: './web/reply.html' },
    },
  },
};
