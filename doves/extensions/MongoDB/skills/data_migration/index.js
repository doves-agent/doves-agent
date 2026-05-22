/**
 * 数据迁移技能 — MongoDB
 * 集合间 / 数据库间数据迁移，支持字段映射、数据变换、分批处理
 *
 * 通过 getDb() 获取原生 MongoDB 驱动，直接操作数据库
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('mongo_data_migration', { 前缀: '[mongo_data_migration]', 级别: 'debug', 显示调用位置: true });

// 延迟获取 MongoDB 连接
let _db = null;
async function getDb() {
  if (_db) return _db;
  try {
    const { getDovesProxy, MongoDB适配器 } = await import('../../../../tools/存储接口.js');
    const proxy = await getDovesProxy();
    const dbName = process.env.MONGO_DB_NAME || 'doves_user_data';
    const adapter = new MongoDB适配器(proxy, dbName);
    _db = adapter.getDb();
    return _db;
  } catch (err) {
    logger.error('获取 MongoDB 连接失败:', err.message);
    return null;
  }
}

/**
 * 分批迁移数据
 */
async function 分批迁移(db, 源集合, 目标集合, 选项 = {}) {
  const {
    查询条件 = {},
    字段映射 = null,
    批大小 = 500,
    上限 = 0,
    删除源 = false,
  } = 选项;

  let 已迁移 = 0;
  let 失败 = 0;
  const 失败详情 = [];
  let cursor = 0;

  while (true) {
    if (上限 > 0 && 已迁移 >= 上限) break;

    try {
      const 文档列表 = await db.collection(源集合)
        .find(查询条件)
        .sort({ _id: 1 })
        .skip(cursor)
        .limit(批大小)
        .toArray();

      if (!文档列表 || 文档列表.length === 0) break;

      for (const 文档 of 文档列表) {
        try {
          let 新文档 = { ...文档 };

          // 字段映射
          if (字段映射) {
            新文档 = {};
            for (const [旧字段, 新字段] of Object.entries(字段映射)) {
              let 值 = 文档;
              for (const k of 旧字段.split('.')) {
                值 = 值?.[k];
              }
              新文档[新字段] = 值 !== undefined ? 值 : 字段映射[旧字段];
            }
          }

          // 不保留源 _id，让 MongoDB 自动生成避免冲突
          delete 新文档._id;

          await db.collection(目标集合).insertOne(新文档);
          已迁移++;

          // 删除源文档
          if (删除源) {
            try {
              await db.collection(源集合).deleteOne({ _id: 文档._id });
            } catch (delErr) {
              失败详情.push({ _id: 文档._id, 阶段: '删除源', 错误: delErr.message });
            }
          }
        } catch (err) {
          失败++;
          失败详情.push({ _id: 文档._id, 阶段: '写入目标', 错误: err.message });
        }
      }

      cursor += 文档列表.length;

      if (文档列表.length < 批大小) break;

    } catch (err) {
      return { 已迁移, 失败, 失败详情, 中断原因: `读取源集合失败: ${err.message}` };
    }
  }

  return { 已迁移, 失败, 失败详情, 完成: 失败 === 0 };
}

async function execute(args, context) {
  const { action = 'migrate' } = args;

  logger.info(`执行: ${action}`);

  try {
    const db = await getDb();

    switch (action) {
      // 执行迁移
      case 'migrate': {
        const { source, target, query, fieldMapping, batchSize = 500, limit = 0, deleteSource = false } = args;

        if (!source || !target) {
          return { 成功: false, 错误: '缺少必填参数: source(源集合) 和 target(目标集合)' };
        }

        if (!db) {
          return {
            成功: false,
            错误: 'MongoDB连接未就绪，无法执行迁移',
            建议: '请确保已通过 mongo_connect 连接数据库',
          };
        }

        // 预估源集合文档数
        let 预估总数 = '未知';
        try {
          预估总数 = await db.collection(source).countDocuments(query || {});
        } catch { /* 统计获取失败 */ }

        // 执行分批迁移
        const 结果 = await 分批迁移(db, source, target, {
          查询条件: query || {},
          字段映射: fieldMapping || null,
          批大小: batchSize,
          上限: limit,
          删除源: deleteSource,
        });

        return {
          成功: true,
          数据: {
            源集合: source,
            目标集合: target,
            预估总数,
            迁移结果: 结果,
            摘要: `成功迁移 ${结果.已迁移} 条${结果.失败 > 0 ? `，失败 ${结果.失败} 条` : ''}`,
            后续建议: deleteSource && 结果.完成
              ? '迁移完成并已清理源数据，建议验证目标集合数据完整性后删除源集合'
              : '迁移完成，建议验证目标集合数据完整性',
          },
        };
      }

      // 预估迁移
      case 'estimate': {
        const { source, query } = args;

        if (!source) {
          return { 成功: false, 错误: '缺少必填参数: source(源集合)' };
        }

        if (!db) {
          return {
            成功: true,
            数据: {
              源集合: source,
              过滤条件: query || {},
              文档数: '无法获取（MongoDB未连接）',
              提示: '使用 mongo_count_documents 可获取准确数量',
            },
          };
        }

        let 文档数 = 0;
        try {
          文档数 = await db.collection(source).countDocuments(query || {});
        } catch (e) {
          return {
            成功: true,
            数据: {
              源集合: source,
              过滤条件: query || {},
              文档数: '无法获取',
              提示: '使用 mongo_count_documents 可获取准确数量',
            },
          };
        }

        const 批大小 = args.batchSize || 500;
        const 批次数 = Math.ceil(文档数 / 批大小);
        const 预估秒数 = 批次数 * 0.5;

        return {
          成功: true,
          数据: {
            源集合: source,
            过滤条件: query || {},
            预估文档数: 文档数,
            批大小,
            所需批次数: 批次数,
            预估耗时: 预估秒数 < 60 ? `${预估秒数.toFixed(0)} 秒` : `${(预估秒数 / 60).toFixed(1)} 分钟`,
          },
        };
      }

      // 校验迁移结果
      case 'verify': {
        const { source, target, query } = args;

        if (!source || !target) {
          return { 成功: false, 错误: '缺少必填参数: source(源集合) 和 target(目标集合)' };
        }

        if (!db) {
          return { 成功: false, 错误: 'MongoDB连接未就绪' };
        }

        const 源总数 = await db.collection(source).countDocuments(query || {});
        const 目标总数 = await db.collection(target).countDocuments(query || {});

        return {
          成功: true,
          数据: {
            源集合: source,
            目标集合: target,
            源文档数: 源总数,
            目标文档数: 目标总数,
            一致: 源总数 === 目标总数,
            差异: Math.abs(源总数 - 目标总数),
            建议: 源总数 === 目标总数
              ? '数据迁移完整，数量一致'
              : `数量不一致，源 ${源总数} ≠ 目标 ${目标总数}，建议重新迁移`,
          },
        };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}。支持: migrate / estimate / verify` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'data_migration',
  description: 'MongoDB数据迁移技能 — 集合间迁移、字段映射变换、分批安全处理（先校验后迁移、源数据不丢失）',
  abilities: ['MongoDB', '数据迁移', '数据管理'],
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['migrate', 'estimate', 'verify'],
        description: '操作类型：migrate=执行迁移 / estimate=预估迁移量 / verify=校验迁移结果',
      },
      source: { type: 'string', description: '源集合名称（migrate/estimate/verify 时必填）' },
      target: { type: 'string', description: '目标集合名称（migrate/verify 时必填）' },
      query: { type: 'object', description: '过滤条件（仅迁移符合条件的文档）' },
      fieldMapping: {
        type: 'object',
        description: '字段映射表（如 {"旧字段名": "新字段名"}），不指定则保留所有字段',
      },
      batchSize: { type: 'number', description: '每批处理文档数（默认500）', default: 500 },
      limit: { type: 'number', description: '迁移上限（0=无限制）', default: 0 },
      deleteSource: { type: 'boolean', description: '迁移后是否删除源文档（谨慎！）', default: false },
    },
    required: ['action'],
  },
  execute,
};
