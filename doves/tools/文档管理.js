/**
 * @file tools/文档管理
 * @description 读取本地/上传/数据库中的文档，支持内容提取和搜索
 */

import { existsSync, statSync, readdirSync } from 'fs';
import { join, extname, basename } from 'path';
import { getDovesProxy } from './存储接口.js';
import { DOC_TYPES, DOC_SOURCES, documentTools } from './文档管理/工具定义.js';
import { extractContent } from './文档管理/内容提取.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('文档管理', { 前缀: '[文档管理]', 级别: 'debug', 显示调用位置: true });
import { searchDocument } from './文档管理/搜索.js';

/**
 * ObjectId 模拟（服务端模式下使用字符串ID）
 * 在服务端模式下，ID 都是字符串格式
 */
function ObjectId(id) {
  return id || null;
}

/**
 * 获取上传目录
 */
function getUploadDir() {
  const cwd = process.cwd();
  return join(cwd, 'data', 'uploads');
}

/**
 * 读取文档内容
 */
async function readDocument(args) {
  const { source, path: filePath, documentId, conversationId, encoding = 'utf-8', maxSize = 10485760 } = args;
  
  let actualPath = filePath;
  let content = null;
  let fileInfo = {};
  
  switch (source) {
    case DOC_SOURCES.LOCAL:
      // 读取本地文件
      if (!filePath || !existsSync(filePath)) {
        return { success: false, error: '文件不存在' };
      }
      
      const localStat = statSync(filePath);
      if (localStat.size > maxSize) {
        return { success: false, error: `文件过大 (${localStat.size} bytes)，超过限制 ${maxSize} bytes` };
      }
      
      fileInfo = {
        path: filePath,
        name: basename(filePath),
        size: localStat.size,
        created: localStat.birthtime,
        modified: localStat.mtime,
        extension: extname(filePath).toLowerCase()
      };
      
      content = await extractContent(filePath, encoding);
      break;
      
    case DOC_SOURCES.UPLOAD: {
      // 读取上传的文件
      const uploadDir = getUploadDir();
      
      // 判断 filePath 是 hashId 还是路径
      const isHashId = /^[a-f0-9]{16}$/i.test(filePath);
      
      let actualPath = null;
      
      if (isHashId) {
        // hashId 格式：查找对应文件
        actualPath = join(uploadDir, filePath.substring(0, 2), filePath.substring(2, 4), filePath);
      } else if (conversationId) {
        // 对话ID + 文件名
        actualPath = join(uploadDir, conversationId, filePath);
      } else {
        // 直接路径
        actualPath = join(uploadDir, filePath);
      }
      
      if (!existsSync(actualPath)) {
        return { success: false, error: '上传文件不存在', path: actualPath };
      }
      
      const uploadStat = statSync(actualPath);
      if (uploadStat.size > maxSize) {
        return { success: false, error: `文件过大 (${uploadStat.size} bytes)` };
      }
      
      fileInfo = {
        path: actualPath,
        name: basename(actualPath),
        size: uploadStat.size,
        created: uploadStat.birthtime,
        modified: uploadStat.mtime,
        extension: extname(actualPath).toLowerCase(),
        conversationId
      };
      
      content = await extractContent(actualPath, encoding);
      break;
    }
      
    case DOC_SOURCES.DATABASE:
      // 从数据库读取
      if (!documentId) {
        return { success: false, error: '缺少 documentId' };
      }
      
      try {
        const client = await getDovesProxy();
        const db = client.db();
        const collection = db.collection('文档');
        const doc = await collection.findOne({ _id: new ObjectId(documentId) });
        
        if (!doc) {
          return { success: false, error: '文档不存在' };
        }
        
        fileInfo = {
          id: doc._id,
          name: doc.name,
          type: doc.type,
          size: doc.content?.length || 0,
          created: doc.创建时间 || doc.createdAt,
          modified: doc.更新时间 || doc.updatedAt,
          tags: doc.tags,
          userId: doc.用户ID || doc.userId,
          conversationId: doc.对话ID || doc.conversationId
        };
        
        content = doc.content;
      } catch (error) {
        return { success: false, error: `数据库读取失败: ${error.message}` };
      }
      break;
      
    default:
      return { success: false, error: `未知的文档来源: ${source}` };
  }
  
  return {
    success: true,
    source,
    fileInfo,
    content,
    contentLength: content?.length || 0
  };
}





/**
 * 列出文档
 */
async function listDocuments(args) {
  const { source, path: listPath, conversationId, fileTypes, recursive = false, limit = 50 } = args;
  
  const results = [];
  const allowedExts = fileTypes?.map(t => t.startsWith('.') ? t : '.' + t) || null;
  
  switch (source) {
    case DOC_SOURCES.LOCAL: {
      const basePath = listPath || process.cwd();
      if (!existsSync(basePath)) {
        return { success: false, error: '目录不存在' };
      }
      
      const files = listDirectory(basePath, recursive, allowedExts, limit);
      results.push(...files.map(f => ({ ...f, source: DOC_SOURCES.LOCAL })));
      break;
    }
      
    case DOC_SOURCES.UPLOAD: {
      const uploadDir = getUploadDir();
      const targetDir = conversationId ? join(uploadDir, conversationId) : uploadDir;
      
      if (!existsSync(targetDir)) {
        return { success: true, count: 0, results: [], message: '没有上传文件' };
      }
      
      const files = listDirectory(targetDir, recursive, allowedExts, limit);
      results.push(...files.map(f => ({ ...f, source: DOC_SOURCES.UPLOAD, conversationId })));
      break;
    }
      
    case DOC_SOURCES.DATABASE: {
      try {
        const client = await getDovesProxy();
        const db = client.db();
        const collection = db.collection('文档');
        const filter = {};
        if (conversationId) filter.conversationId = conversationId;
        
        const docs = await collection.find(filter).limit(limit).toArray();
        results.push(...docs.map(d => ({
          source: DOC_SOURCES.DATABASE,
          documentId: d._id,
          name: d.name,
          type: d.type,
          size: d.content?.length || 0,
          tags: d.tags,
          created: d.createdAt
        })));
      } catch (error) {
        logger.error(`数据库列表失败: ${error.message}`);
      }
      break;
    }
  }
  
  return {
    success: true,
    source,
    count: results.length,
    results
  };
}

/**
 * 列出目录内容
 */
function listDirectory(dirPath, recursive, allowedExts, limit) {
  const results = [];
  
  function listRecursive(dir) {
    if (results.length >= limit) return;
    
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (results.length >= limit) break;
        
        const fullPath = join(dir, entry.name);
        
        if (entry.isDirectory()) {
          if (recursive) {
            listRecursive(fullPath);
          } else {
            results.push({
              path: fullPath,
              name: entry.name,
              type: 'directory'
            });
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (allowedExts && !allowedExts.includes(ext)) continue;
          
          const stat = statSync(fullPath);
          results.push({
            path: fullPath,
            name: entry.name,
            type: 'file',
            extension: ext,
            size: stat.size,
            modified: stat.mtime
          });
        }
      }
    } catch (error) {
      logger.error(`列出目录失败: ${error.message}`);
    }
  }
  
  try {
    listRecursive(dirPath);
  } catch (error) {
    logger.error(`列出目录失败: ${error.message}`);
  }
  
  return results;
}

/**
 * 获取文档信息
 */
async function getDocumentInfo(args) {
  const { source, path: filePath, documentId, conversationId } = args;
  
  switch (source) {
    case DOC_SOURCES.LOCAL: {
      if (!filePath || !existsSync(filePath)) {
        return { success: false, error: '文件不存在' };
      }
      
      const stat = statSync(filePath);
      return {
        success: true,
        source,
        path: filePath,
        name: basename(filePath),
        extension: extname(filePath).toLowerCase(),
        size: stat.size,
        created: stat.birthtime,
        modified: stat.mtime,
        accessed: stat.atime,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory()
      };
    }
      
    case DOC_SOURCES.UPLOAD: {
      const uploadDir = getUploadDir();
      const actualPath = conversationId 
        ? join(uploadDir, conversationId, filePath)
        : join(uploadDir, filePath);
      
      if (!existsSync(actualPath)) {
        return { success: false, error: '文件不存在' };
      }
      
      const stat = statSync(actualPath);
      return {
        success: true,
        source,
        path: actualPath,
        name: basename(actualPath),
        extension: extname(actualPath).toLowerCase(),
        size: stat.size,
        created: stat.birthtime,
        modified: stat.mtime,
        conversationId
      };
    }
      
    case DOC_SOURCES.DATABASE: {
      if (!documentId) {
        return { success: false, error: '缺少 documentId' };
      }
      
      try {
        const client = await getDovesProxy();
        const db = client.db();
        const collection = db.collection('文档');
        const doc = await collection.findOne({ _id: new ObjectId(documentId) });
        
        if (!doc) {
          return { success: false, error: '文档不存在' };
        }
        
        return {
          success: true,
          source,
          documentId: doc._id,
          name: doc.name,
          type: doc.type,
          size: doc.content?.length || 0,
          tags: doc.tags,
          metadata: doc.metadata,
          userId: doc.用户ID || doc.userId,
          conversationId: doc.对话ID || doc.conversationId,
          created: doc.创建时间 || doc.createdAt,
          modified: doc.更新时间 || doc.updatedAt
        };
      } catch (error) {
        return { success: false, error: `数据库读取失败: ${error.message}` };
      }
    }
    
    default:
      return { success: false, error: `未知的文档来源: ${source}` };
  }
}

/**
 * 保存文档到数据库
 */
async function saveDocument(args) {
  try {
    const client = await getDovesProxy();
    const db = client.db();
    const collection = db.collection('文档');
    
    const doc = {
      name: args.name,
      content: args.content,
      type: args.type || 'text',
      用户ID: args.userId || null,
      对话ID: args.conversationId || null,
      tags: args.tags || [],
      metadata: args.metadata || {},
      创建时间: new Date(),
      更新时间: new Date()
    };
    
    const result = await collection.insertOne(doc);
    
    return {
      success: true,
      documentId: result.insertedId,
      message: '文档已保存'
    };
  } catch (error) {
    return { success: false, error: `保存失败: ${error.message}` };
  }
}

/**
 * 删除文档
 */
async function deleteDocument(args) {
  try {
    const client = await getDovesProxy();
    const db = client.db();
    const collection = db.collection('文档');
    
    const result = await collection.deleteOne({ _id: new ObjectId(args.documentId) });
    
    if (result.deletedCount === 0) {
      return { success: false, error: '文档不存在' };
    }
    
    return {
      success: true,
      message: '文档已删除',
      documentId: args.documentId
    };
  } catch (error) {
    return { success: false, error: `删除失败: ${error.message}` };
  }
}

/**
 * 处理文档工具调用
 */
export async function handleDocumentTool(name, args) {
  const text = (content) => ({ 
    content: [{ 
      type: 'text', 
      text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) 
    }] 
  });
  
  try {
    switch (name) {
      case '文档读取':
        return text(await readDocument(args));
        
      case '文档搜索':
        return text(await searchDocument(args));
        
      case '文档列表':
        return text(await listDocuments(args));
        
      case '文档信息':
        return text(await getDocumentInfo(args));
        
      case '文档保存':
        return text(await saveDocument(args));
        
      case '文档删除':
        return text(await deleteDocument(args));
        
      default:
        return { 
          content: [{ type: 'text', text: `Unknown document tool: ${name}` }], 
          isError: true 
        };
    }
  } catch (error) {
    logger.error(`工具错误: ${error.message}`);
    return text({ success: false, error: error.message });
  }
}

export { DOC_TYPES, DOC_SOURCES, documentTools };

// 默认导出
export default {
  documentTools,
  handleDocumentTool,
  DOC_TYPES,
  DOC_SOURCES
};
