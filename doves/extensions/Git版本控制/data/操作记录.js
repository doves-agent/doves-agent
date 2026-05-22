/**
 * Git 操作记录数据层
 * 关键操作（push/merge/rebase/reset/revert/cherry-pick）留痕
 * 支持跨设备查看操作历史
 */

const DB_NAME = 'Git版本控制';
const COLLECTION = '操作记录';

let _ctx = null;
let _db = null;
let _初始化Promise = null;

export function setContext(ctx) {
  _ctx = ctx;
  _db = null;
}

async function getDb() {
  if (!_ctx) throw new Error('[Git版本控制/操作记录] DoveAppContext 未注入');
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
    coll.createIndex({ 操作类型: 1 }),
    coll.createIndex({ 时间: -1 }),
  ]);
}

/**
 * 记录一次操作
 * @param {Object} record
 * @param {string} record.仓库ID - 关联的仓库配置 _id
 * @param {string} record.仓库别名 - 冗余存储方便展示
 * @param {string} record.操作类型 - push/pull/merge/rebase/reset/revert/cherry_pick/commit/tag
 * @param {Object} record.参数 - 操作参数快照
 * @param {Object} record.结果 - { success, stdout, stderr, error }
 * @param {string} [record.分支] - 操作时所在分支
 * @param {string} [record.备注] - 额外说明
 */
export async function 写入记录(record) {
  await ensureIndexes();
  const coll = await getColl();

  const doc = {
    仓库ID: record.仓库ID || null,
    仓库别名: record.仓库别名 || '',
    操作类型: record.操作类型,
    参数: record.参数 || {},
    结果: record.结果 || {},
    分支: record.分支 || '',
    备注: record.备注 || '',
    时间: new Date(),
  };

  return await coll.insertOne(doc);
}

/**
 * 查询操作历史
 */
export async function 查询记录(options = {}) {
  await ensureIndexes();
  const coll = await getColl();
  const { 仓库ID, 操作类型, limit = 50, skip = 0 } = options;

  const query = {};
  if (仓库ID) query.仓库ID = 仓库ID;
  if (操作类型) query.操作类型 = 操作类型;

  return await coll.find(query, {}).sort({ 时间: -1 }).skip(skip).limit(limit).toArray();
}

/**
 * 统计操作频率（按类型）
 */
export async function 操作统计(仓库ID, 天数 = 30) {
  await ensureIndexes();
  const coll = await getColl();
  const since = new Date(Date.now() - 天数 * 86400000);

  const query = { 时间: { $gte: since } };
  if (仓库ID) query.仓库ID = 仓库ID;

  return await coll.aggregate([
    { $match: query },
    { $group: { _id: '$操作类型', 次数: { $sum: 1 } } },
    { $project: { _id: 0, 操作类型: '$_id', 次数: 1 } },
    { $sort: { 次数: -1 } }
  ]).toArray();
}
