/**
 * @file extensions/_permissions-注册表
 * @description 运行时权限注册表 PermissionRegistry
 * 从 _permissions.js 拆分
 *
 * 注意：此类不直接 import PermissionValidator，
 * 而是在 register() 中接受外部传入的 validator 实例，
 * 避免 _permissions.js ↔ _permissions-注册表.js 循环依赖。
 */

/** 支持的权限范围 */
const VALID_SCOPES = ['shared', 'user_scoped', 'task_scoped', 'extension'];

/** 数据库操作白名单 */
const VALID_DB_ACTIONS = [
  'find', 'findOne', 'aggregate', 'insertOne', 'insertMany',
  'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'countDocuments',
  'findOneAndUpdate', 'findOneAndDelete', 'index',
];

/** 存储操作白名单 */
const VALID_STORAGE_ACTIONS = {
  oss: ['read', 'write', 'delete', 'list', 'signUrl'],
  'git-storage': ['read', 'write', 'cloneSnapshot', 'status'],
  memory: ['search', 'write', 'delete'],
};

/** API 权限值白名单 */
const VALID_API_PERMISSIONS = ['read', 'write', ['read', 'write']];

/** 外部 URL 访问类型白名单 */
const VALID_EXTERNAL_URL_TYPES = ['connect', 'fetch', 'iframe'];

/**
 * 运行时权限注册表
 * 存储已加载扩展的权限声明，提供运行时查询
 */
export class PermissionRegistry {
  constructor() {
    this._entries = new Map();
  }

  /**
   * 注册扩展的权限声明
   * @param {string} extensionName - 扩展名
   * @param {Object} permissions - 合并后的 permissions 对象
   * @returns {{ success: boolean, message: string }}
   */
  register(extensionName, permissions) {
    // 内联基础验证（避免循环依赖，完整验证由 PermissionValidator 提供）
    if (!permissions || typeof permissions !== 'object') {
      return { success: false, message: 'permissions 必须是一个对象' };
    }

    this._entries.set(extensionName, {
      permissions,
      registeredAt: new Date(),
    });

    return { success: true, message: `扩展 ${extensionName} 权限注册成功` };
  }

  /**
   * 注销扩展的权限
   */
  unregister(extensionName) {
    this._entries.delete(extensionName);
  }

  /**
   * 检查扩展是否有指定数据库操作的权限
   */
  isDbAllowed(extensionName, dbName, collectionName, action) {
    const entry = this._entries.get(extensionName);
    if (!entry) {
      return { allowed: false, reason: `扩展 "${extensionName}" 未注册权限` };
    }

    const databases = entry.permissions.databases;
    if (!databases || !databases[dbName]) {
      return { allowed: false, reason: `扩展 "${extensionName}" 未声明数据库 "${dbName}"` };
    }

    const dbConfig = databases[dbName];
    if (!dbConfig.collections || !dbConfig.collections[collectionName]) {
      return { allowed: false, reason: `扩展 "${extensionName}" 未声明集合 "${dbName}.${collectionName}"` };
    }

    const collConfig = dbConfig.collections[collectionName];
    if (!collConfig.actions || !collConfig.actions.includes(action)) {
      return {
        allowed: false,
        reason: `扩展 "${extensionName}" 对 "${dbName}.${collectionName}" 不允许执行 "${action}"，已声明: ${collConfig.actions?.join(', ') || '无'}`,
      };
    }

    return {
      allowed: true,
      scope: collConfig.scope || 'shared',
      userField: collConfig.userField || null,
    };
  }

  /**
   * 检查扩展是否有指定存储操作的权限
   */
  isStorageAllowed(extensionName, storageType, action) {
    const entry = this._entries.get(extensionName);
    if (!entry) {
      return { allowed: false, reason: `扩展 "${extensionName}" 未注册权限` };
    }

    const storage = entry.permissions.storage;
    if (!storage || !storage[storageType]) {
      return { allowed: false, reason: `扩展 "${extensionName}" 未声明存储 "${storageType}"` };
    }

    const typeConfig = storage[storageType];
    if (!typeConfig.actions || !typeConfig.actions.includes(action)) {
      return {
        allowed: false,
        reason: `扩展 "${extensionName}" 对存储 "${storageType}" 不允许执行 "${action}"`,
      };
    }

    return {
      allowed: true,
      scope: typeConfig.scope || 'user_scoped',
    };
  }

  /**
   * 检查扩展是否有指定 API 的访问权限
   */
  isApiAllowed(extensionName, apiPattern, action = 'read') {
    const entry = this._entries.get(extensionName);
    if (!entry) {
      return { allowed: false, reason: `扩展 "${extensionName}" 未注册权限` };
    }

    const apis = entry.permissions.apis;
    if (!apis) {
      return { allowed: false, reason: `扩展 "${extensionName}" 未声明任何 API 权限` };
    }

    const permission = apis[apiPattern];
    if (permission === undefined) {
      for (const [pattern, perm] of Object.entries(apis)) {
        if (pattern.endsWith(':*') && apiPattern.startsWith(pattern.slice(0, -1))) {
          return this._checkApiAction(extensionName, apiPattern, perm, action);
        }
      }
      return { allowed: false, reason: `扩展 "${extensionName}" 未声明 API "${apiPattern}"` };
    }

    return this._checkApiAction(extensionName, apiPattern, permission, action);
  }

  _checkApiAction(extensionName, apiPattern, permission, action) {
    let actions;
    if (permission && typeof permission === 'object' && !Array.isArray(permission)) {
      actions = permission.actions || [];
    } else {
      actions = Array.isArray(permission) ? permission : [permission];
    }
    if (!actions.includes(action)) {
      return {
        allowed: false,
        reason: `扩展 "${extensionName}" 对 API "${apiPattern}" 不允许 "${action}" 操作`,
      };
    }
    return { allowed: true };
  }

  /**
   * 检查扩展是否有指定事件的权限
   */
  isEventAllowed(extensionName, eventType, pattern) {
    const entry = this._entries.get(extensionName);
    if (!entry) {
      return { allowed: false, reason: `扩展 "${extensionName}" 未注册权限` };
    }

    const events = entry.permissions.events;
    if (!events || !events[eventType]) {
      return { allowed: false, reason: `扩展 "${extensionName}" 未声明事件 ${eventType} 权限` };
    }

    const declared = events[eventType];
    for (const declaredPattern of declared) {
      if (this._matchEventPattern(declaredPattern, pattern)) {
        return { allowed: true };
      }
    }

    return {
      allowed: false,
      reason: `扩展 "${extensionName}" 未声明事件 ${eventType} "${pattern}"，已声明: ${declared.join(', ')}`,
    };
  }

  /**
   * 检查扩展间通信权限
   */
  isExtensionAllowed(extensionName, targetExtension, action = 'call') {
    const entry = this._entries.get(extensionName);
    if (!entry) {
      return { allowed: false, reason: `扩展 "${extensionName}" 未注册权限` };
    }

    const extensions = entry.permissions.extensions;
    if (!extensions || !extensions[targetExtension]) {
      return { allowed: false, reason: `扩展 "${extensionName}" 未声明扩展 "${targetExtension}" 的访问权限` };
    }

    const perm = extensions[targetExtension];
    if (perm !== action && perm !== 'call') {
      return { allowed: false, reason: `扩展 "${extensionName}" 对扩展 "${targetExtension}" 不允许 "${action}"` };
    }

    return { allowed: true };
  }

  /**
   * 检查扩展是否有指定外部 URL 的访问权限
   */
  isExternalUrlAllowed(extensionName, url, type) {
    const entry = this._entries.get(extensionName);
    if (!entry) {
      return { allowed: false, reason: `扩展 "${extensionName}" 未注册权限` };
    }

    const externalUrls = entry.permissions.externalUrls;
    if (!externalUrls || !Array.isArray(externalUrls) || externalUrls.length === 0) {
      return { allowed: false, reason: `扩展 "${extensionName}" 未声明任何外部链接权限` };
    }

    for (const declared of externalUrls) {
      if (type && declared.type !== type) continue;
      if (this._matchUrlPattern(declared.url, url)) {
        return { allowed: true, matchedUrl: declared.url };
      }
    }

    return {
      allowed: false,
      reason: `扩展 "${extensionName}" 未声明外部链接 "${url}" (type: ${type || 'any'})`,
    };
  }

  getPermissions(extensionName) {
    const entry = this._entries.get(extensionName);
    return entry ? entry.permissions : null;
  }

  getStats() {
    return {
      totalExtensions: this._entries.size,
      extensions: Array.from(this._entries.keys()),
    };
  }

  _matchEventPattern(declared, actual) {
    if (declared === actual) return true;
    if (declared === '*') return true;
    if (declared.endsWith('.*')) {
      const prefix = declared.slice(0, -2);
      return actual.startsWith(prefix + '.') || actual === prefix;
    }
    return false;
  }

  _matchUrlPattern(declared, actual) {
    if (declared === actual) return true;
    if (declared === '*') return true;
    if (!declared.includes('*')) return false;

    const declaredProto = declared.split('://')[0];
    const actualProto = actual.split('://')[0];
    if (declaredProto !== actualProto) return false;

    const regexStr = declared
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*');
    try {
      return new RegExp('^' + regexStr + '$').test(actual);
    } catch (e) {
      return false;
    }
  }
}
