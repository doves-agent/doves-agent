/**
 * 代码搜索辅助工具
 * 从 代码工具.js 提取
 */

import fs from 'fs/promises';
import path from 'path';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('代码搜索', { 前缀: '[代码搜索]', 级别: 'debug' });

// ========== 排除目录常量 ==========
export const EXCLUDED_DIRS = ['node_modules', '.git', 'dist', 'release', '.cache', '__pycache__', '.next', '.nuxt'];

/**
 * 统一返回格式
 */
export const text = (content) => ({
  content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }]
});

/**
 * 判断目录名是否应被排除
 */
export function isExcludedDir(name) {
  return EXCLUDED_DIRS.includes(name);
}

/**
 * 判断文件是否匹配 glob 模式（简单实现，支持 * 和 **）
 * - * 匹配非路径分隔符的任意字符
 * - ** 匹配任意路径段（含0个段）
 */
export function matchGlob(filePath, pattern) {
  const regexStr = pattern
    .split('**')
    .map(segment => segment
      .split('*')
      .map(s => s.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
      .join('[^/\\\\]*')
    )
    .join('.*');
  const regex = new RegExp('^' + regexStr + '$', 'i');
  return regex.test(filePath.replace(/\\/g, '/'));
}

/**
 * 递归读取目录，排除指定目录
 */
export async function readDirRecursive(dirPath, maxDepth = 3, currentDepth = 0) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    if (isExcludedDir(entry.name) || entry.name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const stat = await fs.stat(fullPath).catch(() => null);
      result.push({
        name: entry.name,
        type: 'dir',
        path: fullPath,
        size: stat ? stat.size : 0
      });

      if (currentDepth < maxDepth - 1) {
        const children = await readDirRecursive(fullPath, maxDepth, currentDepth + 1);
        result.push(...children);
      }
    } else if (entry.isFile()) {
      const stat = await fs.stat(fullPath).catch(() => null);
      result.push({
        name: entry.name,
        type: 'file',
        path: fullPath,
        size: stat ? stat.size : 0
      });
    }
  }

  return result;
}

/**
 * 递归搜索文件内容
 */
export async function searchInDirectory(dirPath, regex, options = {}) {
  const { contextLines = 2, maxResults = 50, glob = null, results = [] } = options;

  if (results.length >= maxResults) return results;

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (e) {
    logger.warn(`读取目录失败: ${dirPath} | ${e.message}`);
    return results;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) break;
    if (isExcludedDir(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      await searchInDirectory(fullPath, regex, { contextLines, maxResults, glob, results });
    } else if (entry.isFile()) {
      if (glob && !matchGlob(fullPath, glob)) continue;

      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch (e) {
        logger.debug(`获取文件状态失败: ${fullPath} | ${e.message}`);
        continue;
      }
      if (stat.size > 1024 * 1024) continue;

      let content;
      try {
        content = await fs.readFile(fullPath, 'utf-8');
      } catch (e) {
        logger.debug(`读取文件失败: ${fullPath} | ${e.message}`);
        continue;
      }

      const lines = content.split('\n');
      for (let i = 0; i < lines.length && results.length < maxResults; i++) {
        if (regex.test(lines[i])) {
          results.push({
            file: fullPath,
            line: i + 1,
            content: lines[i],
            context_before: lines.slice(Math.max(0, i - contextLines), i),
            context_after: lines.slice(i + 1, i + 1 + contextLines)
          });
        }
      }
    }
  }

  return results;
}

/**
 * 递归查找匹配 glob 的文件
 */
export async function findFiles(dirPath, pattern, options = {}) {
  const { maxResults = 100, results = [] } = options;

  if (results.length >= maxResults) return results;

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (e) {
    logger.warn(`搜索文件失败: ${dirPath} | ${e.message}`);
    return results;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) break;
    if (isExcludedDir(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      await findFiles(fullPath, pattern, { maxResults, results });
    } else if (entry.isFile()) {
      if (matchGlob(fullPath, pattern)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * 从文件内容中提取符号
 */
export function extractSymbols(content, type) {
  const lines = content.split('\n');
  const symbols = [];
  const types = type === 'all' ? ['function', 'class', 'variable', 'export'] : [type];

  const patterns = {
    function: [
      /(?:async\s+)?function\s+(\w+)/,
      /(\w+)\s*[:=]\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)/
    ],
    class: [
      /class\s+(\w+)/
    ],
    variable: [
      /(?:const|let|var)\s+(\w+)/
    ],
    export: [
      /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/
    ]
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const symType of types) {
      for (const regex of patterns[symType]) {
        const match = line.match(regex);
        if (match) {
          symbols.push({
            name: match[1],
            type: symType,
            line: i + 1,
            text: line.trim()
          });
          break;
        }
      }
    }
  }

  return symbols;
}
