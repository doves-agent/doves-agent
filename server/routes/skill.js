/**
 * 技能管理 API 路由
 * 提供技能列表查询、禁用状态管理、技能执行协议等功能
 * 
 * API 端点：
 * - GET  /api/skill/list              获取技能列表
 * - GET  /api/skill/status/:name      获取技能状态
 * - POST /api/skill/enable            启用技能
 * - POST /api/skill/disable           禁用技能
 * - POST /api/skill/batch             批量操作
 * - GET  /api/skill/categories        获取技能分类
 * - POST /api/skill/discover          按能力需求发现技能
 * - POST /api/skill/:name/execute     执行技能（标准化协议）
 * - GET  /api/skill/:name/schema      获取技能输入/输出Schema
 * - GET  /api/skill/reliability       获取技能可靠性数据
 * - GET  /api/skill/reliability/:name 获取单个技能可靠性
 * - POST /api/skill/:name/reliability-status  手动设置技能可靠性状态
 */

import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { logger } from '../core.js';
import { getAdminDb, getUserDb, getTimestamp, createTimestampFields } from '../db.js';
import { toLocalISOString } from '@dove/common/时间工具.js';

const router = Router();

import { 技能分类, getCategoryForSkill, getDefaultSkillList } from './skill/分类.js';

/**
 * GET /api/skill/list
 * 获取技能列表
 */
router.get('/list', async (req, res) => {
  try {
    const adminDb = getAdminDb();
    
    // 从数据库获取技能列表
    const dbSkills = await adminDb.collection('技能')
      .find({ 状态: { $ne: '已删除' } })
      .project({ id: 1, 标题: 1, 描述: 1, 状态: 1, 参数: 1 })
      .toArray();
    
    // 获取默认技能列表
    const defaultSkills = getDefaultSkillList();
    
    // 合并技能列表
    const 技能列表 = [...defaultSkills];
    
    // 添加数据库技能（去重）
    for (const skill of dbSkills) {
      if (!技能列表.find(s => s.名称 === skill.id)) {
        技能列表.push({
          名称: skill.id,
          描述: skill.标题 || skill.描述,
          分类: getCategoryForSkill(skill.id) || '数据库',
          来源: '数据库',
          状态: skill.状态 || '活跃'
        });
      }
    }
    
    res.json({
      success: true,
      data: {
        技能列表,
        分类列表: Object.keys(技能分类),
        统计: {
          总数: 技能列表.length,
          目录: 技能列表.filter(s => s.来源 === '目录').length,
          数据库: 技能列表.filter(s => s.来源 === '数据库').length
        }
      }
    });
  } catch (err) {
    logger.error('[技能API] 获取技能列表失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/skill/status/:name
 * 获取技能状态
 */
router.get('/status/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const adminDb = getAdminDb();
    
    // 检查数据库中的技能状态
    const dbSkill = await adminDb.collection('技能').findOne({ id: name });
    
    const 分类 = getCategoryForSkill(name);
    const isDefault = Object.values(技能分类).flat().includes(name);
    
    res.json({
      success: true,
      data: {
        名称: name,
        分类,
        来源: dbSkill ? '数据库' : (isDefault ? '目录' : '未知'),
        状态: dbSkill?.状态 || '活跃',
        描述: dbSkill?.标题 || dbSkill?.描述 || null,
        参数: dbSkill?.参数 || null
      }
    });
  } catch (err) {
    logger.error('[技能API] 获取技能状态失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/skill/enable
 * 启用技能（数据库中的技能）
 */
router.post('/enable', async (req, res) => {
  try {
    const { skillId } = req.body;
    
    if (!skillId) {
      return res.status(400).json({ success: false, error: '缺少技能ID' });
    }
    
    const adminDb = getAdminDb();
    
    const result = await adminDb.collection('技能').updateOne(
      { id: skillId },
      { $set: { 状态: '活跃', 更新时间: new Date() } }
    );
    
    if (result.matchedCount === 0) {
      return res.json({ success: false, error: '技能不存在' });
    }
    
    logger.info(`[技能API] 已启用技能: ${skillId}`);
    
    res.json({
      success: true,
      data: { skillId, 状态: '活跃' }
    });
  } catch (err) {
    logger.error('[技能API] 启用技能失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/skill/disable
 * 禁用技能（数据库中的技能）
 */
router.post('/disable', async (req, res) => {
  try {
    const { skillId } = req.body;
    
    if (!skillId) {
      return res.status(400).json({ success: false, error: '缺少技能ID' });
    }
    
    const adminDb = getAdminDb();
    
    const result = await adminDb.collection('技能').updateOne(
      { id: skillId },
      { $set: { 状态: '已禁用', 更新时间: new Date() } }
    );
    
    if (result.matchedCount === 0) {
      return res.json({ success: false, error: '技能不存在' });
    }
    
    logger.info(`[技能API] 已禁用技能: ${skillId}`);
    
    res.json({
      success: true,
      data: { skillId, 状态: '已禁用' }
    });
  } catch (err) {
    logger.error('[技能API] 禁用技能失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/skill/batch
 * 批量操作技能
 */
router.post('/batch', async (req, res) => {
  try {
    const { action, skills } = req.body;
    
    if (!action || !['enable', 'disable'].includes(action)) {
      return res.status(400).json({ success: false, error: '无效的操作类型' });
    }
    
    if (!skills || !Array.isArray(skills) || skills.length === 0) {
      return res.status(400).json({ success: false, error: '缺少技能列表' });
    }
    
    const adminDb = getAdminDb();
    const 状态 = action === 'enable' ? '活跃' : '已禁用';
    
    const result = await adminDb.collection('技能').updateMany(
      { id: { $in: skills } },
      { $set: { 状态, 更新时间: new Date() } }
    );
    
    logger.info(`[技能API] 批量${action === 'enable' ? '启用' : '禁用'}技能: ${skills.join(', ')}`);
    
    res.json({
      success: true,
      data: {
        action,
        affectedCount: result.modifiedCount,
        skills
      }
    });
  } catch (err) {
    logger.error('[技能API] 批量操作失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/skill/categories
 * 获取技能分类列表
 */
router.get('/categories', (req, res) => {
  res.json({
    success: true,
    data: {
      分类: 技能分类,
      列表: Object.keys(技能分类)
    }
  });
});

// ==================== 技能执行协议 ====================

/**
 * POST /api/skill/discover
 * 按能力需求发现技能
 * 
 * 请求体：{ 能力需求: string[], 分类: string }
 * 返回匹配的技能列表
 */
router.post('/discover', async (req, res) => {
  const { 能力需求, 分类 } = req.body;
  
  try {
    const adminDb = getAdminDb();
    const 技能列表 = [];
    
    // 1. 从默认技能列表匹配
    for (const [分类名, 技能名列表] of Object.entries(技能分类)) {
      if (分类 && 分类 !== 分类名) continue;
      for (const 名称 of 技能名列表) {
        if (能力需求 && 能力需求.length > 0) {
          // 简单匹配：能力需求中的关键词出现在技能名称中
          const 匹配 = 能力需求.some(需求 => 
            名称.toLowerCase().includes(需求.toLowerCase()) ||
            分类名.includes(需求)
          );
          if (!匹配) continue;
        }
        技能列表.push({ 名称, 分类: 分类名, 来源: '目录' });
      }
    }
    
    // 2. 从数据库技能匹配
    const dbSkills = await adminDb.collection('技能')
      .find(查询条件)
      .project({ id: 1, 标题: 1, 描述: 1, 参数: 1, 分类: 1 })
      .toArray();

    for (const skill of dbSkills) {
        if (技能列表.find(s => s.名称 === skill.id)) continue;
        
        if (能力需求 && 能力需求.length > 0) {
          const 匹配 = 能力需求.some(需求 => 
            (skill.id || '').toLowerCase().includes(需求.toLowerCase()) ||
            (skill.标题 || '').includes(需求) ||
            (skill.描述 || '').includes(需求)
          );
          if (!匹配) continue;
        }
        
        技能列表.push({
          名称: skill.id,
          描述: skill.标题 || skill.描述,
          分类: skill.分类 || getCategoryForSkill(skill.id) || '数据库',
          来源: '数据库',
          参数: skill.参数 || null
        });
    }

    res.json({
      success: true,
      data: 技能列表,
      匹配数: 技能列表.length
    });
  } catch (e) {
    logger.error('[技能API] 发现技能失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/skill/:name/schema
 * 获取技能输入/输出Schema
 */
router.get('/:name/schema', async (req, res) => {
  const { name } = req.params;
  
  try {
    const adminDb = getAdminDb();
    
    // 从数据库获取
    const dbSkill = await adminDb.collection('技能').findOne({ id: name });
    
    const schema = {
      名称: name,
      版本: dbSkill?.版本 || '1.0.0',
      输入: dbSkill?.参数 || null,
      输出: dbSkill?.输出Schema || null,
      安全级别: dbSkill?.安全级别 || '安全',
      超时: dbSkill?.超时 || 30000
    };
    
    res.json({ success: true, data: schema });
  } catch (e) {
    logger.error('[技能API] 获取Schema失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/skill/:name/execute
 * 标准化技能执行协议
 * 
 * 请求体：{
 *   参数: object,        // 技能输入参数
 *   上下文: object,      // 执行上下文（任务ID等）
 *   超时: number,        // 超时时间（毫秒），默认30000
 *   回调URL: string      // 异步回调地址（可选）
 * }
 * 
 * 同步执行：直接返回结果
 * 异步执行：立即返回执行ID，结果通过回调或轮询获取
 */
router.post('/:name/execute', async (req, res) => {
  const { name } = req.params;
  const { 参数, 上下文, 超时, 回调URL } = req.body;
  const userId = req.user.userId;
  
  try {
    const adminDb = getAdminDb();
    const ts = createTimestampFields();
    
    // 检查技能是否存在和启用
    const 技能 = await adminDb.collection('技能').findOne({ id: name, 状态: { $ne: '已删除' } });
    
    // 内置技能始终可用
    const isDefault = Object.values(技能分类).flat().includes(name);
    if (!技能 && !isDefault) {
      return res.status(404).json({ success: false, error: `技能「${name}」不存在` });
    }
    
    if (技能?.状态 === '已禁用') {
      return res.status(403).json({ success: false, error: `技能「${name}」已禁用` });
    }
    
    // 创建执行记录
    const 执行ID = new ObjectId().toString();
    const 执行记录 = {
      执行ID,
      技能名称: name,
      用户ID: userId,
      参数: 参数 || {},
      上下文: 上下文 || {},
      超时: 超时 || 30000,
      回调URL: 回调URL || null,
      状态: '等待中',
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp
    };
    
    // 存储执行记录
    await adminDb.collection('技能执行记录').insertOne(执行记录);
    
    // 同步执行模式：返回执行ID和状态
    // 实际技能执行由鸽子侧完成（通过任务队列），此处只做调度记录
    res.json({
      success: true,
      data: {
        执行ID,
        技能名称: name,
        状态: '等待中',
        消息: '执行请求已创建，等待鸽子领取执行',
        超时: 执行记录.超时,
        回调URL: 执行记录.回调URL
      }
    });
  } catch (e) {
    logger.error('[技能API] 执行技能失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 技能可靠性 API（方向5）====================

/**
 * GET /api/skill/reliability
 * 获取技能可靠性数据列表
 * 
 * 查询参数：
 * - status: 按状态筛选 (stable/degraded/unstable/unknown)
 * - skillName: 按技能名筛选（模糊匹配）
 */
router.get('/reliability', async (req, res) => {
  try {
    const userDb = getUserDb();
    const { status, skillName } = req.query;
    const userId = req.user?.userId;
    
    const 查询条件 = {};
    if (status) 查询条件.状态 = status;
    if (skillName) 查询条件.技能名 = { $regex: skillName, $options: 'i' };
    // 用户级隔离：普通用户只看自己的，管理员看全局
    if (userId) 查询条件.$or = [{ 用户ID: userId }, { 用户ID: { $exists: false } }];
    
    const 结果 = await userDb.collection('技能可靠性')
      .find(查询条件, { projection: { 统计: { 最近10次结果: 0 } } })
      .sort({ 可靠性分数: 1 }) // 降级/不稳定排前面
      .limit(100)
      .toArray();
    
    const 统计 = {
      总数: 结果.length,
      稳定: 结果.filter(r => r.状态 === 'stable').length,
      降级: 结果.filter(r => r.状态 === 'degraded').length,
      不稳定: 结果.filter(r => r.状态 === 'unstable').length,
      未知: 结果.filter(r => r.状态 === 'unknown').length
    };
    
    res.json({
      success: true,
      data: { 技能列表: 结果, 统计 }
    });
  } catch (err) {
    logger.error('[技能API] 获取可靠性数据失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/skill/reliability/:name
 * 获取单个技能可靠性详情
 */
router.get('/reliability/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const userId = req.user?.userId;
    const userDb = getUserDb();
    
    // 查询用户级和全局数据
    const 查询条件 = {
      技能名: name,
      $or: [{ 用户ID: userId }, { 用户ID: { $exists: false } }]
    };
    
    const 结果 = await userDb.collection('技能可靠性')
      .find(查询条件, { projection: { 统计: { 最近10次结果: 0 } } })
      .toArray();
    
    res.json({
      success: true,
      data: 结果.length > 0 ? 结果 : { 技能名: name, 可靠性分数: 0.7, 状态: 'unknown', 统计: { 总调用数: 0 } }
    });
  } catch (err) {
    logger.error('[技能API] 获取技能可靠性失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/skill/:name/reliability-status
 * 手动设置技能可靠性状态（运维操作）
 * 
 * 请求体：{ 状态: 'stable'|'degraded'|'unstable', 原因: string }
 */
router.post('/:name/reliability-status', async (req, res) => {
  try {
    const { name } = req.params;
    const { 状态, 原因 } = req.body;
    const userId = req.user?.userId;
    const 操作人 = req.user?.username || req.user?.userId || 'admin';
    
    const 合法状态 = ['stable', 'degraded', 'unstable'];
    if (!状态 || !合法状态.includes(状态)) {
      return res.status(400).json({ success: false, error: `非法状态: ${状态}, 合法值: ${合法状态.join(', ')}` });
    }
    
    const userDb = getUserDb();
    const filter = { 技能名: name, 用户ID: { $exists: false } }; // 手动设置影响全局
    
    try {
      await userDb.collection('技能可靠性').updateOne(
        filter,
        {
          $set: {
            状态,
            手动状态: { 操作人, 时间: toLocalISOString(), 原因: 原因 || '' },
            最后评估时间: toLocalISOString(),
            最后评估时间戳: getTimestamp(),
            更新时间: toLocalISOString(),
            更新时间戳: getTimestamp()
          }
        },
        { upsert: true }
      );
    } catch (e) {
      return res.status(500).json({ success: false, error: `设置失败: ${e.message}` });
    }
    
    logger.info(`[技能API] ${name} 可靠性状态手动设置为 ${状态} (操作人: ${操作人}, 原因: ${原因 || '无'})`);
    
    res.json({
      success: true,
      data: { 技能名: name, 状态, 操作人, 原因: 原因 || '' }
    });
  } catch (err) {
    logger.error('[技能API] 设置可靠性状态失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
