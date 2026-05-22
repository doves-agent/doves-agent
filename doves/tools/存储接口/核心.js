/**
 * @file tools/存储接口/核心
 * @description 存储接口共享日志器
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

export const logger = 创建日志器('存储接口', { 前缀: '[存储接口]', 级别: 'debug', 显示调用位置: true });
