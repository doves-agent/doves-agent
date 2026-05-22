/**
 * Demo展示意图定义
 */
export default {
  intents: {
    DEMO_SHOWCASE: 'Demo展示',
  },

  executionModeMap: {
    Demo展示: '先规划后执行',
  },

  // 意图识别关键词线索（用于规则快速路径 + 扩展能力注册表自动生成意图摘要）
  intentKeywords: {
    Demo展示: ['做一个Demo', '生成展示页面', '产品展示', '数据看板', 'Demo页面', '创建Demo', '展示页面', 'Demo', 'demo', 'showcase', '页面生成', 'Demo模板', '移动端预览'],
  },
};
