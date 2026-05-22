/**
 * 词阵对弈 - 执行器增强模块
 * 在LLM执行过程中注入游戏逻辑
 */
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('词阵对弈', { 前缀: '[ci_zhen_dui_yi]', 级别: 'debug', 显示调用位置: true });

export default {
  // 执行前钩子
  beforeExecute: async (context) => {
    const { intent, args } = context;
    if (intent === 'CI_ZHEN_DUI_YI_PLAY' || intent === 'CI_ZHEN_DUI_YI_CREATE' || intent === 'CI_ZHEN_DUI_YI_JOIN') {
      context.gameMode = true;
      context.uiPage = 'ci-zhen-dui-yi-lobby';
    }
    return context;
  },

  // 执行后钩子
  afterExecute: async (result, context) => {
    return result;
  },

  // 错误处理
  onError: async (error, context) => {
    logger.error('执行错误:', error.message);
    return { error: `游戏执行异常: ${error.message}` };
  },
};
