/**
 * 白鸽服务端数据库操作路由
 * 职责：MongoDB操作代理
 * 
 * 🔒 安全设计：
 * 1. 普通用户：只能访问自己的数据（userId 过滤）
 * 2. 鸽子角色：只能访问任务相关的数据（需验证任务归属）
 *    - 任务集合：只能访问自己领取/执行中的任务
 *    - 对话集合：只能访问任务关联的对话
 *    - 技能/能力集合：只读访问
 *    - 扩展注册集合：按 manifest.databases 声明的策略过滤
 *    - 日志集合：只能写入，不能读取其他用户日志
 *    - 其他集合：只能访问任务所属用户的数据
 * 3. 管理员角色：可以跨用户访问（需要额外验证）
 * 4. 扩展注册集合：鸽子通过 /api/dove/extension/db-register 注册后，
 *    可访问扩展声明的集合，按声明的 policy 过滤
 */

import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { ALLOWED_COLLECTIONS, ALLOWED_ACTIONS, logger } from '../core.js';
import { extensionDBRegistry } from '../extension-db-registry.js';
import { 
  getMongoClient, getAdminDb, getUserDb, getUserCollection, checkDocumentSize, checkCollectionQuota,
  getTimestamp, createTimestampFields 
} from '../db.js';
import { 记录审计 } from '../审计日志.js';
import {
  DOVE_ACCESS_POLICIES, verifyPermissions, checkDoveWritePermission,
  isCollectionAllowed, createInjectUserIdFilter, getExtInsertPolicy
} from './db-权限检查.js';

const router = Router();

/**
 * MongoDB 操作代理
 */
router.post('/:collection/:action', async (req, res) => {
  const { collection, action } = req.params;
  const { query, update, doc, document, options, pipeline, body } = req.body;
  const userId = req.user.userId;
  const doveId = req.user?.doveId || null;
  
  // 验证集合和操作（动态注册表 + 静态白名单）
  const collCheck = isCollectionAllowed(collection, doveId);
  if (!collCheck.allowed) {
    return res.status(400).json({ success: false, error: collCheck.reason });
  }
  
  if (!ALLOWED_ACTIONS.includes(action)) {
    return res.status(400).json({ success: false, error: `不允许执行操作: ${action}` });
  }
  
  // 鸽子请求：额外检查该操作是否在扩展注册表的 actions 中
  if (doveId) {
    const extActionCheck = extensionDBRegistry.isAllowed(doveId, collection, action);
    // 如果集合在扩展注册表中但操作不允许，拒绝
    // 如果集合不在扩展注册表中（即 ALLOWED_COLLECTIONS 允许的），跳过
    if (!extActionCheck.allowed) {
      // 检查该集合是否在扩展注册表中
      const doveRegs = extensionDBRegistry.getDoveRegistrations(doveId);
      let inRegistry = false;
      for (const ext of Object.values(doveRegs)) {
        for (const dbConfig of Object.values(ext.databases)) {
          if (dbConfig.collections && collection in dbConfig.collections) {
            inRegistry = true;
            break;
          }
        }
        if (inRegistry) break;
      }
      if (inRegistry) {
        return res.status(403).json({ success: false, error: extActionCheck.reason });
      }
    }
  }
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    const db = getUserDb();
    
    // 🔒 验证权限（不信任 JWT 字段）
    const permissions = await verifyPermissions(req, adminDb);
    
    const { coll, name: actualCollName, isUserCollection } = await getUserCollection(db, collection, userId);
    
    // 🔒 注入用户ID过滤器（从子模块构建）
    const injectUserId = createInjectUserIdFilter({ permissions, collection, userId, isUserCollection, db });
    
    // 🔒 鸽子写操作权限检查
    const writeActions = ['insertOne', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'findOneAndUpdate', 'findOneAndDelete', 'insertMany'];
    if (permissions.isDove && writeActions.includes(action)) {
      const writeCheck = checkDoveWritePermission(collection, action, permissions);
      if (!writeCheck.allowed) {
        记录审计({
          操作者ID: userId,
          操作者类型: permissions.isDove ? 'dove' : 'user',
          操作: action,
          集合: collection,
          结果: 'denied',
          详情: { 原因: writeCheck.reason, doveId: permissions.doveId }
        });
        return res.status(403).json({ success: false, error: writeCheck.reason });
      }
    }
    
    let result;
    
    const extInsertPolicy = getExtInsertPolicy(collection, doveId);

    switch (action) {
      case 'findOne':
        result = await coll.findOne(await injectUserId(query || body), options);
        break;
        
      case 'find':
        const cursor = coll.find(await injectUserId(query || body), options);
        if (options?.sort) cursor.sort(options.sort);
        if (options?.limit) cursor.limit(options.limit);
        if (options?.skip) cursor.skip(options.skip);
        result = await cursor.toArray();
        break;
        
      case 'insertOne':
        const rawInsertDoc = { ...doc, ...document, ...body };
        let insertDoc;
        if (isUserCollection) {
          insertDoc = rawInsertDoc;
        } else if (extInsertPolicy.isExtCollection) {
          // 扩展注册集合：按声明的 policy 决定是否注入用户字段
          if (extInsertPolicy.policy === 'shared') {
            insertDoc = rawInsertDoc; // 全局共享，不注入
          } else if (extInsertPolicy.policy === 'user_scoped') {
            const uf = extInsertPolicy.userField || 'user_id';
            const uid = permissions.isDove
              ? (permissions.taskOwnerUserId || userId)
              : userId;
            insertDoc = { ...rawInsertDoc, [uf]: rawInsertDoc[uf] || uid };
          } else {
            insertDoc = { ...rawInsertDoc, 用户ID: rawInsertDoc.用户ID || userId };
          }
        } else {
          insertDoc = { ...rawInsertDoc, 用户ID: rawInsertDoc.用户ID || userId };
        }
        
        const sizeCheck = checkDocumentSize(insertDoc);
        if (!sizeCheck.ok) {
          return res.status(413).json({
            success: false,
            error: `文档过大: ${sizeCheck.size} > ${sizeCheck.limit} 字节`
          });
        }
        
        const quotaCheck = await checkCollectionQuota(collection, userId);
        if (!quotaCheck.ok) {
          return res.status(429).json({ success: false, error: quotaCheck.error });
        }
        
        const idFieldName = collection.slice(0, -1) + 'ID';
        if (!insertDoc[idFieldName] && !insertDoc.id) {
          insertDoc[idFieldName] = new ObjectId().toString();
        }
        
        if (collection === '任务') {
          insertDoc.状态 = insertDoc.状态 || '等待中';
          insertDoc.阶段 = insertDoc.阶段 || '等待中';
          const ts = createTimestampFields();
          insertDoc.创建时间 = insertDoc.创建时间 || insertDoc.createdAt || ts.localTime;
          insertDoc.创建时间戳 = insertDoc.创建时间戳 || insertDoc.createdAtTs || ts.timestamp;
        }
        
        const insertResult = await coll.insertOne(insertDoc);
        result = { insertedId: insertResult.insertedId, ...insertDoc, _id: insertResult.insertedId, _collection: actualCollName };
        break;
        
      case 'updateOne':
        const updateOneTs = createTimestampFields();
        const updateOneDoc = update || body?.update;
        
        const hasOperators = updateOneDoc && Object.keys(updateOneDoc).some(key => key.startsWith('$'));
        const updateOnePayload = hasOperators
          ? { ...updateOneDoc, $set: { ...updateOneDoc.$set, 更新时间: updateOneTs.localTime, 更新时间戳: updateOneTs.timestamp } }
          : { $set: { ...updateOneDoc, 更新时间: updateOneTs.localTime, 更新时间戳: updateOneTs.timestamp } };
        
        result = await coll.updateOne(
          await injectUserId(query || body?.query),
          updateOnePayload,
          options
        );
        break;
        
      case 'deleteOne':
        result = await coll.deleteOne(await injectUserId(query || body), options);
        break;
        
      case 'findOneAndUpdate':
        const findOneAndUpdateOptions = options || {};
        const faUpdateTs = createTimestampFields();
        const faUpdateRaw = update || body?.update;
        const faHasOperators = faUpdateRaw && Object.keys(faUpdateRaw).some(key => key.startsWith('$'));
        const faUpdateDoc = (findOneAndUpdateOptions.updateOperators || faHasOperators)
          ? { ...faUpdateRaw, $set: { ...(faUpdateRaw.$set || {}), 更新时间: faUpdateTs.localTime, 更新时间戳: faUpdateTs.timestamp } }
          : { $set: { ...faUpdateRaw, 更新时间: faUpdateTs.localTime, 更新时间戳: faUpdateTs.timestamp } };
        
        let findOneAndUpdateCursor = coll.findOneAndUpdate(
          await injectUserId(query || body?.query),
          faUpdateDoc,
          {
            returnDocument: findOneAndUpdateOptions.returnDocument || 'after',
            upsert: findOneAndUpdateOptions.upsert || false,
            sort: findOneAndUpdateOptions.sort
          }
        );
        result = await findOneAndUpdateCursor;
        break;
        
      case 'findOneAndDelete':
        const findOneAndDeleteOptions = options || {};
        result = await coll.findOneAndDelete(
          await injectUserId(query || body),
          {
            sort: findOneAndDeleteOptions.sort
          }
        );
        break;
        
      case 'updateMany':
        const updateManyTs = createTimestampFields();
        const updateManyDoc = update || body?.update;
        
        const hasManyOperators = updateManyDoc && Object.keys(updateManyDoc).some(key => key.startsWith('$'));
        const updateManyPayload = hasManyOperators
          ? { ...updateManyDoc, $set: { ...updateManyDoc.$set, 更新时间: updateManyTs.localTime, 更新时间戳: updateManyTs.timestamp } }
          : { $set: { ...updateManyDoc, 更新时间: updateManyTs.localTime, 更新时间戳: updateManyTs.timestamp } };
        
        result = await coll.updateMany(
          await injectUserId(query || body?.query),
          updateManyPayload,
          options
        );
        break;
        
      case 'deleteMany':
        result = await coll.deleteMany(await injectUserId(query || body), options);
        break;
        
      case 'insertMany':
        const docs = (doc || document || body || []);
        if (!Array.isArray(docs) || docs.length === 0) {
          return res.status(400).json({ success: false, error: 'insertMany 需要 docs 数组' });
        }
        
        const insertManyDocs = docs.map(d => {
          if (isUserCollection) return { ...d };
          if (extInsertPolicy.isExtCollection) {
            if (extInsertPolicy.policy === 'shared') return { ...d };
            if (extInsertPolicy.policy === 'user_scoped') {
              const uf = extInsertPolicy.userField || 'user_id';
              const uid = permissions.isDove
                ? (permissions.taskOwnerUserId || userId)
                : userId;
              return { ...d, [uf]: d[uf] || uid };
            }
          }
          return { ...d, 用户ID: d.用户ID || userId };
        });
        
        const insertManyResult = await coll.insertMany(insertManyDocs);
        result = { insertedCount: insertManyResult.insertedCount, insertedIds: insertManyResult.insertedIds };
        break;
        
      case 'countDocuments':
        result = await coll.countDocuments(await injectUserId(query || body), options);
        break;
        
      case 'aggregate':
        const aggPipeline = pipeline || body || [];
        if (!isUserCollection && !aggPipeline.some(stage => stage.$match?.用户ID)) {
          // 扩展注册集合：按声明的 policy 决定是否注入过滤
          if (extInsertPolicy.isExtCollection) {
            if (extInsertPolicy.policy === 'shared') {
              // 全局共享集合，不注入任何用户过滤
            } else if (extInsertPolicy.policy === 'user_scoped') {
              const uf = extInsertPolicy.userField || 'user_id';
              const uid = permissions.isDove
                ? (permissions.taskOwnerUserId || userId)
                : userId;
              if (!aggPipeline.some(stage => stage.$match && uf in stage.$match)) {
                aggPipeline.unshift({ $match: { [uf]: uid } });
              }
            } else {
              aggPipeline.unshift({ $match: { 用户ID: userId } });
            }
          } else {
            // 核心系统集合，注入默认用户过滤
            aggPipeline.unshift({ $match: { 用户ID: userId } });
          }
        }
        result = await coll.aggregate(aggPipeline, options).toArray();
        break;
        
      case 'createIndex':
        // 扩展包通过网关创建索引（幂等操作）
        try {
          const indexSpec = body?.spec || body;
          const indexOptions = body?.options || {};
          if (!indexSpec || typeof indexSpec !== 'object') {
            return res.status(400).json({ success: false, error: 'createIndex 缺少 spec 参数' });
          }
          result = await coll.createIndex(indexSpec, indexOptions);
        } catch (indexErr) {
          // 索引已存在等错误不阻正
          result = { ok: 0, note: indexErr.message };
        }
        break;
        
      case 'watch':
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        const watchQuery = query || body || {};
        const watchMatch = isUserCollection
          ? watchQuery
          : { 'fullDocument.用户ID': userId, ...watchQuery };
        
        const changeStream = coll.watch(
          [{ $match: watchMatch }],
          { fullDocument: 'updateLookup' }
        );
        
        changeStream.on('change', (change) => {
          res.write(`data: ${JSON.stringify(change)}\n\n`);
        });
        
        changeStream.on('error', (err) => {
          logger.error('Change Stream 错误:', err.message);
          res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        });
        
        req.on('close', () => {
          changeStream.close();
        });
        
        const keepAlive = setInterval(() => {
          res.write(': keep-alive\n\n');
        }, 30000);
        
        req.on('close', () => clearInterval(keepAlive));
        return;
        
      default:
        return res.status(400).json({ success: false, error: '未知操作' });
    }
    
    // 🔒 审计记录（鸽子操作和敏感操作）
    if (permissions.isDove || ['deleteOne', 'deleteMany', 'findOneAndDelete'].includes(action)) {
      记录审计({
        操作者ID: userId,
        操作者类型: permissions.isDove ? 'dove' : (permissions.isAdmin ? 'admin' : 'user'),
        操作: action,
        集合: collection,
        目标ID: result?._id?.toString() || result?.insertedId?.toString() || null,
        结果: 'success'
      });
    }
    
    res.json({ success: true, data: result });
  } catch (e) {
    const isDupKey = e.code === 11000 || e.code === '11000' ||
                     e.codeName === 'DuplicateKey' ||
                     (e.message && e.message.includes('E11000'));
    if (isDupKey) {
      // 重复键返回 409 Conflict，不是服务端错误，不应触发客户端重试
      logger.debug('MongoDB 重复键:', e.message);
      res.status(409).json({ success: false, error: e.message, code: 'DUPLICATE_KEY' });
    } else {
      logger.error('MongoDB 操作失败:', e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  }
});

export default router;
