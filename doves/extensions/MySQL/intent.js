/**
 * MySQL代理意图定义
 */
export default {
  intents: {
    MYSQL_AGENT: 'MySQL',
  },

  executionModeMap: {
    MySQL: '先规划后执行',
  },

  // 意图识别关键词线索（用于规则快速路径 + 扩展能力注册表自动生成意图摘要）
  intentKeywords: {
    MySQL: ['查数据库', 'MySQL', 'SQL查询', 'SQL', '表', 'table', '查询', 'select', '数据库', '数据表', '表结构', 'join', 'group by', 'order by', 'where', 'insert', 'update', 'delete from', '数据库查询', 'mysql查询', '关联查询', '数据导出', '数据导入', '数据库管理'],
  },
};
