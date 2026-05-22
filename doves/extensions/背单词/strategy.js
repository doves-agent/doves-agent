/**
 * 词汇学习规划策略（AI 原生版）
 * 
 * vocabulary_learning: direct 模式，单词查询/学习
 * vocabulary_review: pipeline 模式，测→评→推荐 三阶段
 * vocabulary_navigate: 页面导航
 */
import { 生成策略提示词, 生成用户提示词 } from '../../prompts/strategy-base.js';

const 词汇学习方法论 = [
  '【词汇学习能力组】',
  '',
  '本扩展提供以下原子工具，可独立调用、自由组合：',
  '',
  '1. 单词查询工具',
  '   word_query：获取完整单词数据（词根/音标/释义/关联词）',
  '',
  '2. 学习记录工具',
  '   word_learn：记录学习结果',
  '   learning_stats：查询学生当前水平（已掌握词根/已学单词）',
  '',
  '3. 复习管理工具',
  '   word_review_list：获取待复习词（SM2算法自动筛选到期词汇）',
  '   word_review_submit：提交答题结果（系统自动计算SM-2参数，调整下次复习时间）',
  '',
  '4. 智能推荐工具',
  '   smart_recommend：根据词根掌握度和难度水平推荐新词（自动基于学生画像）',
  '',
  '5. 页面导航工具',
  '   open_vocabulary_page：打开词汇学习页面（learn/review/stats/preview）',
  '',
  '【流程案例】（参考，非强制）',
  '- 学习新单词：word_query(获取数据) → 教学呈现(词根拆解→释义→例句) → word_learn(记录)',
  '- 复习到期词：word_review_list(获取待复习词) → 测试学生 → word_review_submit(提交结果)',
  '- 学习+推荐：word_query(学习) → word_learn(记录) → smart_recommend(推荐下一个)',
  '- 完整学习流程：learning_stats(了解水平) → word_review_list(先复习) → word_query(学新词) → smart_recommend(推荐)',
  '',
  '【关键规则】',
  '- 根据用户实际需求灵活组合工具，流程案例仅为参考',
  '- 先查询再教学：不要凭空编造单词数据，用word_query获取真实数据',
  '- 先复习再学新：如果有到期复习词，优先完成复习',
  '- 关联已知：如果单词的词根学生已掌握，教学中应明确点出关联',
].join('\n');

const 方法论指引 = '请根据用户实际需求，从词汇学习能力组中选择合适的工具组合。流程案例仅供参考，不必拘泥于固定流程。优先使用词汇专用工具，先查询再教学，先复习再学新。';

const 导航指引 = '用户要求打开页面。使用 open_vocabulary_page 工具：先用 action=list 列出可用页面，再根据用户需求用 action=open 打开指定页面（learn=学习页, review=复习页, stats=统计页, preview=预览页）。如果用户没有指定具体页面，可以先列出所有页面让用户选择。';

const 词汇导航方法论 = [
  '【词汇页面导航能力组】',
  '',
  'open_vocabulary_page 工具：',
  '   action=list：列出所有可用页面',
  '   action=open, page=learn/review/stats/preview：打开指定页面',
  '',
  '可用页面：',
  '   learn（学习页，查询/学习单词）',
  '   review（复习页，SM2间隔复习）',
  '   stats（统计页，学习数据）',
  '   preview（预览页）',
  '',
  '【流程案例】（参考，非强制）',
  '- 用户未指定页面：open_vocabulary_page(list) → 用户选择 → open_vocabulary_page(open)',
  '- 用户指定页面：open_vocabulary_page(open, page=指定页面)',
].join('\n');

const 输出格式扩展 = `"vocabularyContext": {
    "wordCount": "涉及的单词数量",
    "taskType": "learn|review|recommend",
    "difficultyTarget": "目标难度级别(1-10)"
  },`;

export default {
  strategies: {
    vocabulary_learning: {
      系统: (最大子任务数 = 5, 当前深度 = 0) => 生成策略提示词(
        '词汇学习任务',
        词汇学习方法论,
        输出格式扩展,
        最大子任务数,
        当前深度
      ),

      用户: (任务描述, 能力列表, 可用技能 = []) => 生成用户提示词(
        任务描述,
        能力列表,
        可用技能,
        方法论指引
      ),
    },

    vocabulary_review: {
      系统: (最大子任务数 = 5, 当前深度 = 0) => 生成策略提示词(
        '词汇复习任务',
        词汇学习方法论,
        输出格式扩展,
        最大子任务数,
        当前深度
      ),

      用户: (任务描述, 能力列表, 可用技能 = []) => 生成用户提示词(
        任务描述,
        能力列表,
        可用技能,
        方法论指引
      ),
    },

    vocabulary_navigate: {
      系统: (最大子任务数 = 5, 当前深度 = 0) => 生成策略提示词(
        '词汇页面导航任务',
        词汇导航方法论,
        '',
        最大子任务数,
        当前深度
      ),

      用户: (任务描述, 能力列表, 可用技能 = []) => 生成用户提示词(
        任务描述,
        能力列表,
        可用技能,
        导航指引
      ),
    },
  },
};
