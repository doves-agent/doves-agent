/**
 * 元素拆解意图定义
 */
export default {
  intents: {
    ELEMENT_EXTRACT: '元素拆解',
  },

  executionModeMap: {
    元素拆解: '先规划后执行',
  },

  // 意图识别关键词线索
  intentKeywords: {
    元素拆解: ['拆元素', '提取元素', '图片拆解', '元素分割', '拆图', '拆出元素', '元素提取',
      '抠图', '抠元素', '分离元素', '图片分割', '元素分离', '图像拆解', '拆图片',
      '拆一下', '拆解图', '拆解图片', '拆解元素', '拆这张图', '拆那张图',
      '把图拆', '把元素拆', '图里拆', '图片里拆', '从图里拆', '从图中拆',
      'element extract', 'extract elements', 'split image', 'segment image'],
  },
};
