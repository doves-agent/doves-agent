/**
 * MySQL能力组声明
 * 扩展 = 能力组 + 流程案例
 */
export default {
  场景: ['MySQL', 'SQL查询', '数据库', '表管理', '数据导入', '数据导出', '关联查询'],

  能力组: [
    {
      名称: 'SQL查询',
      触发关键词: ['SQL查询', 'MySQL查询', 'select', '查询数据', '关联查询'],
      说明: '执行 SQL 查询，支持 select/join/group by 等复杂查询',
      工具: ['mysql_query', 'mysql_explain'],
    },
    {
      名称: '表结构管理',
      触发关键词: ['表结构', '创建表', '修改表', '删除表', 'ALTER TABLE', 'DESC'],
      说明: '查看/创建/修改/删除表结构',
      工具: ['mysql_show_tables', 'mysql_desc', 'mysql_ddl'],
    },
    {
      名称: '数据写入',
      触发关键词: ['插入数据', '更新数据', '删除数据', 'insert', 'update', 'delete'],
      说明: '插入/更新/删除数据',
      工具: ['mysql_execute'],
    },
    {
      名称: '导入导出',
      触发关键词: ['数据导出', '数据导入', '备份', '迁移'],
      说明: '导入导出数据（CSV/SQL dump）',
      工具: ['mysql_export', 'mysql_import'],
    },
  ],

  流程案例: [
    {
      名称: '查询数据',
      适用场景: '用户说"查一下"、"SQL查询"',
      流程: 'mysql_query / mysql_explain',
    },
    {
      名称: '写入数据',
      适用场景: '用户说"插入"、"更新"、"删除"',
      流程: 'mysql_query(确认影响范围) → mysql_execute(执行写入)',
    },
  ],

  关键规则: [
    '流程案例仅供参考，根据用户实际需求灵活组合工具',
    '写入操作前建议先 SELECT 确认影响范围',
    'DELETE/UPDATE 建议带 WHERE 条件',
    '大数据量查询建议加 LIMIT',
  ],
};
