/**
 * 认证 API 模块
 * 提供用户注册、登录、Token 管理等功能
 */

import { BaseClient } from './base-client.js';

/**
 * 认证模块
 * 继承基础客户端，添加认证相关方法
 */
export class AuthClient extends BaseClient {
  // ==================== 用户认证 ====================

  /**
   * 用户注册
   * @param {string} username - 用户名
   * @param {string} password - 密码
   * @param {string} email - 邮箱（可选）
   * @returns {Object} 注册结果
   */
  async register(username, password, email = '') {
    try {
      const data = await this.post('/auth/register', { username, password, email });
      if (data.token) {
        this.token = data.token;
        this.config.token = data.token;
        this.config.userId = data.userId;
        this.config.username = data.username;
        if (data.role) this.config.role = data.role;
        this.saveConfig();
      }
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * 用户登录
   * @param {string} username - 用户名
   * @param {string} password - 密码
   * @returns {Object} 登录结果
   */
  async login(username, password) {
    try {
      const data = await this.post('/auth/login', { username, password });
      if (data.token) {
        this.token = data.token;
        this.config.token = data.token;
        this.config.userId = data.userId;
        this.config.username = data.username;
        this.config.authType = data.authType || 'permanent';
        this.config.expiresAt = data.expiresAt;
        this.config.lastRefreshTime = new Date().toISOString();
        if (data.role) this.config.role = data.role;
        this.saveConfig();
      }
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * 匿名登录（快速体验）
   * @returns {Object} 登录结果
   */
  async anonymousLogin() {
    try {
      const data = await this.post('/auth/anonymous', {});
      if (data.token) {
        this.token = data.token;
        this.config.token = data.token;
        this.config.userId = data.userId;
        this.config.username = data.username;
        this.config.anonymous = true;
        this.config.authType = data.authType;
        this.config.expiresAt = data.expiresAt;
        this.config.lastRefreshTime = new Date().toISOString();
        if (data.role) this.config.role = data.role;
        this.saveConfig();
      }
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * 验证 Token 有效性
   * @returns {Object} 验证结果
   */
  async verifyToken() {
    if (!this.token) {
      return { valid: false, error: '未登录' };
    }

    try {
      const data = await this.get('/auth/verify');
      if (data.valid) {
        this.config.authType = data.authType;
        this.config.expiresAt = data.expiresAt;
        this.config.anonymous = data.anonymous;
        if (data.role) this.config.role = data.role;
      }
      return data;
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  /**
   * 刷新 Token
   * @returns {Object} 刷新结果
   */
  async refreshToken() {
    if (!this.token) {
      return { success: false, error: '未登录' };
    }

    try {
      const data = await this.post('/auth/refresh', {});
      if (data.token) {
        this.token = data.token;
        this.config.token = data.token;
        this.config.authType = data.authType;
        this.config.expiresAt = data.expiresAt;
        this.config.lastRefreshTime = new Date().toISOString();
        this.saveConfig();
      }
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * 获取资源状态
   * @returns {Object} 资源状态
   */
  async getResourceStatus() {
    await this.ensureAuth();

    try {
      return await this.get('/auth/resource-status');
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * 查询服务端是否允许匿名登录
   * @returns {boolean} 是否允许匿名登录
   */
  async isAnonymousAllowed() {
    try {
      const data = await this.get('/auth/anonymous-status');
      return data?.allowed === true;
    } catch {
      return false;
    }
  }

  // ==================== 认证状态检查 ====================

  /**
   * 检查认证类型
   * @returns {string} 'permanent' | 'temporary' | 'none'
   */
  getAuthType() {
    return this.config.authType || (this.config.anonymous ? 'temporary' : 'permanent');
  }

  /**
   * 检查是否为长期认证
   * @returns {boolean}
   */
  isPermanentAuth() {
    return this.getAuthType() === 'permanent';
  }

  /**
   * 确保已登录
   * 每次使用 token 时，如果超过 1 小时就自动刷新延期
   * 如果未登录且匿名登录被禁止，返回 false 让调用方提示用户注册
   */
  async ensureAuth() {
    // 没有 token，尝试登录
    if (!this.token) {
      // 先检查服务端是否允许匿名登录
      const anonymousAllowed = await this.isAnonymousAllowed();
      if (anonymousAllowed) {
        const result = await this.anonymousLogin();
        return result.success;
      }
      // 匿名登录被禁止，返回 false
      return false;
    }

    // 检查是否超过 1 小时，需要刷新延期
    const lastRefresh = this.config.lastRefreshTime;
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    
    if (!lastRefresh || new Date(lastRefresh).getTime() < oneHourAgo) {
      // 超过 1 小时，尝试刷新
      const refreshResult = await this.refreshToken();
      if (!refreshResult.success) {
        // 刷新失败（token 已过期），重新登录
        if (this.config.role === 'admin') {
          // 管理员 token 过期，需要重新登录
          this.token = null;
          this.config.token = null;
        }
        // 尝试匿名登录
        const anonymousAllowed = await this.isAnonymousAllowed();
        if (anonymousAllowed) {
          const result = await this.anonymousLogin();
          return result.success;
        }
        return false;
      }
    }

    return true;
  }

  /**
   * 检查是否为超级管理员
   */
  isAdmin() {
    return this.config.role === 'admin';
  }
}
