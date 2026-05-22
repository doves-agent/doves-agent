import { logger } from './核心.js';
import Git数据 from '../Git存储/数据仓库.js';

export class Git数据适配器 {
  constructor() {
    this.available = null;
  }

  async checkAvailable() {
    if (this.available === null) {
      this.available = Git数据.是否可用();
    }
    return this.available;
  }

  async createSnapshot(path, options = {}) {
    logger.debug(`Git数据 createSnapshot: ${options.name || path}`);
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'Git数据系统未连接' };
    }
    try {
      const result = await Git数据.创建快照({ 名称: options.name || path, 描述: options.description || '' });
      return { 成功: true, data: result };
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }

  async createDirSnapshot(path, options = {}) {
    return this.createSnapshot(path, options);
  }

  async getSnapshot(snapshotId) {
    logger.debug(`Git数据 getSnapshot: ${snapshotId}`);
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'Git数据系统未连接' };
    }
    try {
      const list = await Git数据.列出快照();
      const found = (list || []).find(s => s.标签名 === snapshotId);
      if (!found) return { 成功: false, 错误: '快照不存在' };
      return { 成功: true, data: found };
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }

  async rollbackSnapshot(snapshotId, targetPath = null, options = {}) {
    logger.debug(`Git数据 rollbackSnapshot: ${snapshotId}`);
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'Git数据系统未连接' };
    }
    try {
      const result = await Git数据.恢复快照({ 标签名: snapshotId });
      return { 成功: true, data: result };
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }

  async listSnapshots() {
    logger.debug('Git数据 listSnapshots');
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'Git数据系统未连接' };
    }
    try {
      const result = await Git数据.列出快照();
      return { 成功: true, data: result };
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }

  async deleteSnapshot(snapshotId) {
    logger.debug(`Git数据 deleteSnapshot: ${snapshotId}`);
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'Git数据系统未连接' };
    }
    try {
      const result = await Git数据.删除快照({ 标签名: snapshotId });
      return { 成功: true, data: result };
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }

  async readFile(path) {
    logger.debug(`Git数据 readFile: ${path}`);
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'Git数据系统未连接' };
    }
    try {
      const result = await Git数据.读取文件({ 路径: path });
      return { 成功: true, data: result };
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }

  async writeFile(path, content, options = {}) {
    logger.debug(`Git数据 writeFile: ${path}`);
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'Git数据系统未连接' };
    }
    try {
      const result = await Git数据.写入文件({ 路径: path, 内容: content, 提交消息: options.message });
      return { 成功: true, data: result };
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }

  async deleteFile(path, options = {}) {
    logger.debug(`Git数据 deleteFile: ${path}`);
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'Git数据系统未连接' };
    }
    try {
      const result = await Git数据.删除文件({ 路径: path, 提交消息: options.message });
      return { 成功: true, data: result };
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }

  async listFiles(path = '') {
    logger.debug(`Git数据 listFiles: ${path}`);
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'Git数据系统未连接' };
    }
    try {
      const result = await Git数据.列出文件({ 路径: path });
      return { 成功: true, data: result };
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }

  async getFileHistory(path, limit = 20) {
    logger.debug(`Git数据 getFileHistory: ${path}`);
    if (!await this.checkAvailable()) {
      return { 成功: false, 错误: 'Git数据系统未连接' };
    }
    try {
      const result = await Git数据.获取文件历史({ 路径: path, 数量: limit });
      return { 成功: true, data: result };
    } catch (e) {
      return { 成功: false, 错误: e.message };
    }
  }
}
