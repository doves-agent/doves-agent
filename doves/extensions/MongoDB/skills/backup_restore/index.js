/**
 * 备份恢复技能 — MongoDB
 * 集合/数据库级备份导出 → 恢复导入 → 备份管理
 *
 * 通过 getDb() 获取原生 MongoDB 驱动，直接操作数据库
 */

import fs from 'fs/promises';
import path from 'path';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('mongo_backup_restore', { 前缀: '[mongo_backup_restore]', 级别: 'debug', 显示调用位置: true });

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
 * 生成备份文件名
 */
function 生成备份文件名(collection, format) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${collection}_${ts}.${format}`;
}

/**
 * 格式化字节大小
 */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

async function execute(args, context) {
  const { action = 'backup' } = args;

  logger.info(`执行: ${action}`);

  const db = await getDb();

  try {
    switch (action) {
      // 备份集合
      case 'backup': {
        const {
          collection,
          outputPath,
          format = 'json',
          query,
          limit = 10000,
          includeStats = true,
        } = args;

        if (!collection) {
          return { 成功: false, 错误: '缺少必填参数: collection（要备份的集合名称）' };
        }

        const 输出路径 = outputPath || 生成备份文件名(collection, format);

        if (!db) {
          return {
            成功: true,
            数据: {
              message: 'MongoDB未连接，已生成备份指令',
              集合: collection,
              输出路径,
              格式: format,
              建议执行: `连接MongoDB后使用 mongo_export 工具导出: { collection: "${collection}", filePath: "${输出路径}", format: "${format}" }`,
            },
          };
        }

        try {
          // 获取集合统计
          let 统计 = {};
          if (includeStats) {
            try {
              统计 = await db.collection(collection).stats();
            } catch { /* 统计获取失败 */ }
          }

          // 获取文档总数
          const 总数 = await db.collection(collection).countDocuments(query || {});

          // 分批导出
          const 所有数据 = [];
          let skip = 0;
          const batchSize = 1000;

          while (skip < 总数 && skip < limit) {
            const docs = await db.collection(collection)
              .find(query || {})
              .sort({ _id: 1 })
              .skip(skip)
              .limit(batchSize)
              .toArray();
            if (docs.length === 0) break;
            所有数据.push(...docs);
            skip += docs.length;
          }

          // 构建备份包
          const 备份包 = {
            备份信息: {
              集合: collection,
              备份时间: new Date().toISOString(),
              文档数: 所有数据.length,
              总数,
              格式: format,
              过滤条件: query || '全量',
              统计信息: includeStats ? {
                文档数: 统计.count,
                存储大小: 统计.storageSize,
                索引数: 统计.nindexes,
              } : '未包含',
            },
            数据: 所有数据,
          };

          // 写入文件
          const content = JSON.stringify(备份包, null, 2);

          await fs.mkdir(path.dirname(输出路径), { recursive: true });
          await fs.writeFile(输出路径, content, 'utf-8');

          const stat = await fs.stat(输出路径);

          return {
            成功: true,
            数据: {
              集合: collection,
              输出路径,
              格式: format,
              导出文档数: 所有数据.length,
              集合总数: 总数,
              文件大小: formatSize(stat.size),
              备份时间: 备份包.备份信息.备份时间,
              建议: `备份文件已保存到 ${输出路径}。使用 action=restore 可恢复数据`,
            },
          };
        } catch (err) {
          return {
            成功: false,
            错误: `备份失败: ${err.message}`,
            替代方案: `可使用 mongo_export 工具手动导出: { collection: "${collection}", filePath: "${输出路径}", format: "${format}" }`,
          };
        }
      }

      // 恢复备份
      case 'restore': {
        const {
          collection,
          filePath,
          dropExisting = false,
          batchSize = 500,
        } = args;

        if (!collection || !filePath) {
          return { 成功: false, 错误: '缺少必填参数: collection(目标集合) 和 filePath(备份文件路径)' };
        }

        // 读取备份文件
        let 备份数据;
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          备份数据 = JSON.parse(content);
        } catch (err) {
          return { 成功: false, 错误: `读取备份文件失败: ${err.message}` };
        }

        // 提取文档列表
        const 文档列表 = Array.isArray(备份数据) ? 备份数据 : (备份数据.数据 || 备份数据.documents || []);
        if (文档列表.length === 0) {
          return { 成功: false, 错误: '备份文件中没有数据文档' };
        }

        if (!db) {
          return {
            成功: true,
            数据: {
              message: 'MongoDB未连接，已读取备份文件',
              文件: filePath,
              文档数: 文档列表.length,
              建议执行: `连接MongoDB后使用 mongo_import 工具导入: { collection: "${collection}", filePath: "${filePath}" }`,
            },
          };
        }

        try {
          // 可选：清空目标集合
          if (dropExisting) {
            try {
              await db.collection(collection).deleteMany({});
            } catch (err) {
              return { 成功: false, 错误: `清空目标集合失败: ${err.message}` };
            }
          }

          // 分批写入
          let 已写入 = 0;
          let 失败数 = 0;
          const 失败详情 = [];

          for (let i = 0; i < 文档列表.length; i += batchSize) {
            const batch = 文档列表.slice(i, i + batchSize);
            // 去掉 _id 避免重复键冲突
            const cleanBatch = batch.map(doc => {
              const { _id, ...rest } = doc;
              return rest;
            });

            try {
              const result = await db.collection(collection).insertMany(cleanBatch, { ordered: false });
              已写入 += result.insertedCount;
            } catch (err) {
              // 部分插入失败（ordered:false 会继续插入成功的）
              if (err.result?.insertedCount) {
                已写入 += err.result.insertedCount;
              }
              失败数 += batch.length - (err.result?.insertedCount || 0);
              失败详情.push({ 批次: i / batchSize, 错误: err.message });
            }
          }

          return {
            成功: true,
            数据: {
              目标集合: collection,
              文件文档数: 文档列表.length,
              已写入,
              失败数,
              失败详情: 失败详情.slice(0, 10),
              清空重建: dropExisting,
              摘要: `恢复完成: ${已写入}/${文档列表.length} 条${失败数 > 0 ? ` (${失败数} 失败)` : ''}`,
            },
          };
        } catch (err) {
          return { 成功: false, 错误: `恢复失败: ${err.message}` };
        }
      }

      // 列出备份
      case 'list': {
        const { backupDir = './backups/mongo' } = args;

        let files = [];
        let dirExists = false;
        try {
          files = await fs.readdir(backupDir);
          dirExists = true;
        } catch {
          dirExists = false;
        }

        if (!dirExists || files.length === 0) {
          return {
            成功: true,
            数据: {
              备份目录: backupDir,
              备份数: 0,
              消息: dirExists ? '备份目录为空' : '备份目录不存在',
              建议: '使用 action=backup 创建备份',
            },
          };
        }

        const 备份文件列表 = [];
        for (const file of files) {
          if (file.endsWith('.json') || file.endsWith('.csv')) {
            try {
              const stat = await fs.stat(path.join(backupDir, file));
              备份文件列表.push({
                文件名: file,
                大小: formatSize(stat.size),
                时间: stat.mtime.toISOString().slice(0, 19),
              });
            } catch {
              备份文件列表.push({ 文件名: file });
            }
          }
        }

        return {
          成功: true,
          数据: {
            备份目录: backupDir,
            备份数: 备份文件列表.length,
            备份列表: 备份文件列表.sort((a, b) => (b.时间 || '').localeCompare(a.时间 || '')),
          },
        };
      }

      // 删除备份
      case 'delete': {
        const { filePath } = args;
        if (!filePath) {
          return { 成功: false, 错误: '缺少必填参数: filePath' };
        }

        try {
          await fs.unlink(filePath);
          return {
            成功: true,
            数据: { 已删除: filePath, 消息: '备份文件已删除' },
          };
        } catch (err) {
          return { 成功: false, 错误: `删除失败: ${err.message}` };
        }
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}。支持: backup / restore / list / delete` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'backup_restore',
  description: 'MongoDB备份恢复技能 — 集合级备份（JSON）→ 安全恢复（分批写入，可选清空重建）→ 备份文件管理',
  abilities: ['MongoDB', '数据备份', '数据恢复', '数据管理'],
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['backup', 'restore', 'list', 'delete'],
        description: '操作类型：backup=备份 / restore=恢复 / list=列出备份 / delete=删除备份文件',
      },
      collection: { type: 'string', description: '集合名称（backup/restore 时必填）' },
      outputPath: { type: 'string', description: '备份输出路径（backup时可选，默认自动生成）' },
      filePath: { type: 'string', description: '备份文件路径（restore/delete 时必填）' },
      format: { type: 'string', enum: ['json', 'csv'], description: '备份格式', default: 'json' },
      query: { type: 'object', description: '备份过滤条件（仅备份符合条件的文档）' },
      limit: { type: 'number', description: '备份条数上限', default: 10000 },
      includeStats: { type: 'boolean', description: '是否包含集合统计信息', default: true },
      dropExisting: { type: 'boolean', description: '恢复前是否清空目标集合', default: false },
      batchSize: { type: 'number', description: '恢复时每批写入条数', default: 500 },
      backupDir: { type: 'string', description: '备份目录路径（list 时使用）', default: './backups/mongo' },
    },
    required: ['action'],
  },
  execute,
};

