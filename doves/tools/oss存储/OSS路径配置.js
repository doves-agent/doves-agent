/**
 * @file oss存储/OSS路径配置
 * @description OSS 路径前缀配置，从环境变量读取
 * 
 * 所有 OSS 路径必须以 OSS_PREFIX 为根目录，默认值为 'dove'
 * 修改 .env 中的 OSS_PREFIX 即可全局切换路径前缀
 */

/**
 * OSS 路径前缀（从环境变量读取，默认 'dove'）
 * 所有 OSS 路径格式：{OSS_PREFIX}/users/xxx/... 或 {OSS_PREFIX}/public/...
 */
export const OSS_PREFIX = process.env.OSS_PREFIX || 'dove';

/**
 * 生成 OSS 根路径
 * @returns {string} OSS 根路径（如 'dove/'）
 */
export function getOSSRoot() {
  return `${OSS_PREFIX}/`;
}

/**
 * 检查路径是否以 OSS_PREFIX 开头
 * @param {string} path - OSS 路径
 * @returns {boolean}
 */
export function hasOSSPrefix(path) {
  return path.startsWith(`${OSS_PREFIX}/`);
}

/**
 * 确保路径以 OSS_PREFIX 开头
 * @param {string} path - OSS 路径（可能已包含前缀）
 * @returns {string} 带前缀的完整路径
 */
export function ensureOSSPrefix(path) {
  if (hasOSSPrefix(path)) {
    return path;
  }
  return `${OSS_PREFIX}/${path}`;
}

/**
 * 移除 OSS_PREFIX 前缀（用于相对路径处理）
 * @param {string} path - OSS 路径
 * @returns {string} 移除前缀后的相对路径
 */
export function stripOSSPrefix(path) {
  if (hasOSSPrefix(path)) {
    return path.substring(OSS_PREFIX.length + 1);
  }
  return path;
}
