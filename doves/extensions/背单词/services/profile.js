/**
 * 用户学习画像服务
 *
 * 分析用户学习数据，生成结构化的「学习画像」
 * 供 execution.js / strategy.js 注入 LLM 上下文
 *
 * 功能：
 *   - buildProfile(userId) → 完整学习画像
 *   - getKnownRoots(userId)  → 已掌握词根列表
 *   - getKnownWords(userId)  → 已掌握单词列表
 *   - estimateLevel(userId)  → 估算水平（CET-4/6 等）
 */

import { findByUser, getUserStats, findByUserAndStage } from '../data/records.js';
import { findByIds } from '../data/words.js';

/**
 * 构建用户完整学习画像
 */
export async function buildProfile(userId) {
  const [stats, records, knownRoots] = await Promise.all([
    getUserStats(userId),
    findByUser(userId),
    getKnownRoots(userId),
  ]);

  const level = estimateLevel(stats);
  const learningWords = await getLearningWords(records);
  const masteredWordIds = records
    .filter(r => r.stage === 'mastered')
    .map(r => r.word_id);

  // 找出最近学习的单词（用于上下文关联）
  const recentRecords = [...records]
    .sort((a, b) => {
      const da = a.last_reviewed ? new Date(a.last_reviewed).getTime() : 0;
      const db = b.last_reviewed ? new Date(b.last_reviewed).getTime() : 0;
      return db - da;
    })
    .slice(0, 10);

  return {
    level,
    stats,
    knownRoots,
    totalLearned: records.length,
    masteredCount: masteredWordIds.length,
    learningCount: records.filter(r => r.stage === 'learning').length,
    reviewingCount: records.filter(r => r.stage === 'reviewing').length,
    recentWords: recentRecords.map(r => r.word_id),
    strengths: analyzeStrengths(stats, knownRoots),
    suggestions: generateSuggestions(stats, level),
  };
}

/**
 * 获取用户已掌握词根
 * 从「已掌握」单词中提取词根，按频率排序
 */
export async function getKnownRoots(userId) {
  const masteryRecords = await findByUserAndStage(userId, 'mastered');
  const wordIds = masteryRecords.map(r => r.word_id).filter(Boolean);
  if (!wordIds.length) return [];

  const words = await findByIds(wordIds);
  const rootCount = new Map();

  for (const w of words) {
    const root = w?.roots?.root;
    if (root && root.trim()) {
      rootCount.set(root, (rootCount.get(root) || 0) + 1);
    }
  }

  return [...rootCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([root, count]) => ({
      root,
      count,
      examples: words
        .filter(w => w?.roots?.root === root)
        .slice(0, 3)
        .map(w => w.word),
    }));
}

/**
 * 获取用户已掌握的单词
 */
export async function getKnownWords(userId) {
  const records = await findByUserAndStage(userId, 'mastered');
  const wordIds = records.map(r => r.word_id).filter(Boolean);
  if (!wordIds.length) return [];
  return await findByIds(wordIds);
}

/**
 * 估算用户水平等级
 */
export function estimateLevel(stats) {
  const { mastered_words, accuracy_rate } = stats;
  if (mastered_words >= 3000 && accuracy_rate >= 0.85) return 'CET-6+';
  if (mastered_words >= 1800 && accuracy_rate >= 0.78) return 'CET-4+';
  if (mastered_words >= 800) return 'CET-4 入门';
  if (mastered_words >= 200) return '高考水平';
  return '中学水平';
}

/**
 * 获取正在学习中的单词列表
 */
async function getLearningWords(records) {
  const wordIds = records
    .filter(r => r.stage === 'learning' || r.stage === 'reviewing')
    .map(r => r.word_id)
    .filter(Boolean);
  if (!wordIds.length) return [];
  return await findByIds(wordIds.slice(0, 100));
}

/**
 * 分析学习优势
 */
function analyzeStrengths(stats, knownRoots) {
  const strengths = [];
  if (stats.accuracy_rate >= 0.8) strengths.push('拼写准确率高');
  if (stats.mastered_words >= 500) strengths.push('词汇积累扎实');
  if (knownRoots.length >= 10) strengths.push('词根掌握数量多');
  return strengths;
}

/**
 * 生成学习建议
 */
function generateSuggestions(stats, level) {
  const suggestions = [];
  if (stats.accuracy_rate < 0.6) suggestions.push('建议增加复习频率，当前正确率偏低');
  if (stats.mastered_words < 100) suggestions.push('建议先集中攻克高频词汇，打好基础');
  if (level === '中学水平') suggestions.push('当前水平适合先学习高考高频词');
  return suggestions;
}
