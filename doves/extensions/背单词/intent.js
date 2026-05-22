/**
 * 词汇学习意图定义
 * 
 * 三种意图:
 * - vocabulary_learning: 学习新词/查词/词根词缀
 * - vocabulary_review: 间隔复习/智能推荐/学习统计
 * - vocabulary_navigate: 页面导航/打开背单词页面
 */
export default {
  // 新增意图类型
  intents: {
    VOCABULARY_LEARNING: 'vocabulary_learning',
    VOCABULARY_REVIEW: 'vocabulary_review',
    VOCABULARY_NAVIGATE: 'vocabulary_navigate',
  },

  // 意图→执行模式映射
  executionModeMap: {
    vocabulary_learning: '直接执行',          // 简单学习任务，直接执行
    vocabulary_review: '管线式',           // 复习任务，管线式（测→评→推荐）
    vocabulary_navigate: '直接执行',           // 页面导航，直接执行
  },

  // 意图识别关键词线索（用于规则快速路径 + 扩展能力注册表自动生成意图摘要）
  intentKeywords: {
    vocabulary_learning: ['背单词', '学单词', '查词', '查一下', '词根', '词缀', '英语学习', '记单词', '什么意思', '怎么读', '释义', '这个单词', '怎么拼'],
    vocabulary_review: ['复习', '间隔复习', '推荐', '推荐单词', '推荐新词', '学习统计', '掌握度', '今天学了', '待复习', '智能推荐', '新词', '背过的'],
    vocabulary_navigate: ['打开背单词', '打开学习页面', '打开复习页面', '打开统计', '背单词页面', '显示学习页', '显示复习页', '学习页面', '复习页面', '背单词界面', '词汇页面'],
  },
};
