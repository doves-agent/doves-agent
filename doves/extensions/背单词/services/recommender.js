/**
 * 智能推荐服务
 *
 * 替代原 server/services/smartRecommender.js
 * 使用白鸽 LLM 框架进行智能推荐（不再依赖 doveClient CLI）
 *
 * 在工具层，此服务被 smart_recommend 工具调用
 * 工具将 LLM 能力注入到推荐过程中
 */

import { findByUserAndStage, getLearnedWordIds } from '../data/records.js';
import { findByDifficulty, findUnlearnedByRoot, findByIds } from '../data/words.js';
import { getKnownRoots, getKnownWords } from './profile.js';

/**
 * 为用户生成新词推荐（纯数据部分）
 *
 * 返回候选词列表 + 画像上下文
 * 实际的「推荐理由 + 关联分析」由 LLM 在工具回调中完成
 *
 * @param {string} userId      - 用户ID
 * @param {Object} options     - 推荐选项
 * @param {number} options.count           - 推荐数量（默认5）
 * @param {number} options.delta           - 难度增量（默认5，即当前最高难度+5以内）
 * @param {string} options.focus           - 聚焦词根（如 'form'，优先推荐共享该词根的新词）
 * @param {string} options.excludeSource   - 排除来源（如 'fre_wiki'）
 */
export async function getRecommendationCandidates(userId, options = {}) {
  const { count = 5, delta = 5, focus = null, excludeSource = null } = options;

  const [learnedWordIds, knownRoots, knownWords] = await Promise.all([
    getLearnedWordIds(userId),
    getKnownRoots(userId),
    getKnownWords(userId),
  ]);

  // 确定推荐的最高难度
  const learningRecords = await findByUserAndStage(userId, ['learning', 'reviewing']);
  const maxDifficulty = learningRecords.length > 0
    ? Math.max(...learningRecords.map(r => r.difficulty_level || 0), 3)
    : 3;
  const targetDifficulty = Math.min(maxDifficulty + delta, 10);

  // 获取候选词
  const candidates = [];

  // 策略1：聚焦词根推荐（如果指定了 focus 词根）
  if (focus) {
    const relatedWords = await findUnlearnedByRoot(focus, learnedWordIds, count * 2);
    for (const w of relatedWords) {
      if (candidates.length < count * 2) {
        candidates.push({ word: w, reason: `词根关联: ${focus}`, strategy: 'root_focus' });
      }
    }
  }

  // 策略2：同词根扩展
  if (candidates.length < count) {
    for (const { root, count: rootCount } of knownRoots.slice(0, 3)) {
      if (rootCount < 2) continue;
      const related = await findUnlearnedByRoot(root, learnedWordIds, 10);
      for (const w of related) {
        if (!candidates.some(c => c.word._id === w._id)) {
          candidates.push({ word: w, reason: `扩展词根: ${root}`, strategy: 'root_expand' });
        }
      }
    }
  }

  // 策略3：难度递进（按 targetDifficulty 精确筛选）
  if (candidates.length < count) {
    const filtered = await findByDifficulty(
      targetDifficulty - 2, targetDifficulty, learnedWordIds, count * 2
    );
    for (const w of filtered) {
      if (!candidates.some(c => c.word._id === w._id) &&
          (!excludeSource || w.source !== excludeSource)) {
        candidates.push({ word: w, reason: `难度递进 (Lv${targetDifficulty})`, strategy: 'difficulty' });
      }
    }
  }

  // 策略4：任意补充
  if (candidates.length < count) {
    const remaining = await findByDifficulty(1, 10, learnedWordIds, count * 2);
    for (const w of remaining) {
      if (!candidates.some(c => c.word._id === w._id)) {
        candidates.push({ word: w, reason: '随机补充', strategy: 'random' });
      }
    }
  }

  return {
    candidates: candidates.slice(0, count),
    context: {
      knownRoots: knownRoots.slice(0, 5).map(kr => kr.root),
      knownWordCount: knownWords.length,
      learnedCount: learnedWordIds.length,
      targetDifficulty,
    },
  };
}

/**
 * 构建推荐提示词（供 LLM 生成个性化推荐理由）
 *
 * @param {Array} candidates  - 候选词列表 [{ word, reason, strategy }]
 * @param {Object} context    - 来自 getRecommendationCandidates 的上下文
 * @param {Array} profile     - 用户学习画像（可选）
 */
export function buildRecommendPrompt(candidates, context, profile) {
  const candidateList = candidates
    .map((c, i) => {
      const w = c.word;
      return `${i + 1}. **${w.word}** | 难度 Lv${w.difficulty_level || '?'} | 词根: ${w.roots?.root || '无'} | 策略: ${c.strategy}`;
    })
    .join('\n');

  return `你是词汇导师。根据学生当前水平，为以下候选词推荐最合适的 ${Math.min(3, candidates.length)} 个。

学生画像:
- 已掌握词根: ${context.knownRoots.join(', ') || '尚无'}
- 已学单词数: ${context.learnedCount}
- 目标难度: Lv${context.targetDifficulty}

候选词:
${candidateList}

请选择最合适的 3 个单词，并解释推荐理由。回复格式:
\`\`\`json
{
  "recommendations": [
    {
      "word": "单词",
      "reason": "推荐理由（关联已学词根、难度适中、与已知词汇互补等）",
      "teaching_hint": "教学建议（从哪个角度教这个单词）"
    }
  ]
}
\`\`\``;
}

/**
 * 验证推荐结果的单词是否在数据库中存在
 */
export async function validateRecommendations(words) {
  const results = [];
  for (const w of words) {
    const found = await findByIds([w.word_id]);
    if (found.length > 0) {
      results.push({ ...found[0], match: true });
    }
  }
  return results;
}
