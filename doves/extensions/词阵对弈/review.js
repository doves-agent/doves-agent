/**
 * 词阵对弈 - 审核规则模块
 * 对游戏相关输出进行审核
 */
export default {
  // 审核规则列表
  rules: [
    {
      name: 'game_content_safe',
      description: '游戏内容安全审核',
      check: async (content) => {
        // 游戏内容基本安全规则
        const sensitiveWords = ['色情', '暴力血腥', '政治敏感'];
        for (const word of sensitiveWords) {
          if (content.includes(word)) {
            return { passed: false, reason: `内容包含敏感词: ${word}` };
          }
        }
        return { passed: true };
      },
    },
    {
      name: 'idiom_valid_format',
      description: '成语格式审核',
      check: async (content) => {
        // 成语格式的初步审核(详细校验由LLM完成)
        if (content && content.length > 0 && content.length < 50) {
          return { passed: true };
        }
        return { passed: false, reason: '成语/词语长度异常' };
      },
    },
  ],

  // 默认审核策略
  defaultStrategy: 'lenient',

  // 审核策略配置
  strategies: {
    strict: {
      rules: ['game_content_safe', 'idiom_valid_format'],
      mode: 'all', // 全部通过才放行
    },
    lenient: {
      rules: ['game_content_safe'],
      mode: 'all',
    },
  },
};
