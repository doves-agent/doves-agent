/**
 * 数据迁移技能 — MySQL
 * 表间迁移、字段映射变换、分批安全处理、迁移校验
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('mysql_data_migration', { 前缀: '[mysql_data_migration]', 级别: 'debug', 显示调用位置: true });

/**
 * 生成 INSERT INTO ... SELECT 迁移SQL
 */
function 生成迁移SQL(源表, 目标表, 选项 = {}) {
  const {
    字段映射 = null,
    过滤条件 = '',
    排序 = '',
    分批大小 = 1000,
  } = 选项;

  let selectColumns = '*';
  let insertColumns = '';

  if (字段映射) {
    const 源字段 = Object.keys(字段映射);
    const 目标字段 = Object.values(字段映射);
    insertColumns = 目标字段.map(f => `\`${f}\``).join(', ');
    selectColumns = 源字段.map(f => `\`${f}\``).join(', ');
  }

  let sql = `INSERT INTO \`${目标表}\` ${insertColumns ? `(${insertColumns}) ` : ''}SELECT ${selectColumns} FROM \`${源表}\``;

  if (过滤条件) sql += ` WHERE ${过滤条件}`;
  if (排序) sql += ` ORDER BY ${排序}`;
  if (分批大小) sql += ` LIMIT ${分批大小}`;

  return sql;
}

/**
 * 估计迁移数据量
 */
function 估计迁移信息(源表, 目标表, 选项 = {}) {
  const countSQL = `SELECT COUNT(*) AS cnt FROM \`${源表}\`${选项.过滤条件 ? ` WHERE ${选项.过滤条件}` : ''}`;

  return {
    源表,
    目标表,
    过滤条件: 选项.过滤条件 || '全量',
    统计SQL: countSQL,
    迁移SQL示例: 生成迁移SQL(源表, 目标表, 选项),
    操作建议: {
      预估: `先使用 mysql_select({ sql: "${countSQL}" }) 获取源数据量`,
      分批执行: `如果数据量大（>10000条），建议使用 LIMIT 分批迁移，每批 ${选项.分批大小 || 1000} 条`,
      校验: '迁移完成后使用 action=verify 校验数据完整性',
      回滚: '迁移前建议先使用 backup_restore 技能备份源表',
    },
  };
}

async function execute(args, context) {
  const { action = 'migrate' } = args;

  logger.info(`执行: ${action}`);

  try {
    switch (action) {
      // 生成迁移方案
      case 'plan': {
        const {
          source,
          target,
          fieldMapping,
          where = '',
          batchSize = 1000,
        } = args;

        if (!source || !target) {
          return { 成功: false, 错误: '缺少必填参数: source(源表) 和 target(目标表)' };
        }

        const info = 估计迁移信息(source, target, {
          字段映射: fieldMapping,
          过滤条件: where,
          分批大小: batchSize,
        });

        return { 成功: true, 数据: info };
      }

      // 执行迁移（生成并执行分页SQL）
      case 'migrate': {
        const {
          source,
          target,
          fieldMapping,
          where = '',
          orderBy = '',
          batchSize = 500,
          limit = 0,
        } = args;

        if (!source || !target) {
          return { 成功: false, 错误: '缺少必填参数: source(源表) 和 target(目标表)' };
        }

        // 构建迁移SQL列表
        const sqls = [生成迁移SQL(source, target, {
          字段映射: fieldMapping,
          过滤条件: where,
          排序: orderBy,
          分批大小: batchSize,
        })];

        if (limit > 0) {
          // 如果需要限制总量，生成多个分批SQL
          const batches = Math.ceil(limit / batchSize);
          for (let i = 1; i < batches; i++) {
            const offset = i * batchSize;
            sqls.push(生成迁移SQL(source, target, {
              字段映射: fieldMapping,
              过滤条件: where,
              排序: orderBy,
              分批大小: batchSize,
            }) + ` OFFSET ${offset}`);
          }
        }

        return {
          成功: true,
          数据: {
            源表: source,
            目标表: target,
            过滤条件: where || '全量',
            分批大小: batchSize,
            迁移SQL: sqls,
            执行方式: `依次使用 mysql_execute 执行以下SQL：\n${sqls.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`,
            安全提示: [
              '1. 执行前请确保目标表已创建（可使用 mysql_describe_table 检查结构）',
              '2. 建议先备份源表：使用 backup_restore 技能',
              '3. 迁移完成后使用 action=verify 校验数据完整性',
              '4. 如有报错，检查字段映射是否符合目标表结构',
            ],
          },
        };
      }

      // 校验迁移结果
      case 'verify': {
        const { source, target, where = '' } = args;

        if (!source || !target) {
          return { 成功: false, 错误: '缺少必填参数: source(源表) 和 target(目标表)' };
        }

        const whereClause = where ? ` WHERE ${where}` : '';

        return {
          成功: true,
          数据: {
            源表: source,
            目标表: target,
            校验SQL: [
              `SELECT COUNT(*) AS 源表数量 FROM \`${source}\`${whereClause}`,
              `SELECT COUNT(*) AS 目标表数量 FROM \`${target}\`${whereClause}`,
            ],
            操作步骤: [
              `1. mysql_select({ sql: "SELECT COUNT(*) AS cnt FROM \`${source}\`${whereClause}" })`,
              `2. mysql_select({ sql: "SELECT COUNT(*) AS cnt FROM \`${target}\`${whereClause}" })`,
              '3. 比对两次结果是否一致',
              '4. 抽样检查: mysql_select({ sql: "SELECT * FROM 目标表 ORDER BY RAND() LIMIT 10" })',
            ],
            message: '请按上述步骤执行校验，确认源表和目标表数据量一致',
          },
        };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}。支持: plan / migrate / verify` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'data_migration',
  description: 'MySQL数据迁移技能 — 生成迁移方案→构建INSERT...SELECT SQL→分批安全执行→迁移校验',
  abilities: ['MySQL', '数据迁移', '数据管理'],
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['plan', 'migrate', 'verify'],
        description: '操作类型：plan=生成迁移方案 / migrate=生成迁移SQL / verify=迁移校验',
      },
      source: { type: 'string', description: '源表名称（必填）' },
      target: { type: 'string', description: '目标表名称（必填）' },
      fieldMapping: {
        type: 'object',
        description: '字段映射（如 {"源字段": "目标字段"}），不指定则保持同名字段',
      },
      where: { type: 'string', description: 'WHERE过滤条件（仅迁移符合条件的行）' },
      orderBy: { type: 'string', description: '排序字段' },
      batchSize: { type: 'number', description: '每批行数', default: 500 },
      limit: { type: 'number', description: '总迁移上限（0=无限制）', default: 0 },
    },
    required: ['action'],
  },
  execute,
};
