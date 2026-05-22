/**
 * 颜色模板数据层
 * 通过 DoveAppContext (ctx) 接口底座操作数据
 * 
 * 详见: 白鸽文档/dove_apps/接口底座规范.md
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('背单词/颜色', { 前缀: '[vocabulary/data]', 级别: 'debug', 显示调用位置: true });

const DB_NAME = '背单词';
const COLLECTION = 'colortemplates';

const DEFAULT_TEMPLATES = [
  { name: '经典彩虹', colors: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'], type: 'system' },
  { name: '护眼柔和', colors: ['#A8D8EA', '#AA96DA', '#FCBAD3', '#FFFFD2', '#B5EAD7'], type: 'system' },
  { name: '高对比', colors: ['#E74C3C', '#3498DB', '#2ECC71', '#F39C12', '#9B59B6'], type: 'system' },
  { name: '暗色主题', colors: ['#FF7675', '#74B9FF', '#55EFC4', '#FDCB6E', '#DFE6E9'], type: 'system' },
  { name: '清新自然', colors: ['#00B894', '#00CEC9', '#0984E3', '#6C5CE7', '#FD79A8'], type: 'system' },
];

let _ctx = null;
let _db = null;
let _初始化Promise = null;  // 懒初始化：首次使用时执行，避免每次启动都跑 ensureDefaults

/**
 * 注入 DoveAppContext（由 manifest.onInit 调用）
 */
export function setContext(ctx) {
  _ctx = ctx;
  _db = null;
}

async function getDb() {
  if (!_ctx) throw new Error('[vocabulary/colors] DoveAppContext 未注入，请确认 manifest.onInit 已执行');
  if (!_db) _db = _ctx.db(DB_NAME);
  return _db;
}

async function getColl() {
  const db = await getDb();
  return db.collection(COLLECTION);
}

/**
 * 确保系统预设模板存在（懒初始化：首次使用时自动执行，只跑一次）
 */
export async function ensureDefaults() {
  if (!_初始化Promise) {
    _初始化Promise = _doEnsureDefaults();
  }
  await _初始化Promise;
}

async function _doEnsureDefaults() {
  const coll = await getColl();
  for (const template of DEFAULT_TEMPLATES) {
    const exists = await coll.findOne({ name: template.name, type: 'system' });
    if (!exists) {
      await coll.insertOne({ ...template, createdAt: new Date(), updatedAt: new Date() });
      logger.info(`创建系统颜色模板: ${template.name}`);
    }
  }
}

/**
 * 获取所有颜色模板（系统 + 用户自定义）
 */
export async function listTemplates() {
  await ensureDefaults();
  const coll = await getColl();
  return await coll.find({}, {}).toArray();
}

/**
 * 创建自定义颜色模板
 * @param {string} name - 模板名称
 * @param {string[]} colors - 5个hex颜色值
 * @param {string} userId - 创建者用户ID（可选）
 */
export async function createTemplate(name, colors, userId = null) {
  const coll = await getColl();
  const doc = {
    name,
    colors,
    type: 'user',
    created_by: userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return await coll.insertOne(doc);
}

/**
 * 删除自定义颜色模板（不可删除系统预设）
 * @param {string} templateId - 模板ID
 */
export async function deleteTemplate(templateId) {
  const coll = await getColl();
  const template = await coll.findOne({ _id: templateId });
  if (!template) return { deletedCount: 0, acknowledged: true };
  if (template.type === 'system') {
    throw new Error('不可删除系统预设模板');
  }
  return await coll.deleteOne({ _id: templateId });
}
