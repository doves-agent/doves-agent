/**
 * 进度管理意图定义
 */
export default {
  intents: {
    PROJECT_MGMT: '进度管理',
  },

  executionModeMap: {
    进度管理: '先规划后执行',
  },

  // 意图识别关键词线索（用于规则快速路径 + 扩展能力注册表自动生成意图摘要）
  intentKeywords: {
    进度管理: ['更新禅道', '创建任务', '查看进度', '生成周报', '里程碑', 'Jira', '任务状态', '进度同步', '项目管理', 'project management', 'zentao', 'sprint'],
  },
};
