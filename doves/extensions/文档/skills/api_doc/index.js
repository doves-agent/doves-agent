/**
 * API文档生成技能
 * 扫描代码API端点/函数签名/类型定义 → 返回结构化API信息
 */

import fs from 'fs/promises';
import path from 'path';

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('api_doc', { 前缀: '[api_doc]', 级别: 'debug', 显示调用位置: true });

/**
 * 从代码文件中提取API信息
 */
function 提取API信息(content, filePath) {
  const apis = [];
  const lines = content.split('\n');

  // HTTP路由模式
  const routeRegexes = [
    /(?:app|router|route)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g,
    /@(Get|Post|Put|Delete|Patch|RequestMapping)\s*\(\s*['"]?([^'")\]]+)['"]?\s*\)/g,
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const regex of routeRegexes) {
      regex.lastIndex = 0;
      const match = regex.exec(lines[i]);
      if (match) {
        apis.push({
          type: 'route',
          method: match[1].toUpperCase(),
          path: match[2],
          file: filePath,
          line: i + 1
        });
      }
    }

    // 导出函数
    const exportFunc = lines[i].match(/export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
    if (exportFunc) {
      apis.push({
        type: 'export_function',
        name: exportFunc[1],
        params: exportFunc[2].split(',').map(p => p.trim()).filter(Boolean),
        file: filePath,
        line: i + 1
      });
    }

    // 导出类
    const exportClass = lines[i].match(/export\s+(?:default\s+)?class\s+(\w+)/);
    if (exportClass) {
      apis.push({
        type: 'class',
        name: exportClass[1],
        file: filePath,
        line: i + 1
      });
    }

    // JSDoc注释
    const jsdoc = lines[i].match(/\/\*\*[\s\S]*?\*\//);
    if (jsdoc) {
      const descMatch = jsdoc[0].match(/\*\s*@(description|desc)\s+(.+)/);
      if (descMatch) {
        apis.push({
          type: 'jsdoc',
          description: descMatch[2].trim(),
          file: filePath,
          line: i + 1
        });
      }
    }
  }

  return apis;
}

/**
 * 递归扫描目录
 */
async function 扫描目录(dir, options = {}) {
  const { maxDepth = 3, extensions = /\.(js|ts|jsx|tsx|py|go|java)$/, excludeDirs = ['node_modules', '.git', 'dist', '__pycache__'] } = options;
  const results = [];

  async function scan(currentDir, depth) {
    if (depth > maxDepth) return;
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (excludeDirs.includes(entry.name) || entry.name.startsWith('.')) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isFile() && extensions.test(entry.name)) {
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const apis = 提取API信息(content, fullPath);
          results.push({ file: fullPath, apis });
        } catch { /* 跳过 */ }
      } else if (entry.isDirectory()) {
        await scan(fullPath, depth + 1);
      }
    }
  }

  await scan(dir, 0);
  return results;
}

/**
 * 生成OpenAPI格式
 */
function 生成OpenAPI(scanResults, info = {}) {
  const paths = {};
  const schemas = {};

  for (const result of scanResults) {
    for (const api of result.apis) {
      if (api.type === 'route' && api.path) {
        const method = api.method.toLowerCase();
        if (!paths[api.path]) paths[api.path] = {};
        paths[api.path][method] = {
          summary: `${method.toUpperCase()} ${api.path}`,
          operationId: `${method}_${api.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
          responses: { '200': { description: '成功' } }
        };
      }
      if (api.type === 'class' && api.name) {
        schemas[api.name] = {
          type: 'object',
          description: `类 ${api.name}`
        };
      }
    }
  }

  return {
    openapi: '3.0.0',
    info: {
      title: info.title || 'API文档',
      version: info.version || '1.0.0',
      description: info.description || ''
    },
    paths,
    components: { schemas }
  };
}

async function execute(args, context) {
  const { action = 'scan', source, format = 'markdown', info = {} } = args;

  logger.info(`执行: ${action}`);

  try {
    switch (action) {
      case 'scan': {
        if (!source) return { 成功: false, 错误: '缺少必填参数: source' };
        const results = await 扫描目录(source);
        const allApis = results.flatMap(r => r.apis);

        return {
          成功: true,
          数据: {
            scannedFiles: results.length,
            totalAPIs: allApis.length,
            routes: allApis.filter(a => a.type === 'route'),
            functions: allApis.filter(a => a.type === 'export_function'),
            classes: allApis.filter(a => a.type === 'class'),
            files: results.map(r => ({ file: r.file, apiCount: r.apis.length }))
          }
        };
      }

      case 'openapi': {
        if (!source) return { 成功: false, 错误: '缺少必填参数: source' };
        const results = await 扫描目录(source);
        const openapi = 生成OpenAPI(results, info);
        return { 成功: true, 数据: openapi };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'api_doc',
  description: 'API文档生成技能 — 扫描代码API端点/函数签名，生成OpenAPI格式文档',
  abilities: ['文档管理', '文档生成'],
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['scan', 'openapi'], description: '操作类型' },
      source: { type: 'string', description: '代码目录路径' },
      format: { type: 'string', enum: ['markdown', 'openapi'], description: '输出格式' },
      info: { type: 'object', description: 'OpenAPI info字段' }
    },
    required: ['action']
  },
  execute
};
