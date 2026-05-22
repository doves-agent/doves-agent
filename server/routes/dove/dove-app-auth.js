/**
 * 扩展审核与授权 API 路由
 * 挂载到 /api/dove/app
 *
 * 端点：
 *   POST /submit         提交扩展审核
 *   POST /review         审核扩展（管理员）
 *   GET  /pending        列出待审核（管理员）
 *   GET  /registry/:name 查询官方注册信息（公开）
 *   POST /authorize      授权扩展
 *   POST /revoke         撤销授权
 *   POST /check          检查运行模式
 *   GET  /list           列出已授权
 */

import { Router } from 'express';
import { getAdminDb, createTimestampFields } from '../../db.js';
import { logger } from '../../core.js';
import { 授权扩展, 撤销授权, 检查授权, 列出用户授权, 计算生效权限, isOfficialExtension } from '../../注册服务/扩展授权.js';

const router = Router();

// ==================== 提交审核 ====================

router.post('/submit', async (req, res) => {
  const { devId, extensionName, version, description, permissions, signature } = req.body;
  const userId = req.user?.userId;

  if (!devId || !extensionName) {
    return res.status(400).json({ success: false, error: 'devId 和 extensionName 必填' });
  }

  try {
    const adminDb = getAdminDb();
    const ts = createTimestampFields();

    await adminDb.collection('官方扩展注册表').updateOne(
      { extensionName },
      {
        $set: {
          extensionName,
          devId,
          version: version || '0.0.0',
          description: description || '',
          permissions: permissions || {},
          signature: signature || null,
          status: '等待中',
          submittedBy: userId,
          updatedAt: ts.localTime,
        },
        $setOnInsert: {
          createdAt: ts.localTime,
        },
      },
      { upsert: true }
    );

    logger.info(`[app] 扩展 "${extensionName}" 已提交审核 (开发者: ${devId})`);
    res.json({ success: true, data: { extensionName, status: '等待中' } });
  } catch (e) {
    logger.error(`[app] 提交审核失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 审核扩展 ====================

router.post('/review', async (req, res) => {
  const { extensionName, action, note } = req.body;

  if (!extensionName || !action) {
    return res.status(400).json({ success: false, error: 'extensionName 和 action 必填' });
  }

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ success: false, error: 'action 必须是 approve 或 reject' });
  }

  try {
    const adminDb = getAdminDb();
    const ts = createTimestampFields();

    const result = await adminDb.collection('官方扩展注册表').updateOne(
      { extensionName },
      {
        $set: {
          status: action === 'approve' ? '已批准' : '已拒绝',
          reviewNote: note || '',
          reviewedAt: ts.localTime,
          updatedAt: ts.localTime,
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: `扩展 "${extensionName}" 未找到` });
    }

    logger.info(`[app] 扩展 "${extensionName}" 审核结果: ${action}`);
    res.json({ success: true, data: { extensionName, status: action === 'approve' ? '已批准' : '已拒绝' } });
  } catch (e) {
    logger.error(`[app] 审核失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 列出待审核 ====================

router.get('/pending', async (req, res) => {
  try {
    const adminDb = getAdminDb();
    const list = await adminDb.collection('官方扩展注册表')
      .find({ status: '等待中' })
      .project({ extensionName: 1, devId: 1, version: 1, description: 1, permissions: 1, createdAt: 1 })
      .toArray();

    res.json({ success: true, data: list });
  } catch (e) {
    logger.error(`[app] 列出待审核失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 查询官方注册信息（公开） ====================

router.get('/registry/:name', async (req, res) => {
  const extensionName = req.params.name;

  try {
    const adminDb = getAdminDb();
    const record = await adminDb.collection('官方扩展注册表').findOne(
      { extensionName },
      {
        projection: {
          extensionName: 1,
          devId: 1,
          version: 1,
          description: 1,
          permissions: 1,
          signature: 1,
          status: 1,
        },
      }
    );

    if (!record) {
      return res.status(404).json({ success: false, error: '未找到' });
    }

    res.json({
      success: true,
      data: {
        extensionName: record.extensionName,
        devId: record.devId,
        version: record.version,
        description: record.description,
        permissions: record.permissions || {},
        signatureVerified: !!record.signature,
        status: record.status,
      },
    });
  } catch (e) {
    logger.error(`[app] 查询注册信息失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 授权扩展 ====================

router.post('/authorize', async (req, res) => {
  const { extensionName } = req.body;
  const userId = req.user?.userId;

  if (!extensionName) {
    return res.status(400).json({ success: false, error: 'extensionName 必填' });
  }

  try {
    // 从官方注册表读取权限快照
    const adminDb = getAdminDb();
    const registry = await adminDb.collection('官方扩展注册表').findOne(
      { extensionName, status: '已批准' }
    );

    if (!registry) {
      return res.status(404).json({ success: false, error: `扩展 "${extensionName}" 未审核通过或不存在` });
    }

    const result = await 授权扩展({
      userId,
      extensionName,
      devId: registry.devId,
      permissions: registry.permissions,
      developerVerified: !!registry.signature,
    });

    if (result.成功) {
      res.json({ success: true, data: result.授权 });
    } else {
      res.status(400).json({ success: false, error: result.错误 });
    }
  } catch (e) {
    logger.error(`[app] 授权失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 撤销授权 ====================

router.post('/revoke', async (req, res) => {
  const { extensionName } = req.body;
  const userId = req.user?.userId;

  if (!extensionName) {
    return res.status(400).json({ success: false, error: 'extensionName 必填' });
  }

  try {
    const result = await 撤销授权(userId, extensionName);
    if (result.成功) {
      res.json({ success: true });
    } else {
      res.status(400).json({ success: false, error: result.错误 });
    }
  } catch (e) {
    logger.error(`[app] 撤销授权失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 检查运行模式 ====================

router.post('/check', async (req, res) => {
  const { extensionName, devId, permissions, signatureVerified } = req.body;
  const userId = req.user?.userId;

  if (!extensionName) {
    return res.status(400).json({ success: false, error: 'extensionName 必填' });
  }

  try {
    const result = await 计算生效权限({
      userId,
      extensionName,
      devId,
      declaredPermissions: permissions || {},
      signatureVerified: !!signatureVerified,
    });

    res.json({
      success: true,
      data: {
        mode: result.mode,
        effectivePermissions: result.effectivePermissions,
        warnings: result.warnings,
      },
    });
  } catch (e) {
    logger.error(`[app] 检查运行模式失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 列出已授权 ====================

router.get('/list', async (req, res) => {
  const userId = req.user?.userId;

  try {
    const result = await 列出用户授权(userId);
    res.json({ success: true, data: result.授权列表 || [] });
  } catch (e) {
    logger.error(`[app] 列出授权失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
