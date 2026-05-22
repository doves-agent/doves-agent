/**
 * @file tools/存储接口/OSS适配器
 * @description OSS 存储操作封装（上传/下载/删除/签名URL）
 */

import { logger } from './核心.js';
import OSS存储 from '../oss存储.js';

export class OSS适配器 {
  constructor() {
    this.available = null;
  }

  /**
   * 检查是否可用
   */
  async checkAvailable() {
    if (this.available === null) {
      this.available = OSS存储.是否可用();
    }
    return this.available;
  }

  /**
   * 上传文件
   * @param {Buffer|string} content - 文件内容
   * @param {string} filename - 文件名
   * @param {Object} options - 上传选项
   */
  async upload(content, filename, options = {}) {
    logger.debug(`OSS upload: ${filename}`);
    
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'OSS存储未启用' };
    }

    try {
      const path = options.path ? `${options.path}/${filename}` : filename;
      const result = await OSS存储.上传(content, filename, { 路径: path });
      return result;
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }

  /**
   * 下载文件
   * @param {string} path - 文件路径
   */
  async download(path) {
    logger.debug(`OSS download: ${path}`);
    
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'OSS存储未启用' };
    }

    try {
      const result = await OSS存储.下载(path);
      return result;
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }

  /**
   * 删除文件
   * @param {string} path - 文件路径
   */
  async delete(path) {
    logger.debug(`OSS delete: ${path}`);
    
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'OSS存储未启用' };
    }

    try {
      const result = await OSS存储.删除(path);
      return result;
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }

  /**
   * 列出文件
   * @param {string} prefix - 路径前缀
   */
  async list(prefix = '') {
    logger.debug(`OSS list: ${prefix}`);
    
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'OSS存储未启用' };
    }

    try {
      const result = await OSS存储.列出({ 前缀: prefix });
      return result;
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }

  /**
   * 获取签名URL
   * @param {string} path - 文件路径
   * @param {number} expires - 过期时间（秒）
   */
  async signUrl(path, expires = 3600) {
    logger.debug(`OSS signUrl: ${path}`);
    
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'OSS存储未启用' };
    }

    try {
      const result = await OSS存储.获取签名URL(path, expires);
      return result;
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }
}
