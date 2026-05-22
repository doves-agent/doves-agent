/**
 * 文档管理 - 搜索功能
 * 支持本地目录、上传文件、数据库文档的全文搜索
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { getDovesProxy } from '../存储接口.js';
import { DOC_SOURCES } from './工具定义.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('文档搜索', { 前缀: '[文档管理]', 级别: 'debug', 显示调用位置: true });

/**
 * 获取上传目录
 */
function getUploadDir() {
  return join(process.cwd(), 'data', 'uploads');
}

/**
 * 搜索文档内容
 */
export async function searchDocument(args) {
  const { query, source, path: searchPath, conversationId, fileTypes, limit = 10 } = args;

  const results = [];

  // 搜索数据库文档
  if (source === DOC_SOURCES.DATABASE || !source) {
    try {
      const client = await getDovesProxy();
      const db = client.db();
      const collection = db.collection('文档');

      const filter = {
        $or: [
          { name: { $regex: query, $options: 'i' } },
          { content: { $regex: query, $options: 'i' } },
          { tags: { $regex: query, $options: 'i' } },
        ],
      };

      if (conversationId) filter.conversationId = conversationId;

      const docs = await collection.find(filter).limit(limit).toArray();

      for (const doc of docs) {
        const contentLower = doc.content?.toLowerCase() || '';
        const queryLower = query.toLowerCase();
        const matchIndex = contentLower.indexOf(queryLower);

        let snippet = '';
        if (matchIndex !== -1) {
          const start = Math.max(0, matchIndex - 50);
          const end = Math.min(contentLower.length, matchIndex + query.length + 50);
          snippet = doc.content.substring(start, end);
          if (start > 0) snippet = '...' + snippet;
          if (end < contentLower.length) snippet = snippet + '...';
        }

        results.push({
          source: DOC_SOURCES.DATABASE,
          documentId: doc._id,
          name: doc.name,
          type: doc.type,
          snippet,
          tags: doc.tags,
        });
      }
    } catch (error) {
            logger.error('数据库搜索失败:', error);
    }
  }

  // 搜索本地文件
  if (source === DOC_SOURCES.LOCAL || !source) {
    const basePath = searchPath || process.cwd();
    if (existsSync(basePath)) {
      const files = await searchInDirectory(basePath, query, fileTypes, limit - results.length);
      results.push(...files.map((f) => ({ ...f, source: DOC_SOURCES.LOCAL })));
    } else if (searchPath) {
      results.push({ source: DOC_SOURCES.LOCAL, warning: `路径不存在: ${searchPath}`, count: 0 });
    }
  }

  // 搜索上传文件
  if (source === DOC_SOURCES.UPLOAD || !source) {
    const uploadDir = getUploadDir();
    const searchDir = conversationId ? join(uploadDir, conversationId) : uploadDir;

    if (existsSync(searchDir)) {
      const files = await searchInDirectory(searchDir, query, fileTypes, limit - results.length);
      results.push(...files.map((f) => ({ ...f, source: DOC_SOURCES.UPLOAD, conversationId })));
    }
  }

  return {
    success: true,
    query,
    count: results.length,
    results: results.slice(0, limit),
  };
}

/**
 * 在目录中搜索
 */
async function searchInDirectory(dirPath, query, fileTypes, limit) {
  const results = [];
  const queryLower = query.toLowerCase();
  const allowedExts = fileTypes?.map((t) => (t.startsWith('.') ? t : '.' + t)) || null;

  async function searchRecursive(dir) {
    if (results.length >= limit) return;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= limit) break;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          await searchRecursive(fullPath);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();

          if (allowedExts && !allowedExts.includes(ext)) continue;

          if (['.txt', '.md', '.json', '.csv', '.html', '.xml', '.js', '.ts', '.py'].includes(ext)) {
            try {
              const content = readFileSync(fullPath, 'utf-8');
              const contentLower = content.toLowerCase();

              if (contentLower.includes(queryLower)) {
                const matchIndex = contentLower.indexOf(queryLower);
                const start = Math.max(0, matchIndex - 50);
                const end = Math.min(content.length, matchIndex + query.length + 50);
                let snippet = content.substring(start, end);
                if (start > 0) snippet = '...' + snippet;
                if (end < content.length) snippet = snippet + '...';

                results.push({
                  path: fullPath,
                  name: entry.name,
                  extension: ext,
                  snippet,
                });
              }
            } catch (e) {
              logger.debug(`读取文件失败: ${fullPath} | ${e.message}`);
            }
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EACCES') {
                logger.error(`目录搜索失败: ${error.message}`);
      }
    }
  }

  try {
    await searchRecursive(dirPath);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'EACCES') {
              logger.error(`目录搜索失败: ${error.message}`);
    }
  }

  return results;
}
