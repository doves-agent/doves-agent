/**
 * 词汇导入工具 - 处理函数
 * OCR识别、视频识别、手动录入、发布、我的词库
 */
import { batchImportWords, findPendingReview, countByCategory } from '../data/imports.js';
import { findMyWords, publishWords, requestPublish, insertWord, findByWord } from '../data/words.js';
import { extractWordsFromImage, extractWordsFromText, aiFillWordData } from '../services/ocr识别.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('导入工具', { 前缀: '[导入工具]', 级别: 'debug' });

import { getCurrentUserId } from '../data/records.js';

function getUserId(args) {
  return args?.user_id || getCurrentUserId();
}

// 导出工具定义（供扩展加载器发现）
export { importTools as extTools } from './_导入工具-定义.js';

// 导出安全级别
export const extToolSafetyLevels = {
  word_import_ocr: '谨慎',
  word_import_video: '谨慎',
  word_import_manual: '谨慎',
  word_publish: '谨慎',
  word_list_mine: '安全',
};

/**
 * 处理导入工具调用
 */
export async function handleExtTool(name, args) {
  switch (name) {
    case 'word_import_ocr':
      return await handleWordImportOCR(args);
    case 'word_import_video':
      return await handleWordImportVideo(args);
    case 'word_import_manual':
      return await handleWordImportManual(args);
    case 'word_publish':
      return await handleWordPublish(args);
    case 'word_list_mine':
      return await handleWordListMine(args);
    default:
      return null; /* 不处理此工具，交给链中下一个处理器 */
  }
}

/**
 * 图片 OCR 识别导入
 */
async function handleWordImportOCR({ image_url, category, category_custom, user_id }) {
  if (!image_url) return { error: '缺少参数: image_url' };

  const userId = getUserId({ user_id });

  try {
    // 1. 调用视觉模型识别单词
    const result = await extractWordsFromImage(image_url);

    if (!result.words?.length) {
      return {
        success: false,
        message: '未能从图片中识别到英文单词',
        raw: result.raw,
        error: result.error,
      };
    }

    // 2. 批量入库
    const importResult = await batchImportWords(userId, result.words, {
      category: category || '',
      source: 'ocr',
    });

    return {
      success: true,
      ...importResult,
      raw_analysis: result.raw?.substring(0, 500),
    };
  } catch (e) {
    return { error: `OCR识别导入失败: ${e.message}` };
  }
}

/**
 * 视频识别导入
 */
async function handleWordImportVideo({ video_url, category, category_custom, user_id }) {
  if (!video_url) return { error: '缺少参数: video_url' };

  const userId = getUserId({ user_id });

  try {
    // 1. 先尝试调用视频工具获取文本
    // 视频工具在白鸽内部，通过 DovesProxy 不方便直接调用
    // 这里简化：让调用方先提取视频文本，再传入
    // 如果 video_url 是文本内容，直接处理
    let videoText = video_url;
    
    // 如果是URL格式，提示需要先提取文本
    if (video_url.startsWith('http') || video_url.startsWith('/')) {
      return {
        success: false,
        message: '视频导入需要先提取字幕/对话文本。请将视频中的英文文本内容作为 video_url 参数传入，或通过对话让白鸽帮你提取视频内容。',
        hint: '示例: word_import_video({ video_url: "从视频中提取的文本内容..." })',
      };
    }

    // 2. 从文本中提取单词
    const result = await extractWordsFromText(videoText);

    if (!result.words?.length) {
      return {
        success: false,
        message: '未能从文本中识别到英文单词',
        raw: result.raw,
        error: result.error,
      };
    }

    // 3. 批量入库
    const importResult = await batchImportWords(userId, result.words, {
      category: category || '',
      source: 'video',
    });

    return {
      success: true,
      ...importResult,
      raw_analysis: result.raw?.substring(0, 500),
    };
  } catch (e) {
    return { error: `视频识别导入失败: ${e.message}` };
  }
}

/**
 * 手动录入 + AI辅助填充
 */
async function handleWordImportManual(args) {
  const { word, category, category_custom, user_id } = args;
  if (!word) return { error: '缺少参数: word' };
  if (!category) return { error: '缺少参数: category（请选择单词分类）' };

  const userId = getUserId({ user_id });
  const scope = `user_${userId}`;

  try {
    // 1. 检查是否已存在
    const existing = await findByWord(word);
    if (existing && (existing.scope === scope || existing.scope === 'public')) {
      return {
        success: false,
        message: `单词 "${word}" 已存在于${existing.scope === 'public' ? '公共' : '你的私有'}词库中`,
        word_id: existing._id,
      };
    }

    // 2. AI 辅助填充空字段
    const partial = {
      word,
      phonetic: args.phonetic || '',
      definitions: args.definitions || [],
      roots: args.roots || null,
      syllables: args.syllables || [],
      synonyms: args.synonyms || [],
      antonyms: args.antonyms || [],
      phrases: args.phrases || [],
    };

    let filledData;
    try {
      filledData = await aiFillWordData(word, partial);
    } catch (e) {
      logger.warn(`AI填充单词失败: ${e.message}`);
      return { error: `AI填充单词数据失败: ${e.message}` };
    }

    // 3. 入库
    const result = await insertWord({
      ...filledData,
      source: 'manual',
      scope,
      category,
      category_custom: category_custom || '',
      created_by: userId,
      status: 'private',
      trust_level: 1,
      difficulty_level: filledData.difficulty_level || 3,
      tags: filledData.tags || [],
    });

    return {
      success: true,
      word_id: result.insertedId,
      word,
      auto_filled: filledData.auto_filled || [],
      data: {
        phonetic: filledData.phonetic,
        definitions: filledData.definitions,
        roots: filledData.roots,
      },
    };
  } catch (e) {
    return { error: `手动录入失败: ${e.message}` };
  }
}

/**
 * 管理员发布单词到公共库
 */
async function handleWordPublish({ word_id, word_ids, user_id }) {
  const ids = [];
  if (word_id) ids.push(word_id);
  if (word_ids?.length) ids.push(...word_ids);

  if (ids.length === 0) {
    return { error: '缺少参数: word_id 或 word_ids' };
  }

  const userId = getUserId({ user_id });
  if (!userId) {
    return { error: '缺少用户身份信息' };
  }

  try {
    const count = await publishWords(ids);
    return {
      success: true,
      published: count,
      message: `已将 ${count} 个单词发布到公共词库`,
    };
  } catch (e) {
    return { error: `发布失败: ${e.message}` };
  }
}

/**
 * 查看我的词库
 */
async function handleWordListMine({ category, page, limit, user_id }) {
  const userId = getUserId({ user_id });

  try {
    const [result, categoryStats] = await Promise.all([
      findMyWords(userId, { category, page: page || 1, limit: limit || 20 }),
      countByCategory(userId),
    ]);

    return {
      success: true,
      words: result.words.map(w => ({
        _id: w._id,
        word: w.word,
        phonetic: w.phonetic || '',
        category: w.category,
        status: w.status,
        source: w.source,
        created_at: w.createdAt,
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
      by_category: categoryStats,
    };
  } catch (e) {
    return { error: `查询我的词库失败: ${e.message}` };
  }
}
