/**
 * MongoDB数据库工具
 * 通过自然语言操作MongoDB：查询/聚合/索引/导入/导出/集合管理
 * 底层复用 存储接口.js MongoDB适配器
 *
 * 工具安全级别规范：
 *   safe     - 只读操作，无副作用
 *   caution  - 写入操作，需注意
 *   dangerous- 高风险操作，需用户确认
 *
 * === 拆分说明 ===
 * MongoDB工具.js — extTools 定义 + handleExtTool 入口 + 连接管理 + 安全级别导出
 * MongoDB工具/操作处理.js — 各具体操作的实现函数(executeWithMongo)
 */

// ==================== 工具定义 ====================

export const extTools = [
  // ---------- 连接管理 ----------
  {
    name: 'mongo_connect',
    description: '配置或验证MongoDB数据库连接',
    toolRiskLevel: '安全',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'config', 'test'], description: '操作类型：status=查看连接状态，config=配置新连接，test=测试连接' },
        connectionString: { type: 'string', description: 'MongoDB连接字符串（action=config时必填）' },
        dbName: { type: 'string', description: '数据库名称（action=config时必填）' },
      },
      required: ['action'],
    },
  },
  // ---------- 集合管理 ----------
  {
    name: 'mongo_list_collections',
    description: '列出当前数据库的所有集合',
    toolRiskLevel: '安全',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: '按名称筛选集合（支持正则，可选）' },
        detailed: { type: 'boolean', description: '是否显示详细信息（文档数/存储大小）', default: false },
      },
    },
  },
  {
    name: 'mongo_collection_stats',
    description: '获取集合的统计信息：文档数、存储大小、索引数',
    toolRiskLevel: '安全',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称' },
      },
      required: ['collection'],
    },
  },
  // ---------- 数据查询 ----------
  {
    name: 'mongo_find',
    description: '查询集合中的文档，支持条件/排序/分页/字段筛选',
    toolRiskLevel: '安全',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称' },
        query: { type: 'object', description: '查询条件（如 {"status": "active"}，空对象=查询全部）' },
        options: {
          type: 'object',
          description: '查询选项',
          properties: {
            limit: { type: 'number', description: '返回条数上限（默认100，建议设置合理值）', default: 100 },
            skip: { type: 'number', description: '跳过的条数（用于分页）', default: 0 },
            sort: { type: 'object', description: '排序规则（如 {"createdAt": -1}）' },
            projection: { type: 'object', description: '返回字段筛选（如 {"name": 1, "email": 1}）' },
          },
        },
        explain: { type: 'boolean', description: '是否返回查询执行计划（而非实际数据）', default: false },
      },
      required: ['collection'],
    },
  },
  {
    name: 'mongo_find_one',
    description: '查询集合中的单个文档',
    toolRiskLevel: '安全',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称' },
        query: { type: 'object', description: '查询条件' },
        options: {
          type: 'object',
          properties: {
            projection: { type: 'object', description: '返回字段筛选' },
          },
        },
      },
      required: ['collection'],
    },
  },
  {
    name: 'mongo_count_documents',
    description: '统计符合条件的文档数量',
    toolRiskLevel: '安全',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称' },
        query: { type: 'object', description: '查询条件（空对象=统计全部）' },
      },
      required: ['collection'],
    },
  },
  {
    name: 'mongo_distinct',
    description: '获取指定字段的去重值列表',
    toolRiskLevel: '安全',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称' },
        field: { type: 'string', description: '字段名' },
        query: { type: 'object', description: '筛选条件（可选）' },
      },
      required: ['collection', 'field'],
    },
  },
  // ---------- 聚合分析 ----------
  {
    name: 'mongo_aggregate',
    description: '执行聚合管道查询，用于分组统计、复杂分析',
    toolRiskLevel: '安全',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称' },
        pipeline: {
          type: 'array',
          description: '聚合管道（如 [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]）',
          items: { type: 'object' },
        },
        explain: { type: 'boolean', description: '是否返回聚合执行计划', default: false },
      },
      required: ['collection', 'pipeline'],
    },
  },
  // ---------- 数据写入 ----------
  {
    name: 'mongo_insert_one',
    description: '插入单条文档到集合',
    toolRiskLevel: '谨慎',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称' },
        document: { type: 'object', description: '要插入的文档' },
      },
      required: ['collection', 'document'],
    },
  },
  {
    name: 'mongo_insert_many',
    description: '批量插入多条文档',
    toolRiskLevel: '谨慎',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称' },
        documents: { type: 'array', items: { type: 'object' }, description: '要插入的文档数组' },
        ordered: { type: 'boolean', description: '是否有序插入（false=并行，更快但可能部分失败）', default: true },
      },
      required: ['collection', 'documents'],
    },
  },
  {
    name: 'mongo_update_one',
    description: '更新单条文档',
    toolRiskLevel: '谨慎',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称' },
        query: { type: 'object', description: '匹配条件' },
        update: { type: 'object', description: '更新操作（如 {"$set": {"status": "done"}}）' },
        upsert: { type: 'boolean', description: '如果不存在是否插入', default: false },
      },
      required: ['collection', 'query', 'update'],
    },
  },
  {
    name: 'mongo_update_many',
    description: '批量更新文档（需确认）',
    toolRiskLevel: '危险',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称' },
        query: { type: 'object', description: '匹配条件' },
        update: { type: 'object', description: '更新操作' },
      },
      required: ['collection', 'query', 'update'],
    },
  },
  // ---------- 文档替换 ----------
  {
    name: 'mongo_replace_one',
    description: '替换单条文档（保留_id，整体替换其他字段）',
    toolRiskLevel: '谨慎',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称' },
        query: { type: 'object', description: '匹配条件' },
        replacement: { type: 'object', description: '替换文档（完整内容，不含_id则保留原_id）' },
        upsert: { type: 'boolean', description: '如果不存在是否插入', default: false },
      },
      required: ['collection', 'query', 'replacement'],
    },
  },
  // ---------- 数据删除 ----------
  {
    name: 'mongo_delete_one',
    description: '删除单条文档（需确认）',
    toolRiskLevel: '危险',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称' },
        query: { type: 'object', description: '匹配条件' },
      },
      required: ['collection', 'query'],
    },
  },
  {
    name: 'mongo_delete_many',
    description: '批量删除文档（需确认，必须带条件）',
    toolRiskLevel: '危险',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称' },
        query: { type: 'object', description: '匹配条件' },
      },
      required: ['collection', 'query'],
    },
  },
  // ---------- 导入导出 ----------
  {
    name: 'mongo_import',
    description: '从JSON/CSV数据导入到集合（支持内联数据和文件路径）',
    toolRiskLevel: '谨慎',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '目标集合名称' },
        data: { type: 'array', items: { type: 'object' }, description: '要导入的文档数组（与filePath二选一）' },
        filePath: { type: 'string', description: 'JSON/CSV文件路径（与data二选一）' },
        format: { type: 'string', enum: ['json', 'csv'], description: '文件格式（filePath时使用）', default: 'json' },
        ordered: { type: 'boolean', description: '是否有序插入（false=并行，更快）', default: false },
      },
      required: ['collection'],
    },
  },
  {
    name: 'mongo_export',
    description: '将集合数据导出为JSON/CSV',
    toolRiskLevel: '安全',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称' },
        filePath: { type: 'string', description: '输出文件路径（可选，不填则返回数据）' },
        format: { type: 'string', enum: ['json', 'csv'], description: '输出格式', default: 'json' },
        query: { type: 'object', description: '筛选条件（可选）' },
        projection: { type: 'object', description: '字段筛选（可选）' },
        sort: { type: 'object', description: '排序规则（可选）' },
        limit: { type: 'number', description: '导出条数上限', default: 1000 },
      },
      required: ['collection'],
    },
  },
  // ---------- 索引管理 ----------
  {
    name: 'mongo_list_indexes',
    description: '查看集合的索引列表',
    toolRiskLevel: '安全',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称' },
      },
      required: ['collection'],
    },
  },
  {
    name: 'mongo_create_index',
    description: '创建索引以优化查询性能',
    toolRiskLevel: '谨慎',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称' },
        keys: { type: 'object', description: '索引键（如 {"createdAt": -1}）' },
        options: {
          type: 'object',
          properties: {
            unique: { type: 'boolean', description: '是否唯一索引' },
            name: { type: 'string', description: '索引名称' },
            sparse: { type: 'boolean', description: '是否稀疏索引' },
            background: { type: 'boolean', description: '是否后台创建', default: true },
          },
        },
      },
      required: ['collection', 'keys'],
    },
  },
  {
    name: 'mongo_drop_index',
    description: '删除索引（需确认）',
    toolRiskLevel: '危险',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '集合名称' },
        indexName: { type: 'string', description: '索引名称' },
      },
      required: ['collection', 'indexName'],
    },
  },
];

// ==================== 工具执行器 ====================

import { executeWithMongo } from './MongoDB工具/操作处理.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('MongoDB工具', { 前缀: '[mongo_agent]', 级别: 'debug', 显示调用位置: true });

// 缓存代理实例（延迟初始化，首次调用时连接）
let _proxy = null;
let _mongoAdapter = null;
let _initError = null;
// 当前数据库名（模块局部变量，禁止写入 process.env）
let _currentDbName = process.env.MONGO_DB_NAME || 'doves_user_data';

/**
 * 初始化 MongoDB 连接（通过白鸽系统自有的 getDovesProxy）
 */
async function ensureConnection() {
  if (_mongoAdapter) return _mongoAdapter;
  if (_initError) throw new Error(_initError);

  try {
    const { getDovesProxy, MongoDB适配器 } = await import('../../../tools/存储接口.js');
    _proxy = await getDovesProxy();
    _mongoAdapter = new MongoDB适配器(_proxy, _currentDbName);
    logger.info('MongoDB 连接已建立');
    return _mongoAdapter;
  } catch (err) {
    _initError = `MongoDB 连接失败: ${err.message}。请检查白鸽系统服务是否正常运行。`;
    throw new Error(_initError);
  }
}

export async function handleExtTool(toolName, args) {
  // 只处理 mongo_ 前缀的工具，其他工具返回 null 让路由继续
  if (!toolName.startsWith('mongo_')) return null;

  try {
    const mongo = await ensureConnection();
    const result = await executeWithMongo(toolName, args, mongo, _proxy, _mongoAdapter);

    // 处理 mongo_connect 的 reconnect 特殊动作
    if (result && result.action === 'reconnect') {
      _proxy = null;
      _mongoAdapter = null;
      _initError = null;
      _currentDbName = result.dbName;
      await ensureConnection();
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, message: `MongoDB 连接已配置，数据库: ${result.dbName}` }, null, 2) }],
      };
    }

    return result;
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `MongoDB操作失败: ${err.message}` }] };
  }
}

// ==================== 安全级别导出 ====================
// 供 _loader.js 注册工具到 Server 时使用
// 从 extTools 定义中提取 toolRiskLevel，映射为 safetyLevel
export const extToolSafetyLevels = Object.fromEntries(
  extTools.map(t => [t.name, t.toolRiskLevel || '谨慎'])
);
