/**
 * 学习记录数据层
 * 通过 DoveAppContext (ctx) 接口底座操作数据
 * 
 * 详见: 白鸽文档/dove_apps/接口底座规范.md
 */

const DB_NAME = '背单词';
const COLLECTION = 'learningrecords';

let _ctx = null;
let _db = null;
let _初始化Promise = null;  // 懒初始化：首次使用时执行，避免每次启动都跑 createIndex

/**
 * 注入 DoveAppContext（由 manifest.onInit 调用）
 */
export function setContext(ctx) {
  _ctx = ctx;
  _db = null;
}

/**
 * 获取当前用户ID（从 DoveAppContext 读取）
 */
export function getCurrentUserId() {
  return _ctx?.user?.id || process.env.VOCABULARY_USER_ID || 'vocabulary_default_user';
}

async function getDb() {
  if (!_ctx) throw new Error('[vocabulary/records] DoveAppContext 未注入，请确认 manifest.onInit 已执行');
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
    coll.createIndex({ user_id: 1, word_id: 1 }, { unique: true }),
    coll.createIndex({ user_id: 1, stage: 1 }),
    coll.createIndex({ user_id: 1, 'review_info.next_review_date': 1 }),
  ]);
}

/**
 * 创建学习记录
 * @param {string} userId - 用户ID
 * @param {string} wordId - 单词ID
 * @param {Object} extra - 额外字段
 */
export async function createRecord(userId, wordId, extra = {}) {
  await ensureIndexes();
  const coll = await getColl();
  const doc = {
    user_id: userId,
    word_id: wordId,
    review_info: {
      ease_factor: 2.5,
      interval_days: 0,
      repetition_count: 0,
      next_review_date: null,
      familiarity: 0,
      memory_stability: 0,
    },
    stage: extra.stage || 'learning',
    recommend_info: extra.recommend_info || {},
    stats: {
      correct_count: 0,
      incorrect_count: 0,
      total_count: 0,
      accuracy_rate: 0,
    },
    pronunciation_scores: [],
    first_learned: new Date(),
    last_reviewed: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return await coll.insertOne(doc);
}

/**
 * 按用户ID和单词ID查找记录
 */
export async function findByUserAndWord(userId, wordId) {
  await ensureIndexes();
  const coll = await getColl();
  return await coll.findOne({ user_id: userId, word_id: wordId });
}

/**
 * 按记录ID查找（_id 字段）
 */
export async function findById(recordId) {
  const coll = await getColl();
  return await coll.findOne({ _id: recordId });
}

/**
 * 查找用户的记录（按用户ID）
 */
export async function findByUser(userId, options = {}) {
  await ensureIndexes();
  const coll = await getColl();
  return await coll.find({ user_id: userId }, options).toArray();
}

/**
 * 获取用户今日待复习单词
 * review_info.next_review_date <= today 或 next_review_date 为 null（新学）
 */
export async function getTodayReviewWords(userId, limit = 20) {
  await ensureIndexes();
  const coll = await getColl();
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const query = {
    user_id: userId,
    stage: { $in: ['learning', 'reviewing', 'recommended'] },
    $or: [
      { 'review_info.next_review_date': { $lte: today } },
      { 'review_info.next_review_date': null },
      { 'review_info.next_review_date': { $exists: false } },
    ],
  };

  const docs = await coll.find(query, {}).toArray();
  return docs.slice(0, limit);
}

/**
 * 获取用户指定阶段的记录
 */
export async function findByUserAndStage(userId, stages, limit = 100) {
  const coll = await getColl();
  const stageArray = Array.isArray(stages) ? stages : [stages];
  return await coll.find(
    { user_id: userId, stage: { $in: stageArray } },
    {}
  ).limit(limit).toArray();
}

/**
 * 获取用户已学的所有单词ID（去重）
 */
export async function getLearnedWordIds(userId) {
  const coll = await getColl();
  const docs = await coll.find({ user_id: userId }, { projection: { word_id: 1 } }).toArray();
  return [...new Set(docs.map(d => d.word_id).filter(Boolean))];
}

/**
 * 更新学习记录
 */
export async function updateRecord(recordId, updates) {
  const coll = await getColl();
  const { _id, ...safeUpdates } = updates;
  return await coll.updateOne(
    { _id: recordId },
    { $set: { ...safeUpdates, updatedAt: new Date() } }
  );
}

/**
 * 通过用户ID和单词ID更新记录
 */
export async function updateByUserAndWord(userId, wordId, updates) {
  const coll = await getColl();
  const { _id, ...safeUpdates } = updates;
  return await coll.updateOne(
    { user_id: userId, word_id: wordId },
    { $set: { ...safeUpdates, updatedAt: new Date() } }
  );
}

/**
 * 获取用户记录统计
 */
export async function getUserStats(userId) {
  await ensureIndexes();
  const coll = await getColl();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [masteredCount, todayNew, todayReview, total, accuracyResult, streakInfo] = await Promise.all([
    coll.countDocuments({ user_id: userId, stage: 'mastered' }),
    coll.countDocuments({ user_id: userId, first_learned: { $gte: today } }),
    coll.countDocuments({ user_id: userId, last_reviewed: { $gte: today } }),
    coll.countDocuments({ user_id: userId }),
    coll.aggregate([
      { $match: { user_id: userId, 'stats.total_count': { $gt: 0 } } },
      { $group: { _id: null, avgAccuracy: { $avg: '$stats.accuracy_rate' } } }
    ]).toArray(),
    // 连续学习天数：从今天往前，每天至少有1条记录（first_learned 或 last_reviewed）
    calculateStreak(userId),
  ]);

  return {
    total_words: total,
    mastered_words: masteredCount,
    today_new: todayNew,
    today_review: todayReview,
    accuracy_rate: accuracyResult.length > 0
      ? Math.round((accuracyResult[0].avgAccuracy || 0) * 100) / 100
      : 0,
    streak_days: streakInfo.streak,
    max_streak_days: streakInfo.maxStreak,
  };
}

/**
 * 计算连续学习天数
 * @returns {{ streak: number, maxStreak: number }}
 */
async function calculateStreak(userId) {
  const coll = await getColl();

  // 获取所有 last_reviewed 日期（去重，按天聚合）
  const dateDocs = await coll.aggregate([
    { $match: { user_id: userId, last_reviewed: { $ne: null } } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$last_reviewed' }
        }
      }
    },
    { $sort: { _id: -1 } },
    { $limit: 365 },
  ]).toArray();

  if (dateDocs.length === 0) {
    // 也检查 first_learned
    const learnDocs = await coll.aggregate([
      { $match: { user_id: userId, first_learned: { $ne: null } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$first_learned' }
          }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 365 },
    ]).toArray();
    if (learnDocs.length === 0) return { streak: 0, maxStreak: 0 };
    return computeStreakFromDates(learnDocs.map(d => d._id).filter(Boolean));
  }

  return computeStreakFromDates(dateDocs.map(d => d._id).filter(Boolean));
}

function computeStreakFromDates(uniqueDates) {
  if (uniqueDates.length === 0) return { streak: 0, maxStreak: 0 };

  // 计算当前连续天数
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

  let streak = 0;
  const startDate = uniqueDates[0] === todayStr ? todayStr :
                  uniqueDates[0] === yesterdayStr ? yesterdayStr : null;

  if (startDate) {
    const checkDate = new Date(startDate);
    for (const dateStr of uniqueDates) {
      const expected = checkDate.toISOString().slice(0, 10);
      if (dateStr === expected) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }
  }

  // 计算最大连续天数
  let maxStreak = 0;
  let currentStreak = 1;
  for (let i = 1; i < uniqueDates.length; i++) {
    const prev = new Date(uniqueDates[i - 1]);
    const curr = new Date(uniqueDates[i]);
    const diff = (prev - curr) / (1000 * 60 * 60 * 24);
    if (Math.abs(diff - 1) < 0.5) {
      currentStreak++;
    } else {
      maxStreak = Math.max(maxStreak, currentStreak);
      currentStreak = 1;
    }
  }
  maxStreak = Math.max(maxStreak, currentStreak);

  return { streak, maxStreak };
}
