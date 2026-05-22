/**
 * 导入数据层
 * 通过 DoveAppContext (ctx) 接口底座操作数据
 * 批量插入、scope 查询、发布等导入相关操作
 * 
 * 详见: 白鸽文档/dove_apps/接口底座规范.md
 */
import { findByWord, insertWord } from './words.js';

const DB_NAME = '背单词';
const COLLECTION = 'words';

let _ctx = null;
let _db = null;

/**
 * 注入 DoveAppContext（由 manifest.onInit 调用）
 */
export function setContext(ctx) {
  _ctx = ctx;
  _db = null;
}

async function getDb() {
  if (!_ctx) throw new Error('[vocabulary/imports] DoveAppContext 未注入，请确认 manifest.onInit 已执行');
  if (!_db) _db = _ctx.db(DB_NAME);
  return _db;
}

async function getColl() {
  const db = await getDb();
  return db.collection(COLLECTION);
}

/**
 * 批量导入单词（去重）
 * @param {string} userId - 用户ID
 * @param {Object[]} wordList - [{ word, phonetic?, definitions?, ... }]
 * @param {Object} options - { category, source }
 * @returns {{ imported: Object[], skipped: Object[] }}
 */
export async function batchImportWords(userId, wordList, options = {}) {
  const { category = '', source = 'manual' } = options;
  const scope = `user_${userId}`;
  const imported = [];
  const skipped = [];

  for (const item of wordList) {
    const wordStr = (item.word || '').toLowerCase().trim();
    if (!wordStr) {
      skipped.push({ word: '', reason: '单词为空' });
      continue;
    }

    // 检查是否已存在（同一 scope 内去重）
    const existing = await findByWord(wordStr);
    if (existing && (existing.scope === scope || existing.scope === 'public')) {
      skipped.push({ word: wordStr, reason: '已存在于词库中' });
      continue;
    }

    try {
      const result = await insertWord({
        word: wordStr,
        phonetic: item.phonetic || '',
        pronunciation: item.pronunciation || { us: [], uk: [] },
        syllables: item.syllables || [],
        roots: item.roots || { prefix: '', root: '', suffix: '', explanation: '' },
        vowel_segments: item.vowel_segments || [],
        definitions: item.definitions || [],
        related_words: item.related_words || [],
        synonyms: item.synonyms || [],
        antonyms: item.antonyms || [],
        phrases: item.phrases || [],
        tags: item.tags || [],
        difficulty_level: item.difficulty_level || 3,
        source,
        scope,
        category,
        category_custom: item.category_custom || '',
        created_by: userId,
        status: 'private',
        trust_level: 1,
      });
      imported.push({ word: wordStr, _id: result.insertedId });
    } catch (e) {
      skipped.push({ word: wordStr, reason: e.message });
    }
  }

  return { imported, skipped, total: wordList.length };
}

/**
 * 查询待审核的单词（管理员用）
 * @param {Object} options - { page, limit }
 */
export async function findPendingReview(options = {}) {
  const coll = await getColl();
  const { page = 1, limit = 50 } = options;
  const skip = (page - 1) * limit;

  const [words, total] = await Promise.all([
    coll.find({ status: 'pending_review' }, {})
      .sort({ createdAt: 1 })
      .skip(skip).limit(limit).toArray(),
    coll.countDocuments({ status: 'pending_review' }),
  ]);

  return { words, total, page, limit };
}

/**
 * 按分类统计用户词库
 * @param {string} userId
 */
export async function countByCategory(userId) {
  const coll = await getColl();
  return await coll.aggregate([
    { $match: { created_by: userId } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $project: { _id: 0, category: '$_id', count: 1 } },
    { $sort: { count: -1 } },
  ]).toArray();
}
