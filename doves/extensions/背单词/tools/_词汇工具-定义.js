/**
 * @file 词汇工具-定义.js
 * @description 词汇学习工具的 extTools 定义，从 词汇工具.js 抽取
 * 11个词汇工具：查词、学习、复习、统计、推荐、生成、颜色模板、页面导航
 *
 * 所有工具统一走任务队列，Doves 自主拉取执行。
 */

export const extTools = [
  {
    name: 'word_query',
    description: '查询单词详情，包括音标、词根词缀、释义、关联词、例句等。返回结构化的单词数据。',
    inputSchema: {
      type: 'object',
      properties: {
        word: { type: 'string', description: '要查询的英文单词（必填）' },
      },
      required: ['word']
    }
  },
  {
    name: 'word_learn',
    description: '记录单词学习结果。学完一个单词后调用，会自动同步到白鸽记忆系统。',
    inputSchema: {
      type: 'object',
      properties: {
        word_id: { type: 'string', description: '单词ID（从word_query获取）' },
        correct: { type: 'boolean', description: '是否回答正确' },
        time_spent: { type: 'number', description: '学习耗时(秒)' },
      },
      required: ['word_id', 'correct']
    }
  },
  {
    name: 'word_review_list',
    description: '获取今日待复习单词列表（SM2算法计算）。返回需要复习的单词及其当前掌握度。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '返回数量（默认20）' },
      },
    }
  },
  {
    name: 'word_review_submit',
    description: '提交单词复习结果，SM2算法会据此调整下次复习时间和间隔。',
    inputSchema: {
      type: 'object',
      properties: {
        record_id: { type: 'string', description: '学习记录ID' },
        feedback: { type: 'string', enum: ['unknown', 'vague', 'known', 'again', 'hard', 'good', 'easy'], description: '掌握程度：unknown/again=不认识，vague=模糊，hard=费力，good=认识，known/easy=熟悉' },
      },
      required: ['record_id', 'feedback']
    }
  },
  {
    name: 'learning_stats',
    description: '获取用户学习统计，包括今日学习/复习数量、总掌握词数、连续学习天数等。',
    inputSchema: {
      type: 'object',
      properties: {},
    }
  },
  {
    name: 'smart_recommend',
    description: '获取智能推荐单词。基于白鸽记忆+用户掌握度+难度偏好，AI推荐适合学习的单词。',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: '推荐数量（默认5）' },
        increment: { type: 'number', description: '难度递增百分比（默认5）' },
      },
    }
  },
  {
    name: 'word_generate',
    description: 'AI生成单词详细数据并入库。首次调用不传word_data，系统返回模板；LLM填充后第二次调用传入word_data即可入库。',
    inputSchema: {
      type: 'object',
      properties: {
        word: { type: 'string', description: '要生成的英文单词' },
        word_data: { type: 'object', description: 'LLM生成的完整单词数据（首次调用不传，LLM填充后第二次调用时传入以入库）' },
      },
      required: ['word']
    },
  },
  {
    name: 'color_template_list',
    description: '获取颜色模板列表（系统预设+用户自定义），用于单词颜色分段展示。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'color_template_create',
    description: '创建自定义颜色模板（5种颜色），用于单词颜色分段展示的个性化配色。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '模板名称（必填）' },
        colors: {
          type: 'array',
          items: { type: 'string' },
          description: '5个hex颜色值数组，如 ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7"]（必填）'
        },
      },
      required: ['name', 'colors']
    },
  },
  {
    name: 'color_template_delete',
    description: '删除自定义颜色模板（不可删除系统预设模板）。',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: { type: 'string', description: '模板ID（必填）' },
      },
      required: ['templateId']
    },
  },
  {
    name: 'open_vocabulary_page',
    description: '打开/显示背单词系统的 Web 页面。当用户要求"打开背单词页面"、"显示学习页面"、"打开复习页面"等时使用。返回页面配置信息（页面ID、标题、URL），前端可据此导航到对应页面。',
    inputSchema: {
      type: 'object',
      properties: {
        page: {
          type: 'string',
          enum: ['learn', 'review', 'stats', 'preview'],
          description: '要打开的页面：learn=学习页，review=复习页，stats=统计页，preview=预览页',
        },
        action: {
          type: 'string',
          enum: ['open', 'list'],
          description: '操作：open=打开指定页面（默认），list=列出所有可用页面',
        },
      },
    },
  },
];
