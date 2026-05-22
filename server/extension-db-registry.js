/**
 * @file server/extension-db-registry
 * @description 扩展数据库权限注册表
 * 
 * === 设计理念 ===
 * 替代硬编码的 ALLOWED_COLLECTIONS，实现"扩展声明 → 服务端注册 → 动态鉴权"
 * 
 * === 权限策略 ===
 * - 'shared':       全局共享，不注入用户ID过滤（如 技能/能力/words/colortemplates）
 * - 'user_scoped':  按用户过滤，注入 userField 字段（如 learningrecords.user_id）
 * - 'task_scoped':  按任务过滤，仅允许访问任务关联数据
 * 
 * === 生命周期 ===
 * 1. 鸽子启动 → ExtensionLoader 读取扩展 manifest.databases
 * 2. ExtensionLoader → POST /api/dove/extension/db-register
 * 3. 服务端 registry.register(doveId, extensionName, databases)
 * 4. 鸽子 DB 请求 → db.js 查 registry.isAllowed() → 动态鉴权
 * 5. 鸽子卸载扩展 → POST /api/dove/extension/db-unregister → registry.unregister()
 */

import { logger } from './core.js';

/** 支持的权限策略 */
const POLICIES = {
  shared: 'shared',
  user_scoped: 'user_scoped',
  task_scoped: 'task_scoped',
};

class ExtensionDBRegistry {
  constructor() {
    /**
     * doveId → {
     *   extensions: Map<extensionName, ExtensionDBConfig>
     * }
     */
    this._registrations = new Map();
  }

  /**
   * 验证扩展声明的数据库配置格式
   * @param {Object} databases - manifest.databases 声明
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate(databases) {
    const errors = [];
    
    if (!databases || typeof databases !== 'object') {
      return { valid: false, errors: ['databases 必须是一个对象'] };
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

      const VALID_ACTIONS = ['find', 'findOne', 'aggregate', 'insertOne', 'insertMany',
        'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'countDocuments',
        'findOneAndUpdate', 'findOneAndDelete', 'index'];

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
            if (!VALID_ACTIONS.includes(action)) {
              errors.push(`${dbName}.${collName}: 无效的操作 "${action}"，允许: ${VALID_ACTIONS.join(', ')}`);
            }
          }
        }

        // Doves 端 manifest 使用 scope 字段声明权限策略
        const scope = collConfig.scope;
        if (!scope || !POLICIES[scope]) {
          errors.push(`${dbName}.${collName}: 无效的 scope "${scope}"，允许: ${Object.keys(POLICIES).join(', ')}`);
        }

        // user_scoped 必须声明 userField
        if (scope === 'user_scoped' && !collConfig.userField) {
          errors.push(`${dbName}.${collName}: user_scoped 策略必须声明 userField`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 注册扩展的数据库权限
   * @param {string} doveId - 鸽子ID
   * @param {string} extensionName - 扩展包名
   * @param {Object} databases - 数据库声明
   * @returns {{ success: boolean, message: string }}
   */
  register(doveId, extensionName, databases) {
    const validation = this.validate(databases);
    if (!validation.valid) {
      return { success: false, message: `验证失败: ${validation.errors.join('; ')}` };
    }

    if (!this._registrations.has(doveId)) {
      this._registrations.set(doveId, { extensions: new Map() });
    }

    const doveEntry = this._registrations.get(doveId);
    
    // 如果已注册同名扩展，先清理旧的
    if (doveEntry.extensions.has(extensionName)) {
      logger.info(`[扩展DB注册] 鸽子 ${doveId} 更新扩展 ${extensionName} 的数据库权限`);
    }
    
    doveEntry.extensions.set(extensionName, {
      databases,
      registeredAt: new Date(),
    });

    // 统计
    let totalCollections = 0;
    for (const dbConfig of Object.values(databases)) {
      totalCollections += Object.keys(dbConfig.collections).length;
    }

    logger.info(`[扩展DB注册] 鸽子 ${doveId} 注册扩展 ${extensionName}: ${Object.keys(databases).length} 个数据库, ${totalCollections} 个集合`);
    return { success: true, message: `已注册 ${totalCollections} 个集合` };
  }

  /**
   * 注销扩展的数据库权限
   * @param {string} doveId - 鸽子ID
   * @param {string} extensionName - 扩展包名
   */
  unregister(doveId, extensionName) {
    const doveEntry = this._registrations.get(doveId);
    if (!doveEntry) return;

    doveEntry.extensions.delete(extensionName);
    logger.info(`[扩展DB注册] 鸽子 ${doveId} 注销扩展 ${extensionName} 的数据库权限`);

    // 清理空条目
    if (doveEntry.extensions.size === 0) {
      this._registrations.delete(doveId);
    }
  }

  /**
   * 清理鸽子的所有注册（鸽子下线时调用）
   * @param {string} doveId
   */
  unregisterAll(doveId) {
    const doveEntry = this._registrations.get(doveId);
    if (doveEntry) {
      logger.info(`[扩展DB注册] 清理鸽子 ${doveId} 的所有扩展权限（${doveEntry.extensions.size} 个）`);
      this._registrations.delete(doveId);
    }
  }

  /**
   * 检查操作是否被允许
   * @param {string} doveId - 鸽子ID（null 表示用户请求，走 ALLOWED_COLLECTIONS 回退）
   * @param {string} collection - 集合名
   * @param {string} action - 操作类型
   * @returns {{ allowed: boolean, reason?: string, policy?: string, userField?: string }}
   */
  isAllowed(doveId, collection, action) {
    // 非鸽子请求（普通用户），不在扩展注册表检查，由 ALLOWED_COLLECTIONS 处理
    if (!doveId) {
      return { allowed: false, reason: '非鸽子请求，走 ALLOWED_COLLECTIONS 通用权限检查' };
    }

    const doveEntry = this._registrations.get(doveId);
    if (!doveEntry) {
      return { allowed: false, reason: `鸽子 ${doveId} 未注册任何扩展数据库权限` };
    }

    for (const [, ext] of doveEntry.extensions) {
      for (const dbConfig of Object.values(ext.databases)) {
        if (dbConfig.collections && collection in dbConfig.collections) {
          const collConfig = dbConfig.collections[collection];
          if (collConfig.actions && collConfig.actions.includes(action)) {
            return {
              allowed: true,
              policy: collConfig.scope || 'shared',
              userField: collConfig.userField || null,
            };
          }
          return {
            allowed: false,
            reason: `集合 "${collection}" 不允许执行 "${action}" 操作，已声明: ${collConfig.actions?.join(', ')}`,
          };
        }
      }
    }

    return { allowed: false, reason: `鸽子 ${doveId} 未注册对集合 "${collection}" 的访问权限` };
  }

  /**
   * 获取鸽子已注册的所有集合（用于调试和监控）
   * @param {string} doveId
   * @returns {Object} { extensionName: { databases: {...} } }
   */
  getDoveRegistrations(doveId) {
    const doveEntry = this._registrations.get(doveId);
    if (!doveEntry) return {};

    const result = {};
    for (const [extName, ext] of doveEntry.extensions) {
      result[extName] = { databases: ext.databases, registeredAt: ext.registeredAt };
    }
    return result;
  }

  /**
   * 获取所有注册统计（用于管理监控）
   * @returns {{ totalDoves: number, totalExtensions: number, registrations: Object }}
   */
  getStats() {
    let totalExtensions = 0;
    for (const [, doveEntry] of this._registrations) {
      totalExtensions += doveEntry.extensions.size;
    }

    return {
      totalDoves: this._registrations.size,
      totalExtensions,
      doveIds: Array.from(this._registrations.keys()),
    };
  }
}

// 全局单例
export const extensionDBRegistry = new ExtensionDBRegistry();

export { POLICIES };
export default extensionDBRegistry;
