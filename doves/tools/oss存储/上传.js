/**
 * @file tools/oss存储/上传
 * @description 文件上传（本地文件、Buffer、Base64）
 */

import { existsSync, statSync } from 'fs';
import { logger, 是否可用, 获取客户端, 生成路径 } from './核心.js';

/**
 * 上传文件到 OSS
 * @param {string|Buffer} 源 - 文件路径或 Buffer
 *   - 文件路径：ali-oss SDK 内部 createReadStream 流式上传，不占内存
 *   - Buffer：直接上传
 * @param {string} 文件名 - 原始文件名
 * @param {object} 选项 - 选项
 * @returns {Promise<{成功: boolean, 网址?: string, 路径?: string, 大小?: number, 错误?: string}>}
 */
export async function 上传(源, 文件名, 选项 = {}) {
  if (!是否可用()) {
    return { 成功: false, 错误: 'OSS 未配置或不可用' };
  }
  
  try {
    const 客户端 = await 获取客户端();
    if (!客户端) {
      return { 成功: false, 错误: 'OSS 客户端初始化失败' };
    }
    
    // 生成 OSS 路径
    const oss路径 = 选项.路径 || 生成路径(文件名);
    
    let 文件大小;
    let put结果;
    
    if (Buffer.isBuffer(源)) {
      文件大小 = 源.length;
      put结果 = await 客户端.put(oss路径, 源);
    } else if (typeof 源 === 'string' && existsSync(源)) {
      // 直接传文件路径，ali-oss SDK 内部用 fs.createReadStream 流式上传
      // 不会把整个文件读进内存，大文件也安全
      文件大小 = statSync(源).size;
      put结果 = await 客户端.put(oss路径, 源);
    } else {
      return { 成功: false, 错误: '无效的文件源' };
    }
    
    logger.info(`文件已上传: ${oss路径} (${(文件大小 / 1024 / 1024).toFixed(1)}MB)`);
    
    return {
      成功: true,
      网址: put结果.url,
      路径: oss路径,
      大小: 文件大小,
    };
  } catch (e) {
    logger.error('上传失败:', e.message);
    return { 成功: false, 错误: e.message };
  }
}

/**
 * 上传 Base64 数据到 OSS
 * @param {string} base64数据 - Base64 数据 (data:image/xxx;base64,...)
 * @param {string} 文件名 - 文件名
 * @returns {Promise<{成功: boolean, 网址?: string, 错误?: string}>}
 */
export async function 上传Base64(base64数据, 文件名) {
  if (!base64数据) {
    return { 成功: false, 错误: '没有 base64 数据' };
  }
  
  try {
    // 解析 base64 数据
    let mimeType = 'image/png';
    let base64Content = base64数据;
    
    if (base64数据.startsWith('data:')) {
      const match = base64数据.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        base64Content = match[2];
      }
    }
    
    // 转换为 Buffer
    const buffer = Buffer.from(base64Content, 'base64');
    
    // 根据 MIME 类型确定扩展名
    const extMap = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/bmp': '.bmp'
    };
    const ext = extMap[mimeType] || '.png';
    
    // 生成文件名
    const 最终文件名 = 文件名 || `image_${Date.now()}${ext}`;
    
    return 上传(buffer, 最终文件名);
  } catch (e) {
    logger.error('Base64 上传失败:', e.message);
    return { 成功: false, 错误: e.message };
  }
}
