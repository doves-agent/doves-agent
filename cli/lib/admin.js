/**
 * 管理员 API 模块
 * 提供超级管理员专用功能：管理员登录、系统诊断、系统凭证管理等
 *
 * 注意：此模块仅限超级管理员使用，普通用户请使用 UserClient
 */

import { UserClient } from './user.js';

/**
 * 管理员客户端
 * 继承用户管理客户端，添加管理员专用方法
 *
 * 包含功能：
 * - 超级管理员登录
 * - 系统诊断信息
 * - 系统凭证管理
 */
export class AdminClient extends UserClient {
  // ==================== 管理员登录 ====================

  async adminLogin(username, password) {
    try {
      const data = await this.post('/auth/admin', { username, password });
      if (data.token) {
        this.token = data.token;
        this.config.token = data.token;
        this.config.userId = data.userId;
        this.config.username = data.username;
        this.config.role = 'admin';
        this.config.authType = 'admin';
        this.config.expiresAt = data.expiresAt;
        this.config.lastRefreshTime = new Date().toISOString();
        this.saveConfig();
      }
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ==================== 系统诊断 ====================

  async getAdminDiagnostic() {
    return await this.get('/api/admin/diagnostic');
  }

  // ==================== 系统凭证管理 ====================

  async getAdminCredentials() {
    return await this.get('/api/admin/credentials');
  }

  async updateAdminCredential(category, provider, config) {
    return await this._apiRequest('PUT', '/api/admin/credentials', { category, provider, config });
  }

  // ==================== 全局默认模型配置 ====================

  async getModelDefaults() {
    return await this.get('/api/admin/model-defaults');
  }

  async setModelDefaults(modelSettings) {
    return await this._apiRequest('PUT', '/api/admin/model-defaults', modelSettings);
  }
}
