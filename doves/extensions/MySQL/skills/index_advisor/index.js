/**
 * 索引顾问技能 — MySQL
 * 分析SQL查询的WHERE/JOIN/ORDER BY → 推荐最佳索引（复合索引列顺序优化）
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('mysql_index_advisor', { 前缀: '[mysql_index_advisor]', 级别: 'debug', 显示调用位置: true });

/**
 * 从SQL中提取关键信息
 */
function 解析SQL(sql) {
  const upper = sql.toUpperCase().trim();
  const info = {
    tables: [],
    whereColumns: [],
    joinColumns: [],
    orderByColumns: [],
    groupByColumns: [],
    isJoin: upper.includes(' JOIN '),
    isSubquery: upper.includes('(SELECT'),
  };

  // 提取 FROM 后的表名（简单解析）
  const fromMatch = sql.match(/FROM\s+`?(\w+)`?/i);
  if (fromMatch) info.tables.push({ name: fromMatch[1], alias: null });

  // 提取 JOIN 表名
  const joinMatches = sql.matchAll(/JOIN\s+`?(\w+)`?(?:\s+(?:AS\s+)?(\w+))?/gi);
  for (const m of joinMatches) {
    info.tables.push({ name: m[1], alias: m[2] || null });
    info.isJoin = true;
  }

  // 提取 WHERE 中的列
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:GROUP BY|ORDER BY|LIMIT|HAVING|$)/is);
  if (whereMatch) {
    const whereClause = whereMatch[1].trim();
    // 匹配 `table`.`column` 或 column
    const colMatches = whereClause.matchAll(/(?:`?\w+`?\.)?`?(\w+)`?\s*(?:=|>|<|>=|<=|!=|IN|LIKE|BETWEEN|IS)/gi);
    for (const m of colMatches) {
      if (!['AND', 'OR', 'NOT', 'NULL'].includes(m[1].toUpperCase())) {
        info.whereColumns.push(m[1]);
      }
    }
    // ON 子句中的列（JOIN条件）
    const onMatches = sql.matchAll(/ON\s+.*?(?:`?\w+`?\.)?`?(\w+)`?\s*=/gi);
    for (const m of onMatches) {
      if (!['AND', 'OR', 'NOT'].includes(m[1].toUpperCase())) {
        info.joinColumns.push(m[1]);
      }
    }
  }

  // ORDER BY
  const orderMatch = sql.match(/ORDER BY\s+(.+?)(?:LIMIT|$)/is);
  if (orderMatch) {
    const cols = orderMatch[1].split(',').map(c => c.trim());
    for (const col of cols) {
      const name = col.replace(/`?\w+`?\./g, '').replace(/`/g, '').replace(/\s+(ASC|DESC).*/i, '').trim();
      info.orderByColumns.push(name);
    }
  }

  // GROUP BY
  const groupMatch = sql.match(/GROUP BY\s+(.+?)(?:ORDER BY|LIMIT|HAVING|$)/is);
  if (groupMatch) {
    const cols = groupMatch[1].split(',').map(c => c.trim());
    for (const col of cols) {
      const name = col.replace(/`?\w+`?\./g, '').replace(/`/g, '').trim();
      info.groupByColumns.push(name);
    }
  }

  return info;
}

/**
 * 根据SQL分析推荐索引
 */
function 推荐索引(columns, tables) {
  const 建议列表 = [];
  const 主表 = tables?.[0]?.name || '(主表)';

  // 1. WHERE 条件索引（最优先）
  if (columns.whereColumns.length > 0) {
    // 去重
    const uniqueCols = [...new Set(columns.whereColumns)];

    if (uniqueCols.length === 1) {
      建议列表.push({
        表: 主表,
        类型: '普通索引',
        列: uniqueCols,
        索引键: `${uniqueCols[0]}`,
        理由: `WHERE 条件中使用了 ${uniqueCols[0]}，创建索引可避免全表扫描`,
        优先级: '高',
      });
    } else {
      // 复合索引：WHERE条件列 + ORDER BY列 + GROUP BY列
      const 复合列 = [...uniqueCols];
      // ORDER BY 放在 WHERE 之后
      for (const col of columns.orderByColumns) {
        if (!复合列.includes(col)) 复合列.push(col);
      }
      // GROUP BY 放最后
      for (const col of columns.groupByColumns) {
        if (!复合列.includes(col)) 复合列.push(col);
      }

      建议列表.push({
        表: 主表,
        类型: '复合索引',
        列: 复合列,
        索引键: 复合列.join(', '),
        理由: `WHERE 条件包含多个列 (${uniqueCols.join(', ')})${columns.orderByColumns.length > 0 ? '，且需要排序 (' + columns.orderByColumns.join(', ') + ')' : ''}。复合索引遵循：WHERE等值条件 → ORDER BY → GROUP BY`,
        优先级: '高',
      });
    }
  }

  // 2. ORDER BY 索引（如果没有WHERE条件）
  if (columns.whereColumns.length === 0 && columns.orderByColumns.length > 0) {
    建议列表.push({
      表: 主表,
      类型: '普通索引',
      列: columns.orderByColumns,
      索引键: columns.orderByColumns.join(', '),
      理由: `无 WHERE 条件但需要按 ${columns.orderByColumns.join(', ')} 排序，创建索引可避免 filesort`,
      优先级: '中',
    });
  }

  // 3. JOIN 列索引
  if (columns.isJoin && columns.joinColumns.length > 0) {
    const uniqueJoinCols = [...new Set(columns.joinColumns)];
    建议列表.push({
      表: 'JOIN表',
      类型: '外键索引',
      列: uniqueJoinCols,
      索引键: uniqueJoinCols.join(', '),
      理由: `JOIN 连接列 (${uniqueJoinCols.join(', ')}) 缺少索引会导致全表扫描关联`,
      优先级: '高',
    });
  }

  // 4. GROUP BY 索引
  if (columns.groupByColumns.length > 0 && !建议列表.some(s => s.列?.some(c => columns.groupByColumns.includes(c)))) {
    建议列表.push({
      表: 主表,
      类型: '普通索引',
      列: columns.groupByColumns,
      索引键: columns.groupByColumns.join(', '),
      理由: `GROUP BY 列 (${columns.groupByColumns.join(', ')}) 创建索引可避免临时表排序`,
      优先级: '中',
    });
  }

  return 建议列表;
}

async function execute(args, context) {
  const { action = 'recommend', sql, table, whereColumns, orderByColumns, groupByColumns, joinColumns, isJoin } = args;

  logger.info(`执行: ${action}`);

  try {
    switch (action) {
      // 推荐索引：从SQL分析推荐
      case 'recommend': {
        if (sql) {
          // 从SQL自动解析
          const columns = 解析SQL(sql);
          const 建议列表 = 推荐索引(columns, columns.tables);

          return {
            成功: true,
            数据: {
              sql,
              解析结果: {
                涉及表: columns.tables,
                WHERE列: columns.whereColumns,
                JOIN列: columns.joinColumns,
                ORDER_BY列: columns.orderByColumns,
                GROUP_BY列: columns.groupByColumns,
                是否多表: columns.isJoin,
              },
              推荐索引: 建议列表,
              DDL示例: 建议列表.map(s =>
                `CREATE INDEX idx_${(s.列 || ['col']).join('_')} ON \`${s.表}\` (${s.索引键});`
              ),
              规则说明: '复合索引列顺序：WHERE等值条件列 → ORDER BY列 → GROUP BY列。最左前缀原则：查询必须使用索引的最左列才能利用索引',
            },
          };
        }

        // 手动指定列的场景
        if (table && (whereColumns || orderByColumns || groupByColumns)) {
          const columns = {
            whereColumns: whereColumns || [],
            orderByColumns: orderByColumns || [],
            groupByColumns: groupByColumns || [],
            joinColumns: joinColumns || [],
            isJoin: isJoin || false,
          };
          const 建议列表 = 推荐索引(columns, [{ name: table }]);

          return {
            成功: true,
            数据: {
              表: table,
              分析列: columns,
              推荐索引: 建议列表,
              DDL示例: 建议列表.map(s =>
                `CREATE INDEX idx_${(s.列 || ['col']).join('_')} ON \`${table}\` (${s.索引键});`
              ),
            },
          };
        }

        return {
          成功: false,
          错误: '请提供 sql（SQL语句自动解析）或 table + whereColumns（手动指定）',
          示例: {
            sql模式: '{ action: "recommend", sql: "SELECT * FROM users WHERE email = ? AND status = ? ORDER BY created_at DESC" }',
            手动模式: '{ action: "recommend", table: "users", whereColumns: ["email", "status"], orderByColumns: ["created_at"] }',
          },
        };
      }

      // 评估现有索引
      case 'evaluate': {
        if (!sql) {
          return { 成功: false, 错误: '缺少必填参数: sql' };
        }

        return {
          成功: true,
          数据: {
            sql,
            message: '请通过以下步骤评估现有索引效果',
            操作步骤: [
              `1. mysql_select({ sql: "EXPLAIN ${sql.replace(/\n/g, ' ')}" }) 获取执行计划`,
              '2. mysql_show_indexes({ table: "表名" }) 查看现有索引',
              `3. query_analyzer({ action: "analyze", explainResult: <EXPLAIN结果> }) 分析索引使用情况`,
            ],
            关键指标: '检查 EXPLAIN 的 key 列 — 如果为 NULL 说明未使用索引；检查 Extra 列 — 避免 Using filesort 和 Using temporary',
          },
        };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}。支持: recommend / evaluate` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'index_advisor',
  description: 'MySQL索引顾问技能 — 分析WHERE/JOIN/ORDER BY → 推荐复合索引（最左前缀原则）→ 生成DDL',
  abilities: ['MySQL', '索引管理', '性能优化'],
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['recommend', 'evaluate'],
        description: '操作类型：recommend=推荐索引 / evaluate=评估现有索引',
      },
      sql: { type: 'string', description: 'SQL语句（recommend/evaluate时使用，自动解析列信息）' },
      table: { type: 'string', description: '表名（手动指定模式时使用）' },
      whereColumns: { type: 'array', items: { type: 'string' }, description: 'WHERE条件列（手动指定时使用）' },
      orderByColumns: { type: 'array', items: { type: 'string' }, description: 'ORDER BY列' },
      groupByColumns: { type: 'array', items: { type: 'string' }, description: 'GROUP BY列' },
      joinColumns: { type: 'array', items: { type: 'string' }, description: 'JOIN关联列' },
      isJoin: { type: 'boolean', description: '是否为多表查询' },
    },
    required: ['action'],
  },
  execute,
};
