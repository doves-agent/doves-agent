/**
 * 视频处理扩展包 manifest
 * 统一视频能力：AI理解（百炼）+ ffmpeg处理
 * 一句话剪视频 / 智能视频分析 / 语音转字幕
 */
export default {
  name: '视频处理',
  version: '2.0.0',
  description: '视频智能体 - AI理解+处理一体化：分析内容/问答/转录/转码/剪辑/合并/字幕/截图/GIF/水印',
  abilities: ['视频理解', '视频分析', '视频问答', '语音转录', '视频处理', '视频转码', '视频剪辑', '视频合并', '字幕处理', '视频截图', 'GIF制作', '视频压缩'],

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
    signature: 'hmac-sha256:dbf5fc09f35d7852e1d9357d2c7f4c889ab5e5c9838acb140865312fbf25a4b2',
  },

  // ===== 权限声明 =====
  permissions: {
    apis: {
      '百炼': { actions: ['multimodal-generation', 'asr'], scope: 'user_scoped', description: 'AI视频分析与语音转录' },
    },
    storage: {
      'git-storage': { actions: ['cloneSnapshot', 'status'], scope: 'user_scoped' },
      oss: { actions: ['read', 'write', 'list'], scope: 'user_scoped' },
      memory: { actions: ['search', 'write'], scope: 'user_scoped' },
    },
  },

  // Web 页面声明
  web: {
    nav: { icon: '🎬', label: '视频' },
    pages: {
      'video-dashboard': { title: '处理面板', entry: './web/dashboard.html' },
      'video-tasks':     { title: '任务列表', entry: './web/tasks.html' },
    },
  },
};
