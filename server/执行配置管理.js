/**
 * 执行配置管理模块
 * 负责执行配置的 CRUD 操作
 * 
 * === 设计原则 ===
 * - 内置配置不可删除，只可更新部分字段
 * - 自定义配置可完全 CRUD
 * - 标识字段（标识）唯一，创建后不可修改
 */

import { getUserDb } from './db.js';
import { toLocalISOString, getTimestamp, createTimestampFields } from '../common/时间工具.js';
import { 执行配置管理器, 内置配置列表, 默认空约束 } from '../common/执行配置.js';
import { ObjectId } from 'mongodb';

// 管理器实例（复用内置索引）
const 管理器 = new 执行配置管理器();

/**
 * 列出所有执行配置
 * @param {string} userId - 用户ID（过滤自定义配置）
 * @param {Object} 筛选 - { 标签, 关键词 }
 * @returns {Array} 配置摘要列表
 */
export async function 列出配置(userId, 筛选 = {}) {
  const db = getUserDb();
  const 集合 = db.collection('执行配置');
  
  const 查询条件 = {};
  if (userId) {
    // 内置配置 + 该用户创建的配置
    查询条件.$or = [
      { 是否内置: true },
      { 创建者用户ID: userId }
    ];
  }
  
  const 列表 = await 集合.find(查询条件, {
    projection: { 配置ID: 1, 名称: 1, 标识: 1, 描述: 1, 标签: 1, 是否内置: 1, 创建时间: 1 }
  }).toArray();
  
  // 标签筛选
  let 结果 = 列表;
  if (筛选.标签) {
    结果 = 结果.filter(c => c.标签 && c.标签.includes(筛选.标签));
  }
  if (筛选.关键词) {
    const kw = 筛选.关键词.toLowerCase();
    结果 = 结果.filter(c => 
      (c.名称 && c.名称.toLowerCase().includes(kw)) ||
      (c.标识 && c.标识.toLowerCase().includes(kw)) ||
      (c.描述 && c.描述.toLowerCase().includes(kw))
    );
  }
  
  return 结果;
}

/**
 * 获取单个执行配置详情
 * @param {string} 标识 - 配置标识
 * @returns {Object|null} 配置对象
 */
export async function 获取配置详情(标识) {
  const db = getUserDb();
  const 集合 = db.collection('执行配置');
  
  const 配置 = await 集合.findOne({ 标识 });
  return 配置;
}

/**
 * 创建自定义执行配置
 * @param {Object} 配置数据 - 配置数据（不含元信息）
 * @param {string} userId - 创建者用户ID
 * @returns {Object} 创建结果
 */
export async function 创建配置(配置数据, userId) {
  const db = getUserDb();
  const 集合 = db.collection('执行配置');
  
  // 检查标识是否已存在
  const 已存在 = await 集合.findOne({ 标识: 配置数据.标识 });
  if (已存在) {
    throw new Error(`配置标识 "${配置数据.标识}" 已存在`);
  }
  
  // 构建完整配置
  const ts = createTimestampFields();
  const 完整配置 = {
    配置ID: new ObjectId().toString(),
    名称: 配置数据.名称 || 配置数据.标识,
    标识: 配置数据.标识,
    描述: 配置数据.描述 || '',
    标签: 配置数据.标签 || [],
    执行约束: { ...默认空约束.执行约束, ...(配置数据.执行约束 || {}) },
    能力约束: { ...默认空约束.能力约束, ...(配置数据.能力约束 || {}) },
    工具约束: { ...默认空约束.工具约束, ...(配置数据.工具约束 || {}) },
    技能约束: { ...默认空约束.技能约束, ...(配置数据.技能约束 || {}) },
    意图约束: { ...默认空约束.意图约束, ...(配置数据.意图约束 || {}) },
    创建者用户ID: userId,
    是否内置: false,
    创建时间: ts.localTime,
    创建时间戳: ts.timestamp,
  };
  
  // 校验
  const 校验结果 = 管理器.校验(完整配置);
  if (!校验结果.有效) {
    throw new Error(`配置校验失败: ${校验结果.错误列表.join('; ')}`);
  }
  
  await 集合.insertOne(完整配置);
  
  // 更新缓存
  管理器.自定义配置缓存.set(完整配置.标识, 完整配置);
  
  return 完整配置;
}

/**
 * 更新执行配置
 * @param {string} 标识 - 配置标识
 * @param {Object} 更新数据 - 要更新的字段
 * @param {string} userId - 操作者用户ID
 * @returns {Object} 更新结果
 */
export async function 更新配置(标识, 更新数据, userId) {
  const db = getUserDb();
  const 集合 = db.collection('执行配置');
  
  const 现有配置 = await 集合.findOne({ 标识 });
  if (!现有配置) {
    throw new Error(`配置 "${标识}" 不存在`);
  }
  
  // 内置配置只允许更新描述和标签
  if (现有配置.是否内置) {
    const 允许字段 = ['描述', '标签'];
    const 过滤更新 = {};
    for (const 字段 of 允许字段) {
      if (更新数据[字段] !== undefined) {
        过滤更新[字段] = 更新数据[字段];
      }
    }
    if (Object.keys(过滤更新).length === 0) {
      throw new Error('内置配置仅允许更新描述和标签');
    }
    await 集合.updateOne({ 标识 }, { $set: 过滤更新 });
    return { 更新字段: Object.keys(过滤更新) };
  }
  
  // 自定义配置：检查权限
  if (现有配置.创建者用户ID !== userId) {
    throw new Error('无权修改他人创建的配置');
  }
  
  // 禁止修改标识和内置标志
  const 更新字段 = { ...更新数据 };
  delete 更新字段.标识;
  delete 更新字段.是否内置;
  delete 更新字段.配置ID;
  delete 更新字段.创建者用户ID;
  delete 更新字段.创建时间;
  delete 更新字段.创建时间戳;
  
  // 合并约束字段
  for (const 约束名 of ['执行约束', '能力约束', '工具约束', '技能约束', '意图约束']) {
    if (更新字段[约束名]) {
      更新字段[约束名] = { ...现有配置[约束名], ...更新字段[约束名] };
    }
  }
  
  // 校验
  const 合并配置 = { ...现有配置, ...更新字段 };
  const 校验结果 = 管理器.校验(合并配置);
  if (!校验结果.有效) {
    throw new Error(`配置校验失败: ${校验结果.错误列表.join('; ')}`);
  }
  
  await 集合.updateOne({ 标识 }, { $set: 更新字段 });
  
  // 更新缓存
  if (管理器.自定义配置缓存.has(标识)) {
    管理器.自定义配置缓存.set(标识, { ...管理器.自定义配置缓存.get(标识), ...更新字段 });
  }
  
  return { 更新字段: Object.keys(更新字段) };
}

/**
 * 删除执行配置
 * @param {string} 标识 - 配置标识
 * @param {string} userId - 操作者用户ID
 * @returns {Object} 删除结果
 */
export async function 删除配置(标识, userId) {
  const db = getUserDb();
  const 集合 = db.collection('执行配置');
  
  const 现有配置 = await 集合.findOne({ 标识 });
  if (!现有配置) {
    throw new Error(`配置 "${标识}" 不存在`);
  }
  
  if (现有配置.是否内置) {
    throw new Error('内置配置不可删除');
  }
  
  if (现有配置.创建者用户ID !== userId) {
    throw new Error('无权删除他人创建的配置');
  }
  
  await 集合.deleteOne({ 标识 });
  
  // 更新缓存
  管理器.自定义配置缓存.delete(标识);
  
  return { 删除: 标识 };
}

/**
 * 解析执行配置（供 API 层调用）
 * @param {string|null} profile标识 - Profile 标识
 * @param {Object} 内联参数 - CLI 传入的覆盖参数
 * @returns {Object} 最终生效的执行配置
 */
export function 解析执行配置(profile标识, 内联参数 = {}) {
  return 管理器.解析(profile标识, 内联参数);
}

/**
 * 获取所有可用标签
 * @returns {Array} 标签列表
 */
export async function 获取所有标签() {
  const db = getUserDb();
  const 集合 = db.collection('执行配置');
  
  const 标签列表 = await 集合.distinct('标签');
  return 标签列表.filter(Boolean).sort();
}

export default { 列出配置, 获取配置详情, 创建配置, 更新配置, 删除配置, 解析执行配置, 获取所有标签 };

