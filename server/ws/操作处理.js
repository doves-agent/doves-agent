/**
 * WebSocket 操作处理模块
 * 职责：MongoDB CRUD、认证操作、API路由处理
 */

import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { CONFIG, ALLOWED_COLLECTIONS, ALLOWED_ACTIONS, logger } from '../core.js';
import {
  getMongoClient, getAdminDb, getUserDb, getUserCollection,
  checkDocumentSize, checkCollectionQuota, getUserQuotaStatsForUser,
  getTimestamp, createTimestampFields, toLocalISOString
} from '../db.js';

/**
 * MongoDB 操作处理
 */
async function handleDbOperation(req) {
  const { collection, action } = req.params;
  const { query, update, doc, document, options, pipeline, body } = req.body;
  const userId = req.user.userId;
  
  if (!ALLOWED_COLLECTIONS.includes(collection)) {
    throw new Error(`不允许访问集合: ${collection}`);
  }
  
  if (!ALLOWED_ACTIONS.includes(action)) {
    throw new Error(`不允许执行操作: ${action}`);
  }
  
  await getMongoClient();
  const db = getUserDb();
  
  const { coll, isUserCollection } = await getUserCollection(db, collection, userId);
  
  const injectUserId = (q) => {
    if (isUserCollection) return q;
    if (!q || typeof q !== 'object') return q;
    return { ...q, 用户ID: userId };
  };
  
  let result;
  
  switch (action) {
    case 'findOne':
      result = await coll.findOne(injectUserId(query || body), options);
      break;
    case 'find':
      const cursor = coll.find(injectUserId(query || body), options);
      if (options?.sort) cursor.sort(options.sort);
      if (options?.limit) cursor.limit(options.limit);
      if (options?.skip) cursor.skip(options.skip);
      result = await cursor.toArray();
      break;
    case 'insertOne':
      const insertDoc = isUserCollection
        ? { ...doc, ...document, ...body }
        : { ...doc, ...document, ...body, 用户ID: userId };
      
      const sizeCheck = checkDocumentSize(insertDoc);
      if (!sizeCheck.ok) throw new Error(`文档过大: ${sizeCheck.size} > ${sizeCheck.limit} 字节`);
      
      const quotaCheck = await checkCollectionQuota(collection, userId);
      if (!quotaCheck.ok) throw new Error(quotaCheck.error);
      
      if (!insertDoc.id) {
        insertDoc.id = new ObjectId().toString();
      }
      if (collection === '任务') {
        insertDoc.状态 = insertDoc.状态 || '等待中';
        insertDoc.阶段 = insertDoc.阶段 || '等待中';
        const ts = createTimestampFields();
        insertDoc.创建时间 = insertDoc.创建时间 || insertDoc.createdAt || ts.localTime;
        insertDoc.创建时间戳 = insertDoc.创建时间戳 || insertDoc.createdAtTs || ts.timestamp;
      }
      const insertResult = await coll.insertOne(insertDoc);
      result = { insertedId: insertResult.insertedId, ...insertDoc, _id: insertResult.insertedId };
      break;
    case 'updateOne':
      const updateTs = createTimestampFields();
      result = await coll.updateOne(
        injectUserId(query || body?.query),
        { $set: { ...(update || body?.update), 更新时间: updateTs.localTime, 更新时间戳: updateTs.timestamp } },
        options
      );
      break;
    case 'deleteOne':
      result = await coll.deleteOne(injectUserId(query || body), options);
      break;
    case 'aggregate':
      const aggPipeline = pipeline || body || [];
      if (!isUserCollection && !aggPipeline.some(stage => stage.$match?.用户ID)) {
        aggPipeline.unshift({ $match: { 用户ID: userId } });
      }
      result = await coll.aggregate(aggPipeline, options).toArray();
      break;
    case 'watch':
      throw new Error('watch 操作请使用 WebSocket subscribe 消息类型');
    default:
      throw new Error('未知操作');
  }
  
  return result;
}

/**
 * 认证操作处理
 */
async function handleAuthOperation(action, req) {
  const { username, password } = req.body;
  const userId = req.user.userId;
  
  switch (action) {
    case 'login':
      if (!username || !password) throw new Error('用户名和密码必填');
      await getMongoClient();
      const loginDb = getAdminDb();
      const loginUsers = loginDb.collection('用户');
      const wsUser = await loginUsers.findOne({ 用户名: username });
      if (!wsUser) throw new Error('用户名或密码错误');
      // 验证密码（bcrypt 哈希）
      const ws密码匹配 = await bcrypt.compare(password, wsUser.密码);
      if (!ws密码匹配) {
        throw new Error('用户名或密码错误');
      }
      const wsToken = jwt.sign({ userId: wsUser.用户ID, username: wsUser.用户名, authType: 'permanent' }, CONFIG.jwtSecret, { expiresIn: '7d' });
      const wsQuotaStats = await getUserQuotaStatsForUser(getUserDb(), wsUser.用户ID);
      return { userId: wsUser.用户ID, username: wsUser.用户名, token: wsToken, resourceStatus: wsUser.资源状态 || '已就绪', quota: wsQuotaStats };
      
    case 'verify':
      const now = Math.floor(getTimestamp() / 1000);
      return { valid: true, userId, username: req.user.username, authType: req.user.authType };
      
    case 'refresh':
      const authType = req.user.authType;
      const newToken = jwt.sign({ userId, username: req.user.username, authType }, CONFIG.jwtSecret, { expiresIn: authType === 'permanent' ? '7d' : '24h' });
      return { token: newToken, authType };
      
    case 'resource-status':
      await getMongoClient();
      const userInfo = await getAdminDb().collection('用户').findOne({ 用户ID: userId });
      if (!userInfo) throw new Error('用户不存在');
      const resourceTask = await getUserDb().collection('任务').findOne({ 类型: 'resource_allocation', targetUserId: userId });
      return { userId, resourceStatus: userInfo.资源状态 || '等待中', task: resourceTask };
      
    default:
      throw new Error(`未知的认证操作: ${action}`);
  }
}

/**
 * API 操作处理
 */
async function handleApiOperation(pathParts, method, req) {
  const userId = req.user.userId;
  await getMongoClient();
  const db = getUserDb();
  
  // /api/task
  if (pathParts[1] === 'task') {
    if (method === 'POST' && pathParts.length === 2) {
      const { description, conversationId, parentId } = req.body;
      if (!description) throw new Error('任务描述必填');
      const ts = createTimestampFields();
      const task = {
        任务ID: new ObjectId().toString(),
        描述: description, 状态: '等待中', 阶段: '等待中',
        对话ID: conversationId || null, 根任务ID: parentId || null, 父任务ID: parentId || null,
        子任务列表: [], 子任务状态: { 总数: 0, 已完成: 0, 已失败: 0 },
        执行者: null, 执行提供商: null, 心跳时间: null, 流缓冲: [], 结果: null, 错误: null,
        用户ID: userId, 创建时间: ts.localTime, 创建时间戳: ts.timestamp
      };
      const { coll } = await getUserCollection(db, '任务', userId);
      await coll.insertOne(task);
      return task;
    }
    if (method === 'GET' && pathParts.length === 3) {
      const { coll } = await getUserCollection(db, '任务', userId);
      const task = await coll.findOne({ 任务ID: pathParts[2] });
      if (!task) throw new Error('任务不存在');
      return task;
    }
    if (method === 'GET' && pathParts[2] === 'list') {
      const { coll } = await getUserCollection(db, '任务', userId);
      return await coll.find({}).sort({ 创建时间戳: -1 }).limit(20).toArray();
    }
  }
  
  // /api/conversations
  if (pathParts[1] === 'conversations') {
    const { coll } = await getUserCollection(db, '对话', userId);
    if (pathParts.length === 2) {
      return await coll.find({}).sort({ 创建时间戳: -1 }).limit(50).toArray();
    }
    const convId = pathParts[2];
    // _id 与 对话ID 统一，直接按 对话ID 查询即可
    const conv = await coll.findOne({ 对话ID: convId });
    if (!conv) throw new Error('对话不存在');
    return conv;
  }
  
  // /api/diagnostic
  if (pathParts[1] === 'diagnostic') {
    const quotaStats = await getUserQuotaStatsForUser(db, userId);
    return {
      timestamp: toLocalISOString(),
      gateway: { status: 'online', uptime: process.uptime() },
      user: { userId, username: req.user.username },
      resources: { database: quotaStats }
    };
  }
  
  throw new Error(`未知的API路径: /${pathParts.join('/')}`);
}

export {
  handleDbOperation,
  handleAuthOperation,
  handleApiOperation,
};
