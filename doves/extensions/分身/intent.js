/**
 * 人类分身意图定义
 */
export default {
  intents: {
    HUMAN_AVATAR: '分身',
  },

  executionModeMap: {
    分身: '先规划后执行',
  },

  // 意图识别关键词线索（用于规则快速路径 + 扩展能力注册表自动生成意图摘要）
  intentKeywords: {
    分身: ['导入聊天记录', '学习我的语气', '帮我回消息', '分身', '代回复', 'AI替我说话', '模仿语气', '个人分身', 'autoreply', 'avatar', 'human avatar', '聊天记录', '语气', '回复风格', '自动回复', '分身配置'],
  },
};
