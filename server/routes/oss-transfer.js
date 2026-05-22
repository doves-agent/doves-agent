/**
 * 文件传输路由
 * 
 * API:
 * - POST /api/file/upload/start    开始上传会话（支持断点续传）
 * - GET  /api/file/upload/:uploadId/status  获取上传状态（断点续传）
 * - POST /api/file/upload/:uploadId/chunk  上传数据块
 * - POST /api/file/upload/:uploadId/part   上传单个分片（断点续传重试）
 * - POST /api/file/upload/:uploadId/complete 完成上传
 * - DELETE /api/file/upload/:uploadId  取消上传
 * - POST /api/file/download/link  创建临时下载链接（支持多线程）
 * - GET /api/file/info  获取文件信息
 * - DELETE /api/file  删除文件
 */

import { Router } from 'express';
import { logger } from '../core.js';
import { getAdminDb } from '../db.js';
import { sanitizePath } from '../file-service.js';
import {
  createUploadSession,
  getUploadSession,
  getUploadSessionStatus,
  writeUploadData,
  uploadPart,
  completeUploadSession,
  abortUploadSession,
  createTempDownloadLink,
  getTempDownloadLink,
  recordDownload,
  deleteTempDownloadLink,
  getFileInfo,
  deleteFile
} from '../流式文件传输.js';

const router = Router();

// OSS 路径前缀（从环境变量读取）
const OSS_PREFIX = process.env.OSS_PREFIX;

// ==================== 上传 API ====================

/**
 * 开始上传会话
 * POST /api/file/upload/start
 * 
 * Body: {
 *   fileName: string,      // 文件名
 *   fileSize: number,      // 文件大小
 *   targetDir: string,     // 目标目录 (如 "users/xxx/videos")
 *   fileHash?: string,     // 文件唯一标识（用于断点续传）
 *   encryptionKeyId?: string  // 加密密钥ID（可选）
 * }
 * 
 * Response: {
 *   uploadId: string,
 *   targetPath: string,
 *   chunkSize: number,
 *   resume?: {           // 断点续传信息
 *     uploadedParts: number,
 *     uploadedBytes: number,
 *     nextPartNumber: number
 *   }
 * }
 */
router.post('/upload/start', async (req, res) => {
  const { fileName, fileSize, targetDir, fileHash, encryptionKeyId } = req.body;
  const userId = req.user?.userId;
  
  if (!fileName || !fileSize || !targetDir) {
    return res.status(400).json({ 
      success: false, 
      error: '缺少必要参数: fileName, fileSize, targetDir' 
    });
  }
  
  // 安全校验：移除路径穿越和绝对路径，自动以用户目录为根
  const safeTargetDir = sanitizePath(userId, targetDir);
  
  try {
    // 如果提供了 encryptionKeyId，从系统配置中查找密钥
    let encryptionKey = null;
    if (encryptionKeyId) {
      try {
        const adminDb = getAdminDb();
        if (adminDb) {
          const keyConfig = await adminDb.collection('系统配置').findOne({ 配置键: 'encryption.keys' });
          if (keyConfig?.配置值?.[encryptionKeyId]) {
            encryptionKey = keyConfig.配置值[encryptionKeyId];
          } else if (keyConfig?.配置值?.[userId]?.[encryptionKeyId]) {
            encryptionKey = keyConfig.配置值[userId][encryptionKeyId];
          }
        }
      } catch (keyErr) {
        logger.warn(`查找加密密钥失败 (${encryptionKeyId}):`, keyErr.message);
      }
    }
    
    const result = await createUploadSession({
      userId,
      fileName,
      fileSize,
      targetDir: safeTargetDir,
      encryptionKey,
      fileHash
    });
    
    res.json({
      success: true,
      data: result
    });
  } catch (e) {
    logger.error('创建上传会话失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 获取上传会话状态（用于断点续传）
 * GET /api/file/upload/:uploadId/status
 * 
 * Response: {
 *   uploadId: string,
 *   fileName: string,
 *   fileSize: number,
 *   uploadedParts: number,
 *   uploadedBytes: number,
 *   progress: number,
 *   nextPartNumber: number
 * }
 */
router.get('/upload/:uploadId/status', async (req, res) => {
  const { uploadId } = req.params;
  
  const session = getUploadSession(uploadId);
  if (!session) {
    return res.status(404).json({ success: false, error: '上传会话不存在或已过期' });
  }
  
  if (session.userId !== req.user?.userId) {
    return res.status(403).json({ success: false, error: '无权访问此上传会话' });
  }
  
  try {
    const status = await getUploadSessionStatus(uploadId);
    res.json({
      success: true,
      data: status
    });
  } catch (e) {
    logger.error('获取上传状态失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 上传数据块（加密）
 * POST /api/file/upload/:uploadId/chunk
 * 
 * Content-Type: application/octet-stream
 * Body: 二进制数据
 * 
 * Query: {
 *   index: number,  // 块索引（用于顺序验证和重试）
 *   encrypted?: boolean  // 是否加密
 * }
 * 
 * Response: {
 *   receivedBytes: number,
 *   uploadedParts: number,
 *   progress: number,  // 0-100
 *   nextPartNumber: number
 * }
 */
router.post('/upload/:uploadId/chunk', async (req, res) => {
  const { uploadId } = req.params;
  const { index, encrypted } = req.query;
  
  const session = getUploadSession(uploadId);
  if (!session) {
    return res.status(404).json({ success: false, error: '上传会话不存在或已过期' });
  }
  
  // 验证用户权限
  if (session.userId !== req.user?.userId) {
    return res.status(403).json({ success: false, error: '无权访问此上传会话' });
  }
  
  try {
    // 获取请求体数据（支持二进制流和 JSON base64 两种方式）
    let data;
    if (req.body?.chunkData) {
      data = Buffer.from(req.body.chunkData, 'base64');
    } else {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      data = Buffer.concat(chunks);
    }

    // 写入数据
    const result = await writeUploadData(uploadId, data, parseInt(index) || null);
    
    res.json({
      success: true,
      data: result
    });
  } catch (e) {
    logger.error('上传数据块失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 上传单个分片（用于断点续传重试）
 * POST /api/file/upload/:uploadId/part
 * 
 * Content-Type: application/octet-stream
 * Body: 二进制数据
 * 
 * Query: {
 *   partNumber: number,  // 分片号（必填）
 *   encrypted?: boolean  // 是否加密
 * }
 * 
 * Response: {
 *   partNumber: number,
 *   etag: string,
 *   size: number
 * }
 */
router.post('/upload/:uploadId/part', async (req, res) => {
  const { uploadId } = req.params;
  const { partNumber, encrypted } = req.query;
  
  if (!partNumber) {
    return res.status(400).json({ success: false, error: '缺少 partNumber 参数' });
  }
  
  const session = getUploadSession(uploadId);
  if (!session) {
    return res.status(404).json({ success: false, error: '上传会话不存在或已过期' });
  }
  
  if (session.userId !== req.user?.userId) {
    return res.status(403).json({ success: false, error: '无权访问此上传会话' });
  }
  
  try {
    // 获取请求体数据（支持二进制流和 JSON base64 两种方式）
    let data;
    if (req.body?.chunkData) {
      data = Buffer.from(req.body.chunkData, 'base64');
    } else {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      data = Buffer.concat(chunks);
    }

    // 上传指定分片
    const result = await uploadPart(uploadId, data, parseInt(partNumber));
    
    res.json({
      success: true,
      data: result
    });
  } catch (e) {
    logger.error('上传分片失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 完成上传
 * POST /api/file/upload/:uploadId/complete
 * 
 * Response: {
 *   path: string,
 *   size: number,
 *   parts: number
 * }
 */
router.post('/upload/:uploadId/complete', async (req, res) => {
  const { uploadId } = req.params;
  
  const session = getUploadSession(uploadId);
  if (!session) {
    return res.status(404).json({ success: false, error: '上传会话不存在' });
  }
  
  if (session.userId !== req.user?.userId) {
    return res.status(403).json({ success: false, error: '无权访问此上传会话' });
  }
  
  try {
    const result = await completeUploadSession(uploadId);
    
    res.json({
      success: true,
      data: result
    });
  } catch (e) {
    logger.error('完成上传失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 取消上传
 * DELETE /api/file/upload/:uploadId
 * 
 * Query: {
 *   keepProgress?: boolean  // 是否保留进度（用于稍后恢复），默认 false
 * }
 */
router.delete('/upload/:uploadId', async (req, res) => {
  const { uploadId } = req.params;
  const { keepProgress } = req.query;
  
  const session = getUploadSession(uploadId);
  if (!session) {
    return res.status(404).json({ success: false, error: '上传会话不存在' });
  }
  
  if (session.userId !== req.user?.userId) {
    return res.status(403).json({ success: false, error: '无权访问此上传会话' });
  }
  
  try {
    await abortUploadSession(uploadId, keepProgress === 'true');
    
    res.json({
      success: true,
      data: { 
        uploadId, 
        cancelled: true,
        progressPreserved: keepProgress === 'true'
      }
    });
  } catch (e) {
    logger.error('取消上传失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 下载 API ====================

/**
 * 创建临时下载链接（支持多线程/断点续传）
 * POST /api/file/download/link
 * 
 * Body: {
 *   filePath: string,    // OSS 文件路径
 *   fileName?: string,   // 下载时的文件名（默认从路径提取）
 *   expiresIn?: number,  // 过期时间（秒），默认 3600
 *   maxDownloads?: number // 最大下载次数，默认 10（支持多线程）
 * }
 * 
 * Response: {
 *   linkId: string,
 *   url: string,         // 带签名的 OSS URL（支持 Range 请求）
 *   expiresAt: number,
 *   fileSize: number,    // 文件大小（用于多线程分块）
 *   recommendedChunkSize: number  // 建议的分块大小
 * }
 */
router.post('/download/link', async (req, res) => {
  const { filePath, fileName, expiresIn, maxDownloads } = req.body;
  const userId = req.user?.userId;
  
  if (!filePath) {
    return res.status(400).json({ 
      success: false, 
      error: '缺少必要参数: filePath' 
    });
  }
  
  // 验证文件路径权限（必须在用户目录下或公开目录）
  const isUserFile = filePath.startsWith(`${OSS_PREFIX}/users/${userId}/`);
  const isPublicFile = filePath.startsWith(`${OSS_PREFIX}/public/`);
  
  if (!isUserFile && !isPublicFile) {
    return res.status(403).json({ 
      success: false, 
      error: '无权访问此文件' 
    });
  }
  
  try {
    // 检查文件是否存在
    const info = await getFileInfo(filePath);
    if (!info) {
      return res.status(404).json({ 
        success: false, 
        error: '文件不存在' 
      });
    }
    
    // 提取文件名
    const downloadName = fileName || filePath.split('/').pop();
    
    const result = await createTempDownloadLink({
      userId,
      filePath,
      fileName: downloadName,
      expiresIn: expiresIn || 3600,
      maxDownloads: maxDownloads || 1
    });
    
    res.json({
      success: true,
      data: {
        ...result,
        fileSize: info.size
      }
    });
  } catch (e) {
    logger.error('创建下载链接失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 获取下载链接信息
 * GET /api/file/download/:linkId
 */
router.get('/download/:linkId', async (req, res) => {
  const { linkId } = req.params;
  
  const link = getTempDownloadLink(linkId);
  if (!link) {
    return res.status(404).json({ 
      success: false, 
      error: '下载链接不存在或已过期' 
    });
  }
  
  res.json({
    success: true,
    data: {
      linkId,
      fileName: link.fileName,
      expiresAt: link.expiresAt,
      downloadCount: link.downloadCount,
      maxDownloads: link.maxDownloads
    }
  });
});

/**
 * 删除下载链接
 * DELETE /api/file/download/:linkId
 */
router.delete('/download/:linkId', async (req, res) => {
  const { linkId } = req.params;
  
  const link = getTempDownloadLink(linkId);
  if (!link) {
    return res.status(404).json({ 
      success: false, 
      error: '下载链接不存在' 
    });
  }
  
  // 验证权限
  if (link.userId !== req.user?.userId) {
    return res.status(403).json({ 
      success: false, 
      error: '无权删除此下载链接' 
    });
  }
  
  deleteTempDownloadLink(linkId);
  
  res.json({
    success: true,
    data: { linkId, deleted: true }
  });
});

// ==================== 文件管理 API ====================

/**
 * 获取文件信息
 * GET /api/file/info
 * Query: { path: string }
 */
router.get('/info', async (req, res) => {
  const { path } = req.query;
  const userId = req.user?.userId;
  
  if (!path) {
    return res.status(400).json({ 
      success: false, 
      error: '缺少必要参数: path' 
    });
  }
  
  // 验证权限
  const isUserFile = path.startsWith(`${OSS_PREFIX}/users/${userId}/`);
  const isPublicFile = path.startsWith(`${OSS_PREFIX}/public/`);
  
  if (!isUserFile && !isPublicFile) {
    return res.status(403).json({ 
      success: false, 
      error: '无权访问此文件' 
    });
  }
  
  try {
    const info = await getFileInfo(path);
    
    if (!info) {
      return res.status(404).json({ 
        success: false, 
        error: '文件不存在' 
      });
    }
    
    res.json({
      success: true,
      data: info
    });
  } catch (e) {
    logger.error('获取文件信息失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 删除文件
 * DELETE /api/file
 * Query: { path: string }
 */
router.delete('/', async (req, res) => {
  const { path } = req.query;
  const userId = req.user?.userId;
  
  if (!path) {
    return res.status(400).json({ 
      success: false, 
      error: '缺少必要参数: path' 
    });
  }
  
  // 验证权限（只能删除自己目录下的文件）
  if (!path.startsWith(`${OSS_PREFIX}/users/${userId}/`)) {
    return res.status(403).json({ 
      success: false, 
      error: '无权删除此文件' 
    });
  }
  
  try {
    await deleteFile(path);
    
    res.json({
      success: true,
      data: { path, deleted: true }
    });
  } catch (e) {
    logger.error('删除文件失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
