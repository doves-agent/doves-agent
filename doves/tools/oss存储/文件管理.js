/**
 * @file tools/oss存储/文件管理
 * @description 文件下载、删除、复制、签名URL、检查存在、列出文件
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { logger, 是否可用, 获取客户端 } from './核心.js';

/**
 * 从 OSS 下载文件
 * @param {string} oss路径 - OSS 路径
 * @param {string} 本地路径 - 本地保存路径（可选）
 * @returns {Promise<{成功: boolean, 内容?: Buffer, 大小?: number, 错误?: string}>}
 */
export async function 下载(oss路径, 本地路径 = null) {
  if (!是否可用()) {
    return { 成功: false, 错误: 'OSS 未配置或不可用' };
  }
  
  try {
    const 客户端 = await 获取客户端();
    if (!客户端) {
      return { 成功: false, 错误: 'OSS 客户端初始化失败' };
    }
    
    const 结果 = await 客户端.get(oss路径, 本地路径);
    
    logger.info(`文件已下载: ${oss路径}`);
    
    return {
      成功: true,
      内容: 结果.content,
      大小: 结果.content?.length || 0
    };
  } catch (e) {
    logger.error('下载失败:', e.message);
    return { 成功: false, 错误: e.message };
  }
}

/**
 * 删除 OSS 文件
 * @param {string} oss路径 - OSS 路径
 * @returns {Promise<{成功: boolean, 错误?: string}>}
 */
export async function 删除(oss路径) {
  if (!是否可用()) {
    return { 成功: false, 错误: 'OSS 未配置或不可用' };
  }
  
  try {
    const 客户端 = await 获取客户端();
    if (!客户端) {
      return { 成功: false, 错误: 'OSS 客户端初始化失败' };
    }
    
    await 客户端.delete(oss路径);
    logger.info(`文件已删除: ${oss路径}`);
    
    return { 成功: true };
  } catch (e) {
    logger.error('删除失败:', e.message);
    return { 成功: false, 错误: e.message };
  }
}

/**
 * 批量删除 OSS 文件
 * @param {string[]} 路径列表 - OSS 路径列表
 * @returns {Promise<{成功: boolean, 删除数量?: number, 错误?: string}>}
 */
export async function 批量删除(路径列表) {
  if (!是否可用()) {
    return { 成功: false, 错误: 'OSS 未配置或不可用' };
  }
  
  if (!Array.isArray(路径列表) || 路径列表.length === 0) {
    return { 成功: false, 错误: '路径列表为空' };
  }
  
  try {
    const 客户端 = await 获取客户端();
    if (!客户端) {
      return { 成功: false, 错误: 'OSS 客户端初始化失败' };
    }
    
    const 结果 = await 客户端.deleteMulti(路径列表);
    logger.info(`已批量删除 ${路径列表.length} 个文件`);
    
    return { 成功: true, 删除数量: 路径列表.length };
  } catch (e) {
    logger.error('批量删除失败:', e.message);
    return { 成功: false, 错误: e.message };
  }
}

/**
 * 获取 OSS 签名 URL（临时访问）
 * @param {string} oss路径 - OSS 路径
 * @param {number} 过期时间 - 过期时间（秒），默认 1 小时
 * @returns {Promise<{成功: boolean, 网址?: string, 错误?: string}>}
 */
export async function 获取签名网址(oss路径, 过期时间 = 3600) {
  if (!是否可用()) {
    return { 成功: false, 错误: 'OSS 未配置或不可用' };
  }
  
  try {
    const 客户端 = await 获取客户端();
    if (!客户端) {
      return { 成功: false, 错误: 'OSS 客户端初始化失败' };
    }
    
    const 网址 = 客户端.signatureUrl(oss路径, { expires: 过期时间 });
    
    return {
      成功: true,
      网址,
      过期时间
    };
  } catch (e) {
    logger.error('获取签名 URL 失败:', e.message);
    return { 成功: false, 错误: e.message };
  }
}

/**
 * 检查文件是否存在
 * @param {string} oss路径 - OSS 路径
 * @returns {Promise<{存在: boolean, 信息?: object}>}
 */
export async function 检查存在(oss路径) {
  if (!是否可用()) {
    return { 存在: false };
  }
  
  try {
    const 客户端 = await 获取客户端();
    if (!客户端) {
      return { 存在: false };
    }
    
    const 结果 = await 客户端.head(oss路径);
    
    return {
      存在: true,
      信息: {
        大小: 结果.res?.headers?.['content-length'],
        类型: 结果.res?.headers?.['content-type'],
        最后修改: 结果.res?.headers?.['last-modified']
      }
    };
  } catch (e) {
    return { 存在: false };
  }
}

/**
 * 列出目录下的文件
 * @param {string} 前缀 - 目录前缀
 * @param {object} 选项 - 选项
 * @returns {Promise<{成功: boolean, 文件列表?: Array, 错误?: string}>}
 */
export async function 列出文件(前缀 = '', 选项 = {}) {
  if (!是否可用()) {
    return { 成功: false, 错误: 'OSS 未配置或不可用' };
  }
  
  try {
    const 客户端 = await 获取客户端();
    if (!客户端) {
      return { 成功: false, 错误: 'OSS 客户端初始化失败' };
    }
    
    const 查询选项 = {
      prefix: 前缀,
      'max-keys': 选项.最大数量 || 100
    };
    
    if (选项.起始位置) {
      查询选项.marker = 选项.起始位置;
    }
    
    const 结果 = await 客户端.list(查询选项);
    
    const 文件列表 = (结果.objects || []).map(obj => ({
      名称: obj.name,
      大小: obj.size,
      最后修改: obj.lastModified,
      类型: obj.type
    }));
    
    return {
      成功: true,
      文件列表,
      是否完整: !结果.isTruncated,
      下一个起始位置: 结果.nextMarker
    };
  } catch (e) {
    logger.error('列出文件失败:', e.message);
    return { 成功: false, 错误: e.message };
  }
}

/**
 * 复制文件
 * @param {string} 源路径 - 源 OSS 路径
 * @param {string} 目标路径 - 目标 OSS 路径
 * @returns {Promise<{成功: boolean, 错误?: string}>}
 */
export async function 复制(源路径, 目标路径) {
  if (!是否可用()) {
    return { 成功: false, 错误: 'OSS 未配置或不可用' };
  }
  
  try {
    const 客户端 = await 获取客户端();
    if (!客户端) {
      return { 成功: false, 错误: 'OSS 客户端初始化失败' };
    }
    
    await 客户端.copy(目标路径, 源路径);
    logger.info(`文件已复制: ${源路径} -> ${目标路径}`);
    
    return { 成功: true };
  } catch (e) {
    logger.error('复制失败:', e.message);
    return { 成功: false, 错误: e.message };
  }
}

