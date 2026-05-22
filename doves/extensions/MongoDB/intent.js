/**
 * MongoDB代理意图定义
 */
export default {
  intents: {
    MONGO_AGENT: 'MongoDB',
  },

  executionModeMap: {
    MongoDB: '先规划后执行',
  },

  // 意图识别关键词线索（用于规则快速路径 + 扩展能力注册表自动生成意图摘要）
  intentKeywords: {
    MongoDB: ['查数据库', 'MongoDB', 'mongo', '集合', 'collection', '文档', 'document', '聚合', 'aggregate', '索引管理', 'db.', 'find(', 'insert(', '更新数据', '删除数据', '数据导出', '数据导入', '数据库查询', 'mongo查询', '数据统计', 'count(', 'aggregate'],
  },
};
