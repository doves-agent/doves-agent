/**
 * 代码审查扩展包 manifest
 * PR审查/质量门禁/安全扫描/自动修复
 */
export default {
  name: '代码审查',
  version: '1.1.0',
  description: '代码审查全面接管 - PR审查/质量门禁/安全扫描/自动修复/复杂度分析/依赖审查',
  abilities: ['代码审查', '安全审查', '质量门禁', '复杂度分析', '依赖审查'],

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
    signature: 'hmac-sha256:bd61be810de7b183aab949d7746b0f178e58e19912af32f39292b4abd6883035',
  },

  // ===== 接口底座：权限声明 =====
  // 代码审查 纯工具型，依赖 编码 + Git版本控制 的工具能力
  // 应用间解耦，应用开发者自行处理工具生态链
  // Git记忆用于沉淀审查偏好/规范
  permissions: {
    storage: {
      memory: { actions: ['search', 'write'], scope: 'user_scoped' },
    },
  },

  // Web 页面声明
  web: {
    nav: { icon: '🔍', label: '审查' },
    pages: {
      'review-dashboard': { title: '审查概览', entry: './web/dashboard.html' },
      'quality-gate':     { title: '质量门禁', entry: './web/quality-gate.html' },
    },
  },
};
