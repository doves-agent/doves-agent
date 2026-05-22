/**
 * 元素拆解扩展包 manifest
 * 万相2.7图像编辑模型驱动的智能元素拆解 - 识图→规划→拆解→验证→打包
 */
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('元素拆解', { 前缀: '[元素拆解]', 级别: 'debug', 显示调用位置: true });

export default {
  name: '元素拆解',
  version: '1.0.0',
  description: '元素拆解 - 图片元素识别、拆解提取、打包下载，按需组合使用',
  abilities: ['元素拆解', '图片拆元素', '元素提取', '图像分割'],

  dependencies: ['archiver'],

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
    signature: 'hmac-sha256:bda9de21046f2fee6f667f5ac9e692745c53d88d6abb7b41182b899368797518',
  },

  // ===== Web 页面声明 =====
  web: {
    nav: { icon: '🧩', label: '元素拆解' },
    pages: {
      'element-extract': { title: '元素拆解', entry: './web/index.html' },
    },
  },

  // ===== 接口底座：权限声明 =====
  permissions: {
    storage: {
      oss: { actions: ['read', 'write', 'list'], scope: 'user_scoped' },
    },
  },

  // ===== 初始化钩子 =====
  async onInit(ctx) {
    try {
      const { setAppContext } = await import('./_app-context.js');
      if (ctx) setAppContext(ctx);
      logger.info('DoveAppContext 注入完成');
    } catch (e) {
      logger.warn('DoveAppContext 注入失败:', e.message);
    }
  },
};
