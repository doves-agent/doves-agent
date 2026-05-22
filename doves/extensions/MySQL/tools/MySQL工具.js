/**
 * MySQL数据库工具
 * 通过自然语言操作MySQL：SQL查询/表管理/导入导出
 * 底层通过 mysql2 连接MySQL数据库（npm install mysql2）
 */

// ==================== 工具定义 ====================

export const extTools = [
  // ---------- 连接管理 ----------
  {
    name: 'mysql_connect',
    description: '配置或验证MySQL数据库连接',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'config', 'test'], description: '操作类型：status=查看连接状态，config=配置新连接，test=测试连接' },
        host: { type: 'string', description: '主机地址（action=config时必填）', default: 'localhost' },
        port: { type: 'number', description: '端口', default: 3306 },
        user: { type: 'string', description: '用户名（action=config时必填）' },
        password: { type: 'string', description: '密码（action=config时必填）' },
        database: { type: 'string', description: '数据库名称（action=config时必填）' },
      },
      required: ['action'],
    },
  },
  // ---------- 表信息 ----------
  {
    name: 'mysql_show_tables',
    description: '列出当前数据库的所有表',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: '按表名筛选（LIKE模式，可选）' },
        detailed: { type: 'boolean', description: '是否显示表的详细信息（行数/引擎/创建时间）', default: false },
      },
    },
  },
  {
    name: 'mysql_describe_table',
    description: '查看表的列结构、类型、默认值、是否可为空',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '表名' },
      },
      required: ['table'],
    },
  },
  {
    name: 'mysql_show_create_table',
    description: '查看建表语句（CREATE TABLE DDL）',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '表名' },
      },
      required: ['table'],
    },
  },
  {
    name: 'mysql_show_indexes',
    description: '查看表的索引信息',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '表名' },
      },
      required: ['table'],
    },
  },
  // ---------- 数据查询 ----------
  {
    name: 'mysql_select',
    description: '执行SELECT查询，返回结果集',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SELECT查询语句（不需要加分号）' },
        params: { type: 'array', items: { type: 'string' }, description: '参数化查询的参数（防止SQL注入）' },
        limit: { type: 'number', description: '返回行数上限（默认200）', default: 200 },
      },
      required: ['sql'],
    },
  },
  {
    name: 'mysql_select_one',
    description: '查询单行结果',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SELECT查询语句' },
        params: { type: 'array', items: { type: 'string' }, description: '参数化查询的参数' },
      },
      required: ['sql'],
    },
  },
  // ---------- 数据写入 ----------
  {
    name: 'mysql_insert',
    description: '向表中插入数据（需确认）',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '表名' },
        data: { type: 'object', description: '要插入的数据（键值对，字段名: 值）' },
        orUpdate: { type: 'boolean', description: '是否使用 ON DUPLICATE KEY UPDATE', default: false },
      },
      required: ['table', 'data'],
    },
  },
  {
    name: 'mysql_update',
    description: '更新表中数据（需确认，必须有WHERE条件）',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '表名' },
        data: { type: 'object', description: '要更新的数据（键值对）' },
        where: { type: 'string', description: 'WHERE条件（必填）' },
        whereParams: { type: 'array', items: { type: 'string' }, description: 'WHERE条件的参数化值' },
      },
      required: ['table', 'data', 'where'],
    },
  },
  {
    name: 'mysql_delete',
    description: '删除表中数据（需确认，必须有WHERE条件）',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '表名' },
        where: { type: 'string', description: 'WHERE条件（必填）' },
        whereParams: { type: 'array', items: { type: 'string' }, description: 'WHERE条件的参数化值' },
      },
      required: ['table', 'where'],
    },
  },
  // ---------- 导入导出 ----------
  {
    name: 'mysql_import',
    description: '从文件导入数据到表（支持CSV/JSON/SQL格式）',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '目标表名' },
        filePath: { type: 'string', description: '文件路径' },
        format: { type: 'string', enum: ['csv', 'json', 'sql'], description: '文件格式', default: 'csv' },
        hasHeader: { type: 'boolean', description: 'CSV是否包含表头行', default: true },
        truncateFirst: { type: 'boolean', description: '是否先清空表再导入', default: false },
      },
      required: ['table', 'filePath'],
    },
  },
  {
    name: 'mysql_export',
    description: '将表或查询结果导出到文件（CSV/JSON/SQL）',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '表名或SQL查询' },
        filePath: { type: 'string', description: '输出文件路径' },
        format: { type: 'string', enum: ['csv', 'json', 'sql'], description: '输出格式', default: 'csv' },
        where: { type: 'string', description: 'WHERE条件（可选）' },
        limit: { type: 'number', description: '导出行数上限', default: 5000 },
      },
      required: ['table', 'filePath'],
    },
  },
  // ---------- DDL操作 ----------
  {
    name: 'mysql_create_table',
    description: '创建新表（需确认）',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'CREATE TABLE语句' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'mysql_alter_table',
    description: '修改表结构（需确认，危险操作）',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'ALTER TABLE语句' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'mysql_drop_table',
    description: '删除表（需确认，危险操作，不可恢复）',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '要删除的表名' },
      },
      required: ['table'],
    },
  },
  {
    name: 'mysql_execute',
    description: '执行自定义SQL（仅限管理员，需确认）',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: '要执行的SQL语句' },
        params: { type: 'array', items: { type: 'string' }, description: '参数化值' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'mysql_backup',
    description: '备份表或整个数据库',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '要备份的表名（为空则备份整个数据库）' },
        outputPath: { type: 'string', description: '备份文件输出路径' },
        format: { type: 'string', enum: ['sql', 'csv'], description: '备份格式', default: 'sql' },
        includeCreateTable: { type: 'boolean', description: '是否包含建表语句', default: true },
      },
      required: ['outputPath'],
    },
  },
];

// ==================== 工具执行器 ====================

export async function handleExtTool(toolName, args) {
  // 只处理 mysql_ 前缀的工具，其他工具返回 null 让路由继续
  if (!toolName.startsWith('mysql_')) return null;

  const mysql = await import('mysql2/promise');
  return await executeWithMySQL(toolName, args, mysql);
}

// 连接池
let pool = null;

/**
 * 获取或创建连接池
 */
async function getPool() {
  if (pool) return pool;
  throw new Error('MySQL未连接。请先使用 mysql_connect(action="config") 配置连接');
}

/**
 * 通过 mysql2 执行
 */
async function executeWithMySQL(toolName, args, mysql) {
  switch (toolName) {
    case 'mysql_connect': {
      const { action, host = 'localhost', port = 3306, user, password, database } = args;

      if (action === 'status') {
        if (!pool) {
          return { content: [{ type: 'text', text: JSON.stringify({ connected: false, message: '未连接到MySQL' }) }] };
        }
        try {
          const conn = await pool.getConnection();
          const [rows] = await conn.execute('SELECT VERSION() AS version');
          conn.release();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                connected: true,
                version: rows[0].version,
                database: pool.config.connectionConfig.database,
                host: pool.config.connectionConfig.host,
              }, null, 2),
            }],
          };
        } catch (err) {
          return { content: [{ type: 'text', text: JSON.stringify({ connected: false, error: err.message }) }] };
        }
      }

      if (action === 'test') {
        try {
          const testPool = mysql.createPool({ host, port, user, password, database, connectionLimit: 1 });
          const conn = await testPool.getConnection();
          const [rows] = await conn.execute('SELECT 1 AS ok');
          conn.release();
          await testPool.end();
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `MySQL连接测试成功` }) }] };
        } catch (err) {
          return { isError: true, content: [{ type: 'text', text: `连接测试失败: ${err.message}` }] };
        }
      }

      if (action === 'config') {
        if (!user || !password || !database) {
          return { isError: true, content: [{ type: 'text', text: '配置MySQL连接需要提供 user, password, database' }] };
        }
        if (pool) await pool.end();
        pool = mysql.createPool({ host, port, user, password, database, waitForConnections: true, connectionLimit: 5 });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'MySQL连接已配置',
              host, port, database,
              hint: '使用 mysql_show_tables 查看可用表',
            }, null, 2),
          }],
        };
      }
      break;
    }

    case 'mysql_show_tables': {
      const p = await getPool();
      const [rows] = await p.execute('SELECT TABLE_NAME, TABLE_ROWS, ENGINE, CREATE_TIME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ tables: rows, total: rows.length }, null, 2),
        }],
      };
    }

    case 'mysql_describe_table': {
      const p = await getPool();
      const [rows] = await p.execute(`DESCRIBE \`${args.table}\``);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ table: args.table, columns: rows }, null, 2),
        }],
      };
    }

    case 'mysql_show_create_table': {
      const p = await getPool();
      const [rows] = await p.execute(`SHOW CREATE TABLE \`${args.table}\``);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ table: args.table, createTable: rows[0]['Create Table'] }, null, 2),
        }],
      };
    }

    case 'mysql_show_indexes': {
      const p = await getPool();
      const [rows] = await p.execute(`SHOW INDEXES FROM \`${args.table}\``);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ table: args.table, indexes: rows }, null, 2),
        }],
      };
    }

    case 'mysql_select':
    case 'mysql_select_one': {
      const p = await getPool();
      const { sql, params } = args;
      const isOne = toolName === 'mysql_select_one';
      const finalSQL = isOne ? `${sql.replace(/;$/, '')} LIMIT 1` : sql;
      const [rows] = params ? await p.execute(finalSQL, params) : await p.execute(finalSQL);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            data: isOne ? (rows[0] || null) : rows,
            total: rows.length,
            sql: finalSQL.slice(0, 200),
          }, null, 2),
        }],
      };
    }

    case 'mysql_insert': {
      const p = await getPool();
      const { table, data, orUpdate } = args;
      const keys = Object.keys(data);
      const values = Object.values(data);
      const placeholders = keys.map(() => '?').join(', ');
      const columns = keys.map(k => `\`${k}\``).join(', ');
      let sql = `INSERT INTO \`${table}\` (${columns}) VALUES (${placeholders})`;
      if (orUpdate) {
        const updates = keys.map(k => `\`${k}\` = VALUES(\`${k}\`)`).join(', ');
        sql += ` ON DUPLICATE KEY UPDATE ${updates}`;
      }
      const [result] = await p.execute(sql, values);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            affectedRows: result.affectedRows,
            insertId: result.insertId,
          }, null, 2),
        }],
      };
    }

    case 'mysql_update': {
      const p = await getPool();
      const { table, data, where, whereParams } = args;
      const setClause = Object.keys(data).map(k => `\`${k}\` = ?`).join(', ');
      const values = [...Object.values(data), ...(whereParams || [])];
      const sql = `UPDATE \`${table}\` SET ${setClause} WHERE ${where}`;
      const [result] = await p.execute(sql, values);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            affectedRows: result.affectedRows,
            changedRows: result.changedRows,
          }, null, 2),
        }],
      };
    }

    case 'mysql_delete': {
      const p = await getPool();
      const { table, where, whereParams } = args;
      const sql = `DELETE FROM \`${table}\` WHERE ${where}`;
      const [result] = await p.execute(sql, whereParams || []);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            affectedRows: result.affectedRows,
          }, null, 2),
        }],
      };
    }

    default:
      throw new Error(`不支持的MySQL工具: ${toolName}`);
  }
}

