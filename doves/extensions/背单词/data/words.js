/**
 * 单词数据层
 * 通过 DoveAppContext (ctx) 接口底座操作数据
 * 
 * 详见: 白鸽文档/dove_apps/接口底座规范.md
 */

const DB_NAME = '背单词';
const COLLECTION = 'words';

let _ctx = null;
let _db = null;
let _初始化Promise = null;  // 懒初始化：首次使用时执行，避免每次启动都跑 createIndex

/**
 * 注入 DoveAppContext（由 manifest.onInit 调用）
 */
export function setContext(ctx) {
  _ctx = ctx;
  _db = null;  // 重置缓存，下次 getDb 时使用新 ctx
}

/**
 * 获取当前用户ID（从 DoveAppContext 读取）
 */
export function getCurrentUserId() {
  return _ctx?.user?.id || process.env.VOCABULARY_USER_ID || 'vocabulary_default_user';
}

async function getDb() {
  if (!_ctx) throw new Error('[vocabulary/words] DoveAppContext 未注入，请确认 manifest.onInit 已执行');
  if (!_db) _db = _ctx.db(DB_NAME);
  return _db;
}

async function getColl() {
  const db = await getDb();
  return db.collection(COLLECTION);
}

/**
 * 确保索引存在（懒初始化：首次使用数据时自动执行，只跑一次）
 */
export async function ensureIndexes() {
  if (!_初始化Promise) {
    _初始化Promise = _doEnsureIndexes();
  }
  await _初始化Promise;
}

async function _doEnsureIndexes() {
  const coll = await getColl();
  await Promise.all([
    coll.createIndex({ word: 1 }, { unique: true }),
    coll.createIndex({ difficulty_level: 1 }),
    coll.createIndex({ 'roots.root': 1 }),
    coll.createIndex({ scope: 1, category: 1 }),
    coll.createIndex({ status: 1 }),
    coll.createIndex({ created_by: 1 }),
  ]);
}

/**
 * 查询单词（模糊搜索）
 * @param {string} keyword - 搜索关键词
 * @param {number} limit - 返回数量
 */
export async function searchWords(keyword, limit = 5) {
  await ensureIndexes();
  const coll = await getColl();
  const regex = { $regex: keyword, $options: 'i' };
  return await coll.find({ word: regex }, {}).limit(limit).toArray();
}

/**
 * 按 word 字段精确查询
 * @param {string} word - 单词（大小写不敏感）
 */
export async function findByWord(word) {
  await ensureIndexes();
  const coll = await getColl();
  return await coll.findOne({ word: word.toLowerCase() });
}

/**
 * 按 ID 查询
 * @param {string} id - MongoDB _id
 */
export async function findById(id) {
  const coll = await getColl();
  return await coll.findOne({ _id: id });
}

/**
 * 批量按 ID 查询
 * @param {string[]} ids - MongoDB _id 数组
 */
export async function findByIds(ids) {
  const coll = await getColl();
  return await coll.find({ _id: { $in: ids } }, {}).toArray();
}

/**
 * 插入新单词
 * @param {Object} wordData - 单词数据
 */
export async function insertWord(wordData) {
  await ensureIndexes();
  const coll = await getColl();
  const doc = {
    word: (wordData.word || '').toLowerCase(),
    phonetic: wordData.phonetic || '',
    pronunciation: wordData.pronunciation || { us: [], uk: [] },
    syllables: wordData.syllables || [],
    roots: wordData.roots || { prefix: '', root: '', suffix: '', explanation: '' },
    vowel_segments: wordData.vowel_segments || [],
    definitions: wordData.definitions || [],
    related_words: wordData.related_words || [],
    synonyms: wordData.synonyms || [],
    antonyms: wordData.antonyms || [],
    phrases: wordData.phrases || [],
    trust_level: wordData.trust_level || 1,
    tags: wordData.tags || [],
    difficulty_level: wordData.difficulty_level || 3,
    frequency_rank: wordData.frequency_rank || null,
    source: wordData.source || 'manual',
    verified_at: wordData.verified_at || null,
    // 录入增强字段
    scope: wordData.scope || 'public',
    category: wordData.category || '',
    category_custom: wordData.category_custom || '',
    created_by: wordData.created_by || '',
    status: wordData.status || 'public',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return await coll.insertOne(doc);
}

/**
 * 更新单词
 * @param {string} id - 单词 _id
 * @param {Object} updates - 要更新的字段
 */
export async function updateWord(id, updates) {
  const coll = await getColl();
  const { _id, ...safeUpdates } = updates;
  return await coll.updateOne(
    { _id: id },
    { $set: { ...safeUpdates, updatedAt: new Date() } }
  );
}

/**
 * 获取单词总数
 */
export async function countWords(query = {}) {
  const coll = await getColl();
  return await coll.countDocuments(query);
}

/**
 * 按范围+可见性查询单词（公共库 + 用户私有库）
 * @param {string} userId - 当前用户ID
 * @param {Object} options - { category, keyword, limit }
 */
export async function findVisibleWords(userId, options = {}) {
  const coll = await getColl();
  const { category, keyword, limit = 50 } = options;

  const query = {
    $or: [
      { scope: 'public' },
      { scope: `user_${userId}` },
    ],
  };
  if (category) query.category = category;
  if (keyword) query.word = { $regex: keyword, $options: 'i' };

  return await coll.find(query, {}).limit(limit).toArray();
}

/**
 * 查询用户私有词库
 * @param {string} userId - 用户ID
 * @param {Object} options - { category, page, limit }
 */
export async function findMyWords(userId, options = {}) {
  const coll = await getColl();
  const { category, page = 1, limit = 20 } = options;

  const query = { created_by: userId };
  if (category) query.category = category;

  const skip = (page - 1) * limit;
  const [words, total] = await Promise.all([
    coll.find(query, {}).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    coll.countDocuments(query),
  ]);

  return { words, total, page, limit };
}

/**
 * 发布单词到公共库
 * @param {string[]} wordIds - 单词 _id 数组
 */
export async function publishWords(wordIds) {
  const coll = await getColl();
  const result = await coll.updateMany(
    { _id: { $in: wordIds } },
    { $set: { scope: 'public', status: 'public', updatedAt: new Date() } }
  );
  return result.modifiedCount;
}

/**
 * 申请公开（private → pending_review）
 * @param {string} wordId - 单词 _id
 */
export async function requestPublish(wordId) {
  const coll = await getColl();
  const result = await coll.updateOne(
    { _id: wordId, status: 'private' },
    { $set: { status: 'pending_review', updatedAt: new Date() } }
  );
  return result.modifiedCount > 0;
}

/**
 * 按难度级别统计
 */
export async function countByDifficulty() {
  const coll = await getColl();
  return await coll.aggregate([
    { $group: { _id: '$difficulty_level', count: { $sum: 1 } } },
    { $project: { _id: 0, level: '$_id', count: 1 } }
  ]).toArray();
}

/**
 * 按 trust_level 统计
 */
export async function countByTrustLevel() {
  const coll = await getColl();
  return await coll.aggregate([
    { $group: { _id: '$trust_level', count: { $sum: 1 } } },
    { $project: { _id: 0, level: '$_id', count: 1 } }
  ]).toArray();
}

/**
 * 按难度区间查询（排除已学单词）
 * @param {number} minLevel - 最低难度
 * @param {number} maxLevel - 最高难度
 * @param {string[]} excludeIds - 需排除的单词ID列表
 * @param {number} limit - 返回数量上限
 */
export async function findByDifficulty(minLevel, maxLevel, excludeIds = [], limit = 20) {
  await ensureIndexes();
  const coll = await getColl();
  const query = { difficulty_level: { $gte: minLevel, $lte: maxLevel } };
  if (excludeIds.length > 0) query._id = { $nin: excludeIds };
  return await coll.find(query, {}).limit(limit).toArray();
}

/**
 * 按词根查询未学过的单词
 * @param {string} root - 词根
 * @param {string[]} excludeIds - 需排除的单词ID列表
 * @param {number} limit - 返回数量上限
 */
export async function findUnlearnedByRoot(root, excludeIds = [], limit = 10) {
  await ensureIndexes();
  const coll = await getColl();
  const query = { 'roots.root': root };
  if (excludeIds.length > 0) query._id = { $nin: excludeIds };
  return await coll.find(query, {}).limit(limit).toArray();
}
