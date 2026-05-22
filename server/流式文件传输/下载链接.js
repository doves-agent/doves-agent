/**
 * 流式文件传输 - 下载链接管理
 *
 * 提供临时下载链接的创建、查询、记录和清理功能
 */
import { randomBytes } from 'crypto';
import { getOSSClient, getOSSConfig } from '../db.js';
import { logger } from '../core.js';

/**
 * 临时下载链接存储
 * 生产环境应使用 Redis 或数据库
 */
const tempDownloadLinks = new Map();

// 定期清理过期链接（每分钟）
setInterval(() => {
  const now = Date.now();
  for (const [linkId, link] of tempDownloadLinks.entries()) {
    if (link.expiresAt < now) {
      tempDownloadLinks.delete(linkId);
      logger.debug(`清理过期下载链接: ${linkId}`);
    }
  }
}, 60 * 1000);

/**
 * 生成临时下载链接
 *
 * @param {object} options
 * @param {string} options.userId - 用户ID
 * @param {string} options.filePath - OSS 文件路径
 * @param {string} options.fileName - 下载时的文件名
 * @param {number} [options.expiresIn=3600] - 过期时间（秒）
 * @param {number} [options.maxDownloads=10] - 最大下载次数
 * @param {boolean} [options.allowRange=true] - 允许 Range 请求
 * @returns {Promise<{ linkId: string, url: string, expiresAt: number, fileSize: number }>}
 */
export async function createTempDownloadLink(options) {
  const { userId, filePath, fileName, expiresIn = 3600, maxDownloads = 10 } = options;

  const client = await getOSSClient();
  if (!client) {
    throw new Error('OSS 未配置');
  }

  let fileSize = 0;
  try {
    const head = await client.head(filePath);
    fileSize = parseInt(head.res.headers['content-length'] || '0');
  } catch (e) {
    throw new Error('文件不存在');
  }

  const linkId = randomBytes(16).toString('hex');
  const now = Date.now();
  const expiresAt = now + expiresIn * 1000;

  const signedUrl = client.signatureUrl(filePath, {
    expires: expiresIn,
    response: {
      'content-disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    },
  });

  tempDownloadLinks.set(linkId, {
    userId,
    filePath,
    fileName,
    signedUrl,
    expiresAt,
    maxDownloads,
    downloadCount: 0,
    createdAt: now,
  });

  logger.info(`创建临时下载链接: ${linkId}, 文件: ${filePath}, 大小: ${fileSize} bytes, 用户: ${userId}`);

  return {
    linkId,
    url: signedUrl,
    expiresAt,
    expiresIn,
    fileSize,
    recommendedChunkSize: Math.min(10 * 1024 * 1024, Math.ceil(fileSize / 8)),
  };
}

/**
 * 获取临时下载链接信息
 * @param {string} linkId - 链接ID
 * @returns {object|null}
 */
export function getTempDownloadLink(linkId) {
  const link = tempDownloadLinks.get(linkId);
  if (!link) return null;
  if (link.expiresAt < Date.now()) {
    tempDownloadLinks.delete(linkId);
    return null;
  }
  if (link.downloadCount >= link.maxDownloads) {
    tempDownloadLinks.delete(linkId);
    return null;
  }
  return link;
}

/**
 * 记录下载并检查是否需要清理
 * @param {string} linkId - 链接ID
 * @returns {boolean} 是否还有剩余下载次数
 */
export function recordDownload(linkId) {
  const link = tempDownloadLinks.get(linkId);
  if (!link) return false;

  link.downloadCount++;
  if (link.downloadCount >= link.maxDownloads) {
    tempDownloadLinks.delete(linkId);
    logger.info(`下载链接已用完: ${linkId}`);
    return false;
  }
  return true;
}

/**
 * 清理临时下载链接
 * @param {string} linkId - 链接ID
 * @returns {boolean}
 */
export function deleteTempDownloadLink(linkId) {
  const result = tempDownloadLinks.delete(linkId);
  if (result) logger.info(`删除临时下载链接: ${linkId}`);
  return result;
}
