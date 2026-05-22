/**
 * 词汇学习执行器增强（AI 原生版）
 *
 * 不止告诉 LLM"用哪个工具"，而是注入教学理念和个性化上下文：
 * - 教学前了解学生画像
 * - 教学中关联已知
 * - 教学后记录反馈
 */
export default {
  // 条件性系统提示词片段
  conditionalPrompts: [
    {
      // 匹配条件：任务能力需求包含词汇相关
      match: (任务, tools) => {
        const 能力需求 = 任务.能力需求 || [];
        return 能力需求.some(a => ['词汇学习', '单词记忆', '间隔复习', '智能推荐'].includes(a));
      },
      // 注入到系统提示词末尾
      prompt: `【词汇教学指引】

你是词汇导师。你正在帮助用户学习英语词汇。请遵循以下教学理念，而非机械调用工具：

## 可用工具
- word_query          → 查询单词完整数据（词根/音标/释义/例句/关联词）
- word_learn          → 记录学习结果（学习结果入库 + SM2去重检查）
- word_review_list    → 获取今日待复习单词
- word_review_submit  → 提交复习结果（自动计算下次复习时间）
- learning_stats      → 查看学生学习统计
- smart_recommend     → 获取个性化新词推荐
- word_generate       → AI 生成单词详细数据

## 教学原则
1. **不要编造数据**：词汇信息必须用 word_query 获取，不要凭记忆回答
2. **词根优先**：先用词根拆解帮助理解，再给释义
3. **关联已知**：如果该词跟学生学过的其他词共享词根，要在教学中指出来
4. **例句驱动**：每个重要释义至少配一个地道例句
5. **先释义后词根再例句**：这是你的回答模板`,
    },
    {
      // 匹配条件：任务涉及页面导航或打开页面
      match: (任务, tools) => {
        const 意图 = 任务.意图 || '';
        const 能力需求 = 任务.能力需求 || [];
        return 意图 === 'vocabulary_navigate' ||
          能力需求.some(a => ['页面导航', '背单词'].includes(a)) ||
          (任务.描述 || '').includes('打开');
      },
      // 注入到系统提示词末尾
      prompt: `【词汇页面导航工具指引】
用户要求打开背单词页面时，使用 open_vocabulary_page 工具：
- 用户未指定页面 → 使用 action=list 列出所有可用页面
- 用户指定了页面 → 使用 action=open, page=<learn|review|stats|preview>
- learn: 学习页（查词、背单词）
- review: 复习页（SM2间隔复习）
- stats: 统计页（学习数据）
- preview: 预览页
不要搜索网页或尝试用浏览器打开，直接使用 open_vocabulary_page 工具即可。`,
    },
  ],
};
