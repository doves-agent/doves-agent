/**
 * 词阵对弈 manifest
 * 实时多人词阵对弈 - 团队配合 + 见招拆招
 */
export default {
  name: '词阵对弈',
  version: '1.0.0',
  description: '词阵对弈 - 实时多人词阵对弈游戏',
  abilities: ['词阵对弈', '词语对战', '实时对战'],

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
    signature: 'hmac-sha256:88066f43173f92e12d25244bbade9c2fd2f05c837853b5bf26189b7db07b7776',
  },

  // ===== 接口底座：权限声明 =====
  permissions: {
    databases: {
      '背单词': {
        collections: {
          'words': {
            actions: ['find', 'findOne', 'aggregate', 'countDocuments'],
            scope: 'shared',
            description: '单词库（只读）',
          },
        },
      },
    },
    // 扩展 Web 页面允许连接的外部 URL
    // 游戏 WebSocket 服务器由本扩展自启，CLI Web 页面直连
    externalUrls: [
      { url: 'ws://localhost:3100', type: 'connect', description: '词阵对弈游戏服务器' },
      { url: 'ws://127.0.0.1:3100', type: 'connect', description: '词阵对弈游戏服务器(备用)' },
      { url: 'wss://*.dove.game/*', type: 'connect', description: '白鸽游戏服务器' },
    ],
  },

  // 扩展自启服务声明
  // 加载时由 _loader.js 启动，卸载时停止
  services: {
    game: {
      module: './services/game-server.js',
      port: 3100, // 默认端口，端口被占用时自动 +1
      description: '词阵对弈游戏 WebSocket 服务器',
    },
  },

  // Web 页面声明
  web: {
    nav: { icon: '⚔️', label: '词阵对弈' },
    pages: {
      'ci-zhen-dui-yi-lobby': { title: '游戏大厅', entry: './web/index.html' },
    },
  },
};
