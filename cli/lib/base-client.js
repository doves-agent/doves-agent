/**
 * 基础 HTTP 客户端
 * 提供配置加载、请求头管理、底层操作方法
 */

import { EventEmitter } from 'events';
import { 
  loadConfig as loadConfigFromModule, 
  saveConfig as saveConfigToModule,
  CONFIG_DIR, 
  CONFIG_FILE,
  secureFile, 
  secureMkdir 
} from './config.js';
import { CryptoClient } from './crypto-client.js';

// ==================== 模块级加密客户端单例（跨命令共享，避免重复Noise握手） ====================
let _sharedCryptoClient = null;

/** 获取共享加密客户端 */
export function getSharedCryptoClient() {
  return _sharedCryptoClient;
}

/**
 * 基础客户端类
 * 提供配置管理和 HTTP 请求基础功能
 */
export class BaseClient extends EventEmitter {
  constructor() {
    super();
    this.config = loadConfigFromModule();
    this.baseUrl = this.config.gateway || process.env.SERVER_URL || 'http://localhost:3003';
    this.token = this.config.token || process.env.DOVE_TOKEN;
    this.cryptoClient = null;  // 加密客户端（可选）
    this._adminAll = false;     // 超管 --all 模式：查看/管理所有用户数据
    this._targetUserId = null;  // 超管 --uid 模式：查看指定用户的数据
  }

  /**
   * 设置超管 --all 模式
   * 超管通过 --all 管理全局数据，默认只管理自己的数据
   * @param {boolean} all - 是否查看所有用户数据
   */
  setAdminAll(all) {
    this._adminAll = !!all;
  }

  /**
   * 检查当前是否为超管
   */
  isAdmin() {
    return this.config.role === 'admin';
  }

  /**
   * 设置超管 --uid 目标用户
   * 超管通过 --uid 查看指定用户的数据
   * @param {string|null} userId - 目标用户ID
   */
  setTargetUserId(userId) {
    this._targetUserId = userId || null;
  }

  /**
   * 连接加密通道（模块级单例，跨命令共享）
   * @returns {Promise<boolean>} 是否成功连接
   */
  async connectEncrypted() {
    // 已共享连接
    if (_sharedCryptoClient?.connected) {
      this.cryptoClient = _sharedCryptoClient;
      return true;
    }
    const url = new URL(this.baseUrl);
    const { 获取或生成机器标识, 生成分组标识 } = await import('./machine-id.js');
    const machineId = 获取或生成机器标识();
    const clientId = 生成分组标识(machineId, 'cli', 0);
    const cryptoClient = new CryptoClient({
      hostname: url.hostname,
      clientId
    });
    await cryptoClient.connect();
    _sharedCryptoClient = cryptoClient;
    this.cryptoClient = cryptoClient;
    return true;
  }

  /**
   * 通过加密通道发送请求（关键操作）
   * @param {string} method - HTTP 方法
   * @param {string} path - 请求路径
   * @param {object} body - 请求体
   * @returns {Promise<object>} 响应数据
   */
  async encryptedRequest(method, path, body = null) {
    if (!this.cryptoClient?.connected) {
      throw new Error('加密通道未连接');
    }
    const result = await this.cryptoClient.request(method, path, body);
    return result;
  }

  // 加载配置（使用统一配置模块）
  loadConfig() {
    return loadConfigFromModule();
  }
  
  // 重新加载配置（强制刷新）
  reloadConfig() {
    this.config = loadConfigFromModule(true);
    this.baseUrl = this.config.gateway || process.env.SERVER_URL || 'http://localhost:3003';
    this.token = this.config.token || process.env.DOVE_TOKEN;
    return this.config;
  }

  /**
   * 临时切换 baseUrl（用于扇出发送）
   * @param {string} url - 新的 baseUrl
   */
  setBaseUrl(url) {
    this._originalBaseUrl = this.baseUrl;
    this.baseUrl = url;
  }

  /**
   * 恢复原始 baseUrl
   */
  resetBaseUrl() {
    if (this._originalBaseUrl) {
      this.baseUrl = this._originalBaseUrl;
      delete this._originalBaseUrl;
    }
  }

  /**
   * 测试网关连通性（通过加密通道）
   * @param {number} timeout - 超时时间(ms)，默认5000
   * @returns {Promise<{success: boolean, pong: boolean, latency: number, service: string}>}
   */
  async ping(timeout = 5000) {
    const start = Date.now();
    try {
      if (!this.cryptoClient?.connected) {
        await this.connectEncrypted();
      }
      const result = await this.cryptoClient.request('GET', '/ping', null);
      const latency = Date.now() - start;
      const data = result?.data || result;
      return { ...data, success: true, pong: true, latency };
    } catch (e) {
      const latency = Date.now() - start;
      return { success: false, pong: false, latency, error: e.message };
    }
  }

  // 获取请求头
  getHeaders() {
    const headers = {
      'Content-Type': 'application/json'
    };
    if (this.token) {
      headers['X-Token'] = this.token;
    }
    // 渠道标识：CLI 本机=local，CLI 异机=remote
    // 判定逻辑：如果 gateway 指向 localhost/127.0.0.1，则为 local
    const isLocal = /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(this.baseUrl);
    headers['X-Channel'] = isLocal ? 'local' : 'remote';
    // 超管 --all 模式：查看/管理所有用户数据
    if (this._adminAll) {
      headers['X-Admin-All'] = 'true';
    }
    // 超管 --uid 模式：查看指定用户的数据
    if (this._targetUserId) {
      headers['X-Target-User'] = this._targetUserId;
    }
    return headers;
  }

  // ==================== 通用 API 请求（优先加密通道） ====================

  /**
   * 通用API请求（仅加密通道，不走明文降级）
   * 加密不可用时直接报错，提供排查指引
   * @param {string} method - HTTP 方法
   * @param {string} path - 请求路径（含query string）
   * @param {object|null} body - 请求体
   * @returns {Promise<object>} 响应数据
   */
  async _apiRequest(method, path, body = null) {
    if (!this.cryptoClient?.connected) {
      await this.connectEncrypted();
    }
    const enrichedBody = body ? { ...body } : {};
    // 注入认证token（Server端提取为Authorization头）
    if (this.token) enrichedBody.apiKey = this.token;
    // 注入渠道标识（Server路由通过 req.body.channel 读取）
    const isLocal = /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(this.baseUrl);
    enrichedBody.channel = isLocal ? 'local' : 'remote';

    const encryptedResult = await this.encryptedRequest(method, path, enrichedBody);
    if (encryptedResult.error) {
      throw new Error(encryptedResult.error);
    }
    // Server加密响应统一格式: { success: true/false, data, error }
    if (!encryptedResult.success) {
      throw new Error(encryptedResult.error || '加密请求失败');
    }
    // encryptedResult.data 是 forwardToExpress 的返回值，格式为 { success, data, error }
    // 需要解包 Express 路由层的信封，使调用方直接拿到业务数据
    const expressResponse = encryptedResult.data;
    if (expressResponse && typeof expressResponse === 'object' && 'success' in expressResponse) {
      if (!expressResponse.success) {
        throw new Error(expressResponse.error || '请求失败');
      }
      return expressResponse.data;
    }
    return expressResponse;
  }

  /**
   * GET 请求
   * @param {string} path - 请求路径（如 /api/capability/list）
   * @param {object} params - URL 查询参数（可选）
   * @returns {Promise<object>} 响应 JSON
   */
  async get(path, params = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, value);
      }
    }
    const queryStr = query.toString();
    const fullPath = `${path}${queryStr ? '?' + queryStr : ''}`;
    return await this._apiRequest('GET', fullPath);
  }

  /**
   * POST 请求
   * @param {string} path - 请求路径（如 /api/capability/refresh）
   * @param {object} body - 请求体（可选）
   * @returns {Promise<object>} 响应 JSON
   */
  async post(path, body = {}) {
    return await this._apiRequest('POST', path, body);
  }

  // 保存配置（使用统一配置模块，合并式写入）
  saveConfig() {
    // 使用合并式保存，避免丢失其他字段
    this.config = saveConfigToModule(this.config);
  }

  // ==================== 底层数据库操作代理 ====================

  /**
   * MongoDB 操作代理（通过加密通道）
   */
  async dbOperation(collection, action, body) {
    return await this._apiRequest('POST', `/db/${collection}/${action}`, body);
  }

  // ==================== 文件操作 ====================

  /**
   * 读取文件（通过加密通道）
   */
  async readFile(filePath) {
    return await this._apiRequest('GET', `/files/${filePath}`);
  }

  /**
   * 写入文件（通过加密通道）
   */
  async writeFile(filePath, content) {
    return await this._apiRequest('PUT', `/files/${filePath}`, { content });
  }

  /**
   * 列出文件（通过加密通道）
   */
  async listFiles(dirPath) {
    return await this._apiRequest('GET', `/files/list/${dirPath}`);
  }

  /**
   * 删除文件（通过加密通道）
   */
  async deleteFile(filePath) {
    return await this._apiRequest('DELETE', `/files/${filePath}`);
  }
}
