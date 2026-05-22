/**
 * 能力管理服务端路由
 * 职责：能力发现、存储、查询、报告
 * 
 * API 端点：
 * - POST /api/capability/refresh - 刷新能力发现
 * - GET  /api/capability/list - 列出能力
 * - GET  /api/capability/info/:name - 查看能力详情
 * - POST /api/capability/report - 鸽子报告能力
 * - POST /api/capability/change-queue - 管理端提交能力变更
 * - GET  /api/capability/change-queue - 查询能力变更队列
 * - DELETE /api/capability/change-queue/:id - 撤回未下发的变更
 */

import { Router } from 'express';
import { CONFIG, logger } from '../core.js';
import { 
  getMongoClient, getAdminDb, getUserDb,
  toLocalISOString, createTimestampFields, getTimestamp
} from '../db.js';
import { 记录审计 } from '../审计日志.js';

const router = Router();

// 能力集合名称
const CAPABILITY_COLLECTION = '能力';

import { simpleAuthMiddleware } from './capability/认证.js';

// 应用认证中间件
router.use(simpleAuthMiddleware);

/**
 * POST /api/capability/refresh
 * 刷新能力发现
 * 
 * Body: { doveId?: string }
 * 
 * 管理员可指定任意鸽子，普通用户只能刷新自己的鸽子
 */
router.post('/refresh', async (req, res) => {
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    
    const { doveId } = req.body;
    const targetDoveId = doveId || req.user.doveId;
    
    // 权限检查
    if (targetDoveId && targetDoveId !== req.user.doveId && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        error: '无权刷新其他鸽子的能力' 
      });
    }
    
    // 这里触发能力发现
    // 实际实现中，这会调用能力管理器进行发现
    // 由于这是服务端，我们返回一个提示，实际发现由鸽子进程完成
    
    const ts = createTimestampFields();
    
    // 记录刷新请求
    const 刷新记录 = {
      鸽子ID: targetDoveId,
      userId: req.user.userId,
      刷新时间: ts.localTime,
      状态: 'requested'
    };
    
    await adminDb.collection('能力刷新记录').insertOne(刷新记录);
    
    logger.info(`[能力] 刷新请求: dove=${targetDoveId}, user=${req.user.userId}`);
    
    res.json({
      success: true,
      message: '能力刷新请求已提交，鸽子将在下次心跳时执行发现',
      data: {
        doveId: targetDoveId,
        请求时间: ts.localTime
      }
    });
    
  } catch (err) {
    logger.error('[能力] 刷新失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/capability/list
 * 列出能力
 * 
 * Query: 
 * - doveId: 指定鸽子
 * - all: 是否显示所有能力
 * - category: 按分类筛选
 * - source: 按来源筛选
 */
router.get('/list', async (req, res) => {
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    
    const { doveId, all, category, source } = req.query;
    
    // 构建查询条件
    const query = {};
    
    if (!all || all !== 'true') {
      // 非管理员只能看到自己鸽子的能力，或者公开的能力
      if (req.user.role !== 'admin') {
        query.$or = [
          { 鸽子ID: req.user.doveId },
          { 鸽子ID: { $exists: false } },  // 全局能力
          { 公开: true }
        ];
      }
    }
    
    if (doveId) {
      query.鸽子ID = doveId;
    }
    
    if (category) {
      query.分类 = category;
    }
    
    if (source) {
      query.来源 = source;
    }
    
    const 能力列表 = await adminDb.collection(CAPABILITY_COLLECTION)
      .find(query)
      .sort({ 名称: 1 })
      .toArray();
    
    // 统计分类
    const 分类统计 = {};
    const 来源统计 = {};
    
    for (const cap of 能力列表) {
      const 分类 = cap.分类 || '其他';
      const 来源 = cap.来源 || '未知';
      分类统计[分类] = (分类统计[分类] || 0) + 1;
      来源统计[来源] = (来源统计[来源] || 0) + 1;
    }
    
    res.json({
      success: true,
      data: {
        能力总数: 能力列表.length,
        能力列表,
        分类统计,
        来源统计
      }
    });
    
  } catch (err) {
    logger.error('[能力] 列表获取失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/capability/info/:name
 * 查看能力详情
 */
router.get('/info/:name', async (req, res) => {
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    
    const { name } = req.params;
    
    const 能力 = await adminDb.collection(CAPABILITY_COLLECTION).findOne({ 名称: name });
    
    if (!能力) {
      return res.status(404).json({ 
        success: false, 
        error: `能力 "${name}" 不存在` 
      });
    }
    
    // 权限检查
    if (能力.鸽子ID && 能力.鸽子ID !== req.user.doveId && req.user.role !== 'admin') {
      if (!能力.公开) {
        return res.status(403).json({ 
          success: false, 
          error: '无权查看此能力' 
        });
      }
    }
    
    res.json({
      success: true,
      data: 能力
    });
    
  } catch (err) {
    logger.error('[能力] 详情获取失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/capability/report
 * 鸽子报告能力到管理库
 * 
 * Body: { 
 *   doveId: string,
 *   doveType: string,
 *   能力列表: Array,
 *   能力总数: number,
 *   分类统计: Object,
 *   来源统计: Object
 * }
 */
router.post('/report', async (req, res) => {
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    
    const { doveId, doveType, 能力列表, 能力总数, 分类统计, 来源统计 } = req.body;
    
    // 验证 doveId
    if (!doveId) {
      return res.status(400).json({ 
        success: false, 
        error: '缺少 doveId' 
      });
    }
    
    // 权限检查：只能报告自己的能力
    if (doveId !== req.user.doveId && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        error: '只能报告自己的能力' 
      });
    }
    
    const ts = createTimestampFields();
    
    // 批量更新能力
    if (能力列表 && Array.isArray(能力列表)) {
      const bulkOps = 能力列表.map(cap => ({
        updateOne: {
          filter: { 名称: cap.名称, 鸽子ID: doveId },
          update: {
            $set: {
              ...cap,
              鸽子ID: doveId,
              鸽子类型: doveType,
              报告时间: ts.localTime,
              更新时间: ts.localTime
            },
            $setOnInsert: {
              创建时间: ts.localTime
            }
          },
          upsert: true
        }
      }));
      
      if (bulkOps.length > 0) {
        await adminDb.collection(CAPABILITY_COLLECTION).bulkWrite(bulkOps);
      }
    }
    
    // 更新鸽子的能力摘要
    await adminDb.collection('白鸽账号').updateOne(
      { 鸽子ID: doveId },
      {
        $set: {
          能力摘要: {
            能力总数,
            分类统计,
            来源统计,
            报告时间: ts.localTime
          }
        }
      }
    );
    
    logger.info(`[能力] 报告成功: dove=${doveId}, 能力数=${能力总数}`);
    
    res.json({
      success: true,
      message: '能力报告成功',
      data: {
        doveId,
        报告数量: 能力总数
      }
    });
    
  } catch (err) {
    logger.error('[能力] 报告失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/capability/change-queue
 * 管理端提交能力变更到队列（仅管理员/饲养员）
 * 
 * 请求体: {
 *   鸽子ID: string (必填, 目标鸽子),
 *   操作: 'enable' | 'disable' | 'update' (必填),
 *   能力名称: string (必填),
 *   参数: object (可选, 操作参数),
 *   原因: string (可选, 变更原因，如'安全审计要求')
 * }
 */
router.post('/change-queue', async (req, res) => {
  try {
    // 权限检查：仅管理员可提交强制能力变更
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: '仅管理员可提交能力变更队列'
      });
    }

    const { 鸽子ID, 操作, 能力名称, 参数, 原因 } = req.body;

    // 参数验证
    if (!鸽子ID) {
      return res.status(400).json({ success: false, error: '缺少 鸽子ID' });
    }
    if (!操作 || !['enable', 'disable', 'update'].includes(操作)) {
      return res.status(400).json({ success: false, error: '操作 必须为 enable/disable/update' });
    }
    if (!能力名称) {
      return res.status(400).json({ success: false, error: '缺少 能力名称' });
    }

    await getMongoClient();
    const adminDb = getAdminDb();

    // 验证鸽子是否存在
    const pigeon = await adminDb.collection('鸽子身份').findOne(
      { 鸽子ID },
      { projection: { 鸽子ID: 1, 状态: 1 } }
    );
    if (!pigeon) {
      return res.status(404).json({ success: false, error: `鸽子 "${鸽子ID}" 不存在` });
    }

    const ts = createTimestampFields();

    const 变更记录 = {
      鸽子ID,
      操作,
      能力名称,
      参数: 参数 || {},
      原因: 原因 || '',
      状态: '等待中',
      下发时间: null,
      创建时间: ts.localTime
    };

    const result = await adminDb.collection('能力变更队列').insertOne(变更记录);

    记录审计({
      操作者ID: req.user.userId,
      操作者类型: 'user',
      操作: 'capability_change_queue',
      目标ID: result.insertedId.toString(),
      结果: 'success',
      详情: { 鸽子ID, 操作, 能力名称, 原因 }
    });

    logger.info(`[能力] 变更队列: dove=${鸽子ID}, op=${操作}, cap=${能力名称}, by=${req.user.userId}`);

    res.status(201).json({
      success: true,
      message: '能力变更已加入队列，鸽子下次心跳时将下发',
      data: {
        changeId: result.insertedId.toString(),
        鸽子ID,
        操作,
        能力名称,
        状态: '等待中'
      }
    });

  } catch (err) {
    logger.error('[能力] 变更队列写入失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/capability/change-queue
 * 查询能力变更队列（管理员/饲养员查看自己鸽子的变更队列）
 * 
 * Query:
 * - doveId: 指定鸽子（可选，管理员可查所有）
 * - status: pending/delivered（可选）
 */
router.get('/change-queue', async (req, res) => {
  try {
    await getMongoClient();
    const adminDb = getAdminDb();

    const { doveId, status } = req.query;
    const query = {};

    if (doveId) {
      query.鸽子ID = doveId;
    }
    if (status) {
      query.状态 = status;
    }

    // 非管理员只能查看自己鸽子的变更队列
    if (req.user.role !== 'admin') {
      if (!doveId) {
        // 查找用户拥有的鸽子
        const userDoves = await adminDb.collection('鸽子身份')
          .find({ 饲养员ID: req.user.userId }, { projection: { 鸽子ID: 1 } })
          .toArray();
        const doveIds = userDoves.map(d => d.鸽子ID);
        if (doveIds.length === 0) {
          return res.json({ success: true, data: { 变更列表: [], 总数: 0 } });
        }
        query.鸽子ID = { $in: doveIds };
      } else {
        // 验证权限
        const pigeon = await adminDb.collection('鸽子身份').findOne({ 鸽子ID: doveId });
        if (!pigeon || pigeon.饲养员ID !== req.user.userId) {
          return res.status(403).json({ success: false, error: '无权查看此鸽子的变更队列' });
        }
      }
    }

    const 变更列表 = await adminDb.collection('能力变更队列')
      .find(query)
      .sort({ 创建时间: -1 })
      .toArray();

    res.json({
      success: true,
      data: {
        变更列表,
        总数: 变更列表.length
      }
    });

  } catch (err) {
    logger.error('[能力] 变更队列查询失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/capability/change-queue/:id
 * 撤回未下发的变更（管理员）
 */
router.delete('/change-queue/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: '仅管理员可撤回变更' });
    }

    const { id } = req.params;
    await getMongoClient();
    const adminDb = getAdminDb();

    const { ObjectId } = await import('mongodb');
    let objId;
    try {
      objId = new ObjectId(id);
    } catch {
      return res.status(400).json({ success: false, error: '无效的变更ID' });
    }

    // 仅允许删除 pending 状态的变更
    const result = await adminDb.collection('能力变更队列').deleteOne({
      _id: objId,
      状态: '等待中'
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: '变更不存在或已下发，无法撤回'
      });
    }

    记录审计({
      操作者ID: req.user.userId,
      操作者类型: 'user',
      操作: 'capability_change_cancel',
      目标ID: id,
      结果: 'success'
    });

    logger.info(`[能力] 变更撤回: id=${id}, by=${req.user.userId}`);

    res.json({ success: true, data: { deleted: true } });

  } catch (err) {
    logger.error('[能力] 变更撤回失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/capability/export
 * 导出能力数据（管理员）
 */
router.get('/export', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        error: '需要管理员权限' 
      });
    }
    
    await getMongoClient();
    const adminDb = getAdminDb();
    
    const 能力列表 = await adminDb.collection(CAPABILITY_COLLECTION)
      .find({})
      .sort({ 名称: 1 })
      .toArray();
    
    res.json({
      success: true,
      data: {
        导出时间: toLocalISOString(new Date()),
        能力总数: 能力列表.length,
        能力列表
      }
    });
    
  } catch (err) {
    logger.error('[能力] 导出失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
