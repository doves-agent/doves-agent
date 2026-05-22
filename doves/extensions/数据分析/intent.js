/**
 * 数据统计意图定义
 */
export default {
  intents: {
    DATA_ANALYTICS: '数据分析',
  },

  executionModeMap: {
    数据分析: '先规划后执行',
  },

  // 意图识别关键词线索（用于规则快速路径 + 扩展能力注册表自动生成意图摘要）
  intentKeywords: {
    数据分析: ['查询数据', '统计分析', '生成报表', '数据看板', '异常检测', '数据分析', '数据源', 'SQL查询', '数据可视化', 'data analytics', 'report', 'dashboard'],
  },
};
