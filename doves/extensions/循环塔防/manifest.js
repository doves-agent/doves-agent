/**
 * 循环塔防 manifest
 * 实时多人环形走廊塔防 - 攻守兼备
 */
export default {
  name: '循环塔防',
  version: '1.0.0',
  description: '循环塔防 - 实时多人环形走廊塔防游戏',
  abilities: ['循环塔防', '塔防游戏', '多人塔防', '实时对战'],

  dependencies: ['ws'],

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

  // ===== 开发者凭证 =====
  developer: {
    id: 'dev_official',
    signature: 'hmac-sha256:8f92bdce7696c3994d5dbf7b7fdfdecfac26e5f565b404018a33d77ac23508dd',
  },

  // ===== 权限声明 =====
  permissions: {
    externalUrls: [
      { url: 'ws://localhost:3101', type: 'connect', description: '循环塔防游戏服务器' },
      { url: 'ws://127.0.0.1:3101', type: 'connect', description: '循环塔防游戏服务器(备用)' },
    ],
  },

  // 扩展自启服务
  services: {
    game: {
      module: './services/游戏服务器.js',
      port: 3101,
      description: '循环塔防游戏 WebSocket 服务器',
    },
  },

  // Web 页面声明
  web: {
    nav: { icon: '🏰', label: '循环塔防' },
    pages: {
      'loop-td-lobby': { title: '塔防大厅', entry: './web/index.html' },
    },
  },
};
