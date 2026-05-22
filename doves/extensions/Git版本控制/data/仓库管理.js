/**
 * 仓库配置数据层
 * 通过 DoveAppContext (ctx) 持久化仓库配置，支持跨设备同步
 */

const DB_NAME = 'Git版本控制';
const COLLECTION = '仓库配置';

let _ctx = null;
let _db = null;
let _初始化Promise = null;

export function setContext(ctx) {
  _ctx = ctx;
  _db = null;
}

async function getDb() {
  if (!_ctx) throw new Error('[Git版本控制/仓库管理] DoveAppContext 未注入');
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
    coll.createIndex({ 别名: 1 }, { unique: true }),
    coll.createIndex({ 类型: 1 }),
    coll.createIndex({ 最后访问时间: -1 }),
  ]);
}

/**
 * 添加仓库配置
 * @param {Object} config
 * @param {string} config.地址 - 远程 URL 或本地路径
 * @param {string} config.别名 - 用户友好名称
 * @param {'remote'|'local'} config.类型 - remote=需clone, local=已存在的本地仓库
 * @param {string} [config.本地路径] - 克隆后的本地路径（remote 类型）/ 仓库所在路径（local 类型）
 * @param {string} [config.默认分支] - 默认工作分支
 * @param {Object} [config.认证] - { 方式: 'ssh'|'token'|'none', token引用?: string }
 */
export async function 添加仓库(config) {
  await ensureIndexes();
  const coll = await getColl();

  const doc = {
    地址: config.地址,
    别名: config.别名,
    类型: config.类型 || (config.地址.startsWith('/') || /^[a-zA-Z]:/.test(config.地址) ? 'local' : 'remote'),
    本地路径: config.本地路径 || null,
    默认分支: config.默认分支 || 'main',
    认证: config.认证 || { 方式: 'none' },
    状态: 'active',
    创建时间: new Date(),
    最后访问时间: new Date(),
  };

  return await coll.insertOne(doc);
}

/**
 * 查询所有仓库配置
 */
export async function 查询仓库列表(options = {}) {
  await ensureIndexes();
  const coll = await getColl();
  const { 状态 = 'active', limit = 50 } = options;

  const query = {};
  if (状态) query.状态 = 状态;

  return await coll.find(query, {}).sort({ 最后访问时间: -1 }).limit(limit).toArray();
}

/**
 * 按别名查找仓库
 */
export async function 按别名查找(别名) {
  await ensureIndexes();
  const coll = await getColl();
  return await coll.findOne({ 别名 });
}

/**
 * 按 ID 查找仓库
 */
export async function 按ID查找(id) {
  const coll = await getColl();
  return await coll.findOne({ _id: id });
}

/**
 * 更新仓库配置
 */
export async function 更新仓库(id, updates) {
  const coll = await getColl();
  const { _id, ...safeUpdates } = updates;
  return await coll.updateOne(
    { _id: id },
    { $set: { ...safeUpdates, 更新时间: new Date() } }
  );
}

/**
 * 记录仓库访问（更新最后访问时间）
 */
export async function 记录访问(id) {
  const coll = await getColl();
  return await coll.updateOne(
    { _id: id },
    { $set: { 最后访问时间: new Date() } }
  );
}

/**
 * 删除仓库配置（软删除）
 */
export async function 删除仓库(id) {
  const coll = await getColl();
  return await coll.updateOne(
    { _id: id },
    { $set: { 状态: 'archived', 更新时间: new Date() } }
  );
}

/**
 * 获取当前活跃仓库的本地路径
 * 用于替代 process.cwd() 作为 git 命令的工作目录
 */
export async function 获取仓库路径(仓库标识) {
  let repo;
  if (仓库标识) {
    repo = await 按别名查找(仓库标识) || await 按ID查找(仓库标识);
  } else {
    const list = await 查询仓库列表({ limit: 1 });
    repo = list[0];
  }
  if (!repo) return null;
  await 记录访问(repo._id);
  return repo.本地路径;
}
