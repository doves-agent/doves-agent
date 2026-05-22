/**
 * 电脑操作员扩展包 manifest
 * 用户用自然语言操控电脑——打开应用、操作文件、截图、窗口管理、进程控制
 * 底层通过白鸽MCP (os_mcp) 实现 GUI 自动化
 */
export default {
  name: '电脑操作',
  version: '1.0.0',
  description: '电脑操作员 - 用自然语言操控电脑：键鼠控制、截图、窗口管理、进程控制、文件整理',
  abilities: ['电脑操作', '键鼠控制', '截图', '窗口管理', '进程控制', '文件管理', '桌面自动化', '应用启动', '系统操作'],

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
    signature: 'hmac-sha256:6bf94f3f41d3c47bfd7d77f564374869833cac7c0dc4396cb44cfbe2b782fe45',
  },

  // ===== 接口底座：权限声明 =====
  // 电脑操作员通过 MCP os_mcp + 命令行工具工作，不直接访问数据库
  // 技能层可能使用Git记忆记录用户偏好（未来）
  permissions: {
    storage: {
      memory: { actions: ['search', 'write'], scope: 'user_scoped' },
    },
  },
};
