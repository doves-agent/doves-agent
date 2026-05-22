/**
 * 流式文件上传工具
 *
 * 通过加密通道分片上传到 Server → OSS
 * 链路: CLI → 加密TCP → Server(流式分片) → OSS
 *
 * 上传流程:
 * 1. POST /api/file/upload/start   创建上传会话
 * 2. POST /api/file/upload/:id/chunk  分片上传（base64 编码）
 * 3. POST /api/file/upload/:id/complete 完成上传
 * 4. POST /api/file/download/link  获取签名下载 URL
 */

import { createHash } from 'crypto';
import { openSync, readSync, closeSync, statSync } from 'fs';
import path from 'path';
import { getSharedCryptoClient } from './base-client.js';

/** 默认分片大小 5MB（与 Server 端对齐） */
const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

/**
 * 计算文件 SHA256 哈希（用于断点续传和去重）
 * @param {string} filePath - 本地文件路径
 * @returns {string} SHA256 十六进制哈希值
 */
export function calculateFileHash(filePath) {
  const hash = createHash('sha256');
  const fd = openSync(filePath, 'r');
  const buffer = Buffer.alloc(DEFAULT_CHUNK_SIZE);
  try {
    let bytesRead;
    while ((bytesRead = readSync(fd, buffer)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * 通过加密通道发送请求
 * @param {object} options - { client?, headers? } client 优先，否则用 getSharedCryptoClient
 * @param {string} method - HTTP 方法
 * @param {string} apiPath - API 路径
 * @param {object|null} body - 请求体
 */
async function encryptedRequest(options, method, apiPath, body = null) {
  // 优先使用传入的 client（BaseClient 实例）
  if (options.client) {
    if (method === 'POST') {
      return await options.client.post(apiPath, body);
    } else if (method === 'GET') {
      return await options.client.get(apiPath);
    }
    return await options.client._apiRequest(method, apiPath, body);
  }

  // fallback: 使用共享加密客户端
  const cryptoClient = getSharedCryptoClient();
  if (!cryptoClient?.connected) {
    throw new Error('加密通道未连接');
  }
  const requestBody = body ? { ...body } : {};
  if (options.token) requestBody.apiKey = options.token;
  const result = await cryptoClient.request(method, apiPath, requestBody);
  if (result?.error) throw new Error(result.error);
  return result?.data !== undefined ? result.data : result;
}

/**
 * 流式上传文件到 OSS（通过加密通道中转）
 *
 * 核心原则：不将整个文件读入内存，分片读取+分片上传（base64 编码通过加密通道）
 *
 * @param {object} options
 * @param {object} [options.client] - BaseClient 实例（优先，有 post/get 方法）
 * @param {string} [options.baseUrl] - 已废弃，保留兼容但不使用
 * @param {object} [options.headers] - 已废弃，保留兼容但不使用
 * @param {string} [options.token] - 认证 token（client 不可用时使用）
 * @param {string} options.localPath - 本地文件路径
 * @param {string} options.targetDir - OSS 目标目录 (如 "dove/users/xxx/uploads")
 * @param {string} [options.fileName] - 远程文件名（默认取本地文件名）
 * @param {Function} [options.onProgress] - 进度回调 (percent: number) => void
 * @returns {Promise<{ url: string, path: string, size: number }>}
 */
export async function streamUploadFile(options) {
  const { localPath, targetDir, fileName, onProgress } = options;

  const stat = statSync(localPath);
  const name = fileName || path.basename(localPath);
  const fileSize = stat.size;
  const fileHash = calculateFileHash(localPath);

  // 1. 创建上传会话
  const startResult = await encryptedRequest(options, 'POST', '/api/file/upload/start', {
    fileName: name, fileSize, targetDir, fileHash
  });

  const { uploadId, chunkSize: serverChunkSize, resume } = startResult;
  const chunkSize = serverChunkSize || DEFAULT_CHUNK_SIZE;

  // 如果有断点续传信息，跳过已上传的分片
  let startPartIndex = 0;
  if (resume) {
    startPartIndex = resume.nextPartNumber - 1;
    if (onProgress) onProgress(Math.round((resume.uploadedBytes / fileSize) * 100));
  }

  // 2. 分片上传（流式读取，base64 编码通过加密通道）
  const fd = openSync(localPath, 'r');
  const buffer = Buffer.alloc(chunkSize);
  let totalUploaded = resume ? resume.uploadedBytes : 0;

  try {
    // 跳过已上传的分片
    if (startPartIndex > 0) {
      const skipSize = startPartIndex * chunkSize;
      let skipped = 0;
      while (skipped < skipSize) {
        const toSkip = Math.min(chunkSize, skipSize - skipped);
        const read = readSync(fd, buffer, 0, toSkip, skipped);
        if (read <= 0) break;
        skipped += read;
      }
    }

    let partIndex = startPartIndex;
    let bytesRead;

    while ((bytesRead = readSync(fd, buffer)) > 0) {
      const chunk = buffer.subarray(0, bytesRead);

      await encryptedRequest(options, 'POST', `/api/file/upload/${uploadId}/chunk?index=${partIndex}`, {
        chunkData: chunk.toString('base64')
      });

      totalUploaded += bytesRead;
      partIndex++;

      if (onProgress) {
        onProgress(Math.round((totalUploaded / fileSize) * 100));
      }
    }
  } finally {
    closeSync(fd);
  }

  // 3. 完成上传
  const completeResult = await encryptedRequest(options, 'POST', `/api/file/upload/${uploadId}/complete`, { fileHash });

  const { path: ossPath, size } = completeResult;

  // 4. 获取签名下载 URL
  const downloadResult = await getDownloadUrl({ ...options, filePath: ossPath });

  return {
    url: downloadResult.url,
    path: ossPath,
    size,
  };
}

/**
 * 获取文件签名下载 URL
 *
 * @param {object} options
 * @param {object} [options.client] - BaseClient 实例
 * @param {string} [options.baseUrl] - 已废弃
 * @param {object} [options.headers] - 已废弃
 * @param {string} [options.token] - 认证 token
 * @param {string} options.filePath - OSS 文件路径
 * @param {number} [options.expiresIn=3600] - 链接有效时间（秒）
 * @returns {Promise<{ url: string, expiresAt: number, fileSize: number }>}
 */
export async function getDownloadUrl(options) {
  const { filePath, expiresIn = 3600 } = options;

  const result = await encryptedRequest(options, 'POST', '/api/file/download/link', {
    filePath, expiresIn
  });

  return {
    url: result.url,
    expiresAt: result.expiresAt,
    fileSize: result.fileSize,
  };
}

/**
 * 从 JWT token 解码 userId
 * @param {string} token - JWT token
 * @returns {string|null} userId
 */
export function getUserIdFromToken(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return payload.userId || payload.sub || payload.id || null;
  } catch {
    return null;
  }
}
