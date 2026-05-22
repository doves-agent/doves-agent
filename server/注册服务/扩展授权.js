/**
 * 扩展授权服务
 * 职责：扩展包的用户授权记录管理
 * 
 * === 核心概念 ===
 * - 官方扩展：签名验证通过 = 已授权（OFFICIAL_DEV_SIGNING_KEY 即超管授权凭证，无需扩展授权记录）
 * - 第三方扩展：已授权 = 扩展授权集合中有记录（用户明确同意）
 * - 已授权扩展：生效权限 = 授权快照 与 当前声明 的交集
 *   - 声明超出授权快照的部分不生效（降级为开发模式行为）
 * - 未授权扩展：开发模式，仅允许 user_scoped 访问（用户自己的数据）
 * - 鸽子加载扩展时，用饲养员ID(=注册鸽子的用户ID)检查授权
 * 
 * === 运行模式 ===
 * | 状态 | 数据库scope | 说明 |
 * |------|------------|------|
 * | 官方+签名验证通过 | 全部scope | 上线模式 |
 * | 已授权(快照一致) | 全部scope | 上线模式 |
 * | 已授权(快照超出) | 快照内scope | 部分上线，超出部分降级 |
 * | 未授权 | 仅user_scoped | 开发模式 |
 * 
 * 从接口底座 Phase 3 拆分，遵循KISS原则
 */

import { getAdminDb, createTimestampFields } from '../db.js';
import { logger } from '../core.js';

// ==================== 常量 ====================

/** 官方开发者ID，用于展示层面标识（如应用商店标签、OSS路径分类），不用于授权绕过 */
const OFFICIAL_DEVELOPER_IDS = ['dev_official'];

// ==================== 核心服务 ====================

/**
 * 检查扩展是否为官方扩展（仅用于展示标识，不影响授权逻辑）
 * @param {string} devId - 开发者ID
 * @returns {boolean}
 */
export function isOfficialExtension(devId) {
  return OFFICIAL_DEVELOPER_IDS.includes(devId);
}

/**
 * 授权扩展
 * 记录用户对扩展包的授权，包含权限快照
 * 
 * @param {Object} params
 * @param {string} params.userId - 用户ID
 * @param {string} params.extensionName - 扩展包名称
 * @param {string} [params.devId] - 开发者ID（可选）
 * @param {Object} params.permissions - 权限快照
 * @param {boolean} [params.developerVerified] - 开发者是否验证通过
 * @returns {Promise<{成功: boolean, 授权?: Object, 错误?: string}>}
 */
export async function 授权扩展({ userId, extensionName, devId, permissions, developerVerified }) {
  const adminDb = getAdminDb();
  const ts = createTimestampFields();

  if (!userId || !extensionName) {
    return { 成功: false, 错误: 'userId 和 extensionName 必填' };
  }

  try {
    // 先撤销旧的授权记录（同用户同扩展只保留一条 已授权）
    await adminDb.collection('扩展授权').updateMany(
      { userId, extensionName, 状态: '已授权' },
      { $set: { 状态: '已撤销', revokedAt: ts.localTime } }
    );

    const record = {
      userId,
      extensionName,
      devId: devId || null,
      permissions: permissions || {},
      developerVerified: developerVerified || false,
      状态: '已授权',
      authorizedAt: ts.localTime,
      authorizedAtTimestamp: ts.timestamp,
      revokedAt: null,
    };

    await adminDb.collection('扩展授权').insertOne(record);

    logger.info(`扩展授权成功: 用户 ${userId} 授权扩展 ${extensionName}${devId ? ` (开发者: ${devId})` : ''}`);

    return {
      成功: true,
      授权: {
        userId,
        extensionName,
        devId: record.devId,
        状态: record.状态,
        authorizedAt: ts.localTime,
      },
    };
  } catch (错误) {
    logger.error(`授权扩展失败: ${错误.message}`);
    return { 成功: false, 错误: 错误.message };
  }
}

/**
 * 撤销授权
 * 
 * @param {string} userId - 用户ID
 * @param {string} extensionName - 扩展包名称
 * @returns {Promise<{成功: boolean, 错误?: string}>}
 */
export async function 撤销授权(userId, extensionName) {
  const adminDb = getAdminDb();
  const ts = createTimestampFields();

  try {
    const result = await adminDb.collection('扩展授权').updateMany(
      { userId, extensionName, 状态: '已授权' },
      { $set: { 状态: '已撤销', revokedAt: ts.localTime } }
    );

    if (result.modifiedCount === 0) {
      return { 成功: false, 错误: `扩展 "${extensionName}" 未被授权` };
    }

    logger.info(`授权已撤销: 用户 ${userId} 撤销扩展 ${extensionName}`);
    return { 成功: true };
  } catch (错误) {
    logger.error(`撤销授权失败: ${错误.message}`);
    return { 成功: false, 错误: 错误.message };
  }
}

/**
 * 检查授权
 * 返回用户是否已授权某个扩展
 * 
 * @param {string} userId - 用户ID
 * @param {string} extensionName - 扩展包名称
 * @returns {Promise<{authorized: boolean, record?: Object}>}
 */
export async function 检查授权(userId, extensionName) {
  const adminDb = getAdminDb();

  try {
    const record = await adminDb.collection('扩展授权').findOne(
      { userId, extensionName, 状态: '已授权' }
    );

    if (!record) {
      return { authorized: false };
    }

    return {
      authorized: true,
      record: {
        userId: record.userId,
        extensionName: record.extensionName,
        devId: record.devId,
        permissions: record.permissions,
        developerVerified: record.developerVerified,
        authorizedAt: record.authorizedAt,
      },
    };
  } catch (错误) {
    logger.error(`检查授权失败: ${错误.message}`);
    return { 已授权: false };
  }
}

/**
 * 列出用户所有授权
 * 
 * @param {string} userId - 用户ID
 * @returns {Promise<{成功: boolean, 授权列表?: Object[]}>}
 */
export async function 列出用户授权(userId) {
  const adminDb = getAdminDb();

  try {
    const records = await adminDb.collection('扩展授权')
      .find({ userId, 状态: '已授权' })
      .sort({ authorizedAt: -1 })
      .toArray();

    return {
      成功: true,
      授权列表: records.map(r => ({
        extensionName: r.extensionName,
        devId: r.devId,
        developerVerified: r.developerVerified,
        permissions: r.permissions,
        authorizedAt: r.authorizedAt,
      })),
    };
  } catch (错误) {
    logger.error(`列出用户授权失败: ${错误.message}`);
    return { 成功: false, 授权列表: [] };
  }
}

/**
 * 检查权限变更
 * 对比当前权限与授权时的权限快照
 * 
 * @param {string} userId - 用户ID
 * @param {string} extensionName - 扩展包名称
 * @param {Object} newPermissions - 当前权限声明
 * @returns {Promise<{changed: boolean, details?: Object}>}
 */
export async function 检查权限变更(userId, extensionName, newPermissions) {
  const adminDb = getAdminDb();

  try {
    const record = await adminDb.collection('扩展授权').findOne(
      { userId, extensionName, 状态: '已授权' }
    );

    if (!record) {
      return { changed: false, details: { reason: '未找到授权记录' } };
    }

    const oldPermissions = record.permissions;
    const diff = computePermissionsDiff(oldPermissions, newPermissions);

    return {
      changed: diff.hasChanges,
      details: diff,
    };
  } catch (错误) {
    logger.error(`检查权限变更失败: ${错误.message}`);
    return { changed: false };
  }
}

/**
 * 计算扩展的生效权限
 *
 * 授权规则：
 * - 官方扩展 + 签名验证通过 → production（OFFICIAL_DEV_SIGNING_KEY 即超管授权凭证，无需扩展授权记录）
 * - 已授权且快照一致 → production（授权快照与当前声明的交集）
 * - 已授权但声明超出快照 → 交集（超出部分降级）
 * - 未授权 → 仅 user_scoped
 *
 * @param {Object} params
 * @param {string} params.userId - 用户ID
 * @param {string} params.extensionName - 扩展包名称
 * @param {string} [params.devId] - 开发者ID
 * @param {Object} params.declaredPermissions - manifest 声明的权限
 * @param {boolean} [params.signatureVerified=false] - 签名是否验证通过
 * @returns {Promise<{mode: string, effectivePermissions: Object, warnings: string[]}>}
 */
export async function 计算生效权限({ userId, extensionName, devId, declaredPermissions, signatureVerified = false }) {
  const warnings = [];

  // 官方扩展 + 签名验证通过 → 直接 production
  // OFFICIAL_DEV_SIGNING_KEY 配置在 .env 并同步到数据库，这本身就是超管授权
  // 签名验证在步骤 0.5 已完成，此处信任验签结果
  if (isOfficialExtension(devId) && signatureVerified) {
    return {
      mode: 'production',
      effectivePermissions: declaredPermissions,
      warnings,
    };
  }

  // 检查授权（第三方扩展走此流程）
  const authResult = await 检查授权(userId, extensionName);

  // 未授权：拒绝加载
  if (!authResult.authorized) {
    return {
      mode: 'rejected',
      effectivePermissions: {},
      warnings: ['扩展未授权，拒绝加载'],
    };
  }

  // 已授权：取授权快照与声明声明的交集
  const snapshotPerms = authResult.record.permissions;
  const { effective, exceeded } = computeEffectivePermissions(snapshotPerms, declaredPermissions);

  if (exceeded.length > 0) {
    warnings.push(`权限声明超出授权快照，超出部分已降级: ${exceeded.join(', ')}`);
  }

  return {
    mode: 'production',
    effectivePermissions: effective,
    warnings,
  };
}

// ==================== 内部工具 ====================

/**
 * 过滤出仅 user_scoped 的权限（开发模式用）
 * 未授权扩展只能访问 user_scoped 的集合
 */
function filterUserScopedOnly(permissions) {
  if (!permissions) return {};

  const result = {};

  // databases: 只保留 user_scoped 的集合
  if (permissions.databases) {
    const filteredDbs = {};
    for (const [dbName, dbConfig] of Object.entries(permissions.databases)) {
      if (!dbConfig.collections) continue;
      const filteredColls = {};
      for (const [collName, collConfig] of Object.entries(dbConfig.collections)) {
        if (collConfig.scope === 'user_scoped') {
          filteredColls[collName] = collConfig;
        }
      }
      if (Object.keys(filteredColls).length > 0) {
        filteredDbs[dbName] = { ...dbConfig, collections: filteredColls };
      }
    }
    if (Object.keys(filteredDbs).length > 0) {
      result.databases = filteredDbs;
    }
  }

  // storage/apis/events：开发模式下不开放
  // （只有数据库的 user_scoped 数据可访问）

  // externalUrls：开发模式下不开放外部链接
  // （外部链接是扩展 Web 页面的出站连接，未授权扩展无权访问）

  return result;
}

/**
 * 计算生效权限 = 授权快照 与 当前声明 的交集
 * 声明超出快照的部分记为 exceeded
 */
function computeEffectivePermissions(snapshotPerms, declaredPerms) {
  const effective = {};
  const exceeded = [];

  // databases
  if (declaredPerms.databases) {
    const effDbs = {};
    for (const [dbName, dbConfig] of Object.entries(declaredPerms.databases)) {
      const snapDb = snapshotPerms.databases?.[dbName];
      if (!snapDb) {
        exceeded.push(`db:${dbName}`);
        continue;
      }
      const effColls = {};
      for (const [collName, collConfig] of Object.entries(dbConfig.collections || {})) {
        const snapColl = snapDb.collections?.[collName];
        if (!snapColl) {
          exceeded.push(`db:${dbName}.${collName}`);
          continue;
        }
        // actions 取交集
        const effActions = collConfig.actions?.filter(a => snapColl.actions?.includes(a)) || [];
        if (effActions.length === 0) {
          exceeded.push(`db:${dbName}.${collName}.actions`);
          continue;
        }
        // scope 以快照为准
        effColls[collName] = {
          ...collConfig,
          actions: effActions,
          scope: snapColl.scope || collConfig.scope,
          userField: snapColl.userField || collConfig.userField,
        };
      }
      if (Object.keys(effColls).length > 0) {
        effDbs[dbName] = { ...dbConfig, collections: effColls };
      }
    }
    if (Object.keys(effDbs).length > 0) {
      effective.databases = effDbs;
    }
  }

  // storage
  if (declaredPerms.storage) {
    const effStorage = {};
    for (const [type, typeConfig] of Object.entries(declaredPerms.storage)) {
      const snapType = snapshotPerms.storage?.[type];
      if (!snapType) {
        exceeded.push(`storage:${type}`);
        continue;
      }
      const effActions = typeConfig.actions?.filter(a => snapType.actions?.includes(a)) || [];
      if (effActions.length === 0) {
        exceeded.push(`storage:${type}.actions`);
        continue;
      }
      effStorage[type] = { ...typeConfig, actions: effActions };
    }
    if (Object.keys(effStorage).length > 0) {
      effective.storage = effStorage;
    }
  }

  // apis
  if (declaredPerms.apis) {
    const effApis = {};
    for (const [pattern, perm] of Object.entries(declaredPerms.apis)) {
      const snapPerm = snapshotPerms.apis?.[pattern];
      if (snapPerm === undefined) {
        exceeded.push(`api:${pattern}`);
        continue;
      }
      // 取最小权限
      effApis[pattern] = intersectApiPerm(snapPerm, perm);
    }
    if (Object.keys(effApis).length > 0) {
      effective.apis = effApis;
    }
  }

  // events
  if (declaredPerms.events) {
    effective.events = declaredPerms.events; // 事件权限较轻，直接放行
  }

  // extensions
  if (declaredPerms.extensions) {
    effective.extensions = declaredPerms.extensions; // 扩展间通信较轻，直接放行
  }

  // externalUrls：取声明与快照的交集
  if (declaredPerms.externalUrls && Array.isArray(declaredPerms.externalUrls)) {
    const snapUrls = snapshotPerms.externalUrls || [];
    const effUrls = [];
    for (const declared of declaredPerms.externalUrls) {
      // 检查快照中是否有相同 url+type 的条目
      const inSnapshot = snapUrls.some(s => s.url === declared.url && s.type === declared.type);
      if (inSnapshot) {
        effUrls.push(declared);
      } else {
        exceeded.push(`externalUrl:${declared.url}(${declared.type})`);
      }
    }
    if (effUrls.length > 0) {
      effective.externalUrls = effUrls;
    }
  }

  return { effective, exceeded };
}

/**
 * API 权限取交集
 */
function intersectApiPerm(snapPerm, declaredPerm) {
  const snap = Array.isArray(snapPerm) ? snapPerm : [snapPerm];
  const declared = Array.isArray(declaredPerm) ? declaredPerm : [declaredPerm];
  const intersection = declared.filter(p => snap.includes(p));
  if (intersection.length === 0) return snap[0]; // fallback
  if (intersection.length === 1) return intersection[0];
  return intersection;
}

/**
 * 计算两个权限声明之间的差异
 * 
 * @param {Object} oldPerms - 旧权限
 * @param {Object} newPerms - 新权限
 * @returns {{ hasChanges: boolean, added: Object, removed: Object }}
 */
function computePermissionsDiff(oldPerms, newPerms) {
  const added = {};
  const removed = {};

  // 对比 databases
  const dbDiff = diffSection(oldPerms.databases, newPerms.databases, 'databases');
  if (dbDiff.hasChanges) {
    added.databases = dbDiff.added;
    removed.databases = dbDiff.removed;
  }

  // 对比 storage
  const storageDiff = diffSection(oldPerms.storage, newPerms.storage, 'storage');
  if (storageDiff.hasChanges) {
    added.storage = storageDiff.added;
    removed.storage = storageDiff.removed;
  }

  // 对比 apis
  const apiDiff = diffSection(oldPerms.apis, newPerms.apis, 'apis');
  if (apiDiff.hasChanges) {
    added.apis = apiDiff.added;
    removed.apis = apiDiff.removed;
  }

  // 对比 events
  const eventDiff = diffSection(oldPerms.events, newPerms.events, 'events');
  if (eventDiff.hasChanges) {
    added.events = eventDiff.added;
    removed.events = eventDiff.removed;
  }

  // 对比 externalUrls（数组对比）
  const urlDiff = diffExternalUrls(oldPerms.externalUrls, newPerms.externalUrls);
  if (urlDiff.hasChanges) {
    if (urlDiff.added.length > 0) added.externalUrls = urlDiff.added;
    if (urlDiff.removed.length > 0) removed.externalUrls = urlDiff.removed;
  }

  const hasChanges = Object.keys(added).length > 0 || Object.keys(removed).length > 0;
  return { hasChanges, added, removed };
}

/**
 * 对比 externalUrls 数组的差异
 * 以 url+type 作为唯一标识
 */
function diffExternalUrls(oldUrls, newUrls) {
  const added = [];
  const removed = [];

  const oldList = Array.isArray(oldUrls) ? oldUrls : [];
  const newList = Array.isArray(newUrls) ? newUrls : [];

  const toKey = (e) => `${e.url}|${e.type}`;
  const oldKeys = new Set(oldList.map(toKey));
  const newKeys = new Set(newList.map(toKey));

  for (const entry of newList) {
    if (!oldKeys.has(toKey(entry))) added.push(entry);
  }
  for (const entry of oldList) {
    if (!newKeys.has(toKey(entry))) removed.push(entry);
  }

  return { hasChanges: added.length > 0 || removed.length > 0, added, removed };
}

/**
 * 对比单个 section 的差异
 */
function diffSection(oldSection, newSection, sectionName) {
  const added = {};
  const removed = {};

  if (!oldSection && !newSection) return { hasChanges: false, added, removed };

  // 新增的
  if (newSection) {
    for (const key of Object.keys(newSection)) {
      if (!oldSection || !oldSection[key]) {
        added[key] = newSection[key];
      } else if (JSON.stringify(oldSection[key]) !== JSON.stringify(newSection[key])) {
        // 值变了（如 actions 增加/减少）
        added[key] = newSection[key];
        removed[key] = oldSection[key];
      }
    }
  }

  // 删除的
  if (oldSection) {
    for (const key of Object.keys(oldSection)) {
      if (!newSection || !newSection[key]) {
        removed[key] = oldSection[key];
      }
    }
  }

  const hasChanges = Object.keys(added).length > 0 || Object.keys(removed).length > 0;
  return { hasChanges, added, removed };
}
