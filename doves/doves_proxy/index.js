/**
 * @file doves_proxy/index
 * @description 鸽子代理模块，通过加密通道安全访问数据
 * 
 * 【KISS原则文档的一部分】
 * 
 * === 设计目标 ===
 * 所有鸽子（官方/野鸽子）通过加密 TCP 通道访问服务端，禁止明文 HTTP
 * - 提供与 MongoDB 兼容的接口
 * - 通过 Noise NX 加密 TCP 调用服务端
 * - 支持鸽子 API Key 认证（通过 DoveCryptoClient 自动注入）
 * 
 * === 架构 ===
 * ┌─────────────────────────────────────────────────────────────┐
 * │                      鸽子进程（官方/野鸽子）                   │
 * │  ┌─────────────────┐                                       │
 * │  │ 任务队列.js     │                                       │
 * │  │ 智能体.js       │  →  DovesProxy  →  加密TCP(:3003)  →  Server │
 * │  │ skills/*.js     │                      ↓                │
 * │  └─────────────────┘                   MongoDB/OSS          │
 * └─────────────────────────────────────────────────────────────┘
 * 
 * === 使用方式 ===
 * import { DovesProxy } from './doves_proxy/index.js';
 * import { DoveCryptoClient } from './加密客户端.js';
 * 
 * // 建立加密连接
 * const cryptoClient = new DoveCryptoClient({
 *   hostname: 'doves.fast-agent.cn',
 *   doveId: 'dove_xxx',
 *   apiKey: 'sk_xxx'
 * });
 * await cryptoClient.connect();
 * 
 * // 创建代理
 * const client = new DovesProxy({ cryptoClient });
 * 
 * // 使用
 * const db = client.db('doves_user_data');
 * const collection = db.collection('任务');
 * await collection.findOne({ id: 'task_xxx' });
 */

import { GatewayDatabase, GatewayCollection } from './gateway-集合.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('鸽子代理', { 前缀: '[DovesProxy]', 级别: 'debug', 显示调用位置: true });

/**
 * 鸽子代理类
 * 所有鸽子通过此代理访问服务端数据
 */
export class DovesProxy {
  constructor(config = {}) {
    // 加密客户端（优先）：通过 Noise NX 加密 TCP 通讯
    this.cryptoClient = config.cryptoClient || null;
    this.serverUrl = config.serverUrl || process.env.SERVER_URL || '';

    if (!this.cryptoClient && !this.serverUrl) {
      throw new Error('缺少 cryptoClient 或 SERVER_URL，请在 .env 中配置 Server 地址');
    }

    this.timeout = config.timeout || 30000;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000;

    // 缓存数据库实例
    this._databases = new Map();
  }

  /**
   * 发送请求到服务端（通用方法）
   * 可用于调用任意服务端 API
   * 
   * options.body 可以是:
   * - 字符串 (已 JSON.stringify)
   * - 对象 (自动序列化)
   */
  async fetch(path, options = {}) {
    const method = options.method || 'POST';
    let body = options.body || null;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    return this._request(path, method, body);
  }

  /**
   * 发送请求到服务端（仅加密通道，不走明文降级）
   */
  async _request(path, method = 'GET', body = null) {
    if (!this.cryptoClient?.connected) {
      throw new Error(
        '🔒 Doves 加密通道未建立，无法访问 Server。\n' +
        '\n' +
        '所有 Doves 请求必须通过 Noise NX 加密通道（TCP 3003）。\n' +
        '明文 HTTP 已禁止。\n' +
        '\n' +
        '排查步骤：\n' +
        '  1. 确认 .env 中 SERVER_URL 配置正确\n' +
        '  2. 确认 SERVER_API_KEY 或 GATEWAY_JWT 已配置\n' +
        '  3. 确认 Server 加密端口（默认 3003）已启动\n' +
        '  4. 查看日志中的 [加密客户端] 连接状态\n' +
        '  5. 确认 DOVE_TRUST_ON_FIRST_USE 配置正确'
      );
    }
    return await this._encryptedRequest(path, method, body);
  }

  /**
   * 加密通道请求
   */
  async _encryptedRequest(path, method, body) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.cryptoClient.request(method, path, body, {
          timeout: this.timeout
        });

        if (result.error) {
          const error = new Error(result.error);
          error.status = result.status;
          if (result.当前执行数 !== undefined) error.当前执行数 = result.当前执行数;
          if (result.最大并发数 !== undefined) error.最大并发数 = result.最大并发数;
          if (result.提示) error.提示 = result.提示;

          if (error.status === 409 || (error.status >= 400 && error.status < 500 && error.status !== 429)) {
            throw error;
          }
          throw error;
        }

        return result.data !== undefined ? result.data : result;
      } catch (error) {
        lastError = error;

        if (error.status === 409 || (error.status >= 400 && error.status < 500 && error.status !== 429)) {
          throw error;
        }

        if (attempt < this.maxRetries && (
          error.message?.includes('超时') ||
          error.message?.includes('未连接') ||
          error.message?.includes('ECONNREFUSED')
        )) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  /**
   * 获取数据库实例
   * @param {string} dbName - 数据库名
   * @returns {GatewayDatabase}
   */
  db(dbName) {
    if (!this._databases.has(dbName)) {
      this._databases.set(dbName, new GatewayDatabase(this, dbName));
    }
    return this._databases.get(dbName);
  }

  /**
   * 数据库操作代理
   */
  async dbOperation(collection, action, params = {}) {
    const path = `/db/${collection}/${action}`;
    return this._request(path, 'POST', params);
  }

  /**
   * 文件操作代理
   */
  async fileOperation(action, path, data = null) {
    switch (action) {
      case 'read':
        return this._request(`/files/${path}`, 'GET');
      case 'write':
        return this._request(`/files/${path}`, 'PUT', data);
      case 'delete':
        return this._request(`/files/${path}`, 'DELETE');
      case 'list':
        return this._request(`/files/list/${path}`, 'GET');
      default:
        throw new Error(`未知的文件操作: ${action}`);
    }
  }

  /**
   * 管理数据库操作代理（受限）
   * 仅允许访问特定集合
   */
  async adminDbOperation(collection, action, params = {}) {
    const path = `/api/dove/admin/${collection}/${action}`;
    return this._request(path, 'POST', params);
  }

  /**
   * 获取系统配置
   */
  async getSystemConfig() {
    const result = await this._request('/api/dove/config', 'GET');
    return result.success ? result.data : null;
  }

  /**
   * 获取用户 API 密钥配置
   */
  async getUserKeys(userId) {
    const result = await this._request(`/api/dove/user-keys/${userId}`, 'GET');
    return result.success ? result.data : null;
  }

  /**
   * 获取鸽子身份
   */
  async getDoveIdentity(doveId) {
    const result = await this._request(`/api/dove/identity/${doveId}`, 'GET');
    return result.success ? result.data : null;
  }

  /**
   * 更新鸽子身份
   */
  async updateDoveIdentity(doveId, identityData) {
    const result = await this._request(`/api/dove/identity/${doveId}`, 'PUT', identityData);
    return result.success ? result.data : null;
  }

  /**
   * 创建对话任务（直连模式使用）
   * 通过 Server 的 /api/chat API 创建任务，鸽子会自动从队列中拉取执行
   * @param {Object} params
   * @param {string} params.message - 消息内容
   * @param {string|null} params.conversationId - 对话ID
   * @param {string|null} params.profile - 执行配置
   * @param {Object|null} params.constraints - 执行约束
   * @param {string} params.userId - 用户ID
   * @returns {Object} { taskId, conversationId }
   */
  async createChatTask({ message, conversationId, profile, constraints, attachments, userId, channel }) {
    const result = await this._request('/api/chat', 'POST', {
      message,
      conversationId,
      profile,
      constraints,
      attachments: attachments || [],
      channel: channel || 'local',  // 直连默认 local，Server 中转由 CLI 指定
      machineId: process.env.MACHINE_ID || null
    });
    return result.success ? result.data : null;
  }

  /**
   * 原始请求方法（仅加密通道）
   */
  async _rawRequest(method, path, body = null) {
    if (!this.cryptoClient?.connected) {
      throw new Error('加密通道未建立');
    }
    return await this.cryptoClient.request(method, path, body, { timeout: 10000 });
  }

  /**
   * 释放鸽子的残留 executing 任务
   * 用于启动时清理上次未完成的任务，释放并发额度
   * @param {string} reason - 释放原因
   * @returns {Object} { releasedCount, totalStale, message }
   */
  async releaseStaleTasks(reason = '鸽子重启，回收残留任务') {
    try {
      const result = await this._request('/api/dove/release-stale-tasks', 'POST', { reason });
      return result.success ? result.data : null;
    } catch (error) {
            logger.warn(`释放残留任务失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 获取鸽子的MCP配置
   * @param {string} doveId - 鸽子ID
   * @returns {Object} MCP配置 { servers: [...] }
   */
  async getMCPConfig(doveId) {
    try {
      const result = await this._request(`/api/dove/${doveId}/mcp`, 'GET');
      return result.success ? result.data : null;
    } catch (error) {
      // MCP配置获取失败不应阻塞初始化，返回空配置
            logger.warn(`获取MCP配置失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    try {
      const result = await this._request('/health', 'GET');
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取当前认证身份
   */
  async getWhoAmI() {
    if (this._cachedIdentity) return this._cachedIdentity;
    try {
      const result = await this._request('/health/detailed', 'GET');
      if (result?.user?.userId) {
        this._cachedIdentity = result.user;
        return this._cachedIdentity;
      }
      return null;
    } catch (error) {
            logger.warn(`获取身份信息失败: ${error.message}`);
      return null;
    }
  }

  // ==================== CLI↔Dove 协作对话 API ====================

  /**
   * 发送非最终响应给 CLI（如请求文件上传）
   * Dove 工具返回 __RESPOND__ 时，通过此方法通知 Server 将任务状态改为 awaiting_cli
   * @param {string} taskId - 任务ID
   * @param {Object} response - 响应对象，如 { type: 'need_upload', files: [...] }
   */
  async respond(taskId, response) {
    return this._request('/api/dove/respond', 'POST', { taskId, response });
  }

  /**
   * 关闭连接（兼容 MongoClient 接口）
   */
  async close() {
    this._databases.clear();
    return true;
  }

  // ==================== OSS 临时目录 API ====================

  /**
   * 创建任务临时目录
   * @param {string} taskId - 任务ID
   * @param {string} ownerId - 任务所有者ID
   * @param {string} doveId - 鸽子ID（可选）
   */
  async createTempDir(taskId, ownerId, doveId = null) {
    const result = await this._request('/api/temp/tasks', 'POST', { taskId, ownerId, doveId });
    return result.success ? result.data : null;
  }

  /**
   * 获取临时目录 URL
   */
  async getTempDirUrls(taskId, hash, ownerId, timestamp) {
    const params = new URLSearchParams({ hash, ownerId, timestamp });
    const result = await this._request(`/api/temp/tasks/${taskId}/urls?${params}`, 'GET');
    return result.success ? result.data : null;
  }

  /**
   * 复制文件到临时目录
   */
  async copyToTempDir(taskId, source, target, ownerId, hash) {
    const result = await this._request(`/api/temp/tasks/${taskId}/copy`, 'POST', { source, target, ownerId, hash });
    return result.success ? result.data : null;
  }

  /**
   * 上传文件到临时目录
   */
  async uploadToTempDir(taskId, target, content, ownerId, hash, encoding = 'utf-8') {
    const result = await this._request(`/api/temp/tasks/${taskId}/upload`, 'PUT', { target, content, ownerId, hash, encoding });
    return result.success ? result.data : null;
  }

  /**
   * 列出临时目录内容
   */
  async listTempDir(taskId, ownerId, hash, dir = '') {
    const params = new URLSearchParams({ ownerId, hash, dir });
    const result = await this._request(`/api/temp/tasks/${taskId}/list?${params}`, 'GET');
    return result.success ? result.data : null;
  }

  /**
   * 完成任务并清理临时目录
   */
  async finalizeTempDir(taskId, ownerId, hash, syncTo = null) {
    const result = await this._request(`/api/temp/tasks/${taskId}/finalize`, 'POST', { ownerId, hash, syncTo });
    return result.success ? result.data : null;
  }

  /**
   * 删除临时目录
   */
  async deleteTempDir(taskId, ownerId, hash) {
    const params = new URLSearchParams({ ownerId, hash });
    const result = await this._request(`/api/temp/tasks/${taskId}?${params}`, 'DELETE');
    return result.success ? result.data : null;
  }

  // ==================== CLI 能力 API ====================

  /**
   * 查询 CLI 能力注册表
   * 返回 CLI 在线状态、能力列表、在线 CLI 的机器标识列表
   * 同机判断由调用方（Doves 工具）自行完成：比较自己的 machineId 与 cliMachineIds
   * @returns {Object|null} { onlineClients, cliMachineIds, capabilities }
   */
  async getCliCapabilities() {
    try {
      const result = await this._request('/api/cli/capabilities/list', 'GET');
      return result.success ? result.data : null;
    } catch (error) {
            logger.warn(`查询CLI能力失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 请求 CLI 执行操作
   * @param {string} rootTaskId - 根任务ID
   * @param {Object} actionRequest - 操作请求 { capability, params, description }
   * @param {number} timeoutSec - 超时秒数
   * @returns {Object|null} { actionId, 状态 }
   */
  async requestCliAction(rootTaskId, actionRequest, timeoutSec = 0) {
    try {
      const result = await this._request('/api/cli/action/request', 'POST', {
        根任务ID: rootTaskId,
        操作请求: actionRequest,
        超时秒数: timeoutSec,
      });
      return result.success ? result.data : null;
    } catch (error) {
            logger.warn(`请求CLI操作失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 查询 CLI 操作结果
   * @param {string} actionId - 操作ID
   * @returns {Object|null} { actionId, status, result }
   */
  async getCliActionStatus(actionId) {
    try {
      const result = await this._request(`/api/cli/action/status/${actionId}`, 'GET');
      return result.success ? result.data : null;
    } catch (error) {
            logger.warn(`查询CLI操作状态失败: ${error.message}`);
      return null;
    }
  }

  // ==================== Git存储 API ====================

  /**
   * Git存储健康检查
   */
  async getGitStorageStatus() {
    const result = await this._request('/api/git-storage/files?path=.', 'GET');
    return result.success ? { mounted: true } : null;
  }
}

/**
 * 创建鸽子代理实例（工厂函数）
 */
export function 创建鸽子代理(config) {
  return new DovesProxy(config);
}

/**
 * 从现有环境创建代理（需要先建立加密连接）
 */
export function 获取鸽子代理(cryptoClient) {
  return new DovesProxy({
    cryptoClient,
    serverUrl: process.env.SERVER_URL
  });
}

export default {
  DovesProxy,
  创建鸽子代理,
  获取鸽子代理
};
