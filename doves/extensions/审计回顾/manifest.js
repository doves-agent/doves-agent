/**
 * 审计回顾扩展包 manifest
 * 全链路可审计、可追溯的对话查询能力
 * 类似区块链区块浏览器：每轮对话=区块，每次任务执行=交易
 */
export default {
  name: '审计回顾',
  version: '1.0.0',
  description: '审计回顾扩展包 - 对话记录查询/任务执行轨迹/鸽子活动/使用统计',
  abilities: ['审计', '回顾', '查询', '对话查询', '轨迹查询', '使用统计'],

  dependencies: [],

  // LLM层声明
  intent: './intent.js',
  strategy: './strategy.js',
  roles: './roles.js',
  review: './review.js',
  execution: './execution.js',
  workflow: './workflow.js',

  // 工具层声明
  skills: './skills',
  tools: './tools',

  // 开发者凭证
  developer: {
    id: 'dev_official',
    signature: 'hmac-sha256:d1eec43d307b85d1c36f4d44a76681a1faa5f02e1df7bf38d17d1a47ef4f638b',
  },

  // 权限声明：只读查询，不写入
  permissions: {},

  // 数据库声明：需要查询用户数据库的对话、任务、轨迹集合
  databases: {
    '白鸽系统': {
      collections: {
        '对话': { actions: ['find', 'findOne'], description: '对话记录查询（只读）' },
        '任务': { actions: ['find', 'findOne', 'aggregate'], description: '任务详情查询（只读）' },
        '轨迹': { actions: ['findOne'], description: '执行轨迹查询（只读）' },
      },
    },
  },
};
