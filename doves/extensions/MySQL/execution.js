/**
 * MySQL代理执行增强
 * 提供条件性系统提示词 + 操作安全指引
 */
export default {
  conditionalPrompts: [
    {
      match: (任务, tools) => {
        const 能力需求 = 任务.能力需求 || [];
        return 能力需求.some(a => ['MySQL', '数据库', 'SQL查询', '数据管理'].includes(a));
      },
      prompt: `【MySQL工具优先级】
- 连接/验证 → mysql_connect
- 列出表 → mysql_show_tables
- 查看表结构 → mysql_describe_table
- 查看建表语句 → mysql_show_create_table
- 查看索引 → mysql_show_indexes
- 数据查询 → mysql_select（建议加LIMIT）
- 插入数据 → mysql_insert
- 更新数据 → mysql_update（必须有WHERE，需用户确认）
- 删除数据 → mysql_delete（必须有WHERE，需用户确认）
- 导入导出 → mysql_import / mysql_export
- 创建表 → mysql_create_table（需用户确认）
- 修改表 → mysql_alter_table（需用户确认）
- 删除表 → mysql_drop_table（需用户确认，不可恢复）
- 备份 → mysql_backup

【可用技能】
- 查询分析 → query_analyzer（解读EXPLAIN、识别全表扫描/文件排序/临时表）
- 索引建议 → index_advisor（分析WHERE/JOIN/ORDER BY → 推荐复合索引 → 生成DDL）
- 数据迁移 → data_migration（生成迁移方案→INSERT...SELECT SQL→分批执行→校验）
- 备份恢复 → backup_restore（表级备份SQL/CSV → 安全恢复 → 备份管理）

【安全规则】
- 禁止 DROP DATABASE
- DELETE/UPDATE 必须有 WHERE 条件
- 所有写操作（INSERT/UPDATE/DELETE/DDL）前必须先使用 询问用户 向用户确认
- 查询默认限制 200 行
- 不允许多语句执行（防注入）`,
    },
  ],

  hooks: {},
};
