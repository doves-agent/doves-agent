/**
 * OSS API 路由
 * 供 Doves 扩展（通过 DovesProxy → Server）和 CLI 调用
 *
 * API:
 * - PUT  /api/oss/upload     上传文件（base64）
 * - GET  /api/oss/download   下载文件
 * - GET  /api/oss/list       列出文件
 * - POST /api/oss/sign-url   生成签名 URL
 */

import { Router } from 'express';
import { logger } from '../core.js';
import { getOSSClient, getOSSConfig } from '../db.js';

const router = Router();

// OSS 路径前缀（从环境变量读取，默认 'dove'）
const OSS_PREFIX = process.env.OSS_PREFIX || 'dove';

// ==================== 上传 ====================

/**
 * PUT /api/oss/upload
 * Body: { path: string, content: string (base64) }
 */
router.put('/upload', async (req, res) => {
  const { path: ossPath, content } = req.body;
  const userId = req.user?.userId;

  if (!ossPath || !content) {
    return res.status(400).json({ success: false, error: '缺少参数: path, content' });
  }

  const client = await getOSSClient();
  if (!client) {
    return res.status(503).json({ success: false, error: 'OSS 未配置或不可用' });
  }

  try {
    // 安全：强制路径以用户目录开头（非管理员只能操作自己目录）
    const config = getOSSConfig();
    const safePath = ossPath.startsWith(`${OSS_PREFIX}/users/`) ? ossPath : `${OSS_PREFIX}/users/${userId}/${ossPath}`;

    const buffer = Buffer.from(content, 'base64');
    const result = await client.put(safePath, buffer);

    logger.info(`[OSS] 上传成功: ${safePath} (${buffer.length} bytes), 用户: ${userId}`);

    // 生成签名访问 URL
    let url = result?.url || '';
    if (!url && client) {
      const signed = await client.signUrl(safePath, 3600);
      url = typeof signed === 'string' ? signed : signed?.url || '';
    }

    res.json({ success: true, url, path: safePath, 路径: safePath });
  } catch (e) {
    logger.error(`[OSS] 上传失败: ${e.message}`);
    res.status(500).json({ success: false, error: `OSS上传失败: ${e.message}` });
  }
});

// ==================== 下载 ====================

/**
 * GET /api/oss/download?path=xxx
 */
router.get('/download', async (req, res) => {
  const { path: ossPath } = req.query;
  const userId = req.user?.userId;

  if (!ossPath) {
    return res.status(400).json({ success: false, error: '缺少参数: path' });
  }

  const client = await getOSSClient();
  if (!client) {
    return res.status(503).json({ success: false, error: 'OSS 未配置或不可用' });
  }

  try {
    const result = await client.get(ossPath);
    res.json({
      success: true,
      content: result.content?.toString('base64'),
      size: result.content?.length || 0,
    });
  } catch (e) {
    logger.error(`[OSS] 下载失败: ${e.message}`);
    res.status(500).json({ success: false, error: `OSS下载失败: ${e.message}` });
  }
});

// ==================== 列表 ====================

/**
 * GET /api/oss/list?prefix=xxx
 */
router.get('/list', async (req, res) => {
  const { prefix = '' } = req.query;
  const userId = req.user?.userId;

  const client = await getOSSClient();
  if (!client) {
    return res.status(503).json({ success: false, error: 'OSS 未配置或不可用' });
  }

  try {
    const safePrefix = prefix.startsWith(`${OSS_PREFIX}/users/`) ? prefix : `${OSS_PREFIX}/users/${userId}/${prefix}`;
    const result = await client.list({ prefix: safePrefix, 'max-keys': 100 });
    const files = (result.objects || []).map(obj => ({
      name: obj.name,
      size: obj.size,
      lastModified: obj.lastModified,
      url: obj.url || '',
    }));

    res.json({ success: true, files, count: files.length });
  } catch (e) {
    logger.error(`[OSS] 列表失败: ${e.message}`);
    res.status(500).json({ success: false, error: `OSS列表失败: ${e.message}` });
  }
});

// ==================== 签名 URL ====================

/**
 * POST /api/oss/sign-url
 * Body: { path: string, expires?: number }
 */
router.post('/sign-url', async (req, res) => {
  const { path: ossPath, expires = 3600 } = req.body;
  const userId = req.user?.userId;

  if (!ossPath) {
    return res.status(400).json({ success: false, error: '缺少参数: path' });
  }

  const client = await getOSSClient();
  if (!client) {
    return res.status(503).json({ success: false, error: 'OSS 未配置或不可用' });
  }

  try {
    const safePath = ossPath.startsWith(`${OSS_PREFIX}/users/`) ? ossPath : `${OSS_PREFIX}/users/${userId}/${ossPath}`;
    const signedUrl = await client.signUrl(safePath, expires);
    const url = typeof signedUrl === 'string' ? signedUrl : signedUrl?.url || '';

    res.json({ success: true, url });
  } catch (e) {
    logger.error(`[OSS] 签名URL失败: ${e.message}`);
    res.status(500).json({ success: false, error: `OSS签名失败: ${e.message}` });
  }
});

export default router;
