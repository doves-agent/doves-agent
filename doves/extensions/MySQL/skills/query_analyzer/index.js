/**
 * 查询分析技能 — MySQL
 * EXPLAIN 执行计划解读、慢查询诊断、SQL优化建议
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('mysql_query_analyzer', { 前缀: '[mysql_query_analyzer]', 级别: 'debug', 显示调用位置: true });

/**
 * 解析 MySQL EXPLAIN 结果（JSON格式）
 */
function 分析执行计划(explainResult) {
  // MySQL 8.0+ EXPLAIN FORMAT=JSON
  const queryBlock = explainResult.query_block || explainResult;

  const 指标 = {
    查询类型: queryBlock.select_type || 'UNKNOWN',
    访问类型: queryBlock.table?.access_type || queryBlock.access_type || 'UNKNOWN',
    扫描行数: queryBlock.table?.rows_examined_per_scan || queryBlock.rows_examined_per_scan || 0,
    返回行数: queryBlock.table?.filtered ? `${queryBlock.table.filtered}%` : '未知',
    使用索引: queryBlock.table?.key || queryBlock.key || '(无)',
    可能索引: queryBlock.table?.possible_keys || queryBlock.possible_keys || [],
    是否全表扫描: (queryBlock.table?.access_type || queryBlock.access_type) === 'ALL',
    是否文件排序: queryBlock.table?.using_filesort || queryBlock.using_filesort || false,
    是否临时表: queryBlock.table?.using_temporary || queryBlock.using_temporary || false,
    是否索引覆盖: queryBlock.table?.using_index || queryBlock.using_index || false,
    额外信息: queryBlock.table?.Extra || queryBlock.Extra || '',
  };

  // 判定健康度
  const 访问类型排序 = ['system', 'const', 'eq_ref', 'ref', 'range', 'index', 'ALL'];
  const 访问索引 = 访问类型排序.indexOf(指标.访问类型);
  let 健康度 = '良好';
  const 问题列表 = [];

  if (指标.访问类型 === 'ALL' && 指标.扫描行数 > 1000) {
    健康度 = '差';
    问题列表.push(`全表扫描（ALL），扫描 ${指标.扫描行数} 行。强烈建议创建索引`);
  } else if (指标.访问类型 === 'ALL' && 指标.扫描行数 > 100) {
    健康度 = '一般';
    问题列表.push(`全表扫描（ALL），扫描 ${指标.扫描行数} 行。建议创建索引`);
  } else if (指标.访问类型 === 'index' && 指标.扫描行数 > 1000) {
    健康度 = '一般';
    问题列表.push(`全索引扫描（index），扫描 ${指标.扫描行数} 行。考虑优化WHERE条件或复合索引`);
  } else if (访问索引 >= 5) {
    健康度 = '一般';
    if (指标.扫描行数 > 500) 问题列表.push(`访问类型 ${指标.访问类型} 偏慢，扫描 ${指标.扫描行数} 行`);
  }

  if (指标.是否文件排序) {
    if (指标.扫描行数 > 100) {
      问题列表.push(`使用了文件排序（Using filesort），扫描 ${指标.扫描行数} 行。建议创建合适的排序索引`);
    } else {
      问题列表.push(`使用了文件排序（Using filesort），数据量较小可接受`);
    }
  }

  if (指标.是否临时表) {
    问题列表.push('使用了临时表（Using temporary），可能影响性能。考虑优化GROUP BY/DISTINCT');
  }

  if (指标.是否索引覆盖 && 指标.扫描行数 > 10000) {
    问题列表.push(`虽然使用了覆盖索引但扫描行数很大（${指标.扫描行数}），建议优化查询条件`);
  }

  return { 指标, 健康度, 问题列表, 访问类型等级: 访问索引 };
}

/**
 * 解读原始 EXPLAIN 表格输出
 */
function 解析原始Explain(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { 错误: '无效的 EXPLAIN 结果' };
  }

  const 分析 = rows.map((row, i) => ({
    序号: i + 1,
    表: row.table || '(未知)',
    查询类型: row.select_type || 'SIMPLE',
    访问类型: row.type || 'ALL',
    可能索引: row.possible_keys || null,
    使用索引: row.key || null,
    索引长度: row.key_len || 0,
    ref: row.ref || null,
    扫描行数: row.rows || 0,
    filtered: row.filtered || 100,
    Extra: row.Extra || '',
  }));

  const 最差 = 分析.find(r => r.访问类型 === 'ALL' && r.扫描行数 > 1000);
  const 全扫描 = 分析.filter(r => r.访问类型 === 'ALL').length;
  const 文件排序 = 分析.filter(r => (r.Extra || '').includes('Using filesort')).length;
  const 临时表 = 分析.filter(r => (r.Extra || '').includes('Using temporary')).length;

  return {
    分析行数: 分析.length,
    全表扫描数: 全扫描,
    文件排序数: 文件排序,
    临时表数: 临时表,
    详情: 分析,
    健康度: 最差 ? '差' : (全扫描 > 0 ? '一般' : '良好'),
    建议: 最差
      ? `表 ${最差.表} 存在全表扫描（${最差.扫描行数}行），强烈建议创建索引`
      : (全扫描 > 0 ? `有 ${全扫描} 个全表扫描，建议检查索引` : '查询计划良好'),
  };
}

async function execute(args, context) {
  const { action = 'analyze', sql, explainResult } = args;

  logger.info(`执行: ${action}`);

  try {
    switch (action) {
      // 分析 EXPLAIN 结果
      case 'analyze': {
        if (!explainResult) {
          return {
            成功: false,
            错误: '缺少必填参数: explainResult（EXPLAIN 结果）',
            建议: '请先使用 mysql_select 执行 EXPLAIN 查询，例如: mysql_select({ sql: "EXPLAIN SELECT ..." })',
          };
        }

        // 判断是 JSON 格式还是表格格式
        if (typeof explainResult === 'object' && !Array.isArray(explainResult)) {
          const 分析 = 分析执行计划(explainResult);
          return { 成功: true, 数据: 分析 };
        }

        if (Array.isArray(explainResult)) {
          const 分析 = 解析原始Explain(explainResult);
          return { 成功: true, 数据: 分析 };
        }

        return { 成功: false, 错误: '无法识别的 EXPLAIN 格式，请传入 JSON 对象或表格数组' };
      }

      // 诊断指定SQL
      case 'diagnose': {
        if (!sql) {
          return { 成功: false, 错误: '缺少必填参数: sql' };
        }

        // 返回诊断指引
        return {
          成功: true,
          数据: {
            sql,
            message: '请通过 mysql_select 执行 EXPLAIN 查询获取执行计划后再分析',
            操作步骤: [
              `1. mysql_select({ sql: "EXPLAIN ${sql.replace(/\n/g, ' ')}" })`,
              '2. 将返回结果传入 action=analyze 进行分析',
            ],
            快速诊断: {
              检查是否有全表扫描: `检查 EXPLAIN 的 type 列是否为 ALL`,
              检查索引使用: `检查 key 列是否为 NULL`,
              检查文件排序: `检查 Extra 列是否包含 Using filesort`,
              检查临时表: `检查 Extra 列是否包含 Using temporary`,
            },
          },
        };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}。支持: analyze / diagnose` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'query_analyzer',
  description: 'MySQL查询分析技能 — 解读EXPLAIN执行计划、识别全表扫描/文件排序/临时表 → SQL优化建议',
  abilities: ['MySQL', 'SQL查询', '性能优化'],
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['analyze', 'diagnose'],
        description: '操作类型：analyze=分析EXPLAIN结果 / diagnose=生成诊断指引',
      },
      sql: { type: 'string', description: 'SQL语句（diagnose时使用）' },
      explainResult: {
        description: 'EXPLAIN结果（analyze时使用），支持JSON格式或表格数组',
      },
    },
    required: ['action'],
  },
  execute,
};
