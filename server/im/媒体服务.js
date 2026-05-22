/**
 * IM 媒体服务（平台无关层）
 * 
 * 职责：
 * 1. 统一媒体文件本地存储管理
 * 2. 临时目录管理（自动清理过期文件）
 * 3. 文件信息查询（大小、MIME类型等）
 * 
 * 存储结构：
 * data/im_uploads/{userId}/{timestamp}_{filename}
 * 
 * 平台特定逻辑（CDN加解密等）由各平台媒体模块处理
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync, createReadStream } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { createHash } from 'crypto';
import { logger } from '../core.js';

// ==================== 常量 ====================

/** 临时文件根目录 */
const IM_UPLOADS_ROOT = 'data/im_uploads';

/** 文件过期时间（24小时） */
const FILE_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** 清理间隔（1小时） */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** 文件大小限制 */
const FILE_SIZE_LIMITS = {
  image: 10 * 1024 * 1024,   // 10MB
  video: 100 * 1024 * 1024,  // 100MB
  file: 50 * 1024 * 1024,    // 50MB
  voice: 10 * 1024 * 1024,   // 10MB
};

/** 扩展名到MIME类型映射 */
const EXTENSION_TO_MIME = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

// ==================== 初始化 ====================

/**
 * 初始化媒体服务
 * 创建临时目录，启动定时清理
 */
export function 初始化媒体服务() {
  // 确保根目录存在
  if (!existsSync(IM_UPLOADS_ROOT)) {
    mkdirSync(IM_UPLOADS_ROOT, { recursive: true });
  }
  
  // 启动定时清理
  setInterval(() => {
    清理过期文件().catch(err => {
      logger.warn(`[媒体服务] 清理过期文件失败: ${err.message}`);
    });
  }, CLEANUP_INTERVAL_MS);
  
  logger.info('[媒体服务] 初始化完成，临时目录: ' + IM_UPLOADS_ROOT);
}

// ==================== 核心方法 ====================

/**
 * 保存媒体文件到本地临时目录
 * 
 * @param {string} userId - 用户ID
 * @param {string} fileName - 原始文件名
 * @param {Buffer} buffer - 文件内容
 * @param {Object} options - 可选配置
 * @param {string} options.subDir - 子目录（如 'wechat'）
 * @returns {{ path: string, size: number, md5: string, mime: string }}
 */
export function 保存媒体文件(userId, fileName, buffer, options = {}) {
  const { subDir = '' } = options;
  
  // 构建存储路径: data/im_uploads/{userId}/[{subDir}/]{timestamp}_{filename}
  const timestamp = Date.now();
  const safeFileName = _安全文件名(fileName);
  const storedName = `${timestamp}_${safeFileName}`;
  
  const userDir = subDir
    ? join(IM_UPLOADS_ROOT, userId, subDir)
    : join(IM_UPLOADS_ROOT, userId);
  
  if (!existsSync(userDir)) {
    mkdirSync(userDir, { recursive: true });
  }
  
  const filePath = join(userDir, storedName);
  writeFileSync(filePath, buffer);
  
  // 计算MD5
  const md5 = createHash('md5').update(buffer).digest('hex');
  
  // 获取MIME类型
  const ext = extname(safeFileName).toLowerCase();
  const mime = EXTENSION_TO_MIME[ext] || 'application/octet-stream';
  
  logger.info(`[媒体服务] 保存文件: ${filePath} (${buffer.length} bytes, ${mime})`);
  
  return {
    path: filePath,
    size: buffer.length,
    md5,
    mime,
    fileName: safeFileName,
  };
}

/**
 * 读取本地文件为Buffer
 * 
 * @param {string} filePath - 文件绝对路径
 * @returns {Buffer}
 */
export function 读取本地文件(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }
  return readFileSync(filePath);
}

/**
 * 获取文件信息
 * 
 * @param {string} filePath - 文件路径
 * @returns {{ exists: boolean, size: number, mime: string, md5: string, fileName: string }}
 */
export function 获取文件信息(filePath) {
  if (!existsSync(filePath)) {
    return { exists: false, size: 0, mime: '', md5: '', fileName: '' };
  }
  
  const stat = statSync(filePath);
  const fileName = basename(filePath);
  const ext = extname(fileName).toLowerCase();
  const mime = EXTENSION_TO_MIME[ext] || 'application/octet-stream';
  
  // 只对小文件计算MD5（避免大文件阻塞）
  let md5 = '';
  if (stat.size < 100 * 1024 * 1024) {
    const buffer = readFileSync(filePath);
    md5 = createHash('md5').update(buffer).digest('hex');
  }
  
  return {
    exists: true,
    size: stat.size,
    mime,
    md5,
    fileName,
    lastModified: stat.mtime,
  };
}

/**
 * 验证文件大小是否在限制内
 * 
 * @param {number} fileSize - 文件大小（字节）
 * @param {string} mediaType - 媒体类型 ('image'|'video'|'file'|'voice')
 * @returns {{ ok: boolean, limit: number }}
 */
export function 验证文件大小(fileSize, mediaType) {
  const limit = FILE_SIZE_LIMITS[mediaType] || FILE_SIZE_LIMITS.file;
  return { ok: fileSize <= limit, limit };
}

/**
 * 根据MIME类型判断媒体类型
 * 
 * @param {string} mime - MIME类型
 * @returns {'image'|'video'|'file'|'voice'}
 */
export function 判断媒体类型(mime) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'voice';
  return 'file';
}

/**
 * 列出用户的临时文件
 * 
 * @param {string} userId - 用户ID
 * @returns {Array<{ name: string, path: string, size: number, lastModified: Date }>}
 */
export function 列出用户文件(userId) {
  const userDir = join(IM_UPLOADS_ROOT, userId);
  if (!existsSync(userDir)) return [];
  
  return _递归列出文件(userDir);
}

/**
 * 删除指定文件
 * 
 * @param {string} filePath - 文件路径
 * @returns {boolean}
 */
export function 删除文件(filePath) {
  try {
    // 安全检查：只能在 im_uploads 目录下删除
    const normalized = filePath.replace(/\\/g, '/');
    if (!normalized.includes('im_uploads/')) {
      logger.warn(`[媒体服务] 拒绝删除非临时目录文件: ${filePath}`);
      return false;
    }
    
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      logger.info(`[媒体服务] 已删除: ${filePath}`);
      return true;
    }
    return false;
  } catch (err) {
    logger.warn(`[媒体服务] 删除文件失败: ${err.message}`);
    return false;
  }
}

// ==================== 清理逻辑 ====================

/**
 * 清理过期的临时文件
 * 超过24小时的文件自动删除
 * 
 * @returns {number} 清理的文件数
 */
export async function 清理过期文件() {
  const now = Date.now();
  let cleanedCount = 0;
  
  if (!existsSync(IM_UPLOADS_ROOT)) return 0;
  
  const userDirs = readdirSync(IM_UPLOADS_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => join(IM_UPLOADS_ROOT, d.name));
  
  for (const userDir of userDirs) {
    const files = _递归列出文件(userDir);
    
    for (const file of files) {
      const age = now - file.lastModified.getTime();
      if (age > FILE_EXPIRY_MS) {
        try {
          unlinkSync(file.path);
          cleanedCount++;
        } catch (err) {
          logger.warn(`[媒体服务] 清理文件失败 ${file.path}: ${err.message}`);
        }
      }
    }
    
    // 尝试清理空目录
    try {
      const remaining = readdirSync(userDir);
      if (remaining.length === 0) {
        unlinkSync(userDir);
      }
    } catch (e) { logger.warn('[媒体服务] 清理空目录失败:', e.message); }
  }
  
  if (cleanedCount > 0) {
    logger.info(`[媒体服务] 清理了 ${cleanedCount} 个过期文件`);
  }
  
  return cleanedCount;
}

// ==================== 工具方法 ====================

/**
 * 安全化文件名
 * 移除路径穿越和特殊字符
 * @private
 */
function _安全文件名(fileName) {
  if (!fileName) return `unknown_${Date.now()}`;
  
  // 移除路径穿越
  let safe = fileName.replace(/\.\./g, '');
  // 移除路径分隔符
  safe = safe.replace(/[\/\\]/g, '_');
  // 移除控制字符
  safe = safe.replace(/[\x00-\x1f\x7f]/g, '');
  // 限制长度
  if (safe.length > 200) {
    const ext = extname(safe);
    const name = safe.slice(0, 200 - ext.length);
    safe = name + ext;
  }
  
  return safe || `file_${Date.now()}`;
}

/**
 * 递归列出目录下的文件
 * @private
 */
function _递归列出文件(dir) {
  const results = [];
  
  if (!existsSync(dir)) return results;
  
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(..._递归列出文件(fullPath));
    } else if (entry.isFile()) {
      try {
        const stat = statSync(fullPath);
        results.push({
          name: entry.name,
          path: fullPath,
          size: stat.size,
          lastModified: stat.mtime,
        });
      } catch (e) { logger.warn('[媒体服务] 读取文件信息失败:', e.message); }
    }
  }
  
  return results;
}

export default {
  初始化媒体服务,
  保存媒体文件,
  读取本地文件,
  获取文件信息,
  验证文件大小,
  判断媒体类型,
  列出用户文件,
  删除文件,
  清理过期文件,
  IM_UPLOADS_ROOT,
};

