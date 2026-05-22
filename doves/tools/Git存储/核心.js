import { 创建日志器 } from '@dove/common/日志管理器.js';
import { getDovesProxy } from '../存储接口.js';

export const logger = 创建日志器('Git存储', { 前缀: '[Git存储]', 级别: 'debug', 显示调用位置: true });

export async function api调用(method, path, body = null) {
  const proxy = await getDovesProxy();
  return await proxy.fetch(path, { method, body });
}

export function 是否可用() {
  return !!(process.env.SERVER_URL || process.env.SERVER_API_KEY);
}
