/**
 * MongoDB代理执行增强
 * 提供条件性系统提示词 + 操作安全指引
 */
export default {
  conditionalPrompts: [
    {
      match: (任务, tools) => {
        const 能力需求 = 任务.能力需求 || [];
        return 能力需求.some(a => ['MongoDB', '数据库', '数据查询', '数据管理'].includes(a));
      },
      prompt: `【MongoDB工具优先级】
- 连接/验证 → mongo_connect
- 列出集合 → mongo_list_collections
- 集合统计 → mongo_collection_stats
- 查询数据 → mongo_find（建议设limit）
- 单条查询 → mongo_find_one
- 计数 → mongo_count_documents
- 去重值 → mongo_distinct
- 聚合分析 → mongo_aggregate
- 插入数据 → mongo_insert_one / mongo_insert_many
- 更新数据 → mongo_update_one / mongo_update_many（需用户确认）
- 替换文档 → mongo_replace_one（整体替换，保留_id）
- 删除数据 → mongo_delete_one / mongo_delete_many（需用户确认）
- 导入数据 → mongo_import（支持内联JSON数组和文件路径）
- 导出数据 → mongo_export（支持JSON/CSV，可选写文件）
- 索引管理 → mongo_list_indexes / mongo_create_index / mongo_drop_index

【可用技能】
- 查询分析 → query_analyzer（分析慢查询、解读explain、诊断集合健康度）
- 索引建议 → index_advisor（推荐最佳索引、ESR规则、评估索引效果）
- 数据迁移 → data_migration（集合间迁移、字段映射、分批安全处理）
- 备份恢复 → backup_restore（集合级备份、安全恢复、备份文件管理）

【安全规则】
- 禁止 DROP DATABASE
- 批量更新/删除前必须先使用 询问用户 向用户确认
- 查询默认限制 100 条，大数据量提示用户
- 禁止使用 $where`,
    },
  ],

  hooks: {},
};
