/**
 * @file server/routes/db-权限检查
 * @description 数据库路由的权限策略检查 + 过滤条件注入
 * 从 db.js 拆分
 */

import { ALLOWED_COLLECTIONS } from '../core.js';
import { extensionDBRegistry } from '../extension-db-registry.js';

/**
 * 鸽子权限策略类型
 */
export const DOVE_ACCESS_POLICIES = {
  task_only: 'task_only',
  user_all: 'user_all'
};

/**
 * 鸽子对各集合的写操作限制（核心系统集合）
 */
export const DOVE_WRITE_RESTRICTIONS = {
  '技能': [],
  '能力': [],
  '日志': ['insertOne', 'insertMany'],
  '文件元数据': ['insertOne', 'updateOne'],
  '执行轨迹': ['insertOne', 'updateOne'],
  '事件': ['insertOne', 'findOne', 'find', 'findOneAndUpdate'],
};

/**
 * 权限验证
 * @returns {Object} 权限信息
 */
export async function verifyPermissions(req, adminDb) {
  const user = req.user;
  
  const result = {
    isAdmin: false,
    isDove: false,
    doveId: null,
    accessPolicy: DOVE_ACCESS_POLICIES.task_only,
    allowedTaskIds: [],
    allowedConversationIds: [],
    taskOwnerUserId: null
  };
  
  if (user.role === 'admin' || user.role === 'system_dove') {
    const adminRecord = await adminDb.collection('管理员').findOne({ 
      用户ID: user.userId,
      状态: '活跃'
    });
    if (adminRecord) {
      result.isAdmin = true;
      return result;
    }
  }
  
  if (user.doveId || user.authType === 'apikey') {
    const doveRecord = await adminDb.collection('鸽子身份').findOne({ 
      鸽子ID: user.doveId
    });
    const apiKeyRecord = user.authType === 'apikey' ? 
      await adminDb.collection('API密钥').findOne({ _id: user.keyId, 状态: '活跃' }) : null;
    
    if (doveRecord && doveRecord.状态 !== '禁用') {
      result.isDove = true;
      result.doveId = doveRecord.鸽子ID;
      result.accessPolicy = doveRecord.权限策略?.数据访问范围 || 
        (doveRecord.鸽子类型 === 'official' ? DOVE_ACCESS_POLICIES.user_all : DOVE_ACCESS_POLICIES.task_only);
      
      const { getUserDb } = await import('../db.js');
      const userDb = getUserDb();
      const tasks = await userDb.collection('任务').find({
        执行者: doveRecord.鸽子ID,
        状态: { $in: ['执行中', '等待子任务'] }
      }).project({ 任务ID: 1, 根任务ID: 1, 对话ID: 1, 用户ID: 1 }).toArray();
      
      const taskIdSet = new Set(tasks.map(t => t.任务ID));
      for (const t of tasks) {
        if (t.根任务ID) taskIdSet.add(t.根任务ID);
      }
      result.allowedTaskIds = [...taskIdSet];
      result.allowedConversationIds = tasks.map(t => t.对话ID).filter(Boolean);
      result.taskOwnerUserId = tasks.length > 0 ? tasks[0].用户ID : null;
      
      return result;
    }
  }
  
  return result;
}

/**
 * 鸽子写操作权限检查
 */
export function checkDoveWritePermission(collection, action, permissions) {
  if (permissions.doveId) {
    const extCheck = extensionDBRegistry.isAllowed(permissions.doveId, collection, action);
    if (extCheck.allowed) {
      return { allowed: true };
    }
    const doveRegs = extensionDBRegistry.getDoveRegistrations(permissions.doveId);
    for (const ext of Object.values(doveRegs)) {
      for (const dbConfig of Object.values(ext.databases)) {
        if (dbConfig.collections && collection in dbConfig.collections) {
          const collConfig = dbConfig.collections[collection];
          return { allowed: false, reason: `扩展对集合「${collection}」不允许执行「${action}」操作，已声明: ${collConfig.actions?.join(', ')}` };
        }
      }
    }
  }

  const restrictions = DOVE_WRITE_RESTRICTIONS[collection];
  if (!restrictions) return { allowed: true };
  
  if (restrictions.length === 0) {
    return { allowed: false, reason: `鸽子对「${collection}」集合只有只读权限` };
  }
  
  if (!restrictions.includes(action)) {
    return { allowed: false, reason: `鸽子对「${collection}」集合不允许执行「${action}」操作` };
  }
  
  return { allowed: true };
}

/**
 * 检查集合是否允许访问
 */
export function isCollectionAllowed(collection, doveId) {
  if (ALLOWED_COLLECTIONS.includes(collection)) {
    return { allowed: true };
  }
  
  if (doveId) {
    const extCheck = extensionDBRegistry.isAllowed(doveId, collection, 'find');
    if (extCheck.allowed) {
      return { allowed: true };
    }
  }
  
  return { allowed: false, reason: `不允许访问集合: ${collection}` };
}

/**
 * 构建 injectUserId 过滤函数
 * @param {Object} params - { permissions, collection, userId, isUserCollection, db }
 * @returns {Function} injectUserId 过滤函数
 */
export function createInjectUserIdFilter({ permissions, collection, userId, isUserCollection, db }) {
  return async (q) => {
    // 管理员可以跨用户访问
    if (permissions.isAdmin) return q;
    
    // 鸽子按集合类型和权限策略过滤
    if (permissions.isDove) {
      const ownerUserId = permissions.taskOwnerUserId;
      
      // === 任务集合 ===
      if (collection === '任务' || collection === 'tasks') {
        const parentTaskId = (q && typeof q === 'object') ? (q.父任务ID || q['父任务ID']) : null;
        if (parentTaskId && permissions.allowedTaskIds.includes(parentTaskId)) {
          return q;
        }
        if (q && typeof q === 'object' && permissions.allowedTaskIds.length > 0) {
          const orConditions = q.$or || [];
          const allConditions = [q, ...orConditions];
          const taskIds = allConditions
            .map(c => c?.任务ID || c?.id)
            .filter(Boolean);
          const directlyAllowed = taskIds.some(id => permissions.allowedTaskIds.includes(id));
          if (directlyAllowed) {
            return q;
          }
          if (taskIds.length > 0) {
            const linkedTask = await db.collection('任务').findOne(
              { $or: taskIds.map(id => ({ 任务ID: id })) },
              { projection: { 任务ID: 1, 根任务ID: 1, 父任务ID: 1 } }
            );
            if (linkedTask) {
              const linkedIds = [linkedTask.根任务ID, linkedTask.父任务ID].filter(Boolean);
              if (linkedIds.some(id => permissions.allowedTaskIds.includes(id))) {
                return q;
              }
            }
          }
        }
        if (permissions.accessPolicy === DOVE_ACCESS_POLICIES.user_all && ownerUserId) {
          if (!q || typeof q !== 'object') return { 用户ID: ownerUserId };
          return { ...q, 用户ID: ownerUserId };
        }
        return { ...q, 执行者: permissions.doveId };
      }
      
      // === 对话集合 ===
      if (collection === '对话' || collection === 'conversations') {
        if (permissions.accessPolicy === DOVE_ACCESS_POLICIES.user_all && ownerUserId) {
          if (!q || typeof q !== 'object') return { 用户ID: ownerUserId };
          return { ...q, 用户ID: ownerUserId };
        }
        if (permissions.allowedConversationIds.length > 0) {
          if (!q || typeof q !== 'object') return { 对话ID: { $in: permissions.allowedConversationIds } };
          return { ...q, 对话ID: { $in: permissions.allowedConversationIds } };
        }
        return { _id: 'ACCESS_DENIED' };
      }
      
      // === 技能/能力集合 ===
      if (collection === '技能' || collection === '能力') {
        return q;
      }
      
      // === 扩展注册集合 ===
      const extPolicy = extensionDBRegistry.isAllowed(permissions.doveId, collection, 'find');
      if (extPolicy.allowed && extPolicy.policy) {
        const policy = extPolicy.policy;
        if (policy === 'shared') return q;
        if (policy === 'user_scoped') {
          const userField = extPolicy.userField || 'user_id';
          if (permissions.accessPolicy === DOVE_ACCESS_POLICIES.user_all && ownerUserId) {
            if (!q || typeof q !== 'object') return { [userField]: ownerUserId };
            return { ...q, [userField]: ownerUserId };
          }
          if (!q || typeof q !== 'object') return { [userField]: 'ACCESS_DENIED' };
          return { ...q, [userField]: 'ACCESS_DENIED' };
        }
        if (policy === 'task_scoped') {
          if (permissions.allowedTaskIds.length > 0) {
            if (!q || typeof q !== 'object') return { 根任务ID: { $in: permissions.allowedTaskIds } };
            return { ...q, 根任务ID: { $in: permissions.allowedTaskIds } };
          }
          return { _id: 'ACCESS_DENIED' };
        }
      }
      
      // === 日志集合 ===
      if (collection === '日志') {
        if (permissions.accessPolicy === DOVE_ACCESS_POLICIES.user_all && ownerUserId) {
          if (!q || typeof q !== 'object') return { 用户ID: ownerUserId };
          return { ...q, 用户ID: ownerUserId };
        }
        if (!q || typeof q !== 'object') return { 来源: permissions.doveId };
        return { ...q, 来源: permissions.doveId };
      }
      
      // === 执行轨迹集合 ===
      if (collection === '执行轨迹') {
        if (permissions.accessPolicy === DOVE_ACCESS_POLICIES.user_all && ownerUserId) {
          return q;
        }
        if (permissions.allowedTaskIds.length > 0) {
          const requestedId = q?.根任务ID;
          if (requestedId && permissions.allowedTaskIds.includes(requestedId)) {
            return q;
          }
          if (!q || typeof q !== 'object') return { 根任务ID: { $in: permissions.allowedTaskIds } };
          return { ...q, 根任务ID: { $in: permissions.allowedTaskIds } };
        }
        return { _id: 'ACCESS_DENIED' };
      }
      
      // === 事件集合 ===
      if (collection === '事件') {
        if (permissions.accessPolicy === DOVE_ACCESS_POLICIES.user_all && ownerUserId) {
          if (!q || typeof q !== 'object') return { 用户ID: ownerUserId };
          return { ...q, 用户ID: ownerUserId };
        }
        if (permissions.allowedTaskIds.length > 0) {
          if (!q || typeof q !== 'object') return { 根任务ID: { $in: permissions.allowedTaskIds } };
          return { ...q, 根任务ID: { $in: permissions.allowedTaskIds } };
        }
        return { _id: 'ACCESS_DENIED' };
      }
      
      // === 其他用户数据集合 ===
      if (permissions.accessPolicy === DOVE_ACCESS_POLICIES.user_all && ownerUserId) {
        if (isUserCollection) return q;
        if (!q || typeof q !== 'object') return { 用户ID: ownerUserId };
        return { ...q, 用户ID: ownerUserId };
      }
      
      if (isUserCollection) return q;
      return { _id: 'ACCESS_DENIED', 用户ID: 'ACCESS_DENIED' };
    }
    
    // 普通用户
    if (isUserCollection) return q;
    
    if (!ALLOWED_COLLECTIONS.includes(collection)) {
      for (const [, doveEntry] of extensionDBRegistry._registrations) {
        for (const [, ext] of doveEntry.extensions) {
          for (const dbConfig of Object.values(ext.databases)) {
            if (dbConfig.collections && collection in dbConfig.collections) {
              const collConfig = dbConfig.collections[collection];
              if (collConfig.scope === 'shared') {
                return q;
              }
              if (collConfig.scope === 'user_scoped') {
                const userField = collConfig.userField || 'user_id';
                if (!q || typeof q !== 'object') return { [userField]: userId };
                return { ...q, [userField]: userId };
              }
            }
          }
        }
      }
    }
    
    if (!q || typeof q !== 'object') return q;
    return { ...q, 用户ID: userId };
  };
}

/**
 * 获取扩展集合的注入策略
 */
export function getExtInsertPolicy(collection, doveId) {
  if (doveId) {
    const extCheck = extensionDBRegistry.isAllowed(doveId, collection, 'insertOne');
    if (extCheck.allowed && extCheck.policy) {
      return { isExtCollection: true, policy: extCheck.policy, userField: extCheck.userField };
    }
    const doveRegs = extensionDBRegistry.getDoveRegistrations(doveId);
    for (const ext of Object.values(doveRegs)) {
      for (const dbConfig of Object.values(ext.databases)) {
        if (dbConfig.collections && collection in dbConfig.collections) {
          return { isExtCollection: true, policy: dbConfig.collections[collection].scope, userField: dbConfig.collections[collection].userField };
        }
      }
    }
  }
  for (const [, doveEntry] of extensionDBRegistry._registrations) {
    for (const [, ext] of doveEntry.extensions) {
      for (const dbConfig of Object.values(ext.databases)) {
        if (dbConfig.collections && collection in dbConfig.collections) {
          return { isExtCollection: true, policy: dbConfig.collections[collection].scope, userField: dbConfig.collections[collection].userField };
        }
      }
    }
  }
  return { isExtCollection: false };
}
