/**
 * Git 分析记录数据层
 * 持久化 AI 分析结果（commit分析、changelog、impact等），支持跨设备回溯
 */

const DB_NAME = 'Git版本控制';
const COLLECTION = '分析记录';

let _ctx = null;
let _db = null;
let _初始化Promise = null;

export function setContext(ctx) {
  _ctx = ctx;
  _db = null;
}

async function getDb() {
  if (!_ctx) throw new Error('[Git版本控制/分析记录] DoveAppContext 未注入');
  if (!_db) _db = _ctx.db(DB_NAME);
  return _db;
}

async function getColl() {
  const db = await getDb();
  return db.collection(COLLECTION);
}

export async function ensureIndexes() {
  if (!_初始化Promise) {
    _初始化Promise = _doEnsureIndexes();
  }
  await _初始化Promise;
}

async function _doEnsureIndexes() {
  const coll = await getColl();
  await Promise.all([
    coll.createIndex({ 仓库ID: 1, 时间: -1 }),
    coll.createIndex({ 分析类型: 1 }),
    coll.createIndex({ 'commit.hash': 1 }),
    coll.createIndex({ 时间: -1 }),
  ]);
}

/**
 * 保存分析结果
 * @param {Object} record
 * @param {string} record.仓库ID - 关联仓库
 * @param {string} record.仓库别名
 * @param {string} record.分析类型 - analyze_commit/analyze_range/review_suggest/changelog/impact_analysis/doc_check
 * @param {Object} record.输入参数 - 调用时的参数
 * @param {Object} record.结果 - 分析结果数据
 * @param {Object} [record.commit] - { hash, subject } 关联的提交
 */
export async function 保存分析(record) {
  await ensureIndexes();
  const coll = await getColl();

  const doc = {
    仓库ID: record.仓库ID || null,
    仓库别名: record.仓库别名 || '',
    分析类型: record.分析类型,
    输入参数: record.输入参数 || {},
    结果: record.结果 || {},
    commit: record.commit || null,
    时间: new Date(),
  };

  return await coll.insertOne(doc);
}

/**
 * 查询分析历史
 */
export async function 查询分析(options = {}) {
  await ensureIndexes();
  const coll = await getColl();
  const { 仓库ID, 分析类型, commitHash, limit = 30, skip = 0 } = options;

  const query = {};
  if (仓库ID) query.仓库ID = 仓库ID;
  if (分析类型) query.分析类型 = 分析类型;
  if (commitHash) query['commit.hash'] = commitHash;

  return await coll.find(query, {}).sort({ 时间: -1 }).skip(skip).limit(limit).toArray();
}

/**
 * 查找某个 commit 是否已分析过（避免重复分析）
 */
export async function 查找已有分析(commitHash, 分析类型) {
  const coll = await getColl();
  return await coll.findOne({ 'commit.hash': commitHash, 分析类型 });
}

/**
 * 按仓库统计分析次数
 */
export async function 分析统计(仓库ID) {
  await ensureIndexes();
  const coll = await getColl();

  const query = {};
  if (仓库ID) query.仓库ID = 仓库ID;

  return await coll.aggregate([
    { $match: query },
    { $group: { _id: '$分析类型', 次数: { $sum: 1 } } },
    { $project: { _id: 0, 分析类型: '$_id', 次数: 1 } },
    { $sort: { 次数: -1 } }
  ]).toArray();
}
