/**
 * 用户管理 API 模块
 * 提供用户级别的管理功能：API Key管理、白鸽管理、Profile管理等
 *
 * 扩展审核/授权/仓库功能已拆分到 user-扩展管理.js
 */

import { ConversationClient } from './conversation.js';
import { 扩展管理Mixin } from './user-扩展管理.js';

/**
 * 用户管理客户端
 * 继承对话客户端，添加用户级别的管理方法
 *
 * 包含功能：
 * - 用户 API Key 管理
 * - 用户模型配置
 * - 白鸽注册与管理
 * - 执行配置 Profile 管理
 * - 扩展审核/授权/仓库（通过 扩展管理Mixin 注入）
 */
export class UserClient extends ConversationClient {
  // ==================== 用户 API Key 管理 ====================

  async getUserKeys() {
    await this.ensureAuth();
    return await this.get('/api/user/keys');
  }

  async setUserKey(provider, apiKey, models = []) {
    await this.ensureAuth();
    return await this._apiRequest('PUT', '/api/user/keys', { provider, apiKey, models });
  }

  async deleteUserKey(provider) {
    await this.ensureAuth();
    return await this._apiRequest('DELETE', '/api/user/keys', { provider });
  }

  async testKey(provider, testKey = null) {
    await this.ensureAuth();
    return await this.post('/api/user/keys/test', { provider, testKey });
  }

  // ==================== 用户模型配置 ====================

  async getModelSettings() {
    await this.ensureAuth();
    return await this.get('/api/user/keys/model-settings');
  }

  async setModelSettings(modelSettings) {
    await this.ensureAuth();
    return await this._apiRequest('PUT', '/api/user/keys/model-settings', modelSettings);
  }

  async deleteModelSetting(role) {
    await this.ensureAuth();
    return await this._apiRequest('DELETE', `/api/user/keys/model-settings/${role}`);
  }

  // ==================== 系统模型列表 ====================

  async getModelList(provider = null) {
    await this.ensureAuth();
    const params = {};
    if (provider) params.provider = provider;
    return await this.get('/api/user/keys/model-list', params);
  }

  async updateModelList(provider, models) {
    await this.ensureAuth();
    return await this._apiRequest('PUT', '/api/user/keys/model-list', { provider, models });
  }

  // ==================== 白鸽注册管理 ====================

  async registerDove({ 名称, 类型 = 'private', 能力列表 = [], 配置 = {} }) {
    await this.ensureAuth();
    const { 获取或生成机器标识 } = await import('./machine-id.js');
    const machineId = 获取或生成机器标识();
    try {
      return await this.post('/api/dove/register', { 名称, 类型, 能力列表, 配置, machineId });
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async listMyDoves() {
    await this.ensureAuth();
    return await this.get('/api/dove/my-doves');
  }

  async getDoveInfo(doveId) {
    await this.ensureAuth();
    return await this.get(`/api/dove/info/${doveId}`);
  }

  async deleteDove(doveId) {
    await this.ensureAuth();
    try {
      return await this._apiRequest('DELETE', `/api/dove/${doveId}`);
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async regenerateDoveKey(doveId) {
    await this.ensureAuth();
    try {
      return await this.post(`/api/dove/${doveId}/regenerate-key`);
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ==================== 渠道权限管理 ====================

  async getChannelPermission(doveId) {
    await this.ensureAuth();
    return await this.get(`/api/dove/channel-permission/${doveId}`);
  }

  async updateChannelPermission(doveId, role, channel, config) {
    await this.ensureAuth();
    try {
      return await this._apiRequest('PUT', '/api/dove/channel-permission', { doveId, role, channel, config });
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async resetChannelPermission(doveId, role) {
    await this.ensureAuth();
    try {
      return await this.post('/api/dove/channel-permission/reset', { doveId, role });
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async getDoveConfigDefaults() {
    return await this.get('/api/dove/config/defaults');
  }

  // ==================== 执行配置 Profile API ====================

  async listProfiles(筛选 = {}) {
    await this.ensureAuth();
    const params = {};
    if (筛选.tag) params.tag = 筛选.tag;
    if (筛选.keyword) params.keyword = 筛选.keyword;
    return await this.get('/api/profile', params);
  }

  async getProfile(标识) {
    await this.ensureAuth();
    return await this.get(`/api/profile/${encodeURIComponent(标识)}`);
  }

  async createProfile(配置数据) {
    await this.ensureAuth();
    return await this.post('/api/profile', 配置数据);
  }

  async updateProfile(标识, 更新数据) {
    await this.ensureAuth();
    return await this._apiRequest('PUT', `/api/profile/${encodeURIComponent(标识)}`, 更新数据);
  }

  async deleteProfile(标识) {
    await this.ensureAuth();
    return await this._apiRequest('DELETE', `/api/profile/${encodeURIComponent(标识)}`);
  }

  async listProfileTags() {
    await this.ensureAuth();
    return await this.get('/api/profile/tags/list');
  }

  // ==================== 多智能体团队配置 API ====================

  async getTeamConfig() {
    await this.ensureAuth();
    return await this.get('/api/team/config');
  }

  async getDefaultTeamConfig() {
    await this.ensureAuth();
    return await this.get('/api/team/default');
  }

  async saveTeamConfig(config) {
    await this.ensureAuth();
    return await this._apiRequest('PUT', '/api/team/config', config);
  }

  async addTeamAgent(agent) {
    await this.ensureAuth();
    return await this.post('/api/team/agent', agent);
  }

  async removeTeamAgent(角色名) {
    await this.ensureAuth();
    return await this._apiRequest('DELETE', `/api/team/agent/${encodeURIComponent(角色名)}`);
  }

  async updateTeamAgent(角色名, updates) {
    await this.ensureAuth();
    return await this._apiRequest('PUT', `/api/team/agent/${encodeURIComponent(角色名)}`, updates);
  }

  // ==================== 扩展审核/授权/仓库（从 user-扩展管理.js 注入） ====================
}

// 注入扩展管理功能（从 user-扩展管理.js 拆分）
Object.assign(UserClient.prototype, 扩展管理Mixin);
