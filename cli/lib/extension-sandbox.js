/**
 * 扩展沙盒测试环境
 * 提供 Mock DoveAppContext 和沙盒工具测试函数
 * 让开发者在没有 Server 的情况下测试应用的工具和技能
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * 创建 Mock DoveAppContext（内存存储 + 假 proxy）
 * @param {string} extensionName - 扩展名
 * @param {Object} manifest - manifest 对象
 * @param {Map} storage - 内存存储 Map
 * @returns {Object} 模拟的 ctx
 */
export function createMockContext(extensionName, manifest, storage) {
  const db = (dbName) => ({
    collection: (collName) => {
      const key = `${dbName}.${collName}`;
      if (!storage.has(key)) storage.set(key, []);
      const data = storage.get(key);
      return {
        findOne: async (query) => data.find(item => matchQuery(item, query)) || null,
        find: async (query, options) => {
          const results = data.filter(item => matchQuery(item, query || {}));
          let cursor = results;
          if (options?.skip) cursor = cursor.slice(options.skip);
          if (options?.limit) cursor = cursor.slice(0, options.limit);
          return {
            toArray: async () => cursor,
            sort: () => ({ toArray: async () => cursor }),
            limit: (n) => ({ toArray: async () => cursor.slice(0, n) }),
          };
        },
        insertOne: async (doc) => {
          const newDoc = { ...doc, _id: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
          data.push(newDoc);
          return { insertedId: newDoc._id };
        },
        updateOne: async (query, update) => {
          const idx = data.findIndex(item => matchQuery(item, query));
          if (idx >= 0) {
            if (update.$set) Object.assign(data[idx], update.$set);
            if (update.$inc) {
              for (const [k, v] of Object.entries(update.$inc)) {
                data[idx][k] = (data[idx][k] || 0) + v;
              }
            }
          }
          return { matchedCount: idx >= 0 ? 1 : 0, modifiedCount: idx >= 0 ? 1 : 0 };
        },
        deleteOne: async (query) => {
          const idx = data.findIndex(item => matchQuery(item, query));
          if (idx >= 0) data.splice(idx, 1);
          return { deletedCount: idx >= 0 ? 1 : 0 };
        },
        countDocuments: async (query) => data.filter(item => matchQuery(item, query || {})).length,
        insertMany: async (docs) => {
          const inserted = docs.map(d => ({
            ...d,
            _id: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          }));
          data.push(...inserted);
          return { insertedCount: inserted.length };
        },
        aggregate: async () => ({ toArray: async () => data }),
        findOneAndUpdate: async (query, update) => {
          const idx = data.findIndex(item => matchQuery(item, query));
          if (idx >= 0) {
            if (update.$set) Object.assign(data[idx], update.$set);
            return data[idx];
          }
          return null;
        },
        createIndex: async () => ({ ok: 1, note: '沙盒模式索引跳过' }),
      };
    },
  });

  return {
    extensionName,
    db,
    storage: { getStatus: async () => ({ status: 'mock', message: '沙盒模式，未连接Git存储' }) },
    memory: {
      search: async () => ({ results: [], message: '沙盒模式，未连接Git记忆' }),
      write: async () => ({ success: true, message: '沙盒模拟写入' }),
    },
    oss: {
      signUrl: async () => ({ url: 'mock://sandbox' }),
      upload: async () => ({ success: true }),
      download: async () => ({ content: 'mock' }),
      list: async () => ({ items: [] }),
    },
    event: {
      subscribe: async () => console.log('[沙盒] 事件订阅（模拟）'),
      publish: async () => console.log('[沙盒] 事件发布（模拟）'),
    },
    config: { get: async () => ({}), getAll: async () => ({}) },
    task: { id: 'mock-task', userId: 'mock-user', doveId: 'mock-dove' },
    user: { id: 'mock-user' },
    logger: {
      info: (msg) => console.log(`  [INFO] ${msg}`),
      warn: (msg) => console.warn(`  [WARN] ${msg}`),
      error: (msg, err) => console.error(`  [ERROR] ${msg}`, err || ''),
    },
    authMode: 'dev',
    fetch: async (path, options) => {
      console.log(`  [MOCK fetch] ${options?.method || 'GET'} ${path}`);
      return { success: true, data: { message: '沙盒模拟响应' } };
    },
    updateRuntimeContext: () => {},
  };
}

function matchQuery(item, query) {
  if (!query || Object.keys(query).length === 0) return true;
  for (const [key, val] of Object.entries(query)) {
    if (typeof val === 'object' && val !== null) {
      if (val.$gt !== undefined && !(item[key] > val.$gt)) return false;
      if (val.$lt !== undefined && !(item[key] < val.$lt)) return false;
      if (val.$in && !val.$in.includes(item[key])) return false;
    } else {
      if (item[key] !== val) return false;
    }
  }
  return true;
}

/**
 * 在沙盒中测试指定工具
 * @param {string} 应用目录
 * @param {Object} manifest
 * @param {string} toolName
 * @param {string} argsJson - JSON 格式参数字符串
 * @param {Object} ctx - Mock DoveAppContext
 */
export async function testToolInSandbox(应用目录, manifest, toolName, argsJson, ctx) {
  if (!manifest.tools) {
    console.log('❌ 该应用未声明 tools');
    return;
  }

  const toolsDir = join(应用目录, manifest.tools.replace('./', ''));
  if (!existsSync(toolsDir)) {
    console.log(`❌ tools 目录不存在: ${toolsDir}`);
    return;
  }

  const toolFiles = readdirSync(toolsDir).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  let foundModule = null;
  let foundDef = null;

  for (const f of toolFiles) {
    const toolModule = await import(`file://${join(toolsDir, f)}`);
    const def = (toolModule.extTools || []).find(t => t.name === toolName);
    if (def) {
      foundModule = toolModule;
      foundDef = def;
      break;
    }
  }

  if (!foundModule) {
    console.log(`❌ 工具 "${toolName}" 未找到`);
    console.log('可用工具:');
    for (const f of toolFiles) {
      const m = await import(`file://${join(toolsDir, f)}`);
      for (const t of (m.extTools || [])) {
        console.log(`  - ${t.name}: ${t.description || ''}`);
      }
    }
    return;
  }

  let args = {};
  if (argsJson) {
    try {
      args = JSON.parse(argsJson);
    } catch {
      console.log('⚠️  参数 JSON 解析失败，使用空参数');
    }
  }

  console.log('');
  console.log(`🔧 测试工具: ${toolName}`);
  console.log(`   参数: ${JSON.stringify(args)}`);
  console.log('');

  try {
    const startTime = Date.now();
    let result;

    if (typeof foundModule.handleExtTool === 'function') {
      result = await foundModule.handleExtTool(toolName, args, ctx);
    } else if (typeof foundModule[toolName] === 'function') {
      result = await foundModule[toolName](args, ctx);
    } else {
      console.log(`❌ 工具 "${toolName}" 缺少处理函数（需要 handleExtTool 或同名导出函数）`);
      return;
    }

    const elapsed = Date.now() - startTime;
    console.log(`✅ 执行成功 (${elapsed}ms)`);
    console.log('   结果:');
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.log(`❌ 执行失败: ${e.message}`);
    if (e.stack) {
      console.log('');
      console.log('堆栈:');
      console.log(e.stack.split('\n').slice(0, 5).join('\n'));
    }
  }
}
