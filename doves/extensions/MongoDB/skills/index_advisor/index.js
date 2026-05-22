/**
 * 索引顾问技能 — MongoDB
 * 分析查询模式 → 推荐最佳索引 → 评估索引效果
 *
 * 存储接口通过 MongoDB工具 的 ensureConnection 获取，保持一致性
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('mongo_index_advisor', { 前缀: '[mongo_index_advisor]', 级别: 'debug', 显示调用位置: true });

// 延迟获取 MongoDB 连接
let _mongo = null;
async function getMongo() {
  if (_mongo) return _mongo;
  try {
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
 * 根据查询条件推荐索引
 */
function 推荐索引(query, sort, collection) {
  const 建议 = [];

  if (!query || Object.keys(query).length === 0) {
    if (sort && Object.keys(sort).length > 0) {
      // 无查询条件但有排序 → 建议创建排序字段索引
      for (const [field, direction] of Object.entries(sort)) {
        建议.push({
          索引键: { [field]: direction },
          类型: '普通索引',
          理由: `查询无过滤条件但按 ${field} 排序，创建索引可避免内存排序`,
        });
      }
    }
    return 建议;
  }

  // 分析查询中的字段
  const 等值字段 = []; // field: value（精确匹配）
  const 范围字段 = []; // $gt/$gte/$lt/$lte/$in
  const 排序字段 = sort ? Object.keys(sort) : [];
  const 查询字段 = [...Object.keys(query)];

  for (const [field, value] of Object.entries(query)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const ops = Object.keys(value);
      if (ops.some(op => ['$gt', '$gte', '$lt', '$lte', '$in', '$nin'].includes(op))) {
        范围字段.push(field);
        continue;
      }
      if (ops.some(op => ['$regex', '$text', '$search'].includes(op))) {
        // 文本搜索 → 推荐文本索引
        建议.push({
          索引键: { [field]: 'text' },
          类型: '文本索引',
          理由: `字段 ${field} 使用了 $regex/$text 查询，文本索引可大幅加速模糊匹配`,
        });
        continue;
      }
    }
    等值字段.push(field);
  }

  // ESR 规则：等值(Equality) → 排序(Sort) → 范围(Range)
  const 索引键 = {};
  const 包含字段 = [];

  // 1. 等值字段放最前面
  for (const f of 等值字段) {
    索引键[f] = 1;
    包含字段.push(f);
  }

  // 2. 排序字段
  for (const f of 排序字段) {
    if (!索引键[f]) {
      索引键[f] = sort[f];
      包含字段.push(f);
    }
  }

  // 3. 范围字段放最后
  for (const f of 范围字段) {
    if (!索引键[f]) {
      索引键[f] = 1;
      包含字段.push(f);
    }
  }

  if (包含字段.length > 0) {
    const 理由列表 = [];
    if (等值字段.length > 0) 理由列表.push(`等值过滤: ${等值字段.join(', ')}`);
    if (排序字段.length > 0) 理由列表.push(`排序: ${排序字段.join(', ')}`);
    if (范围字段.length > 0) 理由列表.push(`范围过滤: ${范围字段.join(', ')}`);
    理由列表.push('遵循 ESR 规则（等值→排序→范围）');

    建议.push({
      索引键,
      类型: 包含字段.length > 1 ? '复合索引' : '普通索引',
      理由: 理由列表.join('；'),
      覆盖字段: 包含字段,
    });
  }

  return 建议;
}

/**
 * 分析现有索引冗余/缺失
 */
function 分析索引状况(现有索引, 推荐索引列表, collection) {
  const 现有键集 = new Set(现有索引.map(ix => JSON.stringify({ key: ix.key || ix.键 })));
  const 分析 = { 缺失: [], 已有: [], 可能冗余: [] };

  // 检查推荐索引是否已存在（精确匹配或前缀匹配）
  for (const 推荐 of 推荐索引列表) {
    const 键串 = JSON.stringify({ key: 推荐.索引键 });
    if (现有键集.has(键串)) {
      分析.已有.push(推荐);
    } else {
      // 检查是否有索引覆盖了推荐的前缀
      let 已覆盖 = false;
      for (const 现有 of 现有索引) {
        const 现有键 = 现有.key || 现有.键 || {};
        const 现有字段 = Object.keys(现有键);
        const 推荐字段 = Object.keys(推荐.索引键);

        if (推荐字段.length <= 现有字段.length) {
          const 是前缀 = 推荐字段.every((f, i) => 现有字段[i] === f);
          if (是前缀) {
            分析.已有.push({ ...推荐, 被覆盖: true, 覆盖索引: 现有.name || 现有.名称 });
            已覆盖 = true;
            break;
          }
        }
      }
      if (!已覆盖) 分析.缺失.push(推荐);
    }
  }

  // 检测可能冗余的索引（完全相同的前缀索引）
  for (let i = 0; i < 现有索引.length; i++) {
    for (let j = i + 1; j < 现有索引.length; j++) {
      const a键 = 现有索引[i].key || 现有索引[i].键 || {};
      const b键 = 现有索引[j].key || 现有索引[j].键 || {};
      const a字段 = Object.keys(a键);
      const b字段 = Object.keys(b键);
      if (a字段.length === b字段.length && a字段.every((f, idx) => b字段[idx] === f && a键[f] === b键[f])) {
        分析.可能冗余.push({
          索引A: 现有索引[i].name || 现有索引[i].名称,
          索引B: 现有索引[j].name || 现有索引[j].名称,
          键: a键,
          建议: '两个索引完全相同，保留一个即可',
        });
      }
    }
  }

  return 分析;
}

async function execute(args, context) {
  const { action = 'recommend', collection, query, sort, queries } = args;

  logger.info(`执行: ${action}`);

  try {
    switch (action) {
      // 推荐索引：根据查询条件推荐最佳索引
      case 'recommend': {
        if (!collection) {
          return { 成功: false, 错误: '缺少必填参数: collection' };
        }

        // 对单个查询推荐
        const 建议 = 推荐索引(query || {}, sort, collection);

        // 尝试获取现有索引做对比
        let 现有索引 = [];
        const mongo = await getMongo();
        if (mongo) {
          try {
            const db = mongo.getDb();
            现有索引 = await db.collection(collection).listIndexes().toArray();
          } catch { /* 索引列表获取失败 */ }
        }

        const 对比分析 = 分析索引状况(现有索引, 建议, collection);

        return {
          成功: true,
          数据: {
            collection,
            分析查询: { query: query || {}, sort: sort || {} },
            推荐索引: 建议,
            现有索引数: 现有索引.length,
            对比: 对比分析,
            创建命令提示: 建议
              .filter(s => !对比分析.已有.some(y => y.索引键 && JSON.stringify(y.索引键) === JSON.stringify(s.索引键)))
              .map(s => `db.getCollection('${collection}').createIndex(${JSON.stringify(s.索引键)})`),
            规则说明: 'ESR规则: 等值(Equality)→排序(Sort)→范围(Range)。等值过滤字段放索引最前面，排序字段放中间，范围查询字段放最后',
          },
        };
      }

      // 批量推荐：对多个查询模式批量推荐索引
      case 'batch_recommend': {
        if (!queries || queries.length === 0) {
          return { 成功: false, 错误: '缺少必填参数: queries（查询模式数组）' };
        }

        const 所有建议 = [];
        for (const q of queries) {
          const 建议 = 推荐索引(q.query || {}, q.sort, q.collection || args.collection);
          const 查询描述 = q.desc || JSON.stringify(q.query || {}).slice(0, 50);
          所有建议.push({ 查询: 查询描述, 建议 });
        }

        // 合并去重
        const 合并建议 = [];
        const 键集 = new Set();
        for (const { 建议: list } of 所有建议) {
          for (const s of list) {
            const 键 = JSON.stringify(s.索引键);
            if (!键集.has(键)) {
              键集.add(键);
              合并建议.push(s);
            }
          }
        }

        return {
          成功: true,
          数据: {
            查询数: queries.length,
            所有建议数: 所有建议.reduce((s, r) => s + r.建议.length, 0),
            合并去重后: 合并建议.length,
            详情: 所有建议,
            推荐优先创建: 合并建议.slice(0, 5),
          },
        };
      }

      // 索引评估：评估现有索引对某查询的效果
      case 'evaluate': {
        if (!collection || !query) {
          return { 成功: false, 错误: '缺少必填参数: collection 和 query' };
        }

        const mongo = await getMongo();
        if (mongo) {
          try {
            const db = mongo.getDb();
            const coll = db.collection(collection);
            // 使用 explain 查看查询是否使用索引
            const explainResult = await coll.find(query).sort(sort || {}).limit(1).explain();

            const planner = explainResult.queryPlanner || {};
            const stats = explainResult.executionStats || {};
            const plan = planner.winningPlan || {};

            // 收集被拒绝的计划（即未被选中的备选索引）
            const rejectedPlans = (planner.rejectedPlans || []).map(rp => ({
              stage: rp.stage,
              indexName: rp.inputStage?.indexName || 'N/A',
              reason: '查询优化器未选择此计划',
            }));

            return {
              成功: true,
              数据: {
                collection,
                query,
                sort: sort || {},
                当前使用: {
                  阶段: plan.stage,
                  索引名: plan.inputStage?.indexName || '(无)',
                  是否全扫描: plan.stage === 'COLLSCAN',
                  扫描文档: stats.totalDocsExamined,
                  返回文档: stats.nReturned,
                  耗时_ms: stats.executionTimeMillis,
                },
                备选计划: rejectedPlans,
                现有索引: await db.collection(collection).listIndexes().toArray().then(ixs => ixs.map(ix => ({
                  名称: ix.name, 键: ix.key,
                }))).catch(() => []),
                评价: plan.stage === 'IXSCAN'
                  ? `查询使用了索引 ${plan.inputStage?.indexName || ''}，性能良好`
                  : `查询进行了全集合扫描，建议创建索引`,
              },
            };
          } catch (err) {
            logger.error('评估失败:', err.message);
          }
        }

        return {
          成功: true,
          数据: {
            collection,
            query,
            message: '请在连接MongoDB后使用此功能。可通过 mongo_find(...explain=true) 手动获取执行计划',
          },
        };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}。支持: recommend / batch_recommend / evaluate` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'index_advisor',
  description: 'MongoDB索引顾问技能 — 分析查询模式→推荐最佳索引（遵循ESR规则：等值→排序→范围）→评估索引效果',
  abilities: ['MongoDB', '索引管理', '性能优化'],
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['recommend', 'batch_recommend', 'evaluate'],
        description: '操作类型：recommend=推荐索引 / batch_recommend=批量推荐 / evaluate=评估现有索引效果',
      },
      collection: { type: 'string', description: '集合名称' },
      query: { type: 'object', description: '典型查询条件（JSON对象）' },
      sort: { type: 'object', description: '排序规则（JSON对象）' },
      queries: {
        type: 'array',
        description: '批量查询模式数组（batch_recommend时使用），每项含 query/sort/desc 字段',
        items: { type: 'object' },
      },
    },
    required: ['action'],
  },
  execute,
};
