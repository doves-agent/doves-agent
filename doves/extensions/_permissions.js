/**
 * @file extensions/_permissions
 * @description 白鸽扩展权限声明验证器
 * 
 * === 职责 ===
 * 1. 验证 manifest.permissions 格式合法性
 * 2. 合并计算最终权限集合
 * 3. 提供 isAllowed(extensionName, resource, action) 查询方法
 * 4. 权限注册到服务端（扩展 DB 权限注册 + 未来其他资源注册）
 * 
 * === 权限范围(scope) ===
 * - 'shared':       全局共享，不注入用户ID过滤
 * - 'user_scoped':  按用户过滤，注入 userField 字段
 * - 'task_scoped':  按任务过滤，注入 taskId / rootTaskId
 * - 'extension':    扩展私有，注入 extensionName
 * 
 * 详见: 白鸽文档/dove_apps/接口底座规范.md
 */

// ==================== 常量 ====================

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

/** API 权限值白名单（简单格式；对象格式另见 validateApis） */
const VALID_API_PERMISSIONS = ['read', 'write', ['read', 'write']];

/** 外部 URL 访问类型白名单 */
const VALID_EXTERNAL_URL_TYPES = ['connect', 'fetch', 'iframe'];

// ==================== ExtensionPermissionError ====================

/**
 * 扩展权限错误
 * 当扩展尝试访问未声明的资源时抛出
 */
export class ExtensionPermissionError extends Error {
  constructor(extensionName, resource, action, reason) {
    super(`[权限拒绝] 扩展 "${extensionName}" 无权对 "${resource}" 执行 "${action}": ${reason}`);
    this.name = 'ExtensionPermissionError';
    this.extensionName = extensionName;
    this.resource = resource;
    this.action = action;
    this.reason = reason;
  }
}

// ==================== PermissionValidator ====================

/**
 * 权限声明验证器
 * 验证 manifest.permissions 格式
 */
export class PermissionValidator {

  /**
   * 验证完整的 permissions 声明
   * @param {Object} permissions - manifest.permissions
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate(permissions) {
    const errors = [];

    if (!permissions || typeof permissions !== 'object') {
      return { valid: false, errors: ['permissions 必须是一个对象'] };
    }

    // 验证 databases
    if (permissions.databases) {
      const dbErrors = this.validateDatabases(permissions.databases);
      errors.push(...dbErrors);
    }

    // 验证 storage
    if (permissions.storage) {
      const storageErrors = this.validateStorage(permissions.storage);
      errors.push(...storageErrors);
    }

    // 验证 apis
    if (permissions.apis) {
      const apiErrors = this.validateApis(permissions.apis);
      errors.push(...apiErrors);
    }

    // 验证 events
    if (permissions.events) {
      const eventErrors = this.validateEvents(permissions.events);
      errors.push(...eventErrors);
    }

    // 验证 extensions
    if (permissions.extensions) {
      const extErrors = this.validateExtensions(permissions.extensions);
      errors.push(...extErrors);
    }

    // 验证 externalUrls
    if (permissions.externalUrls) {
      const urlErrors = this.validateExternalUrls(permissions.externalUrls);
      errors.push(...urlErrors);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 验证数据库权限声明
   * @param {Object} databases - permissions.databases
   * @returns {string[]}
   */
  validateDatabases(databases) {
    const errors = [];

    if (!databases || typeof databases !== 'object') {
      return ['databases 必须是一个对象'];
    }

    for (const [dbName, dbConfig] of Object.entries(databases)) {
      if (typeof dbName !== 'string' || dbName.length === 0) {
        errors.push(`数据库名无效: ${dbName}`);
        continue;
      }
      if (!dbConfig.collections || typeof dbConfig.collections !== 'object') {
        errors.push(`${dbName}: 缺少 collections 声明`);
        continue;
      }

      for (const [collName, collConfig] of Object.entries(dbConfig.collections)) {
        if (typeof collName !== 'string' || collName.length === 0) {
          errors.push(`${dbName}: 集合名无效`);
          continue;
        }

        // 检查 actions
        if (!collConfig.actions || !Array.isArray(collConfig.actions) || collConfig.actions.length === 0) {
          errors.push(`${dbName}.${collName}: 缺少 actions 声明`);
        } else {
          for (const action of collConfig.actions) {
            if (!VALID_DB_ACTIONS.includes(action)) {
              errors.push(`${dbName}.${collName}: 无效的操作 "${action}"，允许: ${VALID_DB_ACTIONS.join(', ')}`);
            }
          }
        }

        // 检查 scope
        const scope = collConfig.scope;
        if (!scope || !VALID_SCOPES.includes(scope)) {
          errors.push(`${dbName}.${collName}: 无效的 scope "${scope}"，允许: ${VALID_SCOPES.join(', ')}`);
        }

        // user_scoped 必须声明 userField
        if ((scope === 'user_scoped') && !collConfig.userField) {
          errors.push(`${dbName}.${collName}: user_scoped scope 必须声明 userField`);
        }
      }
    }

    return errors;
  }

  /**
   * 验证存储权限声明
   * @param {Object} storage - permissions.storage
   * @returns {string[]}
   */
  validateStorage(storage) {
    const errors = [];

    if (!storage || typeof storage !== 'object') {
      return ['storage 必须是一个对象'];
    }

    for (const [storageType, typeConfig] of Object.entries(storage)) {
      if (!VALID_STORAGE_ACTIONS[storageType]) {
        errors.push(`未知的存储类型: ${storageType}，允许: ${Object.keys(VALID_STORAGE_ACTIONS).join(', ')}`);
        continue;
      }

      if (!typeConfig.actions || !Array.isArray(typeConfig.actions) || typeConfig.actions.length === 0) {
        errors.push(`storage.${storageType}: 缺少 actions 声明`);
      } else {
        for (const action of typeConfig.actions) {
          if (!VALID_STORAGE_ACTIONS[storageType].includes(action)) {
            errors.push(`storage.${storageType}: 无效的操作 "${action}"`);
          }
        }
      }

      // scope 检查
      const scope = typeConfig.scope;
      if (scope && !VALID_SCOPES.includes(scope)) {
        errors.push(`storage.${storageType}: 无效的 scope "${scope}"`);
      }
    }

    return errors;
  }

  /**
   * 验证 API 权限声明
   * 支持两种格式：
   *   简单: 'read' | 'write' | ['read', 'write']
   *   对象: { actions: string[], scope?: string, description?: string }
   * @param {Object} apis - permissions.apis
   * @returns {string[]}
   */
  validateApis(apis) {
    const errors = [];

    if (!apis || typeof apis !== 'object') {
      return ['apis 必须是一个对象'];
    }

    for (const [apiPattern, permission] of Object.entries(apis)) {
      if (typeof apiPattern !== 'string' || apiPattern.length === 0) {
        errors.push(`API 权限键名无效: ${apiPattern}`);
        continue;
      }

      // 简单格式: 'read' / 'write' / ['read', 'write']
      const isSimple = typeof permission === 'string' && ['read', 'write'].includes(permission)
        || Array.isArray(permission) && permission.every(p => ['read', 'write'].includes(p));

      if (isSimple) continue;

      // 对象格式: { actions: [...], scope?: '...', description?: '...' }
      if (permission && typeof permission === 'object' && !Array.isArray(permission)) {
        if (!permission.actions || !Array.isArray(permission.actions) || permission.actions.length === 0) {
          errors.push(`apis.${apiPattern}: 对象格式必须包含非空 actions 数组`);
        } else if (!permission.actions.every(a => typeof a === 'string' && a.length > 0)) {
          errors.push(`apis.${apiPattern}: actions 中每个元素必须是非空字符串`);
        }

        if (permission.scope !== undefined && !VALID_SCOPES.includes(permission.scope)) {
          errors.push(`apis.${apiPattern}: 无效的 scope "${permission.scope}"，允许: ${VALID_SCOPES.join(', ')}`);
        }

        if (permission.description !== undefined && typeof permission.description !== 'string') {
          errors.push(`apis.${apiPattern}: description 必须是字符串`);
        }
        continue;
      }

      errors.push(`apis.${apiPattern}: 无效的权限值 "${JSON.stringify(permission)}"，允许: 'read' / 'write' / ['read', 'write'] 或 { actions: [...], scope?, description? }`);
    }

    return errors;
  }

  /**
   * 验证事件权限声明
   * @param {Object} events - permissions.events
   * @returns {string[]}
   */
  validateEvents(events) {
    const errors = [];

    if (!events || typeof events !== 'object') {
      return ['events 必须是一个对象'];
    }

    if (events.subscribe !== undefined) {
      if (!Array.isArray(events.subscribe)) {
        errors.push('events.subscribe 必须是数组');
      }
    }

    if (events.publish !== undefined) {
      if (!Array.isArray(events.publish)) {
        errors.push('events.publish 必须是数组');
      }
    }

    return errors;
  }

  /**
   * 验证扩展间通信权限声明
   * @param {Object} extensions - permissions.extensions
   * @returns {string[]}
   */
  validateExtensions(extensions) {
    const errors = [];

    if (!extensions || typeof extensions !== 'object') {
      return ['extensions 必须是一个对象'];
    }

    for (const [extName, permission] of Object.entries(extensions)) {
      if (!['call', 'read', 'write'].includes(permission)) {
        errors.push(`extensions.${extName}: 无效的权限 "${permission}"，允许: call / read / write`);
      }
    }

    return errors;
  }

  /**
   * 验证外部链接权限声明
   * @param {Array} externalUrls - permissions.externalUrls
   * @returns {string[]}
   */
  validateExternalUrls(externalUrls) {
    const errors = [];

    if (!Array.isArray(externalUrls)) {
      return ['externalUrls 必须是数组'];
    }

    for (let i = 0; i < externalUrls.length; i++) {
      const entry = externalUrls[i];

      if (!entry || typeof entry !== 'object') {
        errors.push(`externalUrls[${i}]: 必须是对象`);
        continue;
      }

      // url 必填，必须是合法 URL 格式
      if (!entry.url || typeof entry.url !== 'string') {
        errors.push(`externalUrls[${i}]: 缺少 url 字段或类型无效`);
      } else {
        // 基本 URL 格式校验：必须包含协议
        if (!/^[a-z]+:\/\/.+/i.test(entry.url) && !entry.url.includes('*')) {
          errors.push(`externalUrls[${i}]: url 格式无效 "${entry.url}"，需包含协议（如 wss://、https://）`);
        }
      }

      // type 必填，必须在白名单中
      if (!entry.type || !VALID_EXTERNAL_URL_TYPES.includes(entry.type)) {
        errors.push(`externalUrls[${i}]: 无效的 type "${entry.type}"，允许: ${VALID_EXTERNAL_URL_TYPES.join(', ')}`);
      }

      // description 可选，但如果存在必须是字符串
      if (entry.description !== undefined && typeof entry.description !== 'string') {
        errors.push(`externalUrls[${i}]: description 必须是字符串`);
      }
    }

    return errors;
  }

  /**
   * 验证开发者凭证声明
   * @param {Object} developer - manifest.developer
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validateDeveloper(developer) {
    const errors = [];

    if (!developer || typeof developer !== 'object') {
      return { valid: false, errors: ['developer 必须是一个对象'] };
    }

    // id 必须是 dev_ 前缀字符串
    if (!developer.id || typeof developer.id !== 'string') {
      errors.push('developer.id 必填，且为字符串');
    } else if (!developer.id.startsWith('dev_')) {
      errors.push(`developer.id 格式无效: "${developer.id}"，应以 dev_ 开头`);
    }

    // signature 可选，但如果存在必须符合格式
    if (developer.signature !== undefined) {
      if (typeof developer.signature !== 'string') {
        errors.push('developer.signature 必须是字符串');
      } else if (!developer.signature.match(/^hmac-sha256:[a-f0-9]+$/)) {
        errors.push(`developer.signature 格式无效，应为 hmac-sha256:<hex>`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

}

// ==================== PermissionRegistry（从子模块导入）====================
import { PermissionRegistry } from './_permissions-注册表.js';

// ==================== 全局单例 ====================

export const permissionValidator = new PermissionValidator();
export const permissionRegistry = new PermissionRegistry();

// ==================== 权限摘要（从子模块 re-export）====================
export { generatePermissionSummary, URL_TYPE_LABELS, DB_ACTION_LABELS, SCOPE_LABELS } from './_permissions-摘要.js';

export default permissionRegistry;
