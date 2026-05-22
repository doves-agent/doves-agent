/**
 * 查询分析技能 — MongoDB
 * 分析慢查询、解读 explain 执行计划、发现性能瓶颈并给出优化建议
 *
 * 存储接口通过 MongoDB工具 的 ensureConnection 获取，保持一致性
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('mongo_query_analyzer', { 前缀: '[mongo_query_analyzer]', 级别: 'debug', 显示调用位置: true });

// 延迟获取 MongoDB 连接（与 MongoDB工具.js 共享连接池）
let _mongo = null;
async function getMongo() {
  if (_mongo) return _mongo;
  try {
    const { handleExtTool } = await import('../../tools/MongoDB工具.js');
    // 通过 mongo_connect 工具获取连接状态，确保连接已建立
    await handleExtTool('mongo_connect', { action: 'status' });
    // 然后获取底层适配器
    const mod = await import('../../tools/MongoDB工具.js');
    // 直接使用存储接口获取适配器
    const { getDovesProxy, MongoDB适配器 } = await import('../../../../tools/存储接口.js');
    const proxy = await getDovesProxy();
    const dbName = process.env.MONGO_DB_NAME || 'doves_user_data';
    _mongo = new MongoDB适配器(proxy, dbName);
    return _mongo;
  } catch (err) {
    logger.error('获取 MongoDB 连接失败:', err.message);
    return null;
  }
}

/**
 * 分析 explain 结果，提取关键性能指标
 */
function 分析执行计划(explainResult) {
  const queryPlanner = explainResult.queryPlanner || {};
  const executionStats = explainResult.executionStats || {};
  const winningPlan = queryPlanner.winningPlan || {};

  // 提取指标
  const 指标 = {
    查询方式: winningPlan.stage || 'UNKNOWN',
    扫描文档数: executionStats.totalDocsExamined || 0,
    返回文档数: executionStats.nReturned || 0,
    执行耗时_ms: executionStats.executionTimeMillis || 0,
    是否使用索引: winningPlan.stage === 'IXSCAN' || (winningPlan.inputStage?.stage === 'IXSCAN'),
    索引名: winningPlan.inputStage?.indexName || null,
    是否全集合扫描: winningPlan.stage === 'COLLSCAN',
  };

  // 判定健康状况
  const 扫描比 = 指标.返回文档数 > 0
    ? 指标.扫描文档数 / 指标.返回文档数
    : (指标.扫描文档数 > 0 ? Infinity : 0);

  let 健康度 = '良好';
  const 问题列表 = [];

  if (指标.是否全集合扫描 && 指标.扫描文档数 > 1000) {
    健康度 = '差';
    问题列表.push(`全集合扫描（COLLSCAN），扫描了 ${指标.扫描文档数} 个文档。强烈建议创建合适的索引`);
  } else if (指标.是否全集合扫描 && 指标.扫描文档数 > 100) {
    健康度 = '一般';
    问题列表.push(`全集合扫描（COLLSCAN），扫描了 ${指标.扫描文档数} 个文档。建议创建索引`);
  }

  if (扫描比 > 100 && !指标.是否全集合扫描) {
    问题列表.push(`扫描比过高（${扫描比.toFixed(0)}:1），扫描了 ${指标.扫描文档数} 个文档但只返回 ${指标.返回文档数} 个，索引可能不够精确`);
    健康度 = 健康度 === '良好' ? '一般' : 健康度;
  }

  if (指标.执行耗时_ms > 1000) {
    问题列表.push(`查询耗时 ${指标.执行耗时_ms}ms，超过 1 秒阈值`);
    健康度 = '差';
  } else if (指标.执行耗时_ms > 200) {
    问题列表.push(`查询耗时 ${指标.执行耗时_ms}ms，超过 200ms 阈值`);
  }

  return { 指标, 健康度, 问题列表, 扫描比, 原始计划: winningPlan };
}

/**
 * 对单个集合的多个查询进行批量分析
 */
function 批量分析(queries) {
  if (!Array.isArray(queries)) queries = [queries];

  const 分析结果 = [];
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    if (!q.explain) continue;

    const 分析 = 分析执行计划(q.explain);
    分析结果.push({
      序号: i + 1,
      查询条件: q.query || '(未提供)',
      过滤条件: q.filter || '(未提供)',
      排序: q.sort || '(无)',
      ...分析,
    });
  }

  // 汇总
  const 最差 = 分析结果.filter(r => r.健康度 === '差').length;
  const 一般 = 分析结果.filter(r => r.健康度 === '一般').length;
  const 良好 = 分析结果.filter(r => r.健康度 === '良好').length;
  const 全扫描 = 分析结果.filter(r => r.指标.是否全集合扫描).length;
  const 总耗时 = 分析结果.reduce((s, r) => s + r.指标.执行耗时_ms, 0);

  return {
    查询总数: queries.length,
    分析数: 分析结果.length,
    健康分布: { 差: 最差, 一般, 良好 },
    全集合扫描数: 全扫描,
    总耗时_ms: 总耗时,
    详情: 分析结果,
    建议: 最差 > 0
      ? `有 ${最差} 个查询性能差，建议优先处理全集合扫描（${全扫描}个）和慢查询。使用 index_advisor 获取索引建议`
      : (全扫描 > 0 ? `有 ${全扫描} 个全集合扫描，建议使用 index_advisor 创建索引` : '所有查询性能良好'),
  };
}

async function execute(args, context) {
  const { action = 'analyze', collection, query, filter, sort, projection, queries } = args;

  logger.info(`执行: ${action}`);

  try {
    switch (action) {
      // 分析单个查询
      case 'analyze': {
        if (!collection) {
          return { 成功: false, 错误: '缺少必填参数: collection' };
        }

        const mongo = await getMongo();
        if (mongo) {
          try {
            const db = mongo.getDb();
            const coll = db.collection(collection);
            const explainResult = await coll.find(query || {}).sort(sort ? Object.entries(sort).reduce((o, [k, v]) => { o[k] = v; return o; }, {}) : {}).limit(1).explain();

            const 分析 = 分析执行计划(explainResult);
            return {
              成功: true,
              数据: {
                collection,
                query: query || {},
                过滤: filter || '(无)',
                排序: sort || '(无)',
                ...分析,
              },
            };
          } catch (err) {
            logger.error('explain 执行失败:', err.message);
          }
        }

        return {
          成功: true,
          数据: {
            collection,
            query: query || {},
            message: '请先使用 mongo_connect 连接数据库，然后使用 mongo_find(explain=true) 获取执行计划',
            建议参数: {
              collection,
              query: query || {},
              options: { limit: 1, sort, projection },
              explain: true,
            },
          },
        };
      }

      // 批量分析：对已有的 explain 结果进行分析
      case 'batch_analyze': {
        if (!queries || queries.length === 0) {
          return { 成功: false, 错误: '缺少必填参数: queries（explain结果数组）' };
        }

        const 结果 = 批量分析(queries);
        return { 成功: true, 数据: 结果 };
      }

      // 慢查询诊断：分析集合的索引使用情况
      case 'diagnose': {
        if (!collection) {
          return { 成功: false, 错误: '缺少必填参数: collection' };
        }

        const mongo = await getMongo();
        if (mongo) {
          try {
            const db = mongo.getDb();
            // 获取集合统计
            const stats = await db.collection(collection).stats();
            // 列出当前索引
            let indexes = [];
            try { indexes = await db.collection(collection).listIndexes().toArray(); } catch { /* 无索引 */ }

            // 对常见查询模式做采样分析
            const 采样查询 = [
              { query: {}, sort: { _id: -1 }, desc: '按_id倒序（默认查询）' },
              { query: {}, sort: {}, desc: '无排序全量查询' },
            ];

            const 采样结果 = [];
            for (const 样 of 采样查询) {
              try {
                const explainR = await db.collection(collection).find(样.query).sort(样.sort).limit(1).explain();
                采样结果.push({ 描述: 样.desc, ...分析执行计划(explainR) });
              } catch {
                采样结果.push({ 描述: 样.desc, 错误: '无法执行 explain' });
              }
            }

            return {
              成功: true,
              数据: {
                collection,
                统计: {
                  文档数: stats.count || 0,
                  存储大小: stats.storageSize || '未知',
                  索引数: indexes.length || 0,
                },
                现有索引: indexes.map(ix => ({
                  名称: ix.name,
                  键: ix.key,
                  唯一: !!ix.unique,
                })),
                采样分析: 采样结果,
                建议: '如果采样中有全集合扫描（COLLSCAN），建议使用 index_advisor 技能创建对应索引',
              },
            };
          } catch (err) {
            logger.error('诊断失败:', err.message);
          }
        }

        return {
          成功: true,
          数据: {
            collection,
            message: '存储接口未就绪。请确保MongoDB已连接，使用 mongo_collection_stats 和 mongo_list_indexes 获取基础信息后再诊断',
            手动检查: [
              `1. mongo_collection_stats(${collection}) 获取集合统计`,
              `2. mongo_list_indexes(${collection}) 查看现有索引`,
              `3. mongo_find(${collection}, query={...}, explain=true) 对常用查询执行 explain`,
            ],
          },
        };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}。支持: analyze / batch_analyze / diagnose` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'query_analyzer',
  description: 'MongoDB查询分析技能 — 分析慢查询、解读explain执行计划、发现全集合扫描和索引缺失 → 输出优化建议',
  abilities: ['MongoDB', '数据查询', '性能优化'],
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['analyze', 'batch_analyze', 'diagnose'],
        description: '操作类型：analyze=分析单个查询计划 / batch_analyze=批量分析explain结果 / diagnose=诊断集合整体健康状况',
      },
      collection: { type: 'string', description: '集合名称（analyze/diagnose 时必填）' },
      query: { type: 'object', description: '查询条件（analyze 时使用）' },
      filter: { type: 'string', description: '查询筛选描述（用于报告展示）' },
      sort: { type: 'object', description: '排序规则' },
      projection: { type: 'object', description: '字段筛选' },
      queries: {
        type: 'array',
        description: 'explain结果数组（batch_analyze 时使用），每项含 query/filter/sort/explain 字段',
        items: { type: 'object' },
      },
    },
    required: ['action'],
  },
  execute,
};
