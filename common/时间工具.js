/**
 * 时间工具模块
 * 
 * 时间规范：
 * 1. 所有业务时间必须使用本地时间（带时区）
 * 2. 时间索引使用毫秒级 Unix 时间戳
 * 3. 不允许使用不带时区的格式化时间
 */

/**
 * 获取当前本地时间的 ISO 字符串（带时区偏移）
 * 格式：2026-04-01T15:30:45.123+08:00
 * 
 * @returns {string} 带时区的 ISO 时间字符串
 */
export function toLocalISOString(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const tzOffset = -d.getTimezoneOffset();
  const hours = Math.floor(Math.abs(tzOffset) / 60);
  const minutes = Math.abs(tzOffset) % 60;
  const tzSign = tzOffset >= 0 ? '+' : '-';
  const tzString = `${tzSign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  
  // 获取本地时间的各个部分
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  const second = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}${tzString}`;
}

/**
 * 获取毫秒级 Unix 时间戳（用于索引）
 * 
 * @returns {number} 毫秒级时间戳
 */
export function getTimestamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return d.getTime();
}

/**
 * 格式化本地时间字符串
 * 用于日志显示等场景
 * 
 * @param {Date|string|number} date - 日期对象或时间戳
 * @param {string} format - 格式，默认 'full'
 * @returns {string} 格式化的本地时间字符串
 */
export function formatLocalTime(date = new Date(), format = 'full') {
  const d = date instanceof Date ? date : new Date(date);
  
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  const second = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  
  // 时区
  const tzOffset = -d.getTimezoneOffset();
  const tzHours = Math.floor(Math.abs(tzOffset) / 60);
  const tzMinutes = Math.abs(tzOffset) % 60;
  const tzSign = tzOffset >= 0 ? '+' : '-';
  const tzString = `${tzSign}${String(tzHours).padStart(2, '0')}:${String(tzMinutes).padStart(2, '0')}`;
  
  switch (format) {
    case 'date':
      return `${year}-${month}-${day}`;
    case 'time':
      return `${hour}:${minute}:${second}`;
    case 'datetime':
      return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    case 'log':
      return `${year}-${month}-${day} ${hour}:${minute}:${second}.${ms}`;
    case 'full':
    default:
      return `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}${tzString}`;
  }
}

/**
 * 创建时间戳索引字段
 * 同时返回本地时间字符串和时间戳，便于查询和排序
 * 
 * @param {Date} date - 日期对象
 * @returns {{本地时间: string, 时间戳: number}}
 */
export function createTimestampFields(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return {
    localTime: toLocalISOString(d),
    timestamp: d.getTime()
  };
}

/**
 * 解析时间字符串为 Date 对象
 * 支持多种格式的解析
 * 
 * @param {string|Date|number} input - 时间输入
 * @returns {Date} Date 对象
 */
export function parseTime(input) {
  if (input instanceof Date) return input;
  if (typeof input === 'number') return new Date(input);
  if (typeof input === 'string') {
    // 处理带时区的 ISO 格式
    // JavaScript Date 可以正确解析这种格式
    return new Date(input);
  }
  return new Date();
}

/**
 * 计算时间差
 * 
 * @param {Date|string|number} start - 开始时间
 * @param {Date|string|number} end - 结束时间
 * @returns {{ms: number, seconds: number, human: string}}
 */
export function timeDiff(start, end = new Date()) {
  const startTime = parseTime(start).getTime();
  const endTime = parseTime(end).getTime();
  const diffMs = endTime - startTime;
  
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  let human = '';
  if (days > 0) human = `${days}天${hours % 60}小时`;
  else if (hours > 0) human = `${hours}小时${minutes % 60}分钟`;
  else if (minutes > 0) human = `${minutes}分钟${seconds % 60}秒`;
  else human = `${seconds}秒`;
  
  return {
    ms: diffMs,
    seconds: Math.floor(diffMs / 1000),
    human
  };
}

// 默认导出
export default {
  toLocalISOString,
  getTimestamp,
  formatLocalTime,
  createTimestampFields,
  parseTime,
  timeDiff
};
