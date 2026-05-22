/**
 * 向量记忆服务
 * 核心：embedding 向量化 + MongoDB 存储 + 应用层余弦相似度搜索
 * Git记忆降为冷备/版本归档
 */

import { randomUUID } from 'crypto';
import { getUserDb } from '../db.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';
import { toLocalISOString, getTimestamp } from '@dove/common/时间工具.js';
import { 文本向量化, 查询向量化, 单多模态向量化, 配置 as embedding配置 } from './embedding.js';
import { 批量排序 } from './相似度.js';
import * as Git记忆服务 from '../Git存储/记忆服务.js';

const logger = 创建日志器('向量记忆', { 前缀: '[向量记忆]' });

const 集合名 = '向量记忆';
const 类别列表 = ['技能记忆', '对话记忆', '经验记忆', '用户画像', '事件触发'];
const 短期类别 = new Set(['对话记忆']);
const 短期TTL天数 = 7;
const 默认搜索阈值 = 0.4;
const 默认搜索数量 = 10;
const 候选集上限 = 500;

function 生成记忆ID() {
  return `mem_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function 获取集合() {
  return getUserDb().collection(集合名);
}

/**
 * 添加记忆
 */
export async function 添加记忆({ 用户ID, 内容, 类别 = '对话记忆', 元数据 = {}, 标题 }) {
  if (!内容 || !用户ID) throw new Error('用户ID和内容不能为空');

  const 分类 = 类别列表.includes(类别) ? 类别 : '对话记忆';
  const 记忆ID = 生成记忆ID();
  const now = new Date();

  // 向量化
  let 向量;
  try {
    [向量] = await 文本向量化([内容], { dimension: embedding配置.默认维度 });
  } catch (e) {
    logger.error(`向量化失败: ${e.message}`);
    throw new Error(`向量化失败: ${e.message}`);
  }

  // 构建文档
  const 文档 = {
    记忆ID,
    用户ID,
    内容,
    摘要: 内容.slice(0, 200),
    标题: 标题 || 内容.slice(0, 50),
    类别: 分类,
    记忆类型: 短期类别.has(分类) ? '短期' : '长期',
    向量,
    向量模型: 'text-embedding-v3',
    向量维度: embedding配置.默认维度,
    多模态类型: null,
    多模态URL: null,
    元数据,
    创建时间: toLocalISOString(now),
    创建时间戳: getTimestamp(now),
    更新时间: toLocalISOString(now),
    过期时间: 短期类别.has(分类) ? new Date(now.getTime() + 短期TTL天数 * 86400000) : null
  };

  await 获取集合().insertOne(文档);

  // Git 备份（长期记忆）
  if (文档.记忆类型 === '长期') {
    try {
      await Git记忆服务.添加记忆({ 用户ID, 类别: 分类, 内容, 元数据: { ...元数据, 记忆ID } });
    } catch (e) {
      logger.warn(`Git备份失败（不影响主流程）: ${e.message}`);
    }
  }

  logger.debug(`添加记忆: ${记忆ID} [${分类}] (用户: ${用户ID})`);
  return { 成功: true, data: { id: 记忆ID, 类别: 分类, 记忆类型: 文档.记忆类型 } };
}

/**
 * 添加多模态记忆
 */
export async function 添加多模态记忆({ 用户ID, 文本, 图片URL, 音频URL, 视频URL, 类别 = '经验记忆', 元数据 = {} }) {
  if (!用户ID) throw new Error('用户ID不能为空');
  if (!文本 && !图片URL && !音频URL && !视频URL) throw new Error('至少提供一种内容');

  const 分类 = 类别列表.includes(类别) ? 类别 : '经验记忆';
  const 记忆ID = 生成记忆ID();
  const now = new Date();

  // 多模态向量化
  const content = {};
  if (文本) content.text = 文本;
  if (图片URL) content.image = 图片URL;
  if (音频URL) content.audio = 音频URL;
  if (视频URL) content.video = 视频URL;

  let 向量;
  try {
    向量 = await 单多模态向量化(content);
  } catch (e) {
    logger.error(`多模态向量化失败: ${e.message}`);
    throw new Error(`多模态向量化失败: ${e.message}`);
  }

  const 多模态类型 = 图片URL ? '图片' : 音频URL ? '音频' : 视频URL ? '视频' : null;

  const 文档 = {
    记忆ID,
    用户ID,
    内容: 文本 || `[${多模态类型}] ${图片URL || 音频URL || 视频URL}`,
    摘要: (文本 || '').slice(0, 200),
    标题: (文本 || `${多模态类型}记忆`).slice(0, 50),
    类别: 分类,
    记忆类型: '长期',
    向量,
    向量模型: 'multimodal-embedding-v1',
    向量维度: 1024,
    多模态类型,
    多模态URL: 图片URL || 音频URL || 视频URL || null,
    元数据,
    创建时间: toLocalISOString(now),
    创建时间戳: getTimestamp(now),
    更新时间: toLocalISOString(now),
    过期时间: null
  };

  await 获取集合().insertOne(文档);
  logger.debug(`添加多模态记忆: ${记忆ID} [${多模态类型}] (用户: ${用户ID})`);
  return { 成功: true, data: { id: 记忆ID, 类别: 分类, 多模态类型 } };
}

/**
 * 搜索记忆（向量语义搜索）
 */
export async function 搜索记忆({ 用户ID, 查询, 类别, topK = 默认搜索数量, 阈值 = 默认搜索阈值, 包含多模态 = false }) {
  if (!用户ID || !查询) throw new Error('用户ID和查询不能为空');

  // 1. 向量化查询
  let queryVec;
  try {
    if (包含多模态) {
      queryVec = await 单多模态向量化({ text: 查询 });
    } else {
      queryVec = await 查询向量化(查询);
    }
  } catch (e) {
    logger.error(`查询向量化失败: ${e.message}`);
    throw new Error(`查询向量化失败: ${e.message}`);
  }

  // 2. 从 MongoDB 取候选集
  const filter = { 用户ID };
  if (类别) {
    filter.类别 = Array.isArray(类别) ? { $in: 类别 } : 类别;
  }
  if (!包含多模态) {
    filter.多模态类型 = null;
  }

  const candidates = await 获取集合()
    .find(filter, { projection: { _id: 0, 记忆ID: 1, 内容: 1, 摘要: 1, 标题: 1, 类别: 1, 记忆类型: 1, 向量: 1, 多模态类型: 1, 多模态URL: 1, 元数据: 1, 创建时间: 1 } })
    .sort({ 创建时间戳: -1 })
    .limit(候选集上限)
    .toArray();

  if (candidates.length === 0) return { 成功: true, data: [] };

  // 3. 余弦相似度排序
  const 结果 = 批量排序(queryVec, candidates, topK, 阈值);

  // 去掉向量字段再返回
  const 输出 = 结果.map(({ 向量, ...rest }) => rest);

  return { 成功: true, data: 输出 };
}

/**
 * 获取记忆
 */
export async function 获取记忆({ 用户ID, 记忆ID }) {
  const doc = await 获取集合().findOne(
    { 记忆ID, 用户ID },
    { projection: { _id: 0, 向量: 0 } }
  );
  if (!doc) return { 成功: false, 错误: '记忆不存在' };
  return { 成功: true, data: doc };
}

/**
 * 更新记忆
 */
export async function 更新记忆({ 用户ID, 记忆ID, 内容, 元数据 }) {
  const existing = await 获取集合().findOne({ 记忆ID, 用户ID });
  if (!existing) return { 成功: false, 错误: '记忆不存在' };

  const update = { 更新时间: toLocalISOString() };

  if (内容 !== undefined && 内容 !== existing.内容) {
    update.内容 = 内容;
    update.摘要 = 内容.slice(0, 200);
    // 重新向量化
    try {
      [update.向量] = await 文本向量化([内容], { dimension: existing.向量维度 });
    } catch (e) {
      logger.warn(`更新向量化失败: ${e.message}`);
    }
  }

  if (元数据) {
    update.元数据 = { ...existing.元数据, ...元数据 };
  }

  await 获取集合().updateOne({ 记忆ID, 用户ID }, { $set: update });
  return { 成功: true, data: { id: 记忆ID } };
}

/**
 * 删除记忆
 */
export async function 删除记忆({ 用户ID, 记忆ID }) {
  const result = await 获取集合().deleteOne({ 记忆ID, 用户ID });
  if (result.deletedCount === 0) return { 成功: false, 错误: '记忆不存在' };
  return { 成功: true };
}

/**
 * 获取记忆列表（分页）
 */
export async function 获取记忆列表({ 用户ID, 类别, 页码 = 1, 每页数量 = 20 }) {
  const filter = { 用户ID };
  if (类别) filter.类别 = 类别;

  const 总数 = await 获取集合().countDocuments(filter);
  const 条目 = await 获取集合()
    .find(filter, { projection: { _id: 0, 向量: 0 } })
    .sort({ 创建时间戳: -1 })
    .skip((页码 - 1) * 每页数量)
    .limit(每页数量)
    .toArray();

  return { 成功: true, data: { 条目, 总数, 页码, 每页数量 } };
}

/**
 * 获取类别列表
 */
export async function 获取类别列表() {
  return { 成功: true, data: [...类别列表] };
}

/**
 * 获取统计信息
 */
export async function 获取统计({ 用户ID }) {
  const pipeline = [
    { $match: { 用户ID } },
    { $group: { _id: '$类别', 数量: { $sum: 1 } } }
  ];
  const 结果 = await 获取集合().aggregate(pipeline).toArray();
  const 统计 = {};
  let 总计 = 0;
  for (const item of 结果) {
    统计[item._id] = item.数量;
    总计 += item.数量;
  }
  return { 成功: true, data: { 分类统计: 统计, 总计 } };
}
