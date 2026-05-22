/**
 * 备份恢复技能 — MySQL
 * 表级备份（mysqldump风格SQL / CSV）→ 安全恢复（可选清空重建）→ 备份管理
 */

import fs from 'fs/promises';
import path from 'path';

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('mysql_backup_restore', { 前缀: '[mysql_backup_restore]', 级别: 'debug', 显示调用位置: true });

/**
 * 生成备份文件名
 */
function 生成备份文件名(database, table, format) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const prefix = table ? `${database}_${table}` : database;
  return `${prefix}_${ts}.${format}`;
}

async function execute(args, context) {
  const { action = 'backup' } = args;

  logger.info(`执行: ${action}`);

  try {
    switch (action) {
      // 生成备份SQL / 执行备份
      case 'backup': {
        const {
          database,
          table,
          outputPath,
          format = 'sql',
          where = '',
          includeCreateTable = true,
          includeDropTable = false,
        } = args;

        if (!database && !table) {
          return { 成功: false, 错误: '至少需要指定 database 或 table' };
        }

        const 输出路径 = outputPath || 生成备份文件名(database || 'mysql', table || 'all', format);
        const 目标 = table ? `\`${table}\`` : `\`${database}\`.*`;

        // 构建备份指令
        const 备份指令 = [];

        // 建表语句
        if (includeCreateTable && table) {
          备份指令.push({
            步骤: 1,
            描述: '导出建表语句',
            SQL: `SHOW CREATE TABLE \`${table}\``,
            执行: `mysql_select({ sql: "SHOW CREATE TABLE \\\`${table}\\\`" })`,
            备注: '保存返回的 Create Table 列',
          });
        }

        // DROP TABLE（可选）
        if (includeDropTable && table) {
          备份指令.push({
            步骤: 2,
            描述: '生成 DROP TABLE（恢复时使用）',
            SQL: `DROP TABLE IF EXISTS \`${table}\`;`,
            备注: '此为危险操作，仅在恢复时执行',
          });
        }

        // 数据导出
        const selectSQL = table
          ? `SELECT * FROM \`${table}\`${where ? ` WHERE ${where}` : ''}`
          : `-- 使用 mysql_export 工具导出整个数据库`;

        备份指令.push({
          步骤: includeCreateTable ? 3 : 1,
          描述: '导出数据',
          方式: format === 'sql'
            ? `使用 mysql_export 导出为 SQL: { table: "${table || database}", filePath: "${输出路径}", format: "sql" }`
            : `使用 mysql_export 导出为 ${format.toUpperCase()}: { table: "${table || database}", filePath: "${输出路径}", format: "${format}" }`,
          建议SQL: selectSQL,
        });

        // 如果是SQL格式，生成完整备份脚本
        let 完整备份脚本 = '';
        if (format === 'sql' && table) {
          完整备份脚本 = [
            `-- MySQL 备份脚本`,
            `-- 数据库: ${database || '(当前)'}  表: ${table}  时间: ${new Date().toISOString()}`,
            ``,
            includeDropTable ? `DROP TABLE IF EXISTS \`${table}\`;` : '',
            `-- (建表语句请从 SHOW CREATE TABLE 获取)`,
            ``,
            `-- 数据导出:`,
            `-- 使用 mysql_export 工具执行`,
          ].filter(Boolean).join('\n');
        }

        return {
          成功: true,
          数据: {
            数据库: database || '(当前)',
            表: table || '(全部)',
            输出路径,
            格式: format,
            过滤条件: where || '全量',
            备份指令,
            完整备份脚本: 完整备份脚本 || '请按上述指令逐步执行',
            恢复方式: `使用 mysql_import 工具导入备份文件: { table: "${table || ''}", filePath: "${输出路径}", format: "${format}" }`,
            安全提示: [
              '1. 备份期间表可能被锁定（取决于存储引擎和事务隔离级别）',
              '2. 大表备份建议在低峰期执行',
              '3. InnoDB表可使用 --single-transaction 保证一致性（mysqldump）',
              '4. 备份文件建议存储到安全位置（OSS/Git存储）',
            ],
          },
        };
      }

      // 恢复备份
      case 'restore': {
        const {
          table,
          filePath,
          format = 'sql',
          dropExisting = false,
          batchSize = 500,
        } = args;

        if (!filePath) {
          return { 成功: false, 错误: '缺少必填参数: filePath(备份文件路径)' };
        }

        // 尝试读取备份文件检查存在
        let fileExists = false;
        let fileSize = '未知';
        try {
          const stat = await fs.stat(filePath);
          fileExists = true;
          fileSize = `${(stat.size / 1024).toFixed(1)} KB`;
        } catch {
          fileExists = false;
        }

        const 恢复指令 = [];
        if (dropExisting && table) {
          恢复指令.push({
            步骤: 1,
            描述: '清空目标表',
            SQL: `TRUNCATE TABLE \`${table}\`;`,
            警告: '⚠️ 此操作不可逆！执行前请确认备份文件可用',
            需要确认: true,
          });
        }

        恢复指令.push({
          步骤: dropExisting ? 2 : 1,
          描述: '导入备份数据',
          方式: `使用 mysql_import 工具导入: { table: "${table || ''}", filePath: "${filePath}", format: "${format}" }`,
          备注: format === 'sql' ? 'SQL文件包含建表语句时，工具会自动处理' : `导入 ${format.toUpperCase()} 格式数据`,
        });

        return {
          成功: true,
          数据: {
            文件: filePath,
            文件存在: fileExists,
            文件大小: fileSize,
            目标表: table || '(自动识别)',
            清空重建: dropExisting,
            恢复指令,
            message: fileExists
              ? `备份文件已就绪（${fileSize}），请按指令执行恢复`
              : '备份文件不存在，请检查路径是否正确',
            安全提示: dropExisting
              ? ['⚠️ 将先清空表再恢复，请确认备份文件完整可用', '建议先在测试环境验证恢复流程']
              : ['数据将追加到目标表，注意主键冲突', '建议使用 action=verify 恢复后校验'],
          },
        };
      }

      // 列出备份
      case 'list': {
        const { backupDir = './backups/mysql' } = args;

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
          if (file.endsWith('.sql') || file.endsWith('.csv') || file.endsWith('.json')) {
            try {
              const stat = await fs.stat(path.join(backupDir, file));
              备份文件列表.push({
                文件名: file,
                大小: `${(stat.size / 1024).toFixed(1)} KB`,
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
          return { 成功: true, 数据: { 已删除: filePath, 消息: '备份文件已删除' } };
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
  description: 'MySQL备份恢复技能 — 表级备份（生成mysqldump风格SQL/CSV）→ 安全恢复（可选清空重建）→ 备份管理',
  abilities: ['MySQL', '数据备份', '数据恢复', '数据管理'],
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['backup', 'restore', 'list', 'delete'],
        description: '操作类型：backup=备份 / restore=恢复 / list=列出备份 / delete=删除备份文件',
      },
      database: { type: 'string', description: '数据库名称' },
      table: { type: 'string', description: '表名（backup/restore 时使用）' },
      outputPath: { type: 'string', description: '备份输出路径（backup时可选，默认自动生成）' },
      filePath: { type: 'string', description: '备份文件路径（restore/delete 时必填）' },
      format: { type: 'string', enum: ['sql', 'csv', 'json'], description: '备份格式', default: 'sql' },
      where: { type: 'string', description: '备份过滤条件' },
      includeCreateTable: { type: 'boolean', description: '是否包含建表语句', default: true },
      includeDropTable: { type: 'boolean', description: '是否包含DROP TABLE', default: false },
      dropExisting: { type: 'boolean', description: '恢复前是否清空目标表', default: false },
      batchSize: { type: 'number', description: '导入批次大小', default: 500 },
      backupDir: { type: 'string', description: '备份目录（list时使用）', default: './backups/mysql' },
    },
    required: ['action'],
  },
  execute,
};

