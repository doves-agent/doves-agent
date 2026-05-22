/**
 * 词汇复习技能 (AI 原生版)
 * 
 * SM2间隔复习自动化：
 * 1. 获取待复习单词列表
 * 2. 逐词展示测试
 * 3. 提交复习结果
 * 4. SM2自动调整复习间隔
 * 
 * 通过白鸽 DovesProxy 直连 MongoDB，不再依赖外部 HTTP 服务
 */

import { getTodayReviewWords, findByUserAndWord, findById as findRecordById, updateRecord, getUserStats } from '../../data/records.js';
import { getUserStats as getUserStatsAlias } from '../../data/records.js';
import { findByIds } from '../../data/words.js';
import { calculateSM2, feedbackToQuality } from '../../services/sm2.js';
import { buildProfile } from '../../services/profile.js';

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('vocabulary/review', { 前缀: '[vocabulary/review]', 级别: 'debug', 显示调用位置: true });

import { getCurrentUserId } from '../../data/records.js';

function getUserId(context) {
  return context?.userId || context?.user_id || getCurrentUserId();
}

// ========== 技能执行函数 ==========

/**
 * 开始复习 - 获取待复习单词列表
 */
async function startReview(limit = 20, context = {}) {
  try {
    const userId = getUserId(context);
    const reviewWords = await getTodayReviewWords(userId, limit);

    // 批量获取单词详情
    const wordIds = reviewWords.map(r => r.word_id).filter(Boolean);
    const wordDetails = wordIds.length > 0 ? await findByIds(wordIds) : [];
    const wordMap = new Map(wordDetails.map(w => [String(w._id), w]));

    const displayList = reviewWords.map(r => {
      const wordDoc = wordMap.get(String(r.word_id));
      return {
        record_id: r._id,
        word: wordDoc?.word || r.word_id,
        word_id: r.word_id,
        familiarity: r.review_info?.familiarity || 0,
        stage: r.stage,
        next_review: r.review_info?.next_review_date,
      };
    });

    return {
      成功: true,
      total: reviewWords.length,
      showing: displayList.length,
      words: displayList,
    };
  } catch (e) {
    return { 成功: false, 错误: `获取复习列表异常: ${e.message}` };
  }
}

/**
 * 提交复习结果
 */
async function submitReview(record_id, feedback, context = {}, pronunciation_score) {
  if (!record_id || !feedback) {
    return { 成功: false, 错误: '缺少参数: record_id 和 feedback' };
  }
  const validFeedbacks = ['unknown', 'vague', 'known', 'again', 'hard', 'good', 'easy'];
  if (!validFeedbacks.includes(feedback)) {
    return { 成功: false, 错误: `无效反馈: ${feedback}，可选: ${validFeedbacks.join('/')}` };
  }
  try {
    const userId = getUserId(context);
    // 用记录ID查找（record_id 是 _id，不是 word_id）
    const record = await findRecordById(record_id);
    if (!record) return { 成功: false, 错误: '未找到学习记录' };
    if (record.user_id !== userId) return { 成功: false, 错误: '无权操作此学习记录' };

    const quality = feedbackToQuality(feedback, pronunciation_score);
    const sm2Result = calculateSM2(record.review_info || {}, quality);

    const stats = record.stats || {};
    const correct = quality >= 3;
    const newStats = {
      correct_count: (stats.correct_count || 0) + (correct ? 1 : 0),
      incorrect_count: (stats.incorrect_count || 0) + (correct ? 0 : 1),
      total_count: (stats.total_count || 0) + 1,
      accuracy_rate: ((stats.total_count || 0) + 1) > 0
        ? ((stats.correct_count || 0) + (correct ? 1 : 0)) / ((stats.total_count || 0) + 1) : 0,
    };

    await updateRecord(record._id, {
      review_info: sm2Result,
      stage: sm2Result.stage,
      stats: newStats,
      last_reviewed: new Date(),
    });

    // 记录用户活动
    import('../../../../用户活动记录器.js').then(({ 记录用户活动 }) => {
      记录用户活动({
        用户ID: userId,
        扩展名: '背单词',
        活动: `完成了单词复习 (${correct ? '记住了' : '还需巩固'})`,
        详情: { 阶段: sm2Result.stage, 准确率: newStats.accuracy_rate },
      });
    }).catch(() => {});

    return {
      成功: true,
      message: '复习结果已提交',
      updated: {
        stage: sm2Result.stage,
        next_review: sm2Result.next_review_date,
        interval_days: sm2Result.interval_days,
        familiarity: sm2Result.familiarity,
      },
    };
  } catch (e) {
    return { 成功: false, 错误: `提交复习异常: ${e.message}` };
  }
}

/**
 * 查看复习状态/统计
 */
async function getStatus(context = {}) {
  try {
    const userId = getUserId(context);
    const stats = await getUserStats(userId);
    const profile = await buildProfile(userId);

    return {
      成功: true,
      stats: {
        ...stats,
        level: profile.level,
        strengths: profile.strengths,
        suggestions: profile.suggestions,
        knownRoots: profile.knownRoots?.slice(0, 10).map(kr => kr.root) || [],
      },
    };
  } catch (e) {
    return { 成功: false, 错误: `获取统计异常: ${e.message}` };
  }
}

// ========== 技能模块导出 ==========

export default {
  name: 'vocabulary_review',
  description: 'SM2间隔复习技能 - 获取待复习单词并提交复习结果（AI原生版，直连MongoDB）',
  category: '词汇复习',
  abilities: ['词汇复习', '间隔复习', 'SM2'],

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['start', 'submit', 'status'],
        description: '操作类型：start=开始复习，submit=提交结果，status=查看状态',
      },
      limit: {
        type: 'number',
        description: '复习数量（默认20）',
      },
      record_id: {
        type: 'string',
        description: '提交结果时的学习记录ID',
      },
      feedback: {
        type: 'string',
        enum: ['unknown', 'vague', 'known', 'again', 'hard', 'good', 'easy'],
        description: '掌握程度反馈',
      },
    },
  },

  examples: [
    '帮我复习10个单词',
    '开始今天的复习',
    '这个词我认识了',
  ],

  async execute(params = {}, context = {}) {
    const { action = 'start', limit = 20, record_id, feedback, pronunciation_score } = params;

    logger.info(`执行复习技能: action=${action}`);

    switch (action) {
      case 'start':
        return await startReview(limit, context);
      case 'submit':
        return await submitReview(record_id, feedback, context, pronunciation_score);
      case 'status':
        return await getStatus(context);
      default:
        return { 成功: false, 错误: `未知操作: ${action}，可选: start/submit/status` };
    }
  },
};
