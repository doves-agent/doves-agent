/**
 * @file server/routes/dove/dove-extension-db
 * @description 扩展数据库权限注册 API
 * 
 * === API 端点 ===
 * POST /api/dove/extension/db-register   - 注册扩展的数据库权限
 * POST /api/dove/extension/db-unregister - 注销扩展的数据库权限
 * GET  /api/dove/extension/db-status     - 查看当前鸽子的注册状态
 * 
 * === 安全 ===
 * - 仅鸽子（doveId）可以注册自己的扩展权限
 * - 注册时验证 declarations 格式合法性
 * - 鸽子下线时自动清理注册表
 */

import { Router } from 'express';
import { extensionDBRegistry } from '../../extension-db-registry.js';
import { logger } from '../../core.js';

const router = Router();

/**
 * POST /extension/db-register
 * 注册扩展的数据库权限声明
 * 
 * Body: {
 *   extension: '背单词',
 *   databases: {
 *     '背单词': {
 *       collections: {
 *         'words': {
 *           actions: ['find', 'findOne', 'aggregate', 'insertOne', 'countDocuments'],
 *           policy: 'shared',
 *         },
 *         'learningrecords': {
 *           actions: ['find', 'findOne', 'aggregate', 'insertOne', 'updateOne', 'countDocuments'],
 *           policy: 'user_scoped',
 *           userField: 'user_id',
 *         },
 *         'colortemplates': {
 *           actions: ['find', 'findOne', 'insertOne', 'deleteOne'],
 *           policy: 'shared',
 *         }
 *       }
 *     }
 *   }
 * }
 */
router.post('/db-register', async (req, res) => {
  try {
    const doveId = req.user?.doveId;
    if (!doveId) {
      return res.status(403).json({
        success: false,
        error: '只有鸽子可以注册扩展数据库权限',
      });
    }

    const { extension, databases } = req.body;
    
    if (!extension || typeof extension !== 'string') {
      return res.status(400).json({
        success: false,
        error: '缺少参数: extension（扩展包名称）',
      });
    }

    if (!databases || typeof databases !== 'object') {
      return res.status(400).json({
        success: false,
        error: '缺少参数: databases（数据库权限声明）',
      });
    }

    // 验证格式
    const validation = extensionDBRegistry.validate(databases);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: `声明格式验证失败: ${validation.errors.join('; ')}`,
      });
    }

    // 注册
    const result = extensionDBRegistry.register(doveId, extension, databases);
    
    return res.json({
      success: result.success,
      message: result.message,
      data: {
        doveId,
        extension,
        databases,
      },
    });
  } catch (e) {
    logger.error('[扩展DB注册] 注册失败:', e.message);
    return res.status(500).json({
      success: false,
      error: `注册失败: ${e.message}`,
    });
  }
});

/**
 * POST /extension/db-unregister
 * 注销扩展的数据库权限
 * 
 * Body: { extension: '背单词' }
 */
router.post('/db-unregister', async (req, res) => {
  try {
    const doveId = req.user?.doveId;
    if (!doveId) {
      return res.status(403).json({
        success: false,
        error: '只有鸽子可以注销扩展数据库权限',
      });
    }

    const { extension } = req.body;
    
    if (!extension || typeof extension !== 'string') {
      return res.status(400).json({
        success: false,
        error: '缺少参数: extension（扩展包名称）',
      });
    }

    extensionDBRegistry.unregister(doveId, extension);

    return res.json({
      success: true,
      message: `已注销扩展 ${extension} 的数据库权限`,
    });
  } catch (e) {
    logger.error('[扩展DB注销] 失败:', e.message);
    return res.status(500).json({
      success: false,
      error: `注销失败: ${e.message}`,
    });
  }
});

/**
 * GET /extension/db-status
 * 查看当前鸽子的注册状态
 */
router.get('/db-status', async (req, res) => {
  try {
    const doveId = req.user?.doveId;
    
    const registrations = doveId 
      ? extensionDBRegistry.getDoveRegistrations(doveId)
      : {};
    
    const stats = extensionDBRegistry.getStats();

    return res.json({
      success: true,
      data: {
        doveId: doveId || '(用户)',
        isDove: !!doveId,
        registrations,
        stats,
        note: doveId ? null : '非鸽子请求，数据库访问由 ALLOWED_COLLECTIONS 控制',
      },
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

export default router;
