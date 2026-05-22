/**
 * @file extensions/_context
 * @description 白鸽扩展接口底座 — DoveAppContext
 * 
 * === 核心原则 ===
 * 扩展只能通过 DoveAppContext (ctx) 与系统交互
 * 禁止直接使用 DovesProxy / getMongoClient / 原始 HTTP
 * ctx 根据权限声明动态生成可用方法，未声明的权限不可用
 * 
 * === 架构 ===
 * 扩展代码 → ctx.method() → _checkPermission() → DovesProxy → Server → 存储
 * 
 * 详见: 白鸽文档/dove_apps/接口底座规范.md
 */

import { ExtensionPermissionError, permissionRegistry } from './_permissions.js';
import { AppDatabase, AppCollection, AppStorageProxy, AppMemoryProxy, AppOSSProxy, AppEventProxy } from './_context-受控代理.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

// ==================== AppLogger ====================

/**
 * 受控日志代理
 * 自动标记扩展名，复用创建日志器
 */
class AppLogger {
  constructor(extensionName) {
    this._logger = 创建日志器(extensionName, { 前缀: `[${extensionName}]`, 级别: 'debug', 显示调用位置: true });
  }

  info(msg) {
    this._logger.info(msg);
  }

  warn(msg) {
    this._logger.warn(msg);
  }

  error(msg, err) {
    this._logger.error(msg, err || '');
  }
}

// ==================== DoveAppContext ====================

/**
 * 白鸽扩展接口底座
 * 扩展与系统交互的唯一入口
 */
export class DoveAppContext {
  /**
   * @param {Object} options
   * @param {string} options.extensionName - 扩展名
   * @param {Object} options.proxy - DovesProxy 实例（不暴露给扩展）
   * @param {Object} options.permissions - 合并后的权限声明（全量，含未授权部分）
   * @param {Object} options.effectivePermissions - 实际生效的权限（授权检查后，可能被裁剪）
   * @param {string} options.authMode - 运行模式: 'official' | 'production' | 'dev'
   * @param {string} options.doveId - 鸽子ID
   * @param {string} options.userId - 用户ID
   * @param {string} options.taskId - 当前任务ID
   */
  constructor({ extensionName, proxy, permissions, effectivePermissions, authMode, doveId, userId, taskId }) {
    this._extensionName = extensionName;
    this._proxy = proxy;           // 不暴露
    this._permissions = permissions;                    // 全量声明（用于权限注册表）
    this._effectivePermissions = effectivePermissions || permissions;  // 生效权限（用于运行时校验）
    this._authMode = authMode || 'dev';
    this._doveId = doveId;
    this._userId = userId;
    this._taskId = taskId || null;

    // 延迟初始化的代理
    this._storageProxy = null;
    this._memoryProxy = null;
    this._ossProxy = null;
    this._eventProxy = null;
    this._logger = new AppLogger(extensionName);
  }

  // ==================== 数据库 ====================

  /**
   * 获取受控数据库实例
   * 使用 effectivePermissions 做运行时校验（开发模式下只有 user_scoped 的库）
   * @param {string} dbName - 数据库名
   * @returns {AppDatabase}
   * @throws {ExtensionPermissionError} 库名未声明或未授权
   */
  db(dbName) {
    const databases = this._effectivePermissions.databases;
    if (!databases || !databases[dbName]) {
      // 区分：未声明 vs 未授权
      const declared = this._permissions.databases?.[dbName];
      if (declared) {
        throw new ExtensionPermissionError(
          this._extensionName,
          `db:${dbName}`,
          'access',
          `数据库 "${dbName}" 已声明但当前未授权（${this._authMode}模式），请先 dove app install 安装授权`
        );
      }
      throw new ExtensionPermissionError(
        this._extensionName,
        `db:${dbName}`,
        'access',
        `未声明数据库 "${dbName}"`
      );
    }
    return new AppDatabase(this, dbName);
  }

  // ==================== 存储 ====================

  /**
   * Git存储代理（使用 effectivePermissions 校验）
   */
  get storage() {
    const storage = this._effectivePermissions.storage;
    if (!storage || !storage['git-storage']) {
      const declared = this._permissions.storage?.['git-storage'];
      if (declared) {
        throw new ExtensionPermissionError(this._extensionName, 'storage.git-storage', 'access', `已声明但当前未授权（${this._authMode}模式），请先安装授权`);
      }
      throw new ExtensionPermissionError(this._extensionName, 'storage.git-storage', 'access', '未声明 storage.git-storage 权限');
    }
    if (!this._storageProxy) {
      this._storageProxy = new AppStorageProxy(this);
    }
    return this._storageProxy;
  }

  /**
   * Git记忆代理（使用 effectivePermissions 校验）
   */
  get memory() {
    const storage = this._effectivePermissions.storage;
    if (!storage || !storage.memory) {
      const declared = this._permissions.storage?.memory;
      if (declared) {
        throw new ExtensionPermissionError(this._extensionName, 'storage.memory', 'access', `已声明但当前未授权（${this._authMode}模式），请先安装授权`);
      }
      throw new ExtensionPermissionError(this._extensionName, 'storage.memory', 'access', '未声明 storage.memory 权限');
    }
    if (!this._memoryProxy) {
      this._memoryProxy = new AppMemoryProxy(this);
    }
    return this._memoryProxy;
  }

  /**
   * OSS 代理（使用 effectivePermissions 校验）
   */
  get oss() {
    const storage = this._effectivePermissions.storage;
    if (!storage || !storage.oss) {
      const declared = this._permissions.storage?.oss;
      if (declared) {
        throw new ExtensionPermissionError(this._extensionName, 'storage.oss', 'access', `已声明但当前未授权（${this._authMode}模式），请先安装授权`);
      }
      throw new ExtensionPermissionError(this._extensionName, 'storage.oss', 'access', '未声明 storage.oss 权限');
    }
    if (!this._ossProxy) {
      this._ossProxy = new AppOSSProxy(this);
    }
    return this._ossProxy;
  }

  // ==================== 上下文信息（只读）====================

  /**
   * 当前任务信息
   */
  get task() {
    return {
      id: this._taskId,
      userId: this._userId,
      doveId: this._doveId,
    };
  }

  /**
   * 当前用户信息
   */
  get user() {
    return {
      id: this._userId,
    };
  }

  /**
   * 配置访问（使用 effectivePermissions 校验）
   */
  get config() {
    this._checkApiPermission('dove:config', 'read');
    return {
      get: async (key) => {
        const sysConfig = await this._proxy.getSystemConfig();
        return key ? sysConfig?.[key] : sysConfig;
      },
      getAll: async () => {
        return this._proxy.getSystemConfig();
      },
    };
  }

  // ==================== 事件 ====================

  /**
   * 事件代理（使用 effectivePermissions 校验）
   */
  get event() {
    if (!this._effectivePermissions.events) {
      const declared = this._permissions.events;
      if (declared) {
        throw new ExtensionPermissionError(this._extensionName, 'event', 'access', `已声明但当前未授权（${this._authMode}模式），请先安装授权`);
      }
      throw new ExtensionPermissionError(this._extensionName, 'event', 'access', '未声明 events 权限');
    }
    if (!this._eventProxy) {
      this._eventProxy = new AppEventProxy(this);
    }
    return this._eventProxy;
  }

  // ==================== 日志 ====================

  /**
   * 日志代理（无需权限声明）
   * @returns {AppLogger}
   */
  get logger() {
    return this._logger;
  }

  // ==================== 通用 API 调用 ====================

  /**
   * 通用服务端 API 调用（受 permissions.apis 约束）
   * @param {string} path - API 路径
   * @param {Object} options - 请求选项
   * @returns {Promise<Object>}
   */
  async fetch(path, options = {}) {
    // 从 path 提取 API 模式进行权限检查
    // 如 /api/dove/config → dove:config
    const apiPattern = this._extractApiPattern(path);
    const action = options.method === 'POST' || options.method === 'PUT' ? 'write' : 'read';
    this._checkApiPermission(apiPattern, action);

    return this._proxy.fetch(path, options);
  }

  // ==================== 应用发现与任务委派（已禁用）====================
  // discover() 和 delegate() 已禁用。
  // 应用间不再通过框架动态发现与委派，应用开发者自行处理工具生态链。
  // 如需跨应用协作，应用开发者应在自己的代码中实现。

  // ==================== 运行模式 ====================

  /**
   * 当前运行模式（只读）
   * - 'official': 官方扩展，免授权
   * - 'production': 已审核+已授权+权限一致
   * - 'dev': 未注册/权限不一致/未授权，仅 user_scoped
   */
  get authMode() {
    return this._authMode;
  }

  /**
   * 当前扩展名（只读）
   */
  get extensionName() {
    return this._extensionName;
  }

  // ==================== 内部方法 ====================

  /**
   * 数据库权限检查
   * @returns {Object} 权限信息 { scope, userField }
   * @throws {ExtensionPermissionError}
   */
  _checkDbPermission(dbName, collectionName, action) {
    const result = permissionRegistry.isDbAllowed(this._extensionName, dbName, collectionName, action);
    if (!result.allowed) {
      throw new ExtensionPermissionError(
        this._extensionName,
        `${dbName}.${collectionName}`,
        action,
        result.reason
      );
    }
    return result;
  }

  /**
   * API 权限检查
   * @throws {ExtensionPermissionError}
   */
  _checkApiPermission(apiPattern, action) {
    const result = permissionRegistry.isApiAllowed(this._extensionName, apiPattern, action);
    if (!result.allowed) {
      throw new ExtensionPermissionError(
        this._extensionName,
        `api:${apiPattern}`,
        action,
        result.reason
      );
    }
  }

  /**
   * 从 API 路径提取权限模式
   * /api/dove/config → dove:config
   * /api/dove/identity/dove_001 → dove:identity
   * /db/tasks/find → db:tasks
   * /api/ext/vocabulary/version → ext:vocabulary
   */
  _extractApiPattern(path) {
    // 去掉查询参数
    const cleanPath = path.split('?')[0];

    // /api/dove/xxx → dove:xxx
    const doveMatch = cleanPath.match(/^\/api\/dove\/([^/]+)/);
    if (doveMatch) return `dove:${doveMatch[1]}`;

    // /api/ext/xxx → ext:xxx
    const extMatch = cleanPath.match(/^\/api\/ext\/([^/]+)/);
    if (extMatch) return `ext:${extMatch[1]}`;

    // /db/xxx → db:xxx
    const dbMatch = cleanPath.match(/^\/db\/([^/]+)/);
    if (dbMatch) return `db:${dbMatch[1]}`;

    // /api/xxx → api:xxx
    const apiMatch = cleanPath.match(/^\/api\/([^/]+)/);
    if (apiMatch) return `api:${apiMatch[1]}`;

    // 其他
    return cleanPath;
  }

  /**
   * 更新运行时上下文（任务切换时调用）
   * @param {Object} updates
   */
  updateRuntimeContext({ userId, taskId } = {}) {
    if (userId !== undefined) this._userId = userId;
    if (taskId !== undefined) this._taskId = taskId;
  }
}

export default DoveAppContext;
