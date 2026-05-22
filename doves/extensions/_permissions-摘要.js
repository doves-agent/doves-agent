/**
 * @file extensions/_permissions-摘要
 * @description 权限摘要生成函数 + 中文标签常量
 * 从 _permissions.js 拆分，供 CLI 和 Doves 侧共用
 */

/** 访问类型中文映射 */
export const URL_TYPE_LABELS = {
  connect: 'WebSocket连接',
  fetch: 'HTTP请求',
  iframe: '页面嵌入',
};

/** 操作类型中文映射 */
export const DB_ACTION_LABELS = {
  find: '查询', findOne: '单条查询', aggregate: '聚合',
  insertOne: '插入', insertMany: '批量插入',
  updateOne: '更新', updateMany: '批量更新',
  deleteOne: '删除', deleteMany: '批量删除',
  countDocuments: '计数', findOneAndUpdate: '查找并更新',
  findOneAndDelete: '查找并删除', index: '索引',
};

/** scope 中文映射 */
export const SCOPE_LABELS = {
  shared: '共享',
  user_scoped: '用户隔离',
  task_scoped: '任务隔离',
  extension: '扩展私有',
};

/**
 * 生成人类可读的权限摘要
 * 用于 `dove app info` / `dove app install` 的权限展示
 *
 * @param {Object} permissions - manifest.permissions
 * @returns {string} 格式化的权限摘要文本
 */
export function generatePermissionSummary(permissions) {
  if (!permissions || typeof permissions !== 'object') return '  （无权限声明）';

  const lines = [];

  // 数据库
  if (permissions.databases && Object.keys(permissions.databases).length > 0) {
    lines.push('  数据库:');
    for (const [dbName, dbConfig] of Object.entries(permissions.databases)) {
      if (!dbConfig.collections) continue;
      for (const [collName, collConfig] of Object.entries(dbConfig.collections)) {
        const scope = collConfig.scope || 'shared';
        const actions = (collConfig.actions || []).map(a => DB_ACTION_LABELS[a] || a).join('/');
        const scopeLabel = SCOPE_LABELS[scope] || scope;
        lines.push(`    · ${dbName}.${collName}: ${actions}(${scopeLabel})`);
      }
    }
  }

  // 存储
  if (permissions.storage && Object.keys(permissions.storage).length > 0) {
    lines.push('  存储:');
    for (const [storageType, typeConfig] of Object.entries(permissions.storage)) {
      const actions = (typeConfig.actions || []).join('/');
      const scope = typeConfig.scope ? `(${SCOPE_LABELS[typeConfig.scope] || typeConfig.scope})` : '';
      lines.push(`    · ${storageType}: ${actions}${scope}`);
    }
  }

  // API
  if (permissions.apis && Object.keys(permissions.apis).length > 0) {
    lines.push('  API:');
    for (const [pattern, perm] of Object.entries(permissions.apis)) {
      const permLabel = Array.isArray(perm) ? perm.join('/') : perm;
      lines.push(`    · ${pattern}: ${permLabel}`);
    }
  }

  // 事件
  if (permissions.events) {
    lines.push('  事件:');
    if (permissions.events.subscribe) {
      lines.push(`    · 订阅: ${permissions.events.subscribe.join(', ')}`);
    }
    if (permissions.events.publish) {
      lines.push(`    · 发布: ${permissions.events.publish.join(', ')}`);
    }
  }

  // 扩展间通信
  if (permissions.extensions && Object.keys(permissions.extensions).length > 0) {
    lines.push('  扩展间通信:');
    for (const [extName, perm] of Object.entries(permissions.extensions)) {
      lines.push(`    · ${extName}: ${perm}`);
    }
  }

  // 外部链接
  if (permissions.externalUrls && permissions.externalUrls.length > 0) {
    lines.push('  外部链接:');
    for (const entry of permissions.externalUrls) {
      const typeLabel = URL_TYPE_LABELS[entry.type] || entry.type;
      const desc = entry.description ? `(${entry.description})` : '';
      lines.push(`    · ${entry.url}: ${typeLabel}${desc}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : '  （无权限声明）';
}
