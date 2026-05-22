/**
 * 编码意图定义
 * 迁移自 意图识别器.js 中的 CODING 意图和策略执行模式映射
 */
export default {
  // 新增意图类型
  intents: {
    CODING: 'coding',
  },

  // 意图→执行模式映射
  executionModeMap: {
    coding: '先规划后执行',
  },

  // 意图识别关键词线索（用于规则快速路径 + 扩展能力注册表自动生成意图摘要）
  intentKeywords: {
    coding: ['修改代码', '开发功能', '修复bug', '重构', '写代码', '编程', 'code', 'programming', 'debug', 'refactor', '分析代码', '搜索代码', '找bug', '调试', '代码分析', '语义搜索', '代码智能', '跳转', '引用', '符号', '代码审查'],
  },
};
