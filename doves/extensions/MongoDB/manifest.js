/**
 * MongoDB代理扩展包 manifest
 * 通过自然语言操作MongoDB：查询/聚合/导入/导出/索引管理/数据迁移/备份恢复
 * 底层复用 存储接口.js 的 MongoDB适配器
 */
export default {
  name: 'MongoDB',
  version: '2.0.0',
  description: 'MongoDB代理 - 完整数据库管理：查询/聚合/CRUD/导入导出/索引管理/数据迁移/备份恢复 + AI助手',

  abilities: ['MongoDB', '数据库', '数据查询', '数据聚合', '数据导入', '数据导出', '索引管理', '数据管理', '性能优化', '数据迁移', '数据备份', '数据恢复'],

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
    signature: 'hmac-sha256:dbef3bee4b0b66056946ace9bd6633df977ccb89207e94e620c4044362b804d3',
  },

  // ===== 接口底座：权限声明 =====
  permissions: {
    apis: {
      'dove:config': 'read',
      'api:db': ['read', 'write'],
    },
    databases: {
      // MongoDB 通过工具动态访问数据库，声明为 shared
      // 实际的库/集合由用户请求决定，工具层做运行时检查
    },
  },

  // Web 页面声明（统一管理界面，Compass 风格）
  web: {
    nav: { icon: '🍃', label: 'MongoDB' },
    pages: {
      'mongo-manager': { title: 'MongoDB 管理', entry: './web/manager.html' },
    },
  },
};
