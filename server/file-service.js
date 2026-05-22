/**
 * 白鸽服务端文件服务模块
 * 职责：OSS/本地文件代理
 * 
 * 【KISS原则文档的一部分】
 * 
 * === 文件操作代理 API ===
 * 
 * GET /files/*path          # 读取文件
 * PUT /files/*path          # 写入文件（body为内容）
 * DELETE /files/*path       # 删除文件
 * GET /files/list/*dir      # 列出目录
 * 
 * 响应：
 * {
 *   "success": true,
 *   "path": "users/{userId}/workspace/file.txt",
 *   "size": 1024,
 *   "content": "..."  // 读取时返回
 * }
 * 
 * === 路径安全规则 ===
 * - 自动添加前缀：users/{userId}/{path}
 * - 禁止路径穿越：过滤 .. 和绝对路径
 * - 只能操作自己的文件
 * 
 * 路径安全处理示例：
 * 输入: "../../../etc/passwd"
 * 输出: "users/{userId}/etc/passwd"  // 安全，无法越权
 * 
 * === OSS 权限模型 ===
 * 
 * 客户端通过服务端：
 * ├── 只能访问 users/{自己的userId}/**
 * ├── 服务端强制校验路径
 * └── 防止路径穿越攻击
 * 
 * 鸽群通过 Skill：
 * ├── 可以访问 users/{任务的ownerId}/**
 * ├── 任务关联文件自动继承所有权
 * └── 支持跨用户操作（需任务授权）
 * 
 * === OSS 目录结构 ===
 * 
 * OSS
 * └── users/{userId}/
 *     └── temp/                    # 唯一目录：临时公开访问区
 *         └── tasks/
 *             └── {taskId}_{hash}/
 *                 ├── private/     # 仅用户可访问
 *                 ├── public/      # 完全公开（LLM URL）
 *                 └── dove/        # 领取鸽子专用
 *                     ├── input/
 *                     └── output/
 * 
 * === Git存储 vs OSS 定位 ===
 *
 * Git存储 = 用户的保险箱
 * ├── 本地 git 仓库，支持版本管理
 * ├── 支持快照、回滚、历史追溯
 * └── 存储用户的全部私有数据
 * 
 * OSS = 临时公开窗口
 * ├── 临时访问区，通过 URL 公开访问
 * ├── 仅 temp/ 目录，用完即清
 * └── 用于：外部鸽子任务、LLM API URL、临时分享
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { CONFIG, logger } from './core.js';
import { getOSSClient } from './db.js';

// ==================== 路径安全检查 ====================

/**
 * 路径安全处理
 */
export function sanitizePath(userId, path) {
  // 1. 移除路径穿越
  let normalized = (path || '').replace(/\.\./g, '');
  
  // 2. 移除绝对路径前缀
  if (normalized.startsWith('/')) {
    normalized = normalized.slice(1);
  }
  
  // 3. 如果已包含 users/{userId}/ 前缀，剥离以避免重复
  const userPrefix = `users/${userId}/`;
  if (normalized.startsWith(userPrefix)) {
    normalized = normalized.slice(userPrefix.length);
  }
  
  // 4. 强制用户目录前缀
  return `users/${userId}/${normalized}`;
}

// ==================== 文件操作 ====================

/**
 * 读取文件
 */
export async function readFile(userId, rawPath) {
  const safePath = sanitizePath(userId, rawPath);
  
  // 优先使用 OSS
  if (CONFIG.ossEnabled) {
    const client = await getOSSClient();
    if (client) {
      const result = await client.get(safePath);
      return { content: result.content.toString(), path: safePath };
    }
  }
  
  // 降级到本地文件系统
  const localPath = join(process.cwd(), 'data', safePath);
  if (existsSync(localPath)) {
    return { content: readFileSync(localPath, 'utf-8'), path: safePath };
  }
  
  throw new Error('文件不存在');
}

/**
 * 写入文件
 */
export async function writeFile(userId, rawPath, content) {
  const safePath = sanitizePath(userId, rawPath);
  
  // 优先使用 OSS
  if (CONFIG.ossEnabled) {
    const client = await getOSSClient();
    if (client) {
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(typeof content === 'string' ? content : JSON.stringify(content));
      await client.put(safePath, buffer);
      return { path: safePath, size: buffer.length };
    }
  }
  
  // 降级到本地文件系统
  const localPath = join(process.cwd(), 'data', safePath);
  const dir = dirname(localPath);
  
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  
  const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  writeFileSync(localPath, data);
  
  return { path: safePath, size: data.length };
}

/**
 * 删除文件
 */
export async function deleteFile(userId, rawPath) {
  const safePath = sanitizePath(userId, rawPath);
  
  // 优先使用 OSS
  if (CONFIG.ossEnabled) {
    const client = await getOSSClient();
    if (client) {
      await client.delete(safePath);
      return { path: safePath };
    }
  }
  
  // 降级到本地文件系统
  const localPath = join(process.cwd(), 'data', safePath);
  if (existsSync(localPath)) {
    unlinkSync(localPath);
    return { path: safePath };
  }
  
  throw new Error('文件不存在');
}

/**
 * 列出目录
 */
export async function listFiles(userId, rawDir) {
  const safePath = sanitizePath(userId, rawDir || '');
  
  // 优先使用 OSS
  if (CONFIG.ossEnabled) {
    const client = await getOSSClient();
    if (client) {
      const result = await client.list({ prefix: safePath, 'max-keys': 1000 });
      const files = (result.objects || []).map(obj => ({
        name: obj.name.replace(safePath, '').replace(/^\//, ''),
        size: obj.size,
        lastModified: obj.lastModified,
        type: 'file'
      }));
      return { path: safePath, files };
    }
  }
  
  // 降级到本地文件系统
  const localPath = join(process.cwd(), 'data', safePath);
  if (!existsSync(localPath)) {
    return { path: safePath, files: [] };
  }
  
  const files = readdirSync(localPath).map(name => {
    const filePath = join(localPath, name);
    const stat = statSync(filePath);
    return {
      name,
      size: stat.size,
      lastModified: stat.mtime,
      type: stat.isDirectory() ? 'directory' : 'file'
    };
  });
  
  return { path: safePath, files };
}
