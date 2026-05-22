/**
 * @file gateway-集合.js
 * @description 数据库网关抽象类（GatewayDatabase / GatewayCollection），从 doves_proxy/index.js 抽取
 * 
 * 模拟 MongoDB Db/Collection 接口，通过 HTTP 代理访问服务端数据
 */

import { EventEmitter } from 'events';

/**
 * 数据库类（模拟 MongoDB Db 接口）
 */
export class GatewayDatabase {
  constructor(client, dbName) {
    this.client = client;
    this.dbName = dbName;
    this._collections = new Map();
  }

  /**
   * 获取集合
   * @param {string} name - 集合名
   * @returns {GatewayCollection}
   */
  collection(name) {
    if (!this._collections.has(name)) {
      this._collections.set(name, new GatewayCollection(this.client, name, this.dbName));
    }
    return this._collections.get(name);
  }

  /**
   * 列出集合
   */
  async listCollections() {
    // 通过服务端获取集合列表（如果支持）
    // 目前返回空数组，后续可扩展
    return [];
  }
}

/**
 * 集合类（模拟 MongoDB Collection 接口）
 */
export class GatewayCollection {
  constructor(client, collectionName, dbName) {
    this.client = client;
    this.collectionName = collectionName;
    this.dbName = dbName;
  }

  /**
   * 查询单个文档
   */
  async findOne(query, options = {}) {
    const result = await this.client.dbOperation(this.collectionName, 'findOne', {
      query,
      options
    });
    return result.success ? result.data : null;
  }

  /**
   * 查询多个文档
   * 注意：返回同步的 cursor 对象（兼容 MongoDB 驱动写法）
   */
  find(query, options = {}) {
    const client = this.client;
    const collectionName = this.collectionName;
    
    // 返回类似 MongoDB Cursor 的对象（同步返回）
    // 实际查询在 toArray/sort/limit/skip 中执行
    let pendingQuery = query;
    let pendingOptions = { ...options };
    
    const cursor = {
      toArray: async () => {
        const result = await client.dbOperation(collectionName, 'find', {
          query: pendingQuery,
          options: pendingOptions
        });
        return result.success ? result.data : [];
      },
      sort: (sortSpec) => {
        pendingOptions.sort = sortSpec;
        return cursor;
      },
      limit: (n) => {
        pendingOptions.limit = n;
        return cursor;
      },
      skip: (n) => {
        pendingOptions.skip = n;
        return cursor;
      }
    };
    
    return cursor;
  }

  /**
   * 插入单个文档
   */
  async insertOne(doc) {
    const result = await this.client.dbOperation(this.collectionName, 'insertOne', {
      doc,
      document: doc
    });
    
    if (!result.success) {
      throw new Error(result.error || '插入失败');
    }
    
    return {
      insertedId: result.data?.insertedId || result.data?._id,
      acknowledged: true
    };
  }

  /**
   * 更新单个文档
   */
  async updateOne(query, update, options = {}) {
    // 检测是否包含 MongoDB 操作符（$set, $push, $inc, $addToSet 等）
    const hasOperators = update && Object.keys(update).some(key => key.startsWith('$'));
    const updateDoc = hasOperators ? update : { $set: update };
    
    const result = await this.client.dbOperation(this.collectionName, 'updateOne', {
      query,
      update: updateDoc,
      options
    });
    
    if (!result.success) {
      const err = new Error(result.error || '更新失败');
      err.code = result.code;
      throw err;
    }
    
    // 返回服务端的实际 matchedCount/modifiedCount
    const data = result.data || null;
    return {
      matchedCount: data?.matchedCount ?? 1,
      modifiedCount: data?.modifiedCount ?? 1,
      upsertedId: data?.upsertedId ?? null,
      acknowledged: true
    };
  }

  /**
   * 删除单个文档
   */
  async deleteOne(query, options = {}) {
    const result = await this.client.dbOperation(this.collectionName, 'deleteOne', {
      query,
      options
    });
  
    return {
      deletedCount: result.success && result.data?.deletedCount ? result.data.deletedCount : 0,
      acknowledged: true
    };
  }
  
  /**
   * 原子操作：查找并更新单个文档
   * MongoDB findOneAndUpdate 是原子操作
   * @param {Object} query - 查询条件
   * @param {Object} update - 更新内容
   * @param {Object} options - 选项 { returnDocument: 'after'|'before', upsert: true|false, sort: {}, updateOperators: true|false }
   * @returns {Object|null} 更新后的文档或 null
   */
  async findOneAndUpdate(query, update, options = {}) {
    const result = await this.client.dbOperation(this.collectionName, 'findOneAndUpdate', {
      query,
      update,
      options
    });
  
    // MongoDB findOneAndUpdate 返回的是文档本身，不是操作结果
    return result.success ? result.data : null;
  }
  
  /**
   * 原子操作：查找并删除单个文档
   * MongoDB findOneAndDelete 是原子操作
   * @param {Object} query - 查询条件
   * @param {Object} options - 选项 { sort: {} }
   * @returns {Object|null} 删除的文档或 null
   */
  async findOneAndDelete(query, options = {}) {
    const result = await this.client.dbOperation(this.collectionName, 'findOneAndDelete', {
      query,
      options
    });
  
    return result.success ? result.data : null;
  }
  
  /**
   * 聚合查询
   */
  async aggregate(pipeline, options = {}) {
    const result = await this.client.dbOperation(this.collectionName, 'aggregate', {
      pipeline,
      options
    });
    
    const docs = result.success ? result.data : [];
    
    return {
      toArray: async () => docs
    };
  }

  /**
   * 监听变更流
   */
  watch(pipeline = [], options = {}) {
    // 返回一个 EventEmitter 来模拟 Change Stream
    const emitter = new EventEmitter();
    
    // 注意：实际的 watch 需要通过 SSE 实现
    // 这里提供接口，具体实现可以后续扩展
    const eventSource = new EventSource(
      `${this.client.serverUrl}/db/${this.collectionName}/watch?${new URLSearchParams({ query: JSON.stringify(pipeline) })}`,
      { headers: this.client._getAuthHeaders() }
    );
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        emitter.emit('change', data);
      } catch (e) {
        emitter.emit('error', e);
      }
    };
    
    eventSource.onerror = (error) => {
      emitter.emit('error', error);
    };
    
    // 提供关闭方法
    emitter.close = () => {
      eventSource.close();
    };
    
    return emitter;
  }

  /**
   * 批量插入（扩展支持）
   */
  async insertMany(docs, options = {}) {
    const results = [];
    for (const doc of docs) {
      const result = await this.insertOne(doc);
      results.push(result);
    }
    return {
      insertedCount: results.length,
      insertedIds: results.map(r => r.insertedId),
      acknowledged: true
    };
  }

  /**
   * 批量更新（扩展支持）
   */
  async updateMany(query, update, options = {}) {
    // 服务端目前只支持 updateOne，需要遍历
    const docs = await this.find(query).toArray();
    let modifiedCount = 0;
    
    for (const doc of docs) {
      await this.updateOne({ _id: doc._id }, update, options);
      modifiedCount++;
    }
    
    return {
      matchedCount: docs.length,
      modifiedCount,
      acknowledged: true
    };
  }

  /**
   * 批量删除（扩展支持）
   */
  async deleteMany(query, options = {}) {
    const docs = await this.find(query).toArray();
    let deletedCount = 0;
    
    for (const doc of docs) {
      await this.deleteOne({ _id: doc._id }, options);
      deletedCount++;
    }
    
    return {
      deletedCount,
      acknowledged: true
    };
  }

  /**
   * 计数（扩展支持）
   */
  async countDocuments(query = {}) {
    const docs = await this.find(query).toArray();
    return docs.length;
  }
}
