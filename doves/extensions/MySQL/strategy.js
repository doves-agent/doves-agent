/**
 * MySQL代理规划策略
 * 数据库操作能力组 + 流程案例
 */
import { 生成策略提示词, 生成用户提示词 } from '../../prompts/strategy-base.js';

const 方法论段落 = [
  '【MySQL数据库能力组】',
  '',
  '本扩展提供以下原子工具，可独立调用、自由组合：',
  '',
  '1. 连接与探索工具',
  '   mysql_connect：检查/配置数据库连接',
  '   mysql_show_tables：列出所有表',
  '   mysql_describe_table：查看表结构',
  '   mysql_show_create_table：查看建表语句',
  '   mysql_show_indexes：查看索引',
  '',
  '2. 数据查询工具',
  '   mysql_select：执行SELECT查询（支持JOIN/GROUP BY/ORDER BY/LIKE等）',
  '   mysql_select_one：查询单行',
  '',
  '3. 数据操作工具',
  '   mysql_insert：插入数据',
  '   mysql_update：更新数据（危险，需确认）',
  '   mysql_delete：删除数据（危险，需确认）',
  '',
  '4. 数据导入导出工具',
  '   mysql_import：导入数据（支持CSV/JSON/SQL）',
  '   mysql_export：导出数据（导出为CSV/JSON/SQL）',
  '',
  '5. 高级管理工具',
  '   mysql_execute：执行自定义SQL（仅限管理员模式）',
  '   mysql_create_table：创建表（需确认）',
  '   mysql_alter_table：修改表结构（危险，需确认）',
  '   mysql_drop_table：删除表（危险，需确认）',
  '   mysql_backup：备份指定表或全部',
  '',
  '【流程案例】（参考，非强制）',
  '- 探索未知数据库：mysql_connect → mysql_show_tables → mysql_describe_table → mysql_select',
  '- 条件查询：mysql_connect → mysql_select("SELECT ... WHERE ...")',
  '- 数据修改：mysql_connect → mysql_select(确认数据) → mysql_update/mysql_delete(需确认)',
  '- 表结构变更：mysql_describe_table(现状) → mysql_alter_table(变更，需确认) → mysql_describe_table(验证)',
  '- 数据迁移：mysql_export(源表) → mysql_import(目标表)',
  '',
  '【关键规则】',
  '- 根据用户实际需求灵活组合工具，流程案例仅为参考',
  '- 禁止 DROP DATABASE 操作',
  '- DELETE/UPDATE 必须有 WHERE 条件',
  '- 查询默认限制返回 200 行',
  '- INSERT/UPDATE/DELETE/DROP/ALTER 操作需要用户确认',
  '- 不允许执行多语句（防注入）',
].join('\n');

const 输出格式 = `"mysqlOperation": {
    "operationType": "connect|query|describe|insert|update|delete|import|export|execute|createTable|alterTable|dropTable|backup|showTables",
    "table": "目标表名",
    "sql": "执行的SQL语句摘要",
    "rowCount": 0,
    "needsConfirmation": false
  },`;

const 方法论指引 = '请根据用户实际需求，从MySQL数据库能力组中选择合适的工具组合。流程案例仅供参考，不必拘泥于固定流程。SELECT以外的写操作需要用户确认，DELETE/UPDATE必须有WHERE条件。';

export default {
  strategies: {
    mysql_agent: {
      系统: (最大子任务数 = 10, 当前深度 = 0) => 生成策略提示词(
        'MySQL数据库代理',
        方法论段落,
        输出格式,
        最大子任务数,
        当前深度
      ),

      用户: (任务描述, 能力列表, 可用技能 = []) => 生成用户提示词(
        任务描述,
        能力列表,
        可用技能,
        方法论指引
      ),
    },
  },
};
