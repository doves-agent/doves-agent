/**
 * 流式文件传输 - 流式上传器
 *
 * 提供 OSS 流式分片上传功能，支持解密和断点续传
 */
import { logger } from '../core.js';
import { getOSSClient } from '../db.js';

/**
 * 创建流式上传器
 *
 * @param {string} userId - 用户ID
 * @param {string} targetPath - OSS 目标路径
 * @param {object} options
 * @param {Uint8Array} [options.encryptionKey] - 解密密钥
 * @param {number} [options.chunkSize=1048576] - 分块大小，默认 1MB
 * @returns {Promise<StreamUploader>}
 */
export async function createStreamUploader(userId, targetPath, options = {}) {
  const client = await getOSSClient();
  if (!client) {
    throw new Error('OSS 未配置');
  }

  const { encryptionKey, chunkSize = 1024 * 1024 } = options;
  const uploadId = await client.initMultipartUpload(targetPath);

  logger.info(`创建流式上传: ${targetPath}, uploadId: ${uploadId.uploadId}`);

  return new StreamUploader({
    client,
    userId,
    targetPath,
    uploadId: uploadId.uploadId,
    encryptionKey,
    chunkSize,
  });
}

/**
 * 流式上传器类
 * 支持断点续传
 */
export class StreamUploader {
  constructor(options) {
    this.client = options.client;
    this.userId = options.userId;
    this.targetPath = options.targetPath;
    this.uploadId = options.uploadId;
    this.encryptionKey = options.encryptionKey;
    this.chunkSize = options.chunkSize;

    this.partNumber = options.startPartNumber || 1;
    this.parts = options.existingParts || [];
    this.buffer = Buffer.alloc(0);
    this.totalBytes = this.parts.reduce((sum, p) => sum + (p.size || 0), 0);
    this.ended = false;

    // 解密器（如果有加密密钥）
    this.decryptor = null;
    if (this.encryptionKey) {
      import('@dove/common/crypto/session.js').then(({ StreamDecryptor }) => {
        this.decryptor = new StreamDecryptor(this.encryptionKey);
      });
    }
  }

  /**
   * 写入数据块
   * @param {Buffer|Uint8Array} data - 加密或明文数据
   */
  async write(data) {
    if (this.ended) throw new Error('上传器已关闭');

    let chunk = Buffer.from(data);
    if (this.decryptor) {
      chunk = Buffer.from(this.decryptor.decryptChunk(chunk));
    }

    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= this.chunkSize) {
      const partData = this.buffer.slice(0, this.chunkSize);
      this.buffer = this.buffer.slice(this.chunkSize);
      await this._uploadPart(partData);
    }
  }

  /**
   * 上传一个分片
   */
  async _uploadPart(data) {
    const result = await this.client.uploadPart(
      this.targetPath, this.uploadId, this.partNumber, data,
      { progress: (p) => logger.debug(`分片 ${this.partNumber} 上传进度: ${Math.round(p * 100)}%`) }
    );

    this.parts.push({ number: this.partNumber, etag: result.etag, size: data.length });
    this.totalBytes += data.length;
    this.partNumber++;

    logger.debug(`分片 ${this.partNumber - 1} 上传完成, 累计: ${this.totalBytes} 字节`);
  }

  /**
   * 完成上传
   * @returns {Promise<{ path: string, size: number, parts: number }>}
   */
  async end() {
    if (this.ended) throw new Error('上传器已关闭');

    if (this.buffer.length > 0) await this._uploadPart(this.buffer);

    this.parts.sort((a, b) => a.number - b.number);
    await this.client.completeMultipartUpload(this.targetPath, this.uploadId, this.parts);

    this.ended = true;
    logger.info(`流式上传完成: ${this.targetPath}, 大小: ${this.totalBytes}, 分片: ${this.parts.length}`);

    return { path: this.targetPath, size: this.totalBytes, parts: this.parts.length };
  }

  /**
   * 取消上传
   */
  async abort() {
    if (this.ended) return;
    await this.client.abortMultipartUpload(this.targetPath, this.uploadId);
    this.ended = true;
    logger.info(`流式上传已取消: ${this.targetPath}`);
  }
}
