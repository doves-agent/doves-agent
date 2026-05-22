/**
 * MySQL代理扩展包 manifest
 * 通过自然语言操作MySQL：查询/关联/导入/导出/表结构管理
 * 底层通过 mysql2 连接MySQL数据库
 */
export default {
  name: 'MySQL',
  version: '1.0.0',
  description: 'MySQL代理 - 用自然语言查数据库：SQL查询/表管理/数据导入导出/关联查询',
  abilities: ['MySQL', '数据库', 'SQL查询', '表管理', '数据导入', '数据导出', '数据管理', '关联查询', '性能优化', '数据迁移', '数据备份'],

  dependencies: [],

  intent: './intent.js',
  strategy: './strategy.js',
  roles: './roles.js',
  execution: './execution.js',
  review: './review.js',
  workflow: './workflow.js',

  tools: './tools',
  skills: './skills',

  // ===== 开发者凭证 =====
  developer: {
    id: 'dev_official',
    signature: 'hmac-sha256:0f7501ee69f302bc6b614245a87bbcb34003068fe44fd2cfd43c1ac181235346',
  },

  // ===== 接口底座：权限声明 =====
  // MySQL 需要访问用户库的数据库配置集合，存储MySQL连接信息（加密）
  // 通过工具动态访问用户MySQL数据库，API层做运行时检查（同 MongoDB）
  permissions: {
    apis: {
      'dove:config': 'read',
      'api:db': ['read', 'write'],
    },
    storage: {
      memory: { actions: ['search', 'write'], scope: 'user_scoped' },
    },
  },

  // Web 页面声明
  web: {
    nav: { icon: '🐬', label: 'MySQL' },
    pages: {
      'mysql-dashboard': { title: '数据库概览', entry: './web/dashboard.html' },
      'mysql-query':     { title: 'SQL查询',    entry: './web/query.html' },
    },
  },
};
