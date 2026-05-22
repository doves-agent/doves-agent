/**
 * 编码能力扩展包 manifest
 * 提供代码编写/修改/调试/重构全链路能力
 * 纯工具型扩展：不直接访问数据库/存储，通过文件系统+LLM工作
 */
export default {
  // 基本信息
  name: '编码',
  version: '2.0.0',
  description: '编码能力扩展包 - 代码编写/修改/调试/重构/LSP智能分析/语义搜索',
  abilities: ['编程', '代码', '文件操作', '代码分析', '语义搜索', '调试'],

  // 依赖
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
  // mcp: './mcp/config.js',  // 编码暂无专用MCP

  // ===== 开发者凭证 =====
  developer: {
    id: 'dev_official',
    signature: 'hmac-sha256:094e0bbd1e25614746e965748591fd18274e2f574be827cc09d163a6fc06470a',
  },

  // ===== 接口底座：权限声明 =====
  // coding 是纯工具型扩展，不直接访问数据库/存储
  // 其能力通过文件系统操作和 LLM 推理实现
  permissions: {},

  // Web 页面声明（供 CLI Web 动态注入）
  web: {
    nav: { icon: '💻', label: '编码' },
    pages: {
      'coding-editor': { title: '代码编辑器', entry: './web/editor.html' },
    },
  },
};
