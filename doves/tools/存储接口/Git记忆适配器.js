import { logger } from './核心.js';
import Git记忆 from '../Git存储/记忆仓库.js';

export class Git记忆适配器 {
  constructor() {
    this.available = null;
  }

  async checkAvailable() {
    if (this.available === null) {
      this.available = Git记忆.是否可用();
    }
    return this.available;
  }

  async add(userId, messages, metadata = {}) {
    logger.debug(`Git记忆 add: ${userId}`);
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'Git记忆系统未连接' };
    }
    try {
      const result = await Git记忆.添加记忆({
        用户ID: userId,
        消息列表: messages,
        元数据: metadata,
        类别: metadata.category,
        标题: metadata.title
      });
      return { 成功: true, data: result };
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }

  async addMultimodal(userId, params = {}) {
    logger.debug(`Git记忆 addMultimodal: ${userId}`);
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'Git记忆系统未连接' };
    }
    try {
      const result = await Git记忆.添加多模态记忆({
        用户ID: userId,
        文本: params.文本,
        图片URL: params.图片URL,
        音频URL: params.音频URL,
        视频URL: params.视频URL,
        类别: params.类别 || '经验记忆',
        元数据: params.元数据 || {}
      });
      return { 成功: true, data: result };
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }

  async search(query, userId = null, options = {}) {
    logger.debug(`Git记忆 search: ${query}`, { userId });
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'Git记忆系统未连接' };
    }
    try {
      const result = await Git记忆.搜索记忆({
        查询: query,
        用户ID: userId,
        类别: options.category,
        返回数量: options.limit || 10,
        阈值: options.threshold,
        包含多模态: options.includeMultimodal
      });
      return { 成功: true, data: result };
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }

  async get(memoryId) {
    logger.debug(`Git记忆 get: ${memoryId}`);
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'Git记忆系统未连接' };
    }
    try {
      const result = await Git记忆.获取记忆({ 记忆ID: memoryId });
      return { 成功: true, data: result };
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }

  async delete(memoryId = null, userId = null) {
    logger.debug('Git记忆 delete', { memoryId, userId });
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'Git记忆系统未连接' };
    }
    try {
      const result = await Git记忆.删除记忆({ 记忆ID: memoryId });
      return { 成功: true, data: result };
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }

  async list(userId, options = {}) {
    logger.debug(`Git记忆 list: ${userId}`);
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'Git记忆系统未连接' };
    }
    try {
      const result = await Git记忆.获取记忆列表({
        用户ID: userId,
        类别: options.category,
        页码: options.page || 1,
        每页数量: options.pageSize || 20
      });
      return { 成功: true, data: result };
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }
}
