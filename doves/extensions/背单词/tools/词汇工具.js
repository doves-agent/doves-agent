/**
 * 词汇学习工具 - AI 原生版
 * 通过白鸽 DovesProxy 直连 MongoDB，替代 HTTP 调用背单词服务端
 * 
 * 导出格式：
 * - extTools: 工具定义数组
 * - handleExtTool: 工具调用处理器
 * - extToolCategories: 工具分类
 * - extToolAbilityMap: 工具能力映射
 * - extToolSafetyLevels: 工具安全分级
 */

// ========== 服务层导入 ==========

import { searchWords, findByWord, findById, findByIds, insertWord, updateWord, countWords } from '../data/words.js';
import { findByUserAndWord, findById as findRecordById, findByUser, getTodayReviewWords, createRecord, updateRecord, updateByUserAndWord, getUserStats } from '../data/records.js';
import { listTemplates, createTemplate, deleteTemplate } from '../data/colors.js';
import { calculateSM2, feedbackToQuality } from '../services/sm2.js';
import { buildProfile, getKnownRoots } from '../services/profile.js';
import { getRecommendationCandidates } from '../services/recommender.js';
import { handleExtTool as handleImportToolCall } from './导入工具.js';
import { importTools } from './_导入工具-定义.js';

// ========== 配置 ==========

import { getCurrentUserId } from '../data/records.js';

/** 获取当前用户 ID（优先从参数，其次从 ctx）*/
function getUserId(args) {
  return args?.user_id || getCurrentUserId();
}

export { extTools } from './_词汇工具-定义.js';
export { importTools } from './_导入工具-定义.js';

// ========== 工具调用处理器 ==========

export async function handleExtTool(name, args) {
  switch (name) {
    case 'word_query':
      return await handleWordQuery(args);
    case 'word_learn':
      return await handleWordLearn(args);
    case 'word_review_list':
      return await handleWordReviewList(args);
    case 'word_review_submit':
      return await handleWordReviewSubmit(args);
    case 'learning_stats':
      return await handleLearningStats(args);
    case 'smart_recommend':
      return await handleSmartRecommend(args);
    case 'word_generate':
      return await handleWordGenerate(args);
    case 'color_template_list':
      return await handleColorTemplateList();
    case 'color_template_create':
      return await handleColorTemplateCreate(args);
    case 'color_template_delete':
      return await handleColorTemplateDelete(args);
    case 'open_vocabulary_page':
      return await handleOpenVocabularyPage(args);
    // 导入工具路由
    case 'word_import_ocr':
    case 'word_import_video':
    case 'word_import_manual':
    case 'word_publish':
    case 'word_list_mine':
      return await handleImportToolCall(name, args);
    default:
      return null; /* 不处理此工具，交给链中下一个处理器 */
  }
}

// ========== 工具处理函数 ==========

async function handleWordQuery({ word }) {
  if (!word) return { error: '缺少参数: word' };

  try {
    // 精确查询
    const result = await findByWord(word);
    if (result) return formatWordResult(result);

    // 模糊搜索
    const searchResults = await searchWords(word, 5);
    if (searchResults.length > 0) {
      return formatWordResult(searchResults[0]);
    }

    return { found: false, word, message: `词库中未找到 "${word}"，可使用 word_generate 生成` };
  } catch (e) {
    return { error: `查询失败: ${e.message}` };
  }
}

async function handleWordLearn({ word_id, correct, time_spent, user_id }) {
  if (!word_id) return { error: '缺少参数: word_id' };

  try {
    const userId = getUserId({ user_id });

    // 检查是否已有记录
    let record = await findByUserAndWord(userId, word_id);

    if (record) {
      // 已有记录：更新统计和复习参数
      const quality = correct ? 3 : 1; // 学习时 correct/incorrect 映射为 hard/again
      const sm2Result = calculateSM2(record.review_info || {}, quality);

      const stats = record.stats || {};
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

      return {
        success: true,
        updated: true,
        word_id,
        stage: sm2Result.stage,
        next_review: sm2Result.next_review_date,
      };
    } else {
      // 新记录：创建学习记录
      const quality = correct ? 3 : 1;
      const sm2Result = calculateSM2(
        { ease_factor: 2.5, interval_days: 0, repetition_count: 0 },
        quality
      );

      await createRecord(userId, word_id, {
        stage: sm2Result.stage,
        review_info: sm2Result,
        stats: {
          correct_count: correct ? 1 : 0,
          incorrect_count: correct ? 0 : 1,
          total_count: 1,
          accuracy_rate: correct ? 1 : 0,
        },
        last_reviewed: new Date(),
        first_learned: new Date(),
      });

      return {
        success: true,
        created: true,
        word_id,
        stage: sm2Result.stage,
        next_review: sm2Result.next_review_date,
      };
    }
  } catch (e) {
    return { error: `学习记录失败: ${e.message}` };
  }
}

async function handleWordReviewList({ limit, user_id }) {
  try {
    const userId = getUserId({ user_id });
    const reviewWords = await getTodayReviewWords(userId, limit || 20);

    // 批量获取单词详情（用word_id查询单词字符串）
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
      success: true,
      total: reviewWords.length,
      showing: displayList.length,
      words: displayList,
    };
  } catch (e) {
    return { error: `获取复习列表失败: ${e.message}` };
  }
}

async function handleWordReviewSubmit({ record_id, feedback, pronunciation_score, user_id }) {
  if (!record_id || !feedback) return { error: '缺少参数: record_id 和 feedback' };

  const validFeedbacks = ['unknown', 'vague', 'known', 'again', 'hard', 'good', 'easy'];
  if (!validFeedbacks.includes(feedback)) {
    return { error: `无效反馈: ${feedback}，可选: ${validFeedbacks.join('/')}` };
  }

  try {
    const userId = getUserId({ user_id });

    // 用记录ID查找（record_id 是 _id，不是 word_id）
    const record = await findRecordById(record_id);
    if (!record) return { error: '未找到学习记录' };
    // 安全校验：记录必须属于当前用户
    if (record.user_id !== userId) return { error: '无权操作此学习记录' };

    // SM2 计算
    const quality = feedbackToQuality(feedback, pronunciation_score);
    const sm2Result = calculateSM2(record.review_info || {}, quality);

    // 更新统计
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

    return {
      success: true,
      record_id: record._id,
      stage: sm2Result.stage,
      next_review: sm2Result.next_review_date,
      interval_days: sm2Result.interval_days,
      familiarity: sm2Result.familiarity,
    };
  } catch (e) {
    return { error: `提交复习失败: ${e.message}` };
  }
}

async function handleLearningStats({ user_id }) {
  try {
    const userId = getUserId({ user_id });
    const stats = await getUserStats(userId);
    const profile = await buildProfile(userId);

    return {
      success: true,
      data: {
        ...stats,
        level: profile.level,
        strengths: profile.strengths,
        suggestions: profile.suggestions,
        knownRoots: profile.knownRoots?.slice(0, 10).map(kr => kr.root) || [],
      },
    };
  } catch (e) {
    return { error: `获取统计失败: ${e.message}` };
  }
}

async function handleSmartRecommend({ count, increment, focus, user_id } = {}) {
  try {
    const userId = getUserId({ user_id });
    const result = await getRecommendationCandidates(userId, {
      count: count || 5,
      delta: increment || 5,
      focus: focus || null,
    });

    return {
      success: true,
      data: {
        recommendations: result.candidates.map(c => ({
          word: c.word.word,
          word_id: c.word._id,
          difficulty: c.word.difficulty_level,
          roots: c.word.roots,
          strategy: c.strategy,
          reason: c.reason,
          definitions: c.word.definitions?.slice(0, 2) || [],
        })),
        context: result.context,
      },
    };
  } catch (e) {
    return { error: `获取推荐失败: ${e.message}` };
  }
}

async function handleWordGenerate({ word, word_data }) {
  if (!word) return { error: '缺少参数: word' };

  try {
    // 检查是否已存在
    const existing = await findByWord(word);
    if (existing) {
      return {
        success: true,
        existed: true,
        message: `单词 "${word}" 已存在于词库中`,
        word: formatWordResult(existing),
      };
    }

    // 有 word_data → 入库
    if (word_data && typeof word_data === 'object') {
      await insertWord({
        ...word_data,
        word: word.toLowerCase(),
        source: 'ai_generated',
        scope: 'public',
        status: 'public',
        trust_level: 2,
      });
      const saved = await findByWord(word);
      return {
        success: true,
        saved: true,
        message: `单词 "${word}" 已生成并入库`,
        word: saved ? formatWordResult(saved) : null,
      };
    }

    // 无 word_data → 返回模板让 LLM 填写
    return {
      success: false,
      message: `词库中未找到 "${word}"。请使用你的英语知识为该词生成数据，格式如下：`,
      word_generation_template: {
        word: word,
        phonetic: '/fəˈnetɪk/',
        pronunciation: { us: [], uk: [] },
        syllables: [],
        roots: { prefix: '', root: '', suffix: '', explanation: '' },
        vowel_segments: [],
        definitions: [{ pos: 'n.', definition: '释义', meaning_cn: '中文释义', examples: ['例句'] }],
        related_words: [],
        synonyms: [],
        antonyms: [],
        phrases: [],
        tags: [],
        difficulty_level: 3,
      },
      hint: '请基于你的知识填写上述模板，完成后再次调用 word_generate 并将完整数据作为 word_data 参数传入即可入库',
    };
  } catch (e) {
    return { error: `生成单词失败: ${e.message}` };
  }
}

// ========== 格式化辅助 ==========

function formatWordResult(w) {
  const roots = w.roots || {};
  const rootParts = [roots.prefix, roots.root, roots.suffix].filter(Boolean);
  
  return {
    found: true,
    _id: w._id,
    word: w.word,
    phonetic: w.phonetic || '',
    syllables: w.syllables || [],
    vowel_segments: w.vowel_segments || [],
    roots: rootParts.length > 0 ? {
      prefix: roots.prefix || '',
      root: roots.root || '',
      suffix: roots.suffix || '',
      explanation: roots.explanation || '',
    } : null,
    definitions: w.definitions || [],
    related_words: w.related_words || [],
    synonyms: w.synonyms || [],
    antonyms: w.antonyms || [],
    phrases: w.phrases || [],
    difficulty_level: w.difficulty_level,
    frequency_rank: w.frequency_rank,
    tags: w.tags || [],
  };
}

// ========== 颜色模板处理函数 ==========

async function handleColorTemplateList() {
  try {
    const templates = await listTemplates();
    return {
      success: true,
      templates: templates.map(t => ({
        id: t._id,
        name: t.name,
        colors: t.colors,
        isSystem: t.type === 'system',
      })),
    };
  } catch (e) {
    return { error: `获取颜色模板失败: ${e.message}` };
  }
}

async function handleColorTemplateCreate({ name, colors }) {
  if (!name || !colors) return { error: '缺少参数: name 和 colors' };
  if (!Array.isArray(colors) || colors.length !== 5) {
    return { error: 'colors 必须是5个颜色值的数组' };
  }
  try {
    const userId = getUserId({});
    const result = await createTemplate(name, colors, userId);
    return { success: true, insertedId: result.insertedId };
  } catch (e) {
    return { error: `创建颜色模板失败: ${e.message}` };
  }
}

async function handleColorTemplateDelete({ templateId }) {
  if (!templateId) return { error: '缺少参数: templateId' };
  try {
    const result = await deleteTemplate(templateId);
    return { success: true, deletedCount: result.deletedCount };
  } catch (e) {
    return { error: `删除颜色模板失败: ${e.message}` };
  }
}

// ========== 词汇页面打开处理函数 ==========

const VOCAB_PAGES = {
  learn: {
    id: 'vocabulary-learn',
    title: '学习',
    entry: './web/learn.html',
    description: '单词学习页面 - 查询单词、学习新词、词根词缀分析',
  },
  review: {
    id: 'vocabulary-review',
    title: '复习',
    entry: './web/review.html',
    description: 'SM2间隔复习页面 - 待复习单词、掌握度测试',
  },
  stats: {
    id: 'vocabulary-stats',
    title: '统计',
    entry: './web/stats.html',
    description: '学习统计页面 - 今日/总览数据、连续学习天数',
  },
  preview: {
    id: 'vocabulary-preview',
    title: '预览',
    entry: './web/preview.html',
    description: '单词预览页面',
  },
};

async function handleOpenVocabularyPage({ page, action = 'open' }) {
  if (action === 'list') {
    const pages = Object.entries(VOCAB_PAGES).map(([key, info]) => ({
      key,
      id: info.id,
      title: info.title,
      description: info.description,
    }));
    return {
      success: true,
      action: 'list',
      pages,
      hint: '用户可以选择以上任一页面打开。使用 open_vocabulary_page 工具并指定 page 参数来打开具体页面。',
    };
  }

  const pageInfo = VOCAB_PAGES[page];
  if (!pageInfo) {
    return {
      success: false,
      error: `未知页面: ${page}，可选: ${Object.keys(VOCAB_PAGES).join(', ')}`,
    };
  }

  return {
    success: true,
    action: 'open',
    page: {
      key: page,
      ...pageInfo,
    },
    navigation: {
      type: 'extension_page',
      extension: '背单词',
      pageId: pageInfo.id,
    },
    message: `已为你打开「${pageInfo.title}」页面（${pageInfo.description}）。`,
  };
}

// ========== 工具分类 ==========

export const extToolCategories = {
  '词汇学习': ['word_query', 'word_learn', 'word_generate'],
  '词汇复习': ['word_review_list', 'word_review_submit'],
  '学习统计': ['learning_stats', 'smart_recommend'],
  '颜色模板': ['color_template_list', 'color_template_create', 'color_template_delete'],
  '页面导航': ['open_vocabulary_page'],
  '词汇导入': ['word_import_ocr', 'word_import_video', 'word_import_manual'],
  '词库管理': ['word_publish', 'word_list_mine'],
};

// ========== 工具能力映射 ==========

export const extToolAbilityMap = {
  word_query: ['词汇学习', '查词', '单词'],
  word_learn: ['词汇学习', '学习记录'],
  word_review_list: ['词汇复习', '间隔复习'],
  word_review_submit: ['词汇复习', '复习结果'],
  learning_stats: ['学习统计', '数据分析'],
  smart_recommend: ['智能推荐', '词汇学习', 'AI推荐'],
  word_generate: ['词汇学习', 'AI生成', '词库'],
  color_template_list: ['颜色模板', '词汇学习'],
  color_template_create: ['颜色模板', '词汇学习'],
  color_template_delete: ['颜色模板'],
  open_vocabulary_page: ['页面导航', '词汇学习', '背单词'],
  word_import_ocr: ['词汇导入', 'OCR', '图片识别'],
  word_import_video: ['词汇导入', '视频识别'],
  word_import_manual: ['词汇导入', '手动录入', 'AI辅助'],
  word_publish: ['词库管理', '管理员', '公共库'],
  word_list_mine: ['词库管理', '私有词库'],
};

// ========== 工具安全分级 ==========

export const extToolSafetyLevels = {
  word_query: '安全',
  word_learn: '谨慎',
  word_review_list: '安全',
  word_review_submit: '谨慎',
  learning_stats: '安全',
  smart_recommend: '安全',
  word_generate: '谨慎',
  color_template_list: '安全',
  color_template_create: '谨慎',
  color_template_delete: '谨慎',
  open_vocabulary_page: '安全',
  word_import_ocr: '谨慎',
  word_import_video: '谨慎',
  word_import_manual: '谨慎',
  word_publish: '谨慎',
  word_list_mine: '安全',
};
