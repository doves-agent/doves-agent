/**
 * MongoDB能力组声明
 * 扩展 = 能力组 + 流程案例
 */
export default {
  场景: ['MongoDB', '查数据库', 'mongo', '聚合', '索引管理', '数据导出', '数据导入'],

  能力组: [
    {
      名称: '数据查询',
      触发关键词: ['查数据库', 'MongoDB查询', 'mongo查询', 'find', 'aggregate', '数据统计'],
      说明: '查询文档、聚合统计、count 统计',
      工具: ['mongo_find', 'mongo_aggregate', 'mongo_count'],
    },
    {
      名称: '数据写入',
      触发关键词: ['插入数据', '更新数据', '删除数据', 'MongoDB写入'],
      说明: '插入/更新/删除文档',
      工具: ['mongo_insertOne', 'mongo_updateOne', 'mongo_deleteOne', 'mongo_updateMany', 'mongo_deleteMany'],
    },
    {
      名称: '索引管理',
      触发关键词: ['索引', '创建索引', '删除索引', '索引管理'],
      说明: '创建/删除/查看索引',
      工具: ['mongo_createIndex', 'mongo_dropIndex', 'mongo_getIndexes'],
    },
    {
      名称: '导入导出',
      触发关键词: ['数据导出', '数据导入', '备份', '恢复', '迁移'],
      说明: '导入导出数据（JSON/CSV）、备份恢复',
      工具: ['mongo_export', 'mongo_import'],
    },
  ],

  流程案例: [
    {
      名称: '查询数据',
      适用场景: '用户说"查一下"、"统计有多少"',
      流程: 'mongo_find / mongo_aggregate / mongo_count',
    },
    {
      名称: '写入数据',
      适用场景: '用户说"插入"、"更新"、"删除"',
      流程: 'mongo_count(确认影响范围) → mongo_insertOne / mongo_updateOne / mongo_deleteOne',
    },
    {
      名称: '导入导出',
      适用场景: '用户说"导出数据"、"导入数据"',
      流程: 'mongo_export / mongo_import',
    },
  ],

  关键规则: [
    '流程案例仅供参考，根据用户实际需求灵活组合工具',
    '写入操作前建议先查询确认影响范围',
    '删除操作建议先展示匹配数量',
    '大数据量查询建议加 limit',
  ],
};
