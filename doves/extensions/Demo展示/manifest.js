/**
 * Demo展示扩展包 manifest
 * LLM生成HTML页面 + OSS托管 → 返回可访问URL
 */
export default {
  name: 'Demo展示',
  version: '1.0.0',
  description: 'Demo展示全面接管 - LLM生成HTML页面+OSS托管+分享链接',
  abilities: ['Demo展示', '页面生成', 'Demo模板'],

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
    signature: 'hmac-sha256:2c5bc0a874d3f40ad6302ff50159ec5982c5ab4579535ec055aa8747fec1aba7',
  },

  // ===== 接口底座：权限声明 =====
  // Demo展示需OSS托管HTML页面+静态资源，MongoDB存Demo元数据
  permissions: {
    databases: {
      '白鸽系统': {
        collections: {
          '托管页面': {
            actions: ['find', 'findOne', 'insertOne', 'updateOne', 'deleteOne', 'countDocuments'],
            scope: 'user_scoped',
            userField: 'user_id',
            description: 'Demo页面元数据（标题/URL/模板/版本）',
          },
          'Demo模板': {
            actions: ['find', 'findOne', 'aggregate'],
            scope: 'shared',
            description: 'Demo模板库（全局共享，只读）',
          },
        },
      },
    },
    storage: {
      oss: { actions: ['read', 'write', 'list'], scope: 'user_scoped' },
    },
  },

  // Web 页面声明
  web: {
    nav: { icon: '🎨', label: 'Demo' },
    pages: {
      'demo-create': { title: '创建Demo', entry: './web/create.html' },
      'demo-list':   { title: 'Demo列表', entry: './web/list.html' },
    },
  },
};
