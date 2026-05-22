/**
 * 文档意图定义
 */
export default {
  intents: {
    DOCUMENT: '文档',
  },

  executionModeMap: {
    文档: '先规划后执行',
  },

  // 意图识别关键词线索（用于规则快速路径 + 扩展能力注册表自动生成意图摘要）
  intentKeywords: {
    文档: ['生成文档', '更新文档', 'API文档', 'README', 'changelog', '文档同步', '找文档', '文档搜索', '文档管理', '架构文档', '变更日志', 'document', 'doc generate'],
  },
};
