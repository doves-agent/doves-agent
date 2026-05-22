/**
 * MongoDB 操作处理函数
 * 从 MongoDB工具.js 拆分出的具体操作实现
 */

// 缓存代理实例（与主文件共享，通过参数传入）
// let _proxy, _mongoAdapter, _currentDbName — 这些由主文件管理

/**
 * 受系统保护的敏感集合黑名单
 * 禁止通过 mongo_agent 工具直接访问，防止密钥泄露/权限越界
 */
const BLOCKED_COLLECTIONS = [
  'API密钥',  // 存储 API Key，绝对禁止
  '日志',     // 系统日志，只写不可读
  '事件',     // 鸽子事件队列
];

/**
 * 检查集合访问权限
 * @param {string} collectionName - 集合名称
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkCollectionAccess(collectionName) {
  if (BLOCKED_COLLECTIONS.includes(collectionName)) {
    return { allowed: false, reason: `集合 "${collectionName}" 受系统保护，禁止通过 mongo_agent 访问` };
  }
  return { allowed: true };
}

/**
 * 集合访问拦截：不合法时返回错误结果
 * @param {string} collectionName
 * @returns {Object|null} 错误结果对象，null 表示允许访问
 */
function blockIfRestricted(collectionName) {
  if (!collectionName) return null;
  const { allowed, reason } = checkCollectionAccess(collectionName);
  if (!allowed) {
    return { isError: true, content: [{ type: 'text', text: `访问被拒绝: ${reason}` }] };
  }
  return null;
}

/**
 * 通过真实 MongoDB 适配器执行
 * @param {string} toolName - 工具名
 * @param {Object} args - 工具参数
 * @param {Object} mongo - MongoDB适配器实例
 * @param {Object} _proxy - 代理实例
 * @param {Object} _mongoAdapter - MongoDB适配器引用（用于获取数据库名）
 */
export async function executeWithMongo(toolName, args, mongo, _proxy, _mongoAdapter) {
  const { collection, ...rest } = args;

  const text = (content) => ({
    content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }],
  });

  switch (toolName) {
    // 连接管理
    case 'mongo_connect': {
      const { action, connectionString, dbName } = args;
      if (action === 'status') {
        const db = _proxy.db(_mongoAdapter.数据库名);
        try {
          const stats = await db.stats();
          const cols = await db.listCollections().toArray();
          // 过滤掉受保护集合
          const safeCols = cols.filter(c => !BLOCKED_COLLECTIONS.includes(c.name));
          return text({
            connected: true,
            dbName: _mongoAdapter.数据库名,
            collectionsCount: safeCols.length,
            collections: safeCols.map(c => c.name),
            dataSize: stats.dataSize,
            storageSize: stats.storageSize,
          });
        } catch (e) {
          return text({ connected: false, error: e.message });
        }
      }
      if (action === 'config') {
        if (connectionString && dbName) {
          // 重新初始化连接（使用局部变量，禁止修改 process.env）
          return { action: 'reconnect', connectionString, dbName };
        }
        return text({ success: false, message: '配置连接需要提供 connectionString 和 dbName' });
      }
      if (action === 'test') {
        try {
          const db = _proxy.db(_mongoAdapter.数据库名);
          await db.command({ ping: 1 });
          return text({ success: true, message: 'MongoDB 连接测试成功' });
        } catch (e) {
          return { isError: true, content: [{ type: 'text', text: `连接测试失败: ${e.message}` }] };
        }
      }
      return text({ success: false, message: `未知操作: ${action}` });
    }

    // 集合管理
    case 'mongo_list_collections': {
      const db = _proxy.db(_mongoAdapter.数据库名);
      const cols = await db.listCollections().toArray();
      let result = cols.map(c => ({ name: c.name, type: c.type }));
      // 过滤掉受保护集合（不暴露敏感集合名）
      result = result.filter(c => !BLOCKED_COLLECTIONS.includes(c.name));
      if (args.filter) {
        const re = new RegExp(args.filter, 'i');
        result = result.filter(c => re.test(c.name));
      }
      if (args.detailed) {
        for (const col of result) {
          try {
            const stats = await db.collection(col.name).stats();
            col.documentCount = stats.count;
            col.storageSize = stats.storageSize;
          } catch { /* 忽略无权限的集合 */ }
        }
      }
      return text({ collections: result, total: result.length });
    }

    case 'mongo_collection_stats': {
      if (!collection) return { isError: true, content: [{ type: 'text', text: '请指定 collection 参数' }] };
      const blocked = blockIfRestricted(collection);
      if (blocked) return blocked;
      const db = _proxy.db(_mongoAdapter.数据库名);
      const stats = await db.collection(collection).stats();
      return text({
        collection,
        documentCount: stats.count,
        storageSize: stats.storageSize,
        indexes: stats.nindexes,
        avgDocumentSize: stats.avgObjSize,
      });
    }

    // 查询
    case 'mongo_find': {
      if (!collection) return { isError: true, content: [{ type: 'text', text: '请指定 collection 参数' }] };
      const blocked = blockIfRestricted(collection);
      if (blocked) return blocked;
      const { query = {}, options = {}, explain } = args;
      const db = _proxy.db(_mongoAdapter.数据库名);
      const coll = db.collection(collection);

      if (explain) {
        const plan = await coll.find(query).explain();
        return text({ explain: plan });
      }

      let cursor = coll.find(query);
      if (options.sort) cursor = cursor.sort(options.sort);
      if (options.skip) cursor = cursor.skip(options.skip);
      if (options.limit) cursor = cursor.limit(options.limit);
      if (options.projection) cursor = cursor.project(options.projection);

      const data = await cursor.toArray();
      return text({ data, total: data.length });
    }

    case 'mongo_find_one': {
      if (!collection) return { isError: true, content: [{ type: 'text', text: '请指定 collection 参数' }] };
      const blocked = blockIfRestricted(collection);
      if (blocked) return blocked;
      const { query = {}, options = {} } = args;
      const db = _proxy.db(_mongoAdapter.数据库名);
      const result = await db.collection(collection).findOne(query, options);
      return text({ data: result });
    }

    case 'mongo_count_documents': {
      if (!collection) return { isError: true, content: [{ type: 'text', text: '请指定 collection 参数' }] };
      const blocked = blockIfRestricted(collection);
      if (blocked) return blocked;
      const { query = {} } = args;
      const db = _proxy.db(_mongoAdapter.数据库名);
      const count = await db.collection(collection).countDocuments(query);
      return text({ collection, count, query });
    }

    case 'mongo_distinct': {
      if (!collection || !args.field) return { isError: true, content: [{ type: 'text', text: '请指定 collection 和 field 参数' }] };
      const blocked = blockIfRestricted(collection);
      if (blocked) return blocked;
      const { field, query = {} } = args;
      const db = _proxy.db(_mongoAdapter.数据库名);
      const values = await db.collection(collection).distinct(field, query);
      return text({ collection, field, values, total: values.length });
    }

    // 聚合
    case 'mongo_aggregate': {
      if (!collection || !args.pipeline) return { isError: true, content: [{ type: 'text', text: '请指定 collection 和 pipeline 参数' }] };
      const blocked = blockIfRestricted(collection);
      if (blocked) return blocked;
      const { pipeline, explain } = args;
      const db = _proxy.db(_mongoAdapter.数据库名);
      const coll = db.collection(collection);

      if (explain) {
        const plan = await coll.aggregate(pipeline).explain();
        return text({ explain: plan });
      }

      const results = await coll.aggregate(pipeline).toArray();
      return text({ results, total: results.length });
    }

    // 写入
    case 'mongo_insert_one': {
      if (!collection || !args.document) return { isError: true, content: [{ type: 'text', text: '请指定 collection 和 document 参数' }] };
      const blocked = blockIfRestricted(collection);
      if (blocked) return blocked;
      const { document } = args;
      const db = _proxy.db(_mongoAdapter.数据库名);
      const result = await db.collection(collection).insertOne(document);
      return text({ success: true, insertedId: result.insertedId, acknowledged: result.acknowledged });
    }

    case 'mongo_insert_many': {
      if (!collection || !args.documents) return { isError: true, content: [{ type: 'text', text: '请指定 collection 和 documents 参数' }] };
      const blocked = blockIfRestricted(collection);
      if (blocked) return blocked;
      const { documents, ordered = true } = args;
      const db = _proxy.db(_mongoAdapter.数据库名);
      const result = await db.collection(collection).insertMany(documents, { ordered });
      return text({ success: true, insertedCount: result.insertedCount, insertedIds: result.insertedIds });
    }

    case 'mongo_update_one': {
      if (!collection || !args.query || !args.update) return { isError: true, content: [{ type: 'text', text: '请指定 collection, query 和 update 参数' }] };
      const blocked = blockIfRestricted(collection);
      if (blocked) return blocked;
      const { query, update, upsert = false } = args;
      const db = _proxy.db(_mongoAdapter.数据库名);
      const result = await db.collection(collection).updateOne(query, update, { upsert });
      return text({
        success: true,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedId: result.upsertedId,
      });
    }

    case 'mongo_update_many': {
      if (!collection || !args.query || !args.update) return { isError: true, content: [{ type: 'text', text: '请指定 collection, query 和 update 参数' }] };
      const blocked = blockIfRestricted(collection);
      if (blocked) return blocked;
      const { query, update } = args;
      const db = _proxy.db(_mongoAdapter.数据库名);
      const result = await db.collection(collection).updateMany(query, update);
      return text({ success: true, matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
    }

    // 替换
    case 'mongo_replace_one': {
      if (!collection || !args.query || !args.replacement) return { isError: true, content: [{ type: 'text', text: '请指定 collection, query 和 replacement 参数' }] };
      const blocked = blockIfRestricted(collection);
      if (blocked) return blocked;
      const { query, replacement, upsert = false } = args;
      const db = _proxy.db(_mongoAdapter.数据库名);
      const result = await db.collection(collection).replaceOne(query, replacement, { upsert });
      return text({
        success: true,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedId: result.upsertedId,
      });
    }

    // 删除
    case 'mongo_delete_one': {
      if (!collection || !args.query) return { isError: true, content: [{ type: 'text', text: '请指定 collection 和 query 参数' }] };
      const blocked = blockIfRestricted(collection);
      if (blocked) return blocked;
      const { query } = args;
      const db = _proxy.db(_mongoAdapter.数据库名);
      const result = await db.collection(collection).deleteOne(query);
      return text({ success: true, deletedCount: result.deletedCount });
    }

    case 'mongo_delete_many': {
      if (!collection || !args.query) return { isError: true, content: [{ type: 'text', text: '请指定 collection 和 query 参数' }] };
      const blocked = blockIfRestricted(collection);
      if (blocked) return blocked;
      const { query } = args;
      const db = _proxy.db(_mongoAdapter.数据库名);
      const result = await db.collection(collection).deleteMany(query);
      return text({ success: true, deletedCount: result.deletedCount });
    }

    // 导入
    case 'mongo_import': {
      if (!collection) return { isError: true, content: [{ type: 'text', text: '请指定 collection 参数' }] };
      const blocked = blockIfRestricted(collection);
      if (blocked) return blocked;
      const { data, filePath, format = 'json', ordered = false } = args;

      let documents = data;

      // 如果没提供内联数据，尝试从文件读取
      if (!documents && filePath) {
        try {
          const fs = await import('fs/promises');
          const content = await fs.readFile(filePath, 'utf-8');
          if (format === 'json') {
            const parsed = JSON.parse(content);
            documents = Array.isArray(parsed) ? parsed : [parsed];
          } else {
            // CSV简易解析：首行为表头，后续为数据
            const lines = content.trim().split('\n');
            if (lines.length < 2) return { isError: true, content: [{ type: 'text', text: 'CSV文件为空或只有表头' }] };
            const headers = lines[0].split(',').map(h => h.trim());
            documents = [];
            for (let i = 1; i < lines.length; i++) {
              const vals = lines[i].split(',');
              const doc = {};
              headers.forEach((h, idx) => { doc[h] = (vals[idx] || '').trim(); });
              documents.push(doc);
            }
          }
        } catch (err) {
          return { isError: true, content: [{ type: 'text', text: `读取文件失败: ${err.message}` }] };
        }
      }

      if (!documents || documents.length === 0) {
        return { isError: true, content: [{ type: 'text', text: '没有可导入的数据，请提供 data 或 filePath 参数' }] };
      }

      const db = _proxy.db(_mongoAdapter.数据库名);
      const result = await db.collection(collection).insertMany(documents, { ordered });
      return text({
        success: true,
        collection,
        importedCount: result.insertedCount,
        insertedIds: result.insertedIds,
      });
    }

    // 导出
    case 'mongo_export': {
      if (!collection) return { isError: true, content: [{ type: 'text', text: '请指定 collection 参数' }] };
      const blocked = blockIfRestricted(collection);
      if (blocked) return blocked;
      const { filePath, format = 'json', query = {}, projection, sort, limit = 1000 } = args;
      const db = _proxy.db(_mongoAdapter.数据库名);
      let cursor = db.collection(collection).find(query);
      if (sort) cursor = cursor.sort(sort);
      if (limit) cursor = cursor.limit(limit);
      if (projection) cursor = cursor.project(projection);

      const data = await cursor.toArray();

      // 如果指定了文件路径，写入文件
      if (filePath) {
        try {
          const fs = await import('fs/promises');
          const path = await import('path');
          const content = format === 'csv'
            ? convertToCsv(data)
            : JSON.stringify(data, null, 2);
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, content, 'utf-8');
          const stat = await fs.stat(filePath);
          return text({ success: true, collection, exportedCount: data.length, filePath, fileSize: `${(stat.size / 1024).toFixed(1)} KB` });
        } catch (err) {
          return { isError: true, content: [{ type: 'text', text: `写入文件失败: ${err.message}` }] };
        }
      }

      // 不写文件则直接返回数据
      return text({ success: true, collection, exportedCount: data.length, data });
    }

    // 索引管理
    case 'mongo_list_indexes': {
      if (!collection) return { isError: true, content: [{ type: 'text', text: '请指定 collection 参数' }] };
      const blocked = blockIfRestricted(collection);
      if (blocked) return blocked;
      const db = _proxy.db(_mongoAdapter.数据库名);
      const indexes = await db.collection(collection).listIndexes().toArray();
      return text({ collection, indexes });
    }

    case 'mongo_create_index': {
      if (!collection || !args.keys) return { isError: true, content: [{ type: 'text', text: '请指定 collection 和 keys 参数' }] };
      const blocked = blockIfRestricted(collection);
      if (blocked) return blocked;
      const { keys, options = {} } = args;
      const db = _proxy.db(_mongoAdapter.数据库名);
      const indexOptions = { ...options };
      if (indexOptions.background !== undefined) {
        indexOptions.background = indexOptions.background;
      }
      const result = await db.collection(collection).createIndex(keys, indexOptions);
      return text({ success: true, indexName: result, collection });
    }

    case 'mongo_drop_index': {
      if (!collection || !args.indexName) return { isError: true, content: [{ type: 'text', text: '请指定 collection 和 indexName 参数' }] };
      const blocked = blockIfRestricted(collection);
      if (blocked) return blocked;
      const { indexName } = args;
      const db = _proxy.db(_mongoAdapter.数据库名);
      await db.collection(collection).dropIndex(indexName);
      return text({ success: true, collection, droppedIndex: indexName });
    }

    default:
      return { isError: true, content: [{ type: 'text', text: `未知的 MongoDB 工具: ${toolName}` }] };
  }
}

/**
 * 将文档数组转为 CSV 字符串
 */
function convertToCsv(data) {
  if (!data || data.length === 0) return '';
  const allKeys = new Set();
  data.forEach(doc => Object.keys(doc).forEach(k => allKeys.add(k)));
  const headers = [...allKeys];
  const lines = [headers.join(',')];
  for (const doc of data) {
    const vals = headers.map(h => {
      const v = doc[h];
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    });
    lines.push(vals.join(','));
  }
  return lines.join('\n');
}
