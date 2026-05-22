/**
 * 鸽子能力 + 权限策略 + 渠道权限 子路由
 * 职责：能力管理/报告、权限策略、渠道权限配置
 */

import { Router } from 'express';
import { logger } from '../../core.js';
import { 
  getMongoClient, getAdminDb,
  createTimestampFields
} from '../../db.js';
import { 记录审计 } from '../../审计日志.js';
import 注册服务 from '../../白鸽注册服务.js';
const { 获取白鸽信息, 更新渠道权限, 重置渠道权限, DEFAULT_CONFIG } = 注册服务;
import { default as authMiddleware } from '../dove-auth.js';

const router = Router();

// ==================== 权限策略管理 API ====================

/**
 * GET /api/dove/:doveId/access-policy
 * 获取鸽子的权限策略
 */
router.get('/:doveId/access-policy', authMiddleware, async (req, res) => {
  const { doveId } = req.params;
  const userId = req.user.userId;
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    
    const 鸽子 = await adminDb.collection('鸽子身份').findOne(
      { 鸽子ID: doveId },
      { projection: { 饲养员ID: 1, 权限策略: 1 } }
    );
    
    if (!鸽子) {
      return res.status(404).json({ success: false, error: '鸽子不存在' });
    }
    
    if (鸽子.饲养员ID !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: '无权查看此鸽子权限策略' });
    }
    
    res.json({
      success: true,
      data: 鸽子.权限策略 || { 数据访问范围: 'task_only', 最大单次查询量: 100 }
    });
  } catch (e) {
    logger.error('获取权限策略失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * PUT /api/dove/:doveId/access-policy
 * 更新鸽子的权限策略（仅管理员）
 */
router.put('/:doveId/access-policy', authMiddleware, async (req, res) => {
  const { doveId } = req.params;
  const { 数据访问范围, 最大单次查询量 } = req.body;
  
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: '仅管理员可修改权限策略' });
  }
  
  const 有效范围 = ['task_only', 'user_all'];
  if (数据访问范围 && !有效范围.includes(数据访问范围)) {
    return res.status(400).json({ success: false, error: `数据访问范围必须为: ${有效范围.join(' / ')}` });
  }
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    const ts = createTimestampFields();
    
    const 更新字段 = {
      更新时间: ts.localTime,
      更新时间戳: ts.timestamp
    };
    
    if (数据访问范围) 更新字段['权限策略.数据访问范围'] = 数据访问范围;
    if (最大单次查询量) 更新字段['权限策略.最大单次查询量'] = Math.max(1, Math.min(1000, 最大单次查询量));
    
    const result = await adminDb.collection('鸽子身份').updateOne(
      { 鸽子ID: doveId },
      { $set: 更新字段 }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: '鸽子不存在' });
    }
    
    记录审计({
      操作者ID: req.user.userId,
      操作者类型: 'admin',
      操作: 'update_access_policy',
      目标ID: doveId,
      结果: 'success',
      详情: { 数据访问范围, 最大单次查询量 }
    });
    
    res.json({ success: true, data: { doveId, 数据访问范围, 最大单次查询量 } });
  } catch (e) {
    logger.error('更新权限策略失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 增量能力更新 API
 */
router.post('/capabilities', async (req, res) => {
  const doveId = req.user.doveId || req.user.userId;
  const { 变更列表 = [] } = req.body;
  
  if (!Array.isArray(变更列表) || 变更列表.length === 0) {
    return res.status(400).json({ success: false, error: '变更列表不能为空' });
  }
  
  if (变更列表.length > 50) {
    return res.status(400).json({ success: false, error: '单次最多更新50个能力' });
  }
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    const ts = createTimestampFields();
    
    const results = [];
    
    for (const change of 变更列表) {
      if (!change.能力名称) {
        results.push({ 能力名称: change.能力名称, 操作: change.操作, 结果: 'error', 原因: '能力名称不能为空' });
        continue;
      }
      
      if (!['add', 'remove', 'update'].includes(change.操作)) {
        results.push({ 能力名称: change.能力名称, 操作: change.操作, 结果: 'error', 原因: '操作必须是 add/remove/update' });
        continue;
      }
      
      try {
        if (change.操作 === 'add') {
          const abilityDoc = {
            鸽子ID: doveId,
            名称: change.能力名称,
            描述: change.描述 || '',
            参数: change.参数 || {},
            安全级别: change.安全级别 || '安全',
            状态: '活跃',
            注册时间: ts.localTime,
            更新时间: ts.localTime
          };
          await adminDb.collection('能力').updateOne(
            { 鸽子ID: doveId, 名称: change.能力名称 },
            { $set: { ...abilityDoc, 更新时间: ts.localTime } },
            { upsert: true }
          );
          results.push({ 能力名称: change.能力名称, 操作: 'add', 结果: 'success' });
        } else if (change.操作 === 'remove') {
          await adminDb.collection('能力').updateOne(
            { 鸽子ID: doveId, 名称: change.能力名称 },
            { $set: { 状态: '已停用', 更新时间: ts.localTime } }
          );
          results.push({ 能力名称: change.能力名称, 操作: 'remove', 结果: 'success' });
        } else if (change.操作 === 'update') {
          const updateFields = { 更新时间: ts.localTime };
          if (change.描述) updateFields.描述 = change.描述;
          if (change.参数) updateFields.参数 = change.参数;
          if (change.安全级别) updateFields.安全级别 = change.安全级别;
          
          await adminDb.collection('能力').updateOne(
            { 鸽子ID: doveId, 名称: change.能力名称 },
            { $set: updateFields }
          );
          results.push({ 能力名称: change.能力名称, 操作: 'update', 结果: 'success' });
        }
      } catch (itemErr) {
        results.push({ 能力名称: change.能力名称, 操作: change.操作, 结果: 'error', 原因: itemErr.message });
      }
    }
    
    const successCount = results.filter(r => r.结果 === 'success').length;
    
    记录审计({
      操作者ID: doveId,
      操作者类型: 'dove',
      操作: 'update_capabilities',
      目标ID: doveId,
      结果: successCount === results.length ? 'success' : 'partial',
      详情: { 总数: 变更列表.length, 成功数: successCount, 结果: results }
    });
    
    res.json({
      success: true,
      data: {
        总数: 变更列表.length,
        成功数: successCount,
        结果: results
      }
    });
  } catch (e) {
    logger.error('能力更新失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/dove/report-capabilities
 * 鸽子报告能力列表
 */
router.post('/report-capabilities', authMiddleware, async (req, res) => {
  // 优先使用认证中的 doveId，如果认证中是通用身份(如 local_dove)，则使用请求体中的 doveId
  let doveId = req.user.doveId || req.user.userId;
  const { 版本, 能力总数, 能力列表, doveType } = req.body;
  
  // 如果认证中的 doveId 是通用身份（如 local_dove/system_dove），使用请求体中的真实鸽子ID
  if ((doveId === 'local_dove' || doveId === 'system_dove') && req.body.doveId) {
    doveId = req.body.doveId;
  }
  
  try {
    const adminDb = getAdminDb();
    const ts = createTimestampFields();
    
    const result = await adminDb.collection('鸽子身份').updateOne(
      { 鸽子ID: doveId },
      {
        $set: {
          能力列表: 能力列表 || [],
          能力总数: 能力总数 || (能力列表?.length || 0),
          能力版本: 版本 || '1.0.0',
          能力报告时间: ts.localTime,
          能力报告时间戳: ts.timestamp,
          doveType: doveType || 'official'
        }
      }
    );
    
    if (result.matchedCount === 0) {
      logger.warn(`能力报告: 鸽子 ${doveId} 身份未找到，能力已记录但不关联`);
    }
    
    res.json({
      success: true,
      data: {
        doveId,
        能力总数: 能力总数 || (能力列表?.length || 0),
        reported: true
      }
    });
  } catch (e) {
    logger.error('能力报告失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 渠道权限 API ====================

/**
 * GET /api/dove/channel-permission/:doveId
 * 查询渠道权限配置
 */
router.get('/channel-permission/:doveId', authMiddleware, async (req, res) => {
  const { doveId } = req.params;
  const userId = req.user.userId;
  
  try {
    const 结果 = await 获取白鸽信息(doveId);
    
    if (!结果.成功) {
      return res.status(404).json({ success: false, error: 结果.错误 });
    }
    
    const 鸽子 = 结果.鸽子;
    const 是否鸽主 = 鸽子.饲养员ID === userId;
    
    // 鸽主可看全部权限，其他人只看授权部分
    const 返回权限 = 是否鸽主
      ? 鸽子.渠道权限 || DEFAULT_CONFIG.渠道权限
      : 鸽子.渠道权限?.授权 || DEFAULT_CONFIG.渠道权限.授权;
    
    res.json({
      success: true,
      data: {
        doveId,
        isOwner: 是否鸽主,
        渠道权限: 返回权限
      }
    });
  } catch (e) {
    logger.error('查询渠道权限失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * PUT /api/dove/channel-permission
 * 更新渠道权限配置
 * 
 * 参数:
 *   doveId: 鸽子ID
 *   role: 'owner' | 'granted'  (映射到 '鸽主' | '授权')
 *   channel: 'local' | 'remote' | 'wechat' | 'dingtalk' | 'feishu' | '_default'
 *   config: { 工具安全级别上限, 禁用工具, 自定义提示 }
 */
router.put('/channel-permission', authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  const { doveId, role, channel, config } = req.body;
  
  if (!doveId || !role || !channel || !config) {
    return res.status(400).json({ 
      success: false, 
      error: '缺少必填参数: doveId, role, channel, config' 
    });
  }
  
  // 映射英文角色名到中文
  const 角色映射 = { owner: '鸽主', granted: '授权' };
  const 角色 = 角色映射[role];
  
  if (!角色) {
    return res.status(400).json({ 
      success: false, 
      error: `无效的 role: ${role}，合法值: owner, granted` 
    });
  }
  
  const 结果 = await 更新渠道权限(doveId, userId, 角色, channel, config);
  
  if (结果.成功) {
    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'update_channel_permission',
      结果: 'success',
      详情: { doveId, role, channel, level: config.工具安全级别上限 }
    });
    
    res.json({ success: true, data: 结果.渠道权限 });
  } else {
    res.status(400).json({ success: false, error: 结果.错误 });
  }
});

/**
 * POST /api/dove/channel-permission/reset
 * 重置渠道权限为默认值
 * 
 * 参数:
 *   doveId: 鸽子ID
 *   role: 'owner' | 'granted' (可选，不填则重置全部)
 */
router.post('/channel-permission/reset', authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  const { doveId, role } = req.body;
  
  if (!doveId) {
    return res.status(400).json({ success: false, error: '缺少必填参数: doveId' });
  }
  
  // 映射英文角色名到中文
  const 角色映射 = { owner: '鸽主', granted: '授权' };
  const 角色 = role ? 角色映射[role] : null;
  
  const 结果 = await 重置渠道权限(doveId, userId, 角色);
  
  if (结果.成功) {
    记录审计({
      操作者ID: userId,
      操作者类型: 'user',
      操作: 'reset_channel_permission',
      结果: 'success',
      详情: { doveId, role: role || 'all' }
    });
    
    res.json({ success: true, data: { doveId, reset: role || 'all' } });
  } else {
    res.status(400).json({ success: false, error: 结果.错误 });
  }
});

export default router;
