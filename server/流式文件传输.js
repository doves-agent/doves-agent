/**
 * 流式文件传输服务
 *
 * 功能：
 * 1. 流式上传：客户端加密流 → 解密 → 流式写入 OSS（内网）
 * 2. 临时下载：生成带签名的临时 OSS URL（外网）
 * 3. 断点续传：支持从中断处继续上传
 * 4. 多线程下载：OSS 签名 URL 支持 Range 请求
 */

import { getOSSClient } from './db.js';
import { logger } from './core.js';
import {
  createTempDownloadLink,
  getTempDownloadLink,
  recordDownload,
  deleteTempDownloadLink,
} from './流式文件传输/下载链接.js';
import { createStreamUploader, StreamUploader } from './流式文件传输/上传器.js';
import {
  createUploadSession,
  getUploadSession,
  getUploadSessionStatus,
  writeUploadData,
  uploadPart,
  completeUploadSession,
  abortUploadSession,
  uploadSessionStore,
} from './流式文件传输/会话.js';

// ==================== 文件信息查询 ====================

/**
 * 获取文件信息
 * @param {string} filePath - OSS 文件路径
 * @returns {Promise<object|null>}
 */
export async function getFileInfo(filePath) {
  const client = await getOSSClient();
  if (!client) throw new Error('OSS 未配置');

  try {
    const info = await client.head(filePath);
    return {
      path: filePath,
      size: parseInt(info.res.headers['content-length'] || '0'),
      lastModified: info.res.headers['last-modified'],
      etag: info.res.headers.etag,
      contentType: info.res.headers['content-type'],
    };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

/**
 * 删除文件
 * @param {string} filePath - OSS 文件路径
 */
export async function deleteFile(filePath) {
  const client = await getOSSClient();
  if (!client) throw new Error('OSS 未配置');

  await client.delete(filePath);
  logger.info(`文件已删除: ${filePath}`);
}

export {
  createTempDownloadLink,
  getTempDownloadLink,
  recordDownload,
  deleteTempDownloadLink,
  createStreamUploader,
  StreamUploader,
  createUploadSession,
  getUploadSession,
  getUploadSessionStatus,
  writeUploadData,
  uploadPart,
  completeUploadSession,
  abortUploadSession,
  uploadSessionStore,
};

export default {
  createTempDownloadLink,
  getTempDownloadLink,
  recordDownload,
  deleteTempDownloadLink,
  createStreamUploader,
  createUploadSession,
  getUploadSession,
  getUploadSessionStatus,
  writeUploadData,
  uploadPart,
  completeUploadSession,
  abortUploadSession,
  getFileInfo,
  deleteFile,
  uploadSessionStore,
};

