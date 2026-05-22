/**
 * 饲养员扩展 - 公共辅助函数
 */

import { ObjectId } from 'mongodb';

/**
 * 安全转换字符串为 ObjectId
 */
export function toObjectId(id) {
  if (!id) return id;
  if (ObjectId.isValid(id) && typeof id === 'string') return new ObjectId(id);
  return id;
}

/**
 * 支持的 Webhook/规则 事件类型
 */
export const 支持的事件 = [
  'task.created',
  'task.running',
  'task.completed',
  'task.failed',
  'task.cancelled',
  'dove.online',
  'dove.offline',
  'verification.passed',
  'verification.failed',
  'verification.disputed'
];
