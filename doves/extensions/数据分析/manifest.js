/**
 * 数据统计扩展包 manifest
 * 自然语言→数据查询→可视化→报表生成
 */
export default {
  name: '数据分析',
  version: '1.0.0',
  description: '数据统计全面接管 - 自然语言查询/数据可视化/报表生成/异常检测',
  abilities: ['数据分析', '数据查询', '数据可视化', '报表生成'],

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
    signature: 'hmac-sha256:75becd37e75cb8a02af34e563a3c4a059a371e5780f7c5ad82a14cc4d91f5e83',
  },

  // ===== 接口底座：权限声明 =====
  // 数据分析需存储数据源配置（加密）、可视化报表HTML托管到OSS
  permissions: {
    databases: {
      '白鸽系统': {
        collections: {
          '数据源': {
            actions: ['find', 'findOne', 'insertOne', 'updateOne', 'deleteOne'],
            scope: 'user_scoped',
            userField: 'user_id',
            description: '数据源配置（加密存储鉴权信息）',
          },
        },
      },
    },
    storage: {
      oss: { actions: ['read', 'write'], scope: 'user_scoped' },
    },
  },

  // Web 页面声明
  web: {
    nav: { icon: '📊', label: '数据' },
    pages: {
      'data-query':  { title: '数据查询',  entry: './web/query.html' },
      'data-report': { title: '报表中心',  entry: './web/report.html' },
    },
  },
};
