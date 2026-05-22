/**
 * 存储客户端 API
 *
 * 提供 OSS 临时目录和Git存储的客户端操作
 * 文件上传统一走 Server 流式转发到 OSS，禁止直接发送或 base64
 */

import { BaseClient } from './base-client.js';
import { streamUploadFile, getDownloadUrl, getUserIdFromToken } from './stream-upload.js';

// OSS 路径前缀（从环境变量读取，默认 'dove'）
const OSS_PREFIX = process.env.OSS_PREFIX || 'dove';

/**
 * 存储客户端类
 * 继承 BaseClient，添加存储相关 API
 */
export class StorageClient extends BaseClient {
  
  // ==================== OSS 临时目录 ====================
  
  /**
   * 创建任务临时目录
   * @param {string} taskId - 任务ID
   * @param {string} ownerId - 任务所有者ID
   * @param {string} doveId - 鸽子ID（可选）
   */
  async createTempDir(taskId, ownerId, doveId = null) {
    return await this.post('/api/temp/tasks', { taskId, ownerId, doveId });
  }
  
  /**
   * 获取临时目录 URL
   */
  async getTempDirUrls(taskId, hash, ownerId, timestamp) {
    return await this.get(`/api/temp/tasks/${taskId}/urls`, { hash, ownerId, timestamp });
  }
  
  /**
   * 复制文件到临时目录
   */
  async copyToTempDir(taskId, source, target, ownerId, hash) {
    return await this.post(`/api/temp/tasks/${taskId}/copy`, { source, target, ownerId, hash });
  }
  
  /**
   * 上传文件到临时目录（流式上传到 OSS，禁止 base64）
   *
   * @param {string} taskId - 任务ID
   * @param {string} target - 目标文件名
   * @param {string} localPath - 本地文件路径（不再是 base64 内容）
   * @param {string} ownerId - 所有者ID
   * @param {string} hash - 目录 hash
   * @param {Function} [onProgress] - 进度回调
   * @returns {Promise<object>} 上传结果
   */
  async uploadToTempDir(taskId, target, localPath, ownerId, hash, onProgress) {
    const userId = getUserIdFromToken(this.token) || ownerId;
    const targetDir = `${OSS_PREFIX}/users/${userId}/temp/${hash}`;

    const result = await streamUploadFile({
      client: this,
      localPath,
      targetDir,
      fileName: target,
      onProgress,
    });

    // 关联到临时目录（通知 Server 记录文件归属）
    return await this._apiRequest('PUT', `/api/temp/tasks/${taskId}/upload`, {
      target,
      url: result.url,
      ossPath: result.path,
      ownerId,
      hash,
      encoding: 'url',
    });
  }
  
  /**
   * 列出临时目录内容
   */
  async listTempDir(taskId, ownerId, hash, dir = '') {
    return await this.get(`/api/temp/tasks/${taskId}/list`, { ownerId, hash, dir });
  }
  
  /**
   * 完成任务并清理临时目录
   */
  async finalizeTempDir(taskId, ownerId, hash, syncTo = null) {
    return await this.post(`/api/temp/tasks/${taskId}/finalize`, { ownerId, hash, syncTo });
  }
  
  /**
   * 删除临时目录
   */
  async deleteTempDir(taskId, ownerId, hash) {
    const params = new URLSearchParams({ ownerId, hash });
    return await this._apiRequest('DELETE', `/api/temp/tasks/${taskId}?${params}`);
  }
  
  // ==================== Git存储 ====================

  /**
   * 获取Git存储状态
   */
  async getGitStorageStatus() {
    return await this.get('/api/git-storage/files/status');
  }

  /**
   * 克隆快照
   */
  async cloneSnapshot(source, target, preserve = false) {
    return await this.post('/api/git-storage/files/clone', { source, target, preserve });
  }

  /**
   * 获取配额信息
   */
  async getQuota(path = null) {
    const params = {};
    if (path) params.path = path;
    return await this.get('/api/git-storage/files/quota', params);
  }

  /**
   * 设置配额
   */
  async setQuota(path, capacity, inodes) {
    return await this.post('/api/git-storage/files/quota/set', { path, capacity, inodes });
  }

  /**
   * 删除配额
   */
  async deleteQuota(path) {
    const params = new URLSearchParams({ path });
    return await this._apiRequest('DELETE', `/api/git-storage/files/quota?${params}`);
  }
  
  // ==================== 目录权限 ====================
  
  /**
   * 列出我的目录
   */
  async listMyDirectories() {
    return await this.get('/api/storage/directories');
  }
  
  /**
   * 创建目录
   */
  async createDirectory(路径, 名称, 选项 = {}) {
    return await this.post('/api/storage/directories', { 路径, 名称, ...选项 });
  }
  
  /**
   * 获取目录详情
   */
  async getDirectory(目录ID) {
    return await this.get(`/api/storage/directories/${目录ID}`);
  }
  
  /**
   * 分配权限
   */
  async grantPermission(目录ID, 用户ID, 权限, 选项 = {}) {
    return await this.post('/api/storage/permissions', { 目录ID, 用户ID, 权限, ...选项 });
  }
  
  /**
   * 撤销权限
   */
  async revokePermission(权限ID) {
    return await this._apiRequest('DELETE', `/api/storage/permissions/${权限ID}`);
  }
  
  /**
   * 列出目录权限
   */
  async listDirectoryPermissions(目录ID) {
    return await this.get('/api/storage/permissions', { '目录ID': 目录ID });
  }
  
  // ==================== 文件操作 ====================
  
  /**
   * 读取文件
   * @param {string} filePath - 文件路径
   * @returns {string} 文件内容
   */
  async readFile(filePath) {
    await this.ensureAuth();
    return await this.get(`/api/files/${encodeURIComponent(filePath)}`);
  }
  
  /**
   * 写入文件（仅适用于小文本内容，二进制/大文件请使用 streamUploadFile）
   * @param {string} filePath - 文件路径
   * @param {string} content - 文本内容
   * @returns {Object} 操作结果
   */
  async writeFile(filePath, content) {
    await this.ensureAuth();
    return await this._apiRequest('PUT', `/api/files/${encodeURIComponent(filePath)}`, { content });
  }

  // ==================== 流式上传到 OSS ====================

  /**
   * 流式上传文件到 OSS（通过 Server 中转，禁止直接发送/base64）
   *
   * @param {string} localPath - 本地文件路径
   * @param {string} [targetDir] - OSS 目标目录（默认 users/{userId}/uploads）
   * @param {object} [options]
   * @param {string} [options.fileName] - 远程文件名
   * @param {Function} [options.onProgress] - 进度回调
   * @returns {Promise<{ url: string, path: string, size: number }>}
   */
  async streamUploadFile(localPath, targetDir, options = {}) {
    await this.ensureAuth();

    if (!targetDir) {
      const userId = getUserIdFromToken(this.token);
      if (!userId) throw new Error('无法确定用户ID，请指定 targetDir');
      targetDir = `${OSS_PREFIX}/users/${userId}/uploads`;
    }

    return streamUploadFile({
      client: this,
      localPath,
      targetDir,
      fileName: options.fileName,
      onProgress: options.onProgress,
    });
  }

  /**
   * 获取文件签名下载 URL
   *
   * @param {string} filePath - OSS 文件路径
   * @param {number} [expiresIn=3600] - 链接有效时间（秒）
   * @returns {Promise<{ url: string, expiresAt: number, fileSize: number }>}
   */
  async getDownloadUrl(filePath, expiresIn = 3600) {
    await this.ensureAuth();

    return getDownloadUrl({
      client: this,
      filePath,
      expiresIn,
    });
  }

  /**
   * 确保已认证（简化版，检查 token 存在即可）
   * @returns {boolean} 是否已认证
   */
  async ensureAuth() {
    if (!this.token) {
      return false;
    }
    return true;
  }
  
  /**
   * 删除文件
   * @param {string} filePath - 文件路径
   * @returns {Object} 操作结果
   */
  async deleteFile(filePath) {
    await this.ensureAuth();
    return await this._apiRequest('DELETE', `/api/files/${encodeURIComponent(filePath)}`);
  }
  
  /**
   * 列出目录内容
   * @param {string} dir - 目录路径（可选）
   * @returns {Object} 目录内容
   */
  async listFiles(dir = '') {
    await this.ensureAuth();
    return await this.get(`/api/files/list/${encodeURIComponent(dir)}`);
  }
}
