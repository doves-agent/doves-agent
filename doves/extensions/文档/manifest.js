/**
 * 文档扩展包 manifest
 * API文档/架构文档/变更日志/知识库
 */
export default {
  name: '文档',
  version: '1.1.0',
  description: '文档全面接管 - API文档/架构文档/变更日志/知识库/文档同步',
  abilities: ['文档管理', '文档生成', '知识检索', '文档同步', '变更日志'],

  // 依赖（应用间解耦，不再需要静态依赖）
  dependencies: [],

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
    signature: 'hmac-sha256:70ba4edeb6407b29a076b33888c91a1fdd55591144694ecc344982f8b02ee840',
  },

  // ===== 接口底座：权限声明 =====
  // 文档扩展通过代码文件+LLM工作，生成的HTML页面需OSS托管
  // Git记忆用于代码~文档映射、文档关键词搜索
  permissions: {
    storage: {
      oss: { actions: ['read', 'write'], scope: 'user_scoped' },
      memory: { actions: ['search', 'write'], scope: 'user_scoped' },
    },
  },

  // Web 页面声明
  web: {
    nav: { icon: '📄', label: '文档' },
    pages: {
      'doc-generate': { title: '生成文档', entry: './web/generate.html' },
      'doc-search':   { title: '文档搜索', entry: './web/search.html' },
      'doc-changelog': { title: '变更日志', entry: './web/changelog.html' },
    },
  },
};
