/**
 * @file server/routes/dove/dove-developer
 * @description 开发者凭证管理 API
 * 
 * === API 端点 ===
 * POST /api/dove/developer/register       - 注册开发者账号
 * GET  /api/dove/developer/info            - 查询自己的开发者信息
 * GET  /api/dove/developer/info/:devId     - 公开查询开发者信息
 * POST /api/dove/developer/extension/bind  - 绑定扩展包
 * POST /api/dove/developer/extension/unbind - 解绑扩展包
 * GET  /api/dove/developer/extensions      - 列出已绑定的扩展
 * POST /api/dove/developer/regenerate-key  - 重新生成签名密钥
 * POST /api/dove/developer/verify          - 验证开发者ID+签名（无认证，供鸽子加载器用）
 * 
 * === 安全 ===
 * - 注册/绑定/解绑/重生成密钥需 JWT 认证
 * - /verify 无需认证，供鸽子进程调用
 * - 每个用户最多 1 个开发者账号
 */

import { Router } from 'express';
import { logger } from '../../core.js';
import {
  注册开发者账号,
  获取开发者信息,
  根据用户获取开发者,
  绑定扩展,
  解绑扩展,
  验证开发者,
  验证开发者签名,
  重新生成签名密钥,
} from '../../注册服务/开发者注册.js';
import { authMiddleware } from '../dove-auth.js';

const router = Router();

// ==================== 开发者注册 ====================

/**
 * POST /register
 * 注册开发者账号
 * 
 * Body: { name: '开发者名称' }
 * 需要 JWT 认证
 */
router.post('/register', authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ success: false, error: '开发者名称必填' });
  }

  try {
    const 结果 = await 注册开发者账号({ name, userId });

    if (结果.成功) {
      logger.info(`用户 ${userId} 注册开发者账号: ${结果.开发者.devId}`);
      res.status(201).json({
        success: true,
        data: 结果.开发者,
        warning: '签名密钥(signingKey)仅此一次返回，请妥善保管',
      });
    } else {
      res.status(400).json({ success: false, error: 结果.错误 });
    }
  } catch (e) {
    logger.error('注册开发者账号失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 开发者信息查询 ====================

/**
 * GET /info
 * 查询自己的开发者信息（需认证）
 */
router.get('/info', authMiddleware, async (req, res) => {
  const userId = req.user.userId;

  try {
    const 结果 = await 根据用户获取开发者(userId);

    if (结果.成功) {
      res.json({ success: true, data: 结果.开发者 });
    } else {
      res.status(404).json({ success: false, error: 结果.错误 });
    }
  } catch (e) {
    logger.error('查询开发者信息失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /info/:devId
 * 公开查询开发者信息（无需认证，不含密钥）
 */
router.get('/info/:devId', async (req, res) => {
  const { devId } = req.params;

  try {
    const 结果 = await 获取开发者信息(devId);

    if (结果.成功) {
      // 公开接口只返回基本信息
      res.json({
        success: true,
        data: {
          devId: 结果.开发者.devId,
          name: 结果.开发者.name,
          状态: 结果.开发者.状态,
          extensions: 结果.开发者.extensions,
          createdAt: 结果.开发者.createdAt,
        },
      });
    } else {
      res.status(404).json({ success: false, error: 结果.错误 });
    }
  } catch (e) {
    logger.error('公开查询开发者信息失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 扩展绑定 ====================

/**
 * POST /extension/bind
 * 绑定扩展包到开发者
 * 
 * Body: { devId: 'dev_xxx', extension: '背单词' }
 * 需要 JWT 认证
 */
router.post('/extension/bind', authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  const { devId, extension } = req.body;

  if (!devId) {
    return res.status(400).json({ success: false, error: '缺少参数: devId' });
  }
  if (!extension) {
    return res.status(400).json({ success: false, error: '缺少参数: extension（扩展包名称）' });
  }

  try {
    const 结果 = await 绑定扩展(devId, userId, extension);

    if (结果.成功) {
      res.json({ success: true, message: `扩展 "${extension}" 已绑定到开发者 ${devId}` });
    } else {
      res.status(400).json({ success: false, error: 结果.错误 });
    }
  } catch (e) {
    logger.error('绑定扩展失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /extension/unbind
 * 解绑扩展包
 * 
 * Body: { devId: 'dev_xxx', extension: '背单词' }
 * 需要 JWT 认证
 */
router.post('/extension/unbind', authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  const { devId, extension } = req.body;

  if (!devId) {
    return res.status(400).json({ success: false, error: '缺少参数: devId' });
  }
  if (!extension) {
    return res.status(400).json({ success: false, error: '缺少参数: extension（扩展包名称）' });
  }

  try {
    const 结果 = await 解绑扩展(devId, userId, extension);

    if (结果.成功) {
      res.json({ success: true, message: `扩展 "${extension}" 已从开发者 ${devId} 解绑` });
    } else {
      res.status(400).json({ success: false, error: 结果.错误 });
    }
  } catch (e) {
    logger.error('解绑扩展失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /extensions
 * 列出当前用户开发者账号已绑定的扩展
 * 需要 JWT 认证
 */
router.get('/extensions', authMiddleware, async (req, res) => {
  const userId = req.user.userId;

  try {
    const 结果 = await 根据用户获取开发者(userId);

    if (结果.成功) {
      res.json({
        success: true,
        data: {
          devId: 结果.开发者.devId,
          extensions: 结果.开发者.extensions || [],
        },
      });
    } else {
      res.status(404).json({ success: false, error: 结果.错误 });
    }
  } catch (e) {
    logger.error('列出开发者扩展失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 签名密钥管理 ====================

/**
 * POST /regenerate-key
 * 重新生成签名密钥
 * 
 * Body: { devId: 'dev_xxx' }
 * 需要 JWT 认证
 * 旧密钥立即失效
 */
router.post('/regenerate-key', authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  const { devId } = req.body;

  if (!devId) {
    return res.status(400).json({ success: false, error: '缺少参数: devId' });
  }

  try {
    const 结果 = await 重新生成签名密钥(devId, userId);

    if (结果.成功) {
      logger.info(`开发者 ${devId} 签名密钥已重新生成，操作者: ${userId}`);
      res.json({
        success: true,
        data: { signingKey: 结果.signingKey },
        warning: '新签名密钥仅此一次返回，旧密钥已失效，请更新所有扩展包签名',
      });
    } else {
      res.status(400).json({ success: false, error: 结果.错误 });
    }
  } catch (e) {
    logger.error('重新生成签名密钥失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 验证端点 ====================

/**
 * POST /verify
 * 验证开发者ID和扩展包签名
 * 
 * 无需认证，供鸽子加载器在 Step 0.5 调用
 * 
 * Body: {
 *   devId: 'dev_xxx',
 *   signature?: 'hmac-sha256:abcdef...',  // 可选
 *   payload?: '...'                        // 签名原文（可选，用于签名验证）
 * }
 */
router.post('/verify', async (req, res) => {
  const { devId, signature, payload } = req.body;

  if (!devId) {
    return res.status(400).json({ success: false, error: '缺少参数: devId' });
  }

  try {
    // 有签名时走签名验证，否则只验证开发者ID
    if (signature) {
      const result = await 验证开发者签名(devId, signature, payload);
      res.json({ success: true, data: result });
    } else {
      const result = await 验证开发者(devId);
      res.json({ success: true, data: result });
    }
  } catch (e) {
    logger.error('验证开发者失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
