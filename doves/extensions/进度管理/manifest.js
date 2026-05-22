/**
 * 进度管理扩展包 manifest
 * 不替代，是接管 — 白鸽任务状态 ↔ 禅道/Jira双向同步
 */
export default {
  name: '进度管理',
  version: '1.0.0',
  description: '进度管理全面接管 - 禅道/Jira对接/进度同步/周报自动生成',
  abilities: ['进度管理', '任务管理', '项目跟踪'],

  // 依赖（应用间解耦，不再需要静态依赖）
  dependencies: [],

  intent: './intent.js',
  strategy: './strategy.js',
  roles: './roles.js',
  review: './review.js',
  execution: './execution.js',
  workflow: './workflow.js',

  skills: './skills',
  tools: './tools',

  // ===== 开发者凭证 =====
  developer: {
    id: 'dev_official',
    signature: 'hmac-sha256:0c8f45ff82b65dd2b512a382136e79a3e3bd4257943468f10db60074511c04a1',
  },

  // ===== 接口底座：权限声明 =====
  // 进度管理 需要访问任务映射、禅道/Jira配置集合（加密存储）
  // Git记忆用于报告风格偏好、任务描述模式
  permissions: {
    databases: {
      '白鸽系统': {
        collections: {
          '任务映射': {
            actions: ['find', 'findOne', 'insertOne', 'updateOne', 'deleteOne', 'aggregate'],
            scope: 'user_scoped',
            userField: 'user_id',
            description: '白鸽任务ID ↔ 禅道/Jira任务ID映射',
          },
          '禅道配置': {
            actions: ['find', 'findOne', 'insertOne', 'updateOne', 'deleteOne'],
            scope: 'user_scoped',
            userField: 'user_id',
            description: '禅道连接配置（加密存储）',
          },
          'Jira配置': {
            actions: ['find', 'findOne', 'insertOne', 'updateOne', 'deleteOne'],
            scope: 'user_scoped',
            userField: 'user_id',
            description: 'Jira连接配置（加密存储）',
          },
        },
      },
    },
    storage: {
      memory: { actions: ['search', 'write'], scope: 'user_scoped' },
      oss: { actions: ['read', 'write'], scope: 'user_scoped' },
    },
  },

  // Web 页面声明
  web: {
    nav: { icon: '📋', label: '进度' },
    pages: {
      'pm-tasks':   { title: '任务看板', entry: './web/tasks.html' },
      'pm-weekly':  { title: '周报',     entry: './web/weekly.html' },
      'pm-milestone':{ title: '里程碑',  entry: './web/milestone.html' },
    },
  },
};
