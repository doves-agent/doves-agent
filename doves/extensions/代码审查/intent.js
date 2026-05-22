/**
 * 代码审查意图定义
 */
export default {
  intents: {
    CODE_REVIEW: '代码审查',
  },

  executionModeMap: {
    代码审查: '先规划后执行',
  },

  // 意图识别关键词线索（用于规则快速路径 + 扩展能力注册表自动生成意图摘要）
  intentKeywords: {
    代码审查: ['审查代码', '代码审查', 'review', 'PR审查', '安全扫描', '质量检查', '代码质量', 'code review', '审查PR', '质量门禁', '代码规范检查', '复杂度', '依赖漏洞', '依赖安全', '依赖审查', 'npm audit'],
  },
};
