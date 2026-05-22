/**
 * 元素拆解应用上下文
 * 存储框架注入的 DoveAppContext，供工具层通过 ctx.oss 上传文件
 * 同时提供 API Key 获取能力，避免工具层直接 import 常量模块
 */

let _ctx = null;

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('元素拆解-上下文', { 前缀: '[元素拆解/上下文]', 级别: 'debug', 显示调用位置: true });

export function setAppContext(ctx) {
  logger.debug(`setAppContext: ctx=${ctx ? '有效' : 'null'}, oss=${ctx?.oss ? '可用' : '不可用'}`);
  _ctx = ctx;
}

export function getAppContext() {
  logger.debug(`getAppContext: ctx=${_ctx ? '有效' : 'null'}`);
  return _ctx;
}

/**
 * 获取提供商 API Key
 * 从 DoveAppContext 或环境变量读取
 */
export function getApiKey(provider) {
  logger.debug(`getApiKey: provider=${provider}`);

  // 从环境变量读取
  const envMap = {
    '百炼': ['BAILIAN_API_KEY', 'QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
  };
  const keys = envMap[provider] || [`${provider.toUpperCase()}_API_KEY`];
  for (const key of keys) {
    if (typeof process !== 'undefined' && process.env?.[key]) {
      logger.debug(`找到 API Key: env=${key}, 值=${process.env[key].substring(0, 8)}...`);
      return process.env[key];
    }
  }
  logger.warn(`未找到 ${provider} 的 API Key，已检查环境变量: [${keys.join(', ')}]`);
  return null;
}

/**
 * 获取百炼 API Host（合规管道）
 */
export function getBailianHost() {
  const host = (typeof process !== 'undefined' && process.env?.BAILIAN_API_HOST)
    ? process.env.BAILIAN_API_HOST
    : 'dashscope.aliyuncs.com';
  logger.debug(`getBailianHost: ${host}`);
  return host;
}
