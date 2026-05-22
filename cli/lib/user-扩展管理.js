/**
 * @file cli/lib/user-扩展管理
 * @description UserClient 的扩展审核、授权与仓库功能
 *
 * 从 user.js 拆分，KISS 原则
 * 职责：
 * 1. 扩展审核（提交审核/审核/列出待审核/查询注册信息）
 * 2. 扩展授权（授权/撤销/检查模式/列出已授权）
 * 3. 扩展包仓库（发布/获取上传URL/搜索/下载）
 */

/**
 * 扩展管理功能 mixin
 * 通过 Object.assign 注入到 UserClient.prototype
 */
export const 扩展管理Mixin = {
  // ==================== 扩展审核与授权 ====================

  /**
   * 提交扩展审核
   */
  async submitExtensionReview({ devId, extensionName, version, description, permissions, signature }) {
    await this.ensureAuth();
    return await this.post('/api/dove/app/submit', { devId, extensionName, version, description, permissions, signature });
  },

  /**
   * 审核扩展（管理员）
   */
  async reviewExtension(extensionName, action, note) {
    await this.ensureAuth();
    return await this.post('/api/dove/app/review', { extensionName, action, note });
  },

  /**
   * 列出待审核扩展（管理员）
   */
  async listPendingExtensions() {
    await this.ensureAuth();
    return await this.get('/api/dove/app/pending');
  },

  /**
   * 查询扩展官方注册信息
   */
  async getExtensionRegistry(extensionName) {
    try {
      return await this.get(`/api/dove/app/registry/${encodeURIComponent(extensionName)}`);
    } catch {
      return null;
    }
  },

  /**
   * 授权扩展
   */
  async authorizeExtension(extensionName) {
    await this.ensureAuth();
    return await this.post('/api/dove/app/authorize', { extensionName });
  },

  /**
   * 撤销扩展授权
   */
  async revokeExtension(extensionName) {
    await this.ensureAuth();
    return await this.post('/api/dove/app/revoke', { extensionName });
  },

  /**
   * 检查扩展运行模式
   */
  async checkExtensionMode(extensionName, devId, permissions) {
    await this.ensureAuth();
    return await this.post('/api/dove/app/check', { extensionName, devId, permissions });
  },

  /**
   * 列出已授权扩展
   */
  async listAuthorizedExtensions() {
    await this.ensureAuth();
    return await this.get('/api/dove/app/list');
  },

  // ==================== 扩展包仓库 ====================

  /**
   * 发布扩展包（注册索引）
   * @param {Object} metadata - 包元数据
   */
  async publishExtension(metadata) {
    await this.ensureAuth();
    return await this.post('/api/dove/app/store/publish', { metadata });
  },

  /**
   * 获取扩展包上传 URL
   * @param {string} name - 扩展名
   * @param {string} version - 版本
   */
  async getExtensionUploadUrl(name, version) {
    await this.ensureAuth();
    return await this.post('/api/dove/app/store/upload', { name, version });
  },

  /**
   * 搜索扩展包
   * @param {string} keyword - 关键词
   * @param {Object} options - 分页选项
   */
  async searchExtensions(keyword, options = {}) {
    return await this.get('/api/dove/app/store/search', {
      keyword: keyword || '',
      page: options.page || 1,
      limit: options.limit || 20,
    });
  },

  /**
   * 下载扩展包
   * @param {string} name - 扩展名
   * @param {string} version - 版本（可选，默认最新）
   */
  async downloadExtension(name, version) {
    const path = version
      ? `/api/dove/app/store/download/${encodeURIComponent(name)}/${version}`
      : `/api/dove/app/store/download/${encodeURIComponent(name)}`;
    return await this.get(path);
  }
};
