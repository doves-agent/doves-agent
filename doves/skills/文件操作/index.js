/**
 * 文件操作技能 - txt
 * 
 * 支持完整的文件系统操作：
 * - read: 读取文件
 * - write: 写入文件  
 * - append: 追加内容
 * - list: 列出目录
 * - exists: 检查存在
 * - stat: 获取信息
 * - mkdir: 创建目录
 * - copy: 复制文件
 * - move: 移动文件
 * - delete: 删除文件
 * - create: 创建文本文件
 */

import fs from 'fs';
import { dirname } from 'path';

import { 创建日志器 } from '@dove/common/日志管理器.js';

// ============================================================================
// 日志器
// ============================================================================

const logger = 创建日志器('文件操作', { 前缀: '[文件操作]', 级别: 'debug', 显示调用位置: true });

const fsp = fs.promises;

/**
 * 读取文件
 */
async function readFile(path, encoding) {
  try {
    await fsp.access(path);
  } catch {
    return { 成功: false, 错误: `文件不存在: ${path}` };
  }
  const content = await fsp.readFile(path, encoding);
  return { 成功: true, 数据: content, path };
}

/**
 * 写入文件
 */
async function writeFile(path, content, encoding) {
  const dir = dirname(path);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path, content, { encoding });
  return { 成功: true, 数据: `文件已写入: ${path}`, path };
}

/**
 * 追加内容
 */
async function appendFile(path, content, encoding) {
  try {
    await fsp.access(path);
  } catch {
    return { 成功: false, 错误: `文件不存在: ${path}` };
  }
  await fsp.appendFile(path, content, { encoding });
  return { 成功: true, 数据: `内容已追加: ${path}`, path };
}

/**
 * 列出目录
 */
async function listDir(path) {
  let entries;
  try {
    entries = await fsp.readdir(path, { withFileTypes: true });
  } catch {
    return { 成功: false, 错误: `目录不存在: ${path}` };
  }
  const result = entries.map(item => ({
    name: item.name,
    type: item.isDirectory() ? 'directory' : 'file'
  }));
  return { 成功: true, 数据: result, path, count: result.length };
}

/**
 * 检查存在
 */
async function checkExists(path) {
  let exists;
  try {
    await fsp.access(path);
    exists = true;
  } catch {
    exists = false;
  }
  return { 成功: true, 数据: exists, path, exists };
}

/**
 * 获取信息
 */
async function getStat(path) {
  let stats;
  try {
    stats = await fsp.stat(path);
  } catch {
    return { 成功: false, 错误: `路径不存在: ${path}` };
  }
  return {
    成功: true,
    数据: {
      path,
      type: stats.isDirectory() ? 'directory' : 'file',
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      accessed: stats.atime
    }
  };
}

/**
 * 创建目录
 */
async function makeDir(path) {
  try {
    await fsp.access(path);
    return { 成功: true, 数据: `目录已存在: ${path}`, path };
  } catch {
    // 不存在，继续创建
  }
  await fsp.mkdir(path, { recursive: true });
  return { 成功: true, 数据: `目录已创建: ${path}`, path };
}

/**
 * 复制文件
 */
async function copyFile(from, to) {
  try {
    await fsp.access(from);
  } catch {
    return { 成功: false, 错误: `源文件不存在: ${from}` };
  }
  const dir = dirname(to);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.copyFile(from, to);
  return { 成功: true, 数据: `文件已复制: ${from} -> ${to}`, from, to };
}

/**
 * 移动文件
 */
async function moveFile(from, to) {
  try {
    await fsp.access(from);
  } catch {
    return { 成功: false, 错误: `源文件不存在: ${from}` };
  }
  const dir = dirname(to);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.rename(from, to);
  return { 成功: true, 数据: `文件已移动: ${from} -> ${to}`, from, to };
}

/**
 * 删除文件
 */
async function deleteFile(path) {
  let stats;
  try {
    stats = await fsp.stat(path);
  } catch {
    return { 成功: true, 数据: `文件不存在，无需删除: ${path}`, path };
  }

  if (stats.isDirectory()) {
    await fsp.rm(path, { recursive: true });
  } else {
    await fsp.unlink(path);
  }
  return { 成功: true, 数据: `已删除: ${path}`, path };
}

/**
 * 创建故事文件
 */
async function createStory(path, storyText, encoding) {
  if (!storyText) {
    return { success: false, error: '缺少 story_text 参数' };
  }
  
  const formattedText = `故事

作者：AI 助手
创作时间：${new Date().toLocaleDateString('zh-CN')}

${storyText}

---
故事字数：${storyText.length}字
`;
  
  return await writeFile(path, formattedText, encoding);
}

// ============================================================================
// Skill 主执行函数
// ============================================================================

async function execute(args, context) {
  const action = args.action;
  const path = args.path;
  const { content, encoding = 'utf-8', from, to, story_text } = args;
  
  try {
    switch (action) {
      case 'read':
        return await readFile(path, encoding);
      case 'write':
      case 'create':
        return await writeFile(path, content || '', encoding);
      case 'append':
        return await appendFile(path, content, encoding);
      case 'list':
        return await listDir(path);
      case 'exists':
        return await checkExists(path);
      case 'stat':
        return await getStat(path);
      case 'mkdir':
        return await makeDir(path);
      case 'copy':
        return await copyFile(from || path, to);
      case 'move':
        return await moveFile(from || path, to);
      case 'delete':
        return await deleteFile(path);
      case 'story':
        return await createStory(path, story_text, encoding);
      default:
        return { 成功: false, 错误: `未知操作: ${action}` };
    }
  } catch (error) {
    logger.error(`执行 ${action} 失败:`, error);
    return { 成功: false, 错误: error.message };
  }
}

// ============================================================================
// 导出
// ============================================================================

export default {
  name: '文件操作',
  description: '文件操作技能 - 完整的文件系统操作能力：读取、写入、追加、列表、存在检查、复制、移动、删除',

  // 内置技能，不需要拥有权检查
  需要拥有权: false,

  // 能力声明（用于任务匹配）
  abilities: ['文件操作', '文件读写', '目录管理'],
  
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'write', 'append', 'list', 'exists', 'stat', 'mkdir', 'copy', 'move', 'delete', 'create', 'story'],
        description: '操作类型'
      },
      path: { 
        type: 'string', 
        description: '文件路径' 
      },
      content: { 
        type: 'string', 
        description: '文件内容' 
      },
      encoding: { 
        type: 'string', 
        default: 'utf-8', 
        description: '文件编码' 
      },
      from: { 
        type: 'string', 
        description: '源路径 (copy/move)' 
      },
      to: { 
        type: 'string', 
        description: '目标路径 (copy/move)' 
      },
      story_text: { 
        type: 'string', 
        description: '故事文本' 
      }
    },
    required: ['action']
  },
  execute
};

