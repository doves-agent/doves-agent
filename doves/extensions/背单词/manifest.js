/**
 * 词汇学习扩展包 manifest (AI 原生版)
 * 
 * 通过白鸽 DoveAppContext 接口底座访问数据，零外部依赖
 * 架构：LLM 层（智能教学）→ 服务层（SM2/画像/推荐）→ 数据层（ctx.db → DovesProxy → Server → MongoDB）
 * 
 * 详见: 白鸽文档/dove_apps/接口底座规范.md
 */
import { setContext as setWordsContext } from './data/words.js';
import { setContext as setRecordsContext } from './data/records.js';
import { setContext as setColorsContext } from './data/colors.js';
import { setContext as setImportsContext } from './data/imports.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('背单词', { 前缀: '[背单词]', 级别: 'debug', 显示调用位置: true });

export default {
  // 基本信息
  name: '背单词',
  version: '2.0.0',
  description: '词汇学习扩展包 - AI原生教学/SM2间隔复习/词根记忆/智能推荐',
  abilities: ['词汇学习', '单词记忆', '间隔复习', '智能推荐'],

  // 依赖（不再依赖外部背单词服务端）
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

  // ===== 开发者凭证 =====
  developer: {
    id: 'dev_official',
    signature: 'hmac-sha256:f30918a51bda224335983eedd18025466c74ad0b72f1eb2c48055f374358e0de',
  },

  // ===== 接口底座：权限声明 =====
  // 扩展只能通过 ctx 访问此处声明的资源，未声明 = 禁止
  // 详见: 白鸽文档/dove_apps/接口底座规范.md
  permissions: {
    // 数据库权限
    databases: {
      '背单词': {
        collections: {
          'words': {
            actions: ['find', 'findOne', 'aggregate', 'insertOne', 'updateOne', 'updateMany', 'countDocuments', 'index'],
            scope: 'shared',
            description: '单词库（全局共享，只读为主）',
          },
          'learningrecords': {
            actions: ['find', 'findOne', 'aggregate', 'insertOne', 'updateOne', 'countDocuments', 'index'],
            scope: 'user_scoped',
            userField: 'user_id',
            description: '学习记录（按用户过滤）',
          },
          'colortemplates': {
            actions: ['find', 'findOne', 'insertOne', 'deleteOne', 'index'],
            scope: 'shared',
            description: '颜色模板（全局共享）',
          },
        },
      },
    },
  },

  // Web 页面声明（供 CLI Web 动态注入）
  web: {
    nav: { icon: '📚', label: '背单词' },
    pages: {
      'vocabulary-learn':  { title: '学习',  entry: './web/learn.html' },
      'vocabulary-review': { title: '复习',  entry: './web/review.html' },
      'vocabulary-import': { title: '录入',  entry: './web/import.html' },
      'vocabulary-stats':  { title: '统计',  entry: './web/stats.html' },
      'vocabulary-preview': { title: '预览', entry: './web/preview.html' },
    },
  },

  // 初始化钩子（扩展包加载时自动执行，ctx 由框架注入）
  async onInit(ctx) {
    try {
      // 数据层模块通过 setContext 注入 ctx
      // 索引和默认数据改为懒初始化：首次使用时自动执行，不阻塞启动
      if (ctx) {
        setWordsContext(ctx);
        setRecordsContext(ctx);
        setColorsContext(ctx);
        setImportsContext(ctx);
      }
      logger.info('DoveAppContext 注入完成（索引和模板将在首次使用时自动初始化）');
    } catch (e) {
      logger.warn('初始化失败:', e.message);
    }
  },
};
