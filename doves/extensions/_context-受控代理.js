/**
 * @file extensions/_context-受控代理
 * @description 受控代理类：AppDatabase/AppCollection/AppStorageProxy/AppMemoryProxy/AppOSSProxy/AppEventProxy
 * 从 _context.js 拆分
 */

import { ExtensionPermissionError, permissionRegistry } from './_permissions.js';
import { GatewayDatabase, GatewayCollection } from '../doves_proxy/gateway-集合.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('ctx代理', { 前缀: '[ctx.event]', 级别: 'debug', 显示调用位置: true });

// ==================== AppDatabase / AppCollection ====================

/**
 * 受控数据库实例
 * 只能访问 permissions.databases 声明的库
 */
export class AppDatabase {
  constructor(ctx, dbName) {
    this._ctx = ctx;
    this._dbName = dbName;
    this._gatewayDb = ctx._proxy.db(dbName);
  }

  /**
   * 获取受控集合实例
   */
  collection(name) {
    return new AppCollection(this._ctx, this._dbName, name, this._gatewayDb.collection(name));
  }

  /**
   * 确保索引存在（需 index 权限）
   */
  async ensureIndex(collectionName, spec, options = {}) {
    this._ctx._checkDbPermission(this._dbName, collectionName, 'index');
    const coll = this._gatewayDb.collection(collectionName);
    return await this._ctx._proxy.dbOperation(collectionName, 'createIndex', { spec, options });
  }
}

/**
 * 受控集合实例
 * 每次操作前校验权限，根据 scope 自动注入过滤条件
 */
export class AppCollection {
  constructor(ctx, dbName, collectionName, gatewayCollection) {
    this._ctx = ctx;
    this._dbName = dbName;
    this._collectionName = collectionName;
    this._gateway = gatewayCollection;
  }

  _checkAndInject(query, action) {
    const perm = this._ctx._checkDbPermission(this._dbName, this._collectionName, action);
    return this._injectScopeFilter(query, perm);
  }

  _injectScopeFilter(query, perm) {
    if (!perm || perm.scope === 'shared') return query;

    if (perm.scope === 'user_scoped' && perm.userField) {
      const userId = this._ctx._userId;
      if (!query || typeof query !== 'object') return { [perm.userField]: userId };
      return { ...query, [perm.userField]: query[perm.userField] || userId };
    }

    if (perm.scope === 'task_scoped') {
      const taskId = this._ctx._taskId;
      if (!query || typeof query !== 'object') return { 根任务ID: taskId };
      return { ...query, 根任务ID: query.根任务ID || taskId };
    }

    if (perm.scope === 'extension') {
      const extName = this._ctx._extensionName;
      if (!query || typeof query !== 'object') return { _extension: extName };
      return { ...query, _extension: extName };
    }

    return query;
  }

  async findOne(query, options = {}) {
    const q = this._checkAndInject(query, 'findOne');
    return this._gateway.findOne(q, options);
  }

  find(query, options = {}) {
    this._ctx._checkDbPermission(this._dbName, this._collectionName, 'find');
    const perm = permissionRegistry.isDbAllowed(this._ctx._extensionName, this._dbName, this._collectionName, 'find');
    const q = this._injectScopeFilter(query, perm);
    return this._gateway.find(q, options);
  }

  async insertOne(doc) {
    this._ctx._checkDbPermission(this._dbName, this._collectionName, 'insertOne');
    const perm = permissionRegistry.isDbAllowed(this._ctx._extensionName, this._dbName, this._collectionName, 'insertOne');
    const enriched = this._enrichDocForScope(doc, perm);
    return this._gateway.insertOne(enriched);
  }

  async updateOne(query, update, options = {}) {
    const q = this._checkAndInject(query, 'updateOne');
    return this._gateway.updateOne(q, update, options);
  }

  async deleteOne(query, options = {}) {
    const q = this._checkAndInject(query, 'deleteOne');
    return this._gateway.deleteOne(q, options);
  }

  async findOneAndUpdate(query, update, options = {}) {
    const q = this._checkAndInject(query, 'findOneAndUpdate');
    return this._gateway.findOneAndUpdate(q, update, options);
  }

  async findOneAndDelete(query, options = {}) {
    const q = this._checkAndInject(query, 'findOneAndDelete');
    return this._gateway.findOneAndDelete(q, options);
  }

  async aggregate(pipeline, options = {}) {
    this._ctx._checkDbPermission(this._dbName, this._collectionName, 'aggregate');
    return this._gateway.aggregate(pipeline, options);
  }

  async countDocuments(query = {}) {
    const q = this._checkAndInject(query, 'countDocuments');
    return this._gateway.countDocuments(q);
  }

  async insertMany(docs) {
    this._ctx._checkDbPermission(this._dbName, this._collectionName, 'insertMany');
    const perm = permissionRegistry.isDbAllowed(this._ctx._extensionName, this._dbName, this._collectionName, 'insertMany');
    const enriched = docs.map(d => this._enrichDocForScope(d, perm));
    return this._gateway.insertMany(enriched);
  }

  async updateMany(query, update, options = {}) {
    const q = this._checkAndInject(query, 'updateMany');
    return this._gateway.updateMany(q, update, options);
  }

  async deleteMany(query, options = {}) {
    const q = this._checkAndInject(query, 'deleteMany');
    return this._gateway.deleteMany(q, options);
  }

  async createIndex(spec, options = {}) {
    try {
      this._ctx._checkDbPermission(this._dbName, this._collectionName, 'index');
      return await this._ctx._proxy.dbOperation(this._collectionName, 'createIndex', {
        spec,
        options,
        dbName: this._dbName,
      });
    } catch {
      return { ok: 0, note: 'createIndex skipped (server unsupported or no permission)' };
    }
  }

  _enrichDocForScope(doc, perm) {
    if (!perm || perm.scope === 'shared') return doc;

    if (perm.scope === 'user_scoped' && perm.userField) {
      return { ...doc, [perm.userField]: doc[perm.userField] || this._ctx._userId };
    }

    if (perm.scope === 'task_scoped') {
      return { ...doc, 根任务ID: doc.根任务ID || this._ctx._taskId };
    }

    if (perm.scope === 'extension') {
      return { ...doc, _extension: this._ctx._extensionName };
    }

    return doc;
  }
}

// ==================== AppStorageProxy / AppMemoryProxy / AppOSSProxy ====================

/**
 * 受控Git存储代理
 */
export class AppStorageProxy {
  constructor(ctx) {
    this._ctx = ctx;
  }

  _check(action) {
    const result = permissionRegistry.isStorageAllowed(this._ctx._extensionName, 'git-storage', action);
    if (!result.allowed) {
      throw new ExtensionPermissionError(this._ctx._extensionName, 'storage.git-storage', action, result.reason);
    }
  }

  async getStatus() {
    this._check('status');
    return this._ctx._proxy.fetch('/api/git-storage/files/status');
  }

  async cloneSnapshot(source, target, preserve = false) {
    this._check('cloneSnapshot');
    return this._ctx._proxy.fetch('/api/git-storage/files/clone', {
      method: 'POST',
      body: { source, target, preserve },
    });
  }
}

/**
 * 受控Git记忆代理
 */
export class AppMemoryProxy {
  constructor(ctx) {
    this._ctx = ctx;
  }

  _check(action) {
    const result = permissionRegistry.isStorageAllowed(this._ctx._extensionName, 'memory', action);
    if (!result.allowed) {
      throw new ExtensionPermissionError(this._ctx._extensionName, 'storage.memory', action, result.reason);
    }
  }

  async search(query, options = {}) {
    this._check('search');
    const { Git记忆适配器 } = await import('../tools/存储接口/Git记忆适配器.js');
    const adapter = new Git记忆适配器();
    return adapter.search(query, options);
  }

  async write(data) {
    this._check('write');
    const { Git记忆适配器 } = await import('../tools/存储接口/Git记忆适配器.js');
    const adapter = new Git记忆适配器();
    return adapter.add(data.userId, data.messages, data.metadata);
  }
}

/**
 * 受控 OSS 代理
 */
export class AppOSSProxy {
  constructor(ctx) {
    this._ctx = ctx;
  }

  _check(action) {
    const result = permissionRegistry.isStorageAllowed(this._ctx._extensionName, 'oss', action);
    if (!result.allowed) {
      throw new ExtensionPermissionError(this._ctx._extensionName, 'storage.oss', action, result.reason);
    }
  }

  async signUrl(path, expires = 3600) {
    this._check('signUrl');
    return this._ctx._proxy.fetch('/api/oss/sign-url', { method: 'POST', body: { path, expires } });
  }

  async upload(path, content) {
    this._check('write');
    return this._ctx._proxy.fetch('/api/oss/upload', { method: 'PUT', body: { path, content } });
  }

  async download(path) {
    this._check('read');
    return this._ctx._proxy.fetch(`/api/oss/download?path=${encodeURIComponent(path)}`);
  }

  async list(prefix = '') {
    this._check('list');
    return this._ctx._proxy.fetch(`/api/oss/list?prefix=${encodeURIComponent(prefix)}`);
  }
}

// ==================== AppEventProxy ====================

/**
 * 受控事件代理
 */
export class AppEventProxy {
  constructor(ctx) {
    this._ctx = ctx;
  }

  async subscribe(pattern, handler) {
    const result = permissionRegistry.isEventAllowed(this._ctx._extensionName, 'subscribe', pattern);
    if (!result.allowed) {
      throw new ExtensionPermissionError(this._ctx._extensionName, 'event.subscribe', pattern, result.reason);
    }
    logger.warn(`事件订阅暂未实现: ${pattern}`);
  }

  async publish(pattern, data) {
    const result = permissionRegistry.isEventAllowed(this._ctx._extensionName, 'publish', pattern);
    if (!result.allowed) {
      throw new ExtensionPermissionError(this._ctx._extensionName, 'event.publish', pattern, result.reason);
    }
    logger.warn(`事件发布暂未实现: ${pattern}`);
  }
}
