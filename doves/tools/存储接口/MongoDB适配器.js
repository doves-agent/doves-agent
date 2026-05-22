/**
 * @file tools/存储接口/MongoDB适配器
 * @description MongoDB 存储操作（通过鸽子代理）
 */

import { logger } from './核心.js';
import { getTimestamp, createTimestampFields } from '@dove/common/时间工具.js';
import { ObjectId } from '@dove/common/对象标识.js';

export class MongoDB适配器 {
  constructor(代理实例, 数据库名 = 'doves_user_data') {
    this.代理 = 代理实例;
    this.数据库名 = 数据库名;
  }

  /**
   * 获取数据库
   */
  getDb() {
    return this.代理.db(this.数据库名);
  }

  /**
   * 获取集合（统一使用共享集合，通过 userId 索引查询）
   */
  getCollection(collectionName, userId) {
    const db = this.getDb();
    // 不再区分用户专属集合，统一使用共享集合
    return db.collection(collectionName);
  }

  /**
   * 保存数据
   * @param {string} collection - 集合名
   * @param {Object} data - 数据
   * @param {string} userId - 用户ID（用于用户专属集合）
   */
  async save(collection, data, userId = null) {
    logger.debug(`MongoDB save: ${collection}`, { userId });
      
    const coll = this.getCollection(collection, userId);
    const ts = createTimestampFields();
    const doc = {
      ...data,
      创建时间: data.createdAt || data.创建时间 || ts.localTime,
      创建时间戳: data.createdAtTs || data.创建时间戳 || ts.timestamp,
      更新时间: ts.localTime,
      更新时间戳: ts.timestamp
    };
  
    // 项目规范：数据库字段统一使用中文命名
    // 通用ID：根据集合名生成对应中文ID字段
    const idFieldName = collection.slice(0, -1) + 'ID'; // 如 任务→任务ID, 对话→对话ID
    if (!doc[idFieldName] && !doc.id) {
      doc[idFieldName] = new ObjectId().toString();
    }
  
    const result = await coll.insertOne(doc);
    return { 成功: true, id: doc[idFieldName] || doc.id, insertedId: result.insertedId };
  }

  /**
   * 查询数据
   * @param {string} collection - 集合名
   * @param {Object} query - 查询条件
   * @param {Object} options - 查询选项
   * @param {string} userId - 用户ID
   */
  async find(collection, query = {}, options = {}, userId = null) {
    logger.debug(`MongoDB find: ${collection}`, { userId });
    
    const coll = this.getCollection(collection, userId);
    const cursor = coll.find(query, options);
    
    if (options.sort) cursor.sort(options.sort);
    if (options.limit) cursor.limit(options.limit);
    if (options.skip) cursor.skip(options.skip);
    
    return await cursor.toArray();
  }

  /**
   * 查询单条
   * @param {string} collection - 集合名
   * @param {Object} query - 查询条件
   * @param {string} userId - 用户ID
   */
  async findOne(collection, query = {}, userId = null) {
    logger.debug(`MongoDB findOne: ${collection}`, { userId });
    
    const coll = this.getCollection(collection, userId);
    return await coll.findOne(query);
  }

  /**
   * 更新数据
   * @param {string} collection - 集合名
   * @param {Object} query - 查询条件
   * @param {Object} data - 更新数据
   * @param {string} userId - 用户ID
   */
  async update(collection, query, data, userId = null) {
    logger.debug(`MongoDB update: ${collection}`, { userId });
      
    const coll = this.getCollection(collection, userId);
    const ts = createTimestampFields();
    const result = await coll.updateOne(
      query,
      { $set: { ...data, 更新时间: ts.localTime, 更新时间戳: ts.timestamp } }
    );
  
    return { 
      成功: result.matchedCount > 0, 
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount 
    };
  }

  /**
   * 删除数据
   * @param {string} collection - 集合名
   * @param {Object} query - 查询条件
   * @param {string} userId - 用户ID
   */
  async delete(collection, query, userId = null) {
    logger.debug(`MongoDB delete: ${collection}`, { userId });
    
    const coll = this.getCollection(collection, userId);
    const result = await coll.deleteOne(query);
    
    return { 成功: result.deletedCount > 0, deletedCount: result.deletedCount };
  }

  /**
   * 聚合查询
   * @param {string} collection - 集合名
   * @param {Array} pipeline - 聚合管道
   * @param {string} userId - 用户ID
   */
  async aggregate(collection, pipeline, userId = null) {
    logger.debug(`MongoDB aggregate: ${collection}`, { userId });
    
    const coll = this.getCollection(collection, userId);
    return await coll.aggregate(pipeline).toArray();
  }
}
