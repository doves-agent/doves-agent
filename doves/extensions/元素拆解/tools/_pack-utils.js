/**
 * 元素拆解 - ZIP打包工具
 * 使用 archiver 库生成 zip，开箱支持 UTF-8 文件名
 */

import { createWriteStream } from 'fs';
import { ZipArchive } from 'archiver';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('元素拆解-打包', { 前缀: '[元素拆解/打包]', 级别: 'debug', 显示调用位置: true });

/**
 * 创建zip文件
 * @param {Array} files - 文件列表 [{ name, path }]
 * @param {string} zipPath - 输出zip路径
 * @param {string} _workDir - 工作目录（未使用，保留接口兼容）
 * @param {Function} sanitizeFileName - 文件名清理函数
 */
export async function createZip(files, zipPath, _workDir, sanitizeFileName) {
  logger.debug(`--- createZip 入口 ---`);
  logger.debug(`文件数: ${files.length}, zipPath: ${zipPath}`);

  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive({
      zlib: { level: 6 },             // 压缩级别 0-9
      forceUTC: true,                  // 统一用 UTC 时间戳，避免时区问题
    });

    output.on('close', () => {
      logger.info(`zip创建成功: ${zipPath} (${archive.pointer()} bytes)`);
      resolve();
    });

    archive.on('error', (err) => {
      logger.error(`zip创建失败: ${err.message}`);
      reject(err);
    });

    archive.pipe(output);

    for (const file of files) {
      const safeName = sanitizeFileName(file.name);
      const entryName = `${safeName}.png`;
      logger.debug(`添加文件: ${file.name} → ${entryName}`);
      archive.file(file.path, { name: entryName });
    }

    archive.finalize();
  });
}
