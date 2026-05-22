/**
 * 词阵对弈 - 意图识别模块
 * 识别用户关于词阵对弈游戏的意图
 */
export default {
  // 意图类型
  intents: {
    CI_ZHEN_DUI_YI_PLAY: '词阵对弈',
    CI_ZHEN_DUI_YI_CREATE: '词阵对弈创建',
    CI_ZHEN_DUI_YI_JOIN: '词阵对弈加入',
  },

  // 意图→执行模式映射
  executionModeMap: {
    '词阵对弈': '直接执行',
    '词阵对弈创建': '直接执行',
    '词阵对弈加入': '直接执行',
  },

  // 意图识别关键词线索（用于规则快速路径 + 扩展能力注册表自动生成意图摘要）
  intentKeywords: {
    '词阵对弈': ['词阵对弈', '玩词阵', '词语游戏', '对战', '开战'],
    '词阵对弈创建': ['创建房间', '开房间', '新建游戏', '创建对战', '开战房'],
    '词阵对弈加入': ['加入房间', '加入游戏', '加入对战', '匹配'],
  },

  // 意图上下文映射（保留用于页面路由）
  contextMap: {
    CI_ZHEN_DUI_YI_PLAY: { module: '词阵对弈', page: 'ci-zhen-dui-yi-lobby' },
    CI_ZHEN_DUI_YI_CREATE: { module: '词阵对弈', page: 'ci-zhen-dui-yi-lobby' },
    CI_ZHEN_DUI_YI_JOIN: { module: '词阵对弈', page: 'ci-zhen-dui-yi-lobby' },
  },
};
