/**
 * 流式文件传输 - 上传会话管理
 *
 * 提供上传会话的创建、状态查询、写入、完成和取消功能
 * 支持断点续传和超时清理
 */
import { randomBytes } from 'crypto';
import { logger } from '../core.js';
import { getOSSClient } from '../db.js';
import { StreamUploader, createStreamUploader } from './上传器.js';

/**
 * 活跃的上传会话
 */
const activeUploads = new Map();

/**
 * 持久化存储（生产环境应使用 Redis 或数据库）
 * 用于断点续传时恢复会话
 */
const uploadSessionStore = new Map();

/**
 * 创建上传会话
 *
 * @param {object} options
 * @param {string} options.userId - 用户ID
 * @param {string} options.fileName - 文件名
 * @param {number} options.fileSize - 预期文件大小
 * @param {string} options.targetDir - 目标目录
 * @param {Uint8Array} [options.encryptionKey] - 加密密钥
 * @param {string} [options.fileHash] - 文件唯一标识（用于断点续传）
 * @returns {Promise<{ uploadId: string, targetPath: string, chunkSize: number, ossUploadId: string }>}
 */
export async function createUploadSession(options) {
  const { userId, fileName, fileSize, targetDir, encryptionKey, fileHash } = options;

  const client = await getOSSClient();
  if (!client) throw new Error('OSS 未配置');

  const targetPath = `${targetDir}/${fileName}`;
  const chunkSize = 5 * 1024 * 1024; // 5MB 分片

  // 检查是否有未完成的上传（断点续传）
  const sessionKey = `${userId}:${fileHash || fileName}`;
  const existingSession = uploadSessionStore.get(sessionKey);

  let ossUploadId;
  let uploadedParts = [];
  let startPartNumber = 1;

  if (existingSession && fileHash) {
    try {
      const result = await client.listParts(targetPath, existingSession.ossUploadId);
      if (result.parts && result.parts.length > 0) {
        ossUploadId = existingSession.ossUploadId;
        uploadedParts = result.parts.map(p => ({
          number: p.PartNumber, etag: p.ETag, size: p.Size,
        }));
        startPartNumber = uploadedParts.length + 1;
        logger.info(`恢复上传会话: ${sessionKey}, 已上传 ${uploadedParts.length} 个分片`);
      }
    } catch (e) {
      logger.warn(`恢复上传失败: ${e.message}, 创建新上传`);
    }
  }

  if (!ossUploadId) {
    const initResult = await client.initMultipartUpload(targetPath);
    ossUploadId = initResult.uploadId;
    startPartNumber = 1;
  }

  const uploadId = `upload_${Date.now()}_${randomBytes(8).toString('hex')}`;

  const uploader = new StreamUploader({
    client, userId, targetPath, uploadId: ossUploadId,
    encryptionKey, chunkSize, startPartNumber, existingParts: uploadedParts,
  });

  const now = Date.now();
  const session = {
    uploadId, ossUploadId, userId, fileName, fileSize, targetPath,
    uploader, createdAt: now, updatedAt: now,
    receivedBytes: uploadedParts.reduce((sum, p) => sum + p.size, 0),
    uploadedParts, completedParts: uploadedParts.length, fileHash,
  };

  activeUploads.set(uploadId, session);
  if (fileHash) {
    uploadSessionStore.set(sessionKey, { ossUploadId, targetPath, userId, fileName, fileSize, createdAt: now });
  }

  logger.info(`创建上传会话: ${uploadId}, 文件: ${fileName}, 大小: ${fileSize}, 从分片 ${startPartNumber} 开始`);

  return {
    uploadId, targetPath, chunkSize, ossUploadId,
    resume: uploadedParts.length > 0 ? {
      uploadedParts: uploadedParts.length, uploadedBytes: session.receivedBytes, nextPartNumber: startPartNumber,
    } : null,
  };
}

/**
 * 获取上传会话
 * @param {string} uploadId - 上传ID
 * @returns {object|null}
 */
export function getUploadSession(uploadId) {
  return activeUploads.get(uploadId) || null;
}

/**
 * 获取上传会话详细状态
 * @param {string} uploadId - 上传ID
 * @returns {Promise<object|null>}
 */
export async function getUploadSessionStatus(uploadId) {
  const session = activeUploads.get(uploadId);
  if (!session) return null;

  const client = await getOSSClient();
  try {
    const result = await client.listParts(session.targetPath, session.ossUploadId);
    const parts = result.parts || [];
    return {
      uploadId: session.uploadId, fileName: session.fileName,
      fileSize: session.fileSize, targetPath: session.targetPath,
      chunkSize: session.uploader.chunkSize,
      uploadedParts: parts.map(p => ({ number: p.PartNumber, size: p.Size, etag: p.ETag })),
      uploadedBytes: parts.reduce((sum, p) => sum + p.Size, 0),
      totalParts: Math.ceil(session.fileSize / session.uploader.chunkSize),
      progress: Math.round((parts.reduce((sum, p) => sum + p.Size, 0) / session.fileSize) * 100),
      nextPartNumber: parts.length + 1,
    };
  } catch (e) {
    logger.error(`获取上传状态失败: ${e.message}`);
    return { uploadId: session.uploadId, error: e.message };
  }
}

/**
 * 向上传会话写入数据
 * @param {string} uploadId - 上传ID
 * @param {Buffer} data - 数据
 * @param {number|null} partIndex - 分片索引（可选）
 * @returns {Promise<{ receivedBytes: number, uploadedParts: number, progress: number }>}
 */
export async function writeUploadData(uploadId, data, partIndex = null) {
  const session = activeUploads.get(uploadId);
  if (!session) throw new Error('上传会话不存在');

  if (partIndex !== null && partIndex !== session.uploader.partNumber) {
    logger.warn(`分片索引不匹配: 期望 ${session.uploader.partNumber}, 收到 ${partIndex}`);
  }

  await session.uploader.write(data);
  session.receivedBytes += data.length;
  session.updatedAt = Date.now();

  const progress = session.fileSize > 0
    ? Math.round((session.uploader.totalBytes / session.fileSize) * 100) : 0;

  return {
    receivedBytes: session.receivedBytes,
    uploadedParts: session.uploader.parts.length,
    progress,
    nextPartNumber: session.uploader.partNumber,
  };
}

/**
 * 上传单个分片（用于断点续传重试）
 * @param {string} uploadId - 上传ID
 * @param {Buffer} data - 分片数据
 * @param {number} partNumber - 分片号
 * @returns {Promise<{ partNumber: number, etag: string, size: number }>}
 */
export async function uploadPart(uploadId, data, partNumber) {
  const session = activeUploads.get(uploadId);
  if (!session) throw new Error('上传会话不存在');

  const client = await getOSSClient();
  const result = await client.uploadPart(session.targetPath, session.ossUploadId, partNumber, data);

  session.uploader.parts.push({ number: partNumber, etag: result.etag });
  session.uploader.totalBytes += data.length;
  session.updatedAt = Date.now();

  return { partNumber, etag: result.etag, size: data.length };
}

/**
 * 完成上传会话
 * @param {string} uploadId - 上传ID
 * @returns {Promise<{ path: string, size: number, parts: number }>}
 */
export async function completeUploadSession(uploadId) {
  const session = activeUploads.get(uploadId);
  if (!session) throw new Error('上传会话不存在');

  const result = await session.uploader.end();
  activeUploads.delete(uploadId);

  if (session.fileHash) {
    const sessionKey = `${session.userId}:${session.fileHash}`;
    uploadSessionStore.delete(sessionKey);
  }

  // 生成可访问的 URL
  let url = '';
  try {
    const client = await getOSSClient();
    if (client) {
      // 优先用签名 URL（最可靠，无需公开读权限）
      url = client.signatureUrl(result.path, { expires: 3600 });
    }
  } catch (e) {
    logger.warn(`生成上传文件 URL 失败: ${e.message}`);
  }

  return { ...result, url };
}

/**
 * 取消上传会话
 * @param {string} uploadId - 上传ID
 * @param {boolean} [keepProgress=false] - 是否保留进度
 */
export async function abortUploadSession(uploadId, keepProgress = false) {
  const session = activeUploads.get(uploadId);
  if (!session) return;

  if (!keepProgress) {
    await session.uploader.abort();
    if (session.fileHash) {
      const sessionKey = `${session.userId}:${session.fileHash}`;
      uploadSessionStore.delete(sessionKey);
    }
  }

  activeUploads.delete(uploadId);
  logger.info(`上传会话已取消: ${uploadId}, 保留进度: ${keepProgress}`);
}

// 定期清理超时的上传会话（每5分钟）
setInterval(() => {
  const now = Date.now();
  const timeout = 30 * 60 * 1000;
  for (const [uploadId, session] of activeUploads.entries()) {
    if (now - session.createdAt > timeout) {
      session.uploader.abort().catch(() => {});
      activeUploads.delete(uploadId);
      logger.warn(`清理超时上传会话: ${uploadId}`);
    }
  }
}, 5 * 60 * 1000);

export { uploadSessionStore };
