/**
 * OSS 临时目录管理路由
 * 
 * 【KISS原则文档的一部分】
 * 
 * === 功能说明 ===
 * 为外部鸽子任务、LLM API URL 访问、临时分享提供临时公开访问区
 * 
 * === 目录结构 ===
 * {OSS_PREFIX}/users/{userId}/temp/tasks/{taskId}_{hash}/
 * ├── private/    # 仅用户可访问
 * ├── public/     # 完全公开（LLM URL、临时分享）
 * └── dove/       # 领取鸽子专用
 *     ├── input/  # 任务输入
 *     └── output/ # 任务输出
 * 
 * === API ===
 * POST /api/temp/tasks              创建任务临时目录
 * POST /api/temp/tasks/:taskId/copy 复制文件到临时目录
 * GET  /api/temp/tasks/:taskId/urls 获取临时目录URL
 * POST /api/temp/tasks/:taskId/finalize 完成任务并清理
 * DELETE /api/temp/tasks/:taskId    清理临时目录
 */

import { Router } from 'express';
import { createHmac, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { CONFIG, logger } from '../core.js';
import { getOSSClient } from '../db.js';

// OSS 路径前缀（从环境变量读取，默认 'dove'）
const OSS_PREFIX = process.env.OSS_PREFIX;

// ==================== 安全增强 ====================

/**
 * 临时目录 nonce 缓存
 * 存储 nonce 供验证使用（生产环境应使用 Redis）
 * key: `${taskId}:${doveId || 'system'}`
 * value: { nonce, timestamp, hash }
 */
const tempNonceCache = new Map();

// 定期清理过期的 nonce（每分钟）
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of tempNonceCache.entries()) {
    // nonce 有效期 5 分钟
    if (now - record.timestamp > 5 * 60 * 1000) {
      tempNonceCache.delete(key);
    }
  }
}, 60 * 1000);

const router = Router();

/**
 * 生成临时目录 hash（增强版，支持 nonce）
 * 签名规则: sha256(taskId:doveId:timestamp:nonce:SECRET)
 * 
 * @param {string} taskId - 任务ID
 * @param {string} doveId - 鸽子ID
 * @param {number} timestamp - 时间戳
 * @param {string} nonce - 随机数
 * @returns {string} 24位hash值
 */
function generateTempHash(taskId, doveId, timestamp, nonce) {
  return createHmac('sha256', CONFIG.hashSecret)
    .update(`${taskId}:${doveId || 'system'}:${timestamp}:${nonce}`)
    .digest('hex')
    .substring(0, 24);  // 增加到24位
}

/**
 * 生成安全的临时目录 hash（带随机 nonce）
 * 自动生成 nonce 并缓存供后续验证
 * 
 * @param {string} taskId - 任务ID
 * @param {string} doveId - 鸽子ID
 * @returns {Object} { hash, nonce, timestamp }
 */
function generateSecureTempHash(taskId, doveId) {
  const timestamp = Date.now();
  const nonce = randomBytes(16).toString('hex');  // 32位随机nonce
  const hash = generateTempHash(taskId, doveId, timestamp, nonce);
  
  // 存储 nonce 供验证（5分钟有效期）
  const key = `${taskId}:${doveId || 'system'}`;
  tempNonceCache.set(key, { nonce, timestamp, hash });
  
  return { hash, nonce, timestamp };
}

/**
 * 验证临时目录访问权限（增强版，支持 nonce）
 * 
 * @param {string} taskId - 任务ID
 * @param {string} hash - 提供的hash值
 * @param {string} doveId - 鸽子ID
 * @param {number} timestamp - 时间戳
 * @param {string} nonce - 随机数
 * @returns {Object} { valid: boolean, reason?: string }
 */
function verifyTempHash(taskId, hash, doveId, timestamp, nonce) {
  // 检查时间戳是否过期（5分钟有效期）
  const now = Date.now();
  if (now - timestamp > 5 * 60 * 1000) {
    return { valid: false, reason: '访问凭证已过期' };
  }
  
  // 如果提供了 nonce，使用增强验证
  if (nonce) {
    // 从缓存获取预期的 nonce
    const key = `${taskId}:${doveId || 'system'}`;
    const cached = tempNonceCache.get(key);
    
    if (!cached) {
      return { valid: false, reason: '访问凭证不存在或已过期' };
    }
    
    // 验证 hash
    const expectedHash = generateTempHash(taskId, doveId, timestamp, nonce);
    if (hash !== expectedHash) {
      return { valid: false, reason: '无效的访问凭证' };
    }
    
    // 验证时间戳
    if (cached.timestamp !== timestamp) {
      return { valid: false, reason: '时间戳不匹配' };
    }
    
    return { valid: true };
  }
  
  return { valid: false };
}

/**
 * 获取 OSS 公开访问基础 URL
 */
function getPublicBaseUrl() {
  return CONFIG.ossPublicUrl || CONFIG.ossEndpoint;
}

// ==================== API 路由 ====================

/**
 * 创建任务临时目录
 * POST /api/temp/tasks
 * Body: { taskId, ownerId, doveId? }
 */
router.post('/tasks', async (req, res) => {
  const { taskId, ownerId, doveId } = req.body;
  
  if (!taskId || !ownerId) {
    return res.status(400).json({ success: false, error: '缺少 taskId 或 ownerId' });
  }
  
  try {
    // 使用增强版 Hash 生成（带 nonce）
    const { hash, nonce, timestamp } = generateSecureTempHash(taskId, doveId);
    const basePath = `${OSS_PREFIX}/users/${ownerId}/temp/tasks/${taskId}_${hash}`;
    
    // 创建三个子目录的占位文件
    const client = await getOSSClient();
    if (client) {
      await Promise.all([
        client.put(`${basePath}/private/.keep`, Buffer.from('')),
        client.put(`${basePath}/public/.keep`, Buffer.from('')),
        client.put(`${basePath}/dove/input/.keep`, Buffer.from('')),
        client.put(`${basePath}/dove/output/.keep`, Buffer.from(''))
      ]);
    }
    
    // 生成公开访问 URL
    const baseUrl = getPublicBaseUrl();
    
    logger.info(`创建临时目录: ${basePath}`);
    
    res.json({
      success: true,
      data: {
        taskId,
        hash,
        nonce,  // 返回 nonce 供验证使用
        basePath,
        timestamp,
        urls: {
          private: `${baseUrl}/${basePath}/private/`,
          public: `${baseUrl}/${basePath}/public/`,
          doveInput: `${baseUrl}/${basePath}/dove/input/`,
          doveOutput: `${baseUrl}/${basePath}/dove/output/`
        }
      }
    });
  } catch (e) {
    logger.error('创建临时目录失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 获取临时目录 URL
 * GET /api/temp/tasks/:taskId/urls
 * Query: hash, ownerId, doveId, timestamp
 */
router.get('/tasks/:taskId/urls', async (req, res) => {
  const { taskId } = req.params;
  const { hash, ownerId, doveId, timestamp, nonce } = req.query;
  
  if (!hash || !ownerId || !timestamp) {
    return res.status(400).json({ success: false, error: '缺少必要参数' });
  }
  
  // 验证 hash（增强版，支持 nonce）
  const verification = verifyTempHash(taskId, hash, doveId, parseInt(timestamp), nonce);
  if (!verification.valid) {
    logger.warn(`临时目录验证失败: ${verification.reason}, taskId=${taskId}`);
    return res.status(403).json({ success: false, error: verification.reason });
  }
  
  const basePath = `users/${ownerId}/temp/tasks/${taskId}_${hash}`;
  const baseUrl = getPublicBaseUrl();
  
  res.json({
    success: true,
    data: {
      private: `${baseUrl}/${basePath}/private/`,
      public: `${baseUrl}/${basePath}/public/`,
      doveInput: `${baseUrl}/${basePath}/dove/input/`,
      doveOutput: `${baseUrl}/${basePath}/dove/output/`
    }
  });
});

/**
 * 复制文件到临时目录
 * POST /api/temp/tasks/:taskId/copy
 * Body: { source, target, ownerId, hash }
 * - source: OSS 路径
 * - target: 临时目录下的相对路径 (如 "dove/input/file.pdf")
 */
router.post('/tasks/:taskId/copy', async (req, res) => {
  const { taskId } = req.params;
  const { source, target, ownerId, hash } = req.body;
  
  if (!source || !target || !ownerId || !hash) {
    return res.status(400).json({ success: false, error: '缺少必要参数' });
  }
  
  try {
    const basePath = `${OSS_PREFIX}/users/${ownerId}/temp/tasks/${taskId}_${hash}`;
    const targetPath = `${basePath}/${target}`;
    
    const client = await getOSSClient();
    if (!client) {
      return res.status(500).json({ success: false, error: 'OSS 未配置' });
    }

    // lakefs:// 路径已废弃
    if (source.startsWith('lakefs://')) {
      return res.status(410).json({
        success: false,
        error: 'lakefs:// 路径已废弃，请使用 /api/git-storage/files/read 读取文件'
      });
    }

    // OSS 内部复制
    await client.copy(source, targetPath);

    const baseUrl = getPublicBaseUrl();
    
    res.json({
      success: true,
      data: {
        source,
        target: targetPath,
        url: `${baseUrl}/${targetPath}`
      }
    });
  } catch (e) {
    logger.error('复制文件失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 上传文件到临时目录 / 关联已上传文件
 * PUT /api/temp/tasks/:taskId/upload
 * Body: { target, content?, ownerId, hash, encoding? }
 *   encoding='url': content 为 OSS URL，ossPath 为 OSS 路径（流式上传后关联）
 */
router.put('/tasks/:taskId/upload', async (req, res) => {
  const { taskId } = req.params;
  const { target, content, ownerId, hash, encoding = 'utf-8', url, ossPath } = req.body;

  if (!target || !ownerId || !hash) {
    return res.status(400).json({ success: false, error: '缺少必要参数' });
  }

  try {
    const basePath = `${OSS_PREFIX}/users/${ownerId}/temp/tasks/${taskId}_${hash}`;
    const targetPath = `${basePath}/${target}`;

    const client = await getOSSClient();
    if (!client) {
      return res.status(500).json({ success: false, error: 'OSS 未配置' });
    }

    if (encoding === 'url') {
      // 流式上传模式：文件已通过 /api/file/upload/* 上传到 OSS
      // 这里只做关联记录（copy 到临时目录路径）
      if (ossPath) {
        await client.copy(targetPath, ossPath);
        const baseUrl = getPublicBaseUrl();
        res.json({
          success: true,
          data: {
            path: targetPath,
            url: url || `${baseUrl}/${targetPath}`,
            ossPath,
          },
        });
      } else {
        res.status(400).json({ success: false, error: 'url 模式需提供 ossPath' });
      }
      return;
    }

    res.status(400).json({ success: false, error: `不支持的编码: ${encoding}，仅支持 url 模式` });
  } catch (e) {
    logger.error('上传文件失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 列出临时目录内容
 * GET /api/temp/tasks/:taskId/list
 * Query: ownerId, hash, dir?
 */
router.get('/tasks/:taskId/list', async (req, res) => {
  const { taskId } = req.params;
  const { ownerId, hash, dir = '' } = req.query;
  
  if (!ownerId || !hash) {
    return res.status(400).json({ success: false, error: '缺少必要参数' });
  }
  
  try {
    const basePath = `${OSS_PREFIX}/users/${ownerId}/temp/tasks/${taskId}_${hash}`;
    const listPath = `${basePath}/${dir}`;
    
    const client = await getOSSClient();
    if (!client) {
      return res.status(500).json({ success: false, error: 'OSS 未配置' });
    }
    
    const result = await client.list({ prefix: listPath, 'max-keys': 1000 });
    const files = (result.objects || []).map(obj => ({
      name: obj.name.replace(listPath, '').replace(/^\//, ''),
      size: obj.size,
      lastModified: obj.lastModified
    }));
    
    res.json({
      success: true,
      data: {
        path: listPath,
        files
      }
    });
  } catch (e) {
    logger.error('列出目录失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 完成任务并清理临时目录
 * POST /api/temp/tasks/:taskId/finalize
 * Body: { ownerId, hash, syncTo? }
 * - syncTo: Git存储目标路径 (可选，当前未实现)
 */
router.post('/tasks/:taskId/finalize', async (req, res) => {
  const { taskId } = req.params;
  const { ownerId, hash, syncTo } = req.body;
  
  if (!ownerId || !hash) {
    return res.status(400).json({ success: false, error: '缺少必要参数' });
  }
  
  try {
    const basePath = `${OSS_PREFIX}/users/${ownerId}/temp/tasks/${taskId}_${hash}`;
    const client = await getOSSClient();
    
    let synced = false;
    
    // 如果指定了同步目标路径，同步 output 目录
    if (syncTo && client) {
      // 列出 output 目录的所有文件
      const outputPrefix = `${basePath}/dove/output/`;
      const result = await client.list({ prefix: outputPrefix, 'max-keys': 1000 });

      if (result.objects && result.objects.length > 0) {
        // 同步到Git存储尚未实现，跳过
        logger.debug(`跳过同步，${result.objects.length} 个文件保留在OSS`);
      }
    }
    
    // 清理临时目录
    if (client) {
      const result = await client.list({ prefix: `${basePath}/`, 'max-keys': 1000 });
      if (result.objects) {
        for (const obj of result.objects) {
          await client.delete(obj.name);
        }
      }
    }
    
    logger.info(`任务临时目录已清理: ${basePath}`);
    
    res.json({
      success: true,
      data: {
        taskId,
        synced,
        cleaned: true
      }
    });
  } catch (e) {
    logger.error('完成任务失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 删除临时目录
 * DELETE /api/temp/tasks/:taskId
 * Query: ownerId, hash
 */
router.delete('/tasks/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const { ownerId, hash } = req.query;
  
  if (!ownerId || !hash) {
    return res.status(400).json({ success: false, error: '缺少必要参数' });
  }
  
  try {
    const basePath = `${OSS_PREFIX}/users/${ownerId}/temp/tasks/${taskId}_${hash}`;
    const client = await getOSSClient();
    
    if (client) {
      // 列出并删除所有文件
      const result = await client.list({ prefix: `${basePath}/`, 'max-keys': 1000 });
      if (result.objects) {
        for (const obj of result.objects) {
          await client.delete(obj.name);
        }
      }
    }
    
    logger.info(`删除临时目录: ${basePath}`);
    
    res.json({
      success: true,
      data: { taskId, basePath, deleted: true }
    });
  } catch (e) {
    logger.error('删除临时目录失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
