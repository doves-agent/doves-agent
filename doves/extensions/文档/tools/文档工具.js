/**
 * 文档工具 - 扩展包版本
 * 5个工具：doc_generate / doc_sync_check / doc_sync_fix / doc_template / doc_search_semantic
 */

import fs from 'fs/promises';
import fsc from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('文档工具', { 前缀: '[文档工具]', 级别: 'debug', 显示调用位置: true });

// ==================== 工具定义 ====================

export const extTools = [
  {
    name: 'doc_generate',
    description: '生成文档：扫描代码提取API端点/函数签名/类型定义，返回结构化文档信息。',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['api', 'architecture', 'readme', 'changelog'], description: '文档类型（必填）' },
        source: { type: 'string', description: '代码目录或文件路径（必填）' },
        format: { type: 'string', enum: ['markdown', 'html', 'openapi'], description: '输出格式（默认markdown）' },
        template: { type: 'string', description: '模板名（可选）' },
        output: { type: 'string', description: '输出路径（可选）' }
      },
      required: ['type', 'source']
    }
  },
  {
    name: 'doc_sync_check',
    description: '检查代码与文档是否同步：对比代码变更与文档内容，返回差异报告。',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '代码目录（必填）' },
        docs: { type: 'string', description: '文档目录（必填）' },
        since: { type: 'string', description: '检查从此时间点开始的变更（如 "7 days ago"）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['source', 'docs']
    }
  },
  {
    name: 'doc_sync_fix',
    description: '自动同步：根据代码变更生成文档更新建议。',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '代码目录（必填）' },
        docs: { type: 'string', description: '文档目录（必填）' },
        syncItems: {
          type: 'array',
          description: '要同步的项目（来自doc_sync_check的结果）',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string', description: '需要更新的文档文件' },
              changes: { type: 'string', description: '变更描述' }
            }
          }
        },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['source', 'docs']
    }
  },
  {
    name: 'doc_template',
    description: '管理/返回文档模板。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'apply'], description: '操作类型（必填）' },
        name: { type: 'string', description: '模板名（get/apply时必填）' },
        variables: { type: 'object', description: '模板变量（apply时使用）' }
      },
      required: ['action']
    }
  },
  {
    name: 'doc_search_semantic',
    description: '语义搜索文档：通过Git记忆进行关键词搜索，返回匹配的文档条目。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索查询（必填）' },
        topK: { type: 'number', description: '返回条数（默认5）' },
        threshold: { type: 'number', description: '相似度阈值（默认0.3）' }
      },
      required: ['query']
    }
  }
];

// ==================== 工具分类/映射/安全分级 ====================

export const extToolCategories = {
  '文档工具': ['doc_generate', 'doc_sync_check', 'doc_sync_fix', 'doc_template', 'doc_search_semantic'],
};

export const extToolAbilityMap = {
  doc_generate: ['文档管理', '文档生成'],
  doc_sync_check: ['文档管理'],
  doc_sync_fix: ['文档管理', '文档生成'],
  doc_template: ['文档管理'],
  doc_search_semantic: ['文档管理', '知识检索'],
};

export const extToolSafetyLevels = {
  doc_generate: '谨慎',
  doc_sync_check: '安全',
  doc_sync_fix: '谨慎',
  doc_template: '安全',
  doc_search_semantic: '安全',
};

// ==================== 文档模板 ====================

const DOC_TEMPLATES = {
  api: {
    name: 'API文档模板',
    sections: ['概述', '认证方式', 'API列表', '数据模型', '错误码', '变更历史'],
    format: `# {项目名} API文档

## 概述
{描述}

## 认证方式
{认证说明}

## API列表

### {接口名}
- **路径**: \`{方法} {路径}\`
- **描述**: {接口描述}
- **参数**:
  | 参数名 | 类型 | 必填 | 描述 |
  |--------|------|------|------|
  | {参数} | {类型} | {必填} | {描述} |
- **返回**: {返回说明}

## 数据模型
{数据模型}

## 错误码
| 错误码 | 描述 |
|--------|------|
| {错误码} | {描述} |

## 变更历史
| 版本 | 日期 | 变更内容 |
|------|------|---------|
| {版本} | {日期} | {变更} |`
  },
  readme: {
    name: 'README模板',
    sections: ['项目介绍', '安装', '使用', '配置', 'API', '贡献指南', '许可证'],
    format: `# {项目名}

{描述}

## 安装
\`\`\`bash
{安装命令}
\`\`\`

## 使用
\`\`\`{语言}
{使用示例}
\`\`\`

## 配置
{配置说明}

## API
{API文档链接}

## 贡献指南
{贡献说明}

## 许可证
{许可证}`
  },
  architecture: {
    name: '架构文档模板',
    sections: ['系统概述', '架构图', '模块说明', '数据流', '部署架构', '技术选型'],
    format: `# {项目名} 架构文档

## 系统概述
{描述}

## 架构图
{架构图描述}

## 模块说明
| 模块 | 职责 | 关键文件 |
|------|------|---------|
| {模块名} | {职责} | {文件} |

## 数据流
{数据流描述}

## 部署架构
{部署说明}

## 技术选型
| 技术 | 用途 | 版本 |
|------|------|------|
| {技术} | {用途} | {版本} |`
  },
  changelog: {
    name: '变更日志模板',
    sections: ['新功能', '修复', '重构', '文档', '其他'],
    format: `# 变更日志

## {版本} ({日期})

### 新功能
- {功能描述}

### 修复
- {修复描述}

### 重构
- {重构描述}

### 文档
- {文档变更}`
  }
};

// ==================== 辅助函数 ====================

const text = (content) => ({
  content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }]
});

/**
 * 从代码中提取API信息
 */
function 提取API信息(content, filePath) {
  const apis = [];
  const lines = content.split('\n');

  // Express/Koa 路由模式
  const routePatterns = [
    /(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g,
    /(?:router\.)?(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g,
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const pattern of routePatterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(lines[i]);
      if (match) {
        apis.push({
          method: match[1].toUpperCase(),
          path: match[2],
          file: filePath,
          line: i + 1
        });
      }
    }

    // 函数/方法签名
    const funcMatch = lines[i].match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
    if (funcMatch) {
      apis.push({
        type: 'function',
        name: funcMatch[1],
        params: funcMatch[2],
        file: filePath,
        line: i + 1
      });
    }

    // 类定义
    const classMatch = lines[i].match(/(?:export\s+)?(?:default\s+)?class\s+(\w+)/);
    if (classMatch) {
      apis.push({
        type: 'class',
        name: classMatch[1],
        file: filePath,
        line: i + 1
      });
    }
  }

  return apis;
}

// ==================== 工具处理函数 ====================

export async function handleExtTool(name, args) {
  switch (name) {

    // ===== doc_generate =====
    case 'doc_generate': {
      const { type, source, format = 'markdown', template, output } = args;

      if (!type || !source) {
        return text({ error: '缺少必填参数: type 和 source' });
      }

      try {
        const stat = await fs.stat(source);
        const apis = [];

        if (stat.isFile()) {
          const content = await fs.readFile(source, 'utf-8');
          apis.push(...提取API信息(content, source));
        } else if (stat.isDirectory()) {
          // 递归扫描代码文件
          const 扫描目录 = async (dir, depth = 0) => {
            if (depth > 3) return;
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
              const fullPath = path.join(dir, entry.name);
              if (entry.isFile() && /\.(js|ts|jsx|tsx|py|go|java)$/.test(entry.name)) {
                try {
                  const content = await fs.readFile(fullPath, 'utf-8');
                  apis.push(...提取API信息(content, fullPath));
                } catch { /* 跳过无法读取的文件 */ }
              } else if (entry.isDirectory()) {
                await 扫描目录(fullPath, depth + 1);
              }
            }
          };
          await 扫描目录(source);
        }

        // 获取模板
        const tpl = DOC_TEMPLATES[template || type] || DOC_TEMPLATES[type];

        const result = {
          action: 'doc_generate',
          type,
          source,
          format,
          extractedInfo: {
            totalAPIs: apis.length,
            routes: apis.filter(a => a.method && a.path),
            functions: apis.filter(a => a.type === 'function'),
            classes: apis.filter(a => a.type === 'class')
          },
          apis: apis.slice(0, 100),
          template: tpl ? { name: tpl.name, sections: tpl.sections } : null,
          hint: '请基于提取的信息和模板，生成完整的文档内容'
        };

        // 如果指定了输出路径，生成文档
        if (output && tpl) {
          result.outputPath = output;
          result.hint += `，然后使用 code_create_file 写入 ${output}`;
        }

        return text(result);
      } catch (e) {
        return text({ action: 'doc_generate', error: e.message });
      }
    }

    // ===== doc_sync_check =====
    case 'doc_sync_check': {
      const { source, docs, since = '7 days ago', cwd = process.cwd() } = args;

      try {
        // 获取最近变更的代码文件
        const { stdout } = await execFileAsync('git', ['diff', '--name-only', since, '--', source], { cwd, maxBuffer: 10 * 1024 * 1024 });
        const changedFiles = stdout.trim().split('\n').filter(f => f.trim());

        // 检查文档目录
        const docFiles = [];
        try {
          const docEntries = await fs.readdir(docs, { withFileTypes: true });
          for (const entry of docEntries) {
            if (entry.isFile() && /\.(md|rst|txt|html)$/.test(entry.name)) {
              const stat = await fs.stat(path.join(docs, entry.name));
              docFiles.push({
                name: entry.name,
                path: path.join(docs, entry.name),
                lastModified: stat.mtime.toISOString()
              });
            }
          }
        } catch { /* 文档目录可能不存在 */ }

        const outOfSync = [];
        for (const changedFile of changedFiles) {
          const baseName = path.basename(changedFile, path.extname(changedFile));
          const hasMatchingDoc = docFiles.some(df => df.name.toLowerCase().includes(baseName.toLowerCase()));
          if (!hasMatchingDoc) {
            outOfSync.push({
              sourceFile: changedFile,
              status: 'missing_doc',
              suggestion: `代码文件 ${changedFile} 变更但未找到对应的文档`
            });
          }
        }

        return text({
          action: 'doc_sync_check',
          source, docs, since,
          changedFiles: changedFiles.length,
          docFiles: docFiles.length,
          outOfSyncCount: outOfSync.length,
          outOfSync: outOfSync.slice(0, 50),
          syncScore: docFiles.length > 0 ? Math.max(0, 100 - outOfSync.length * 10) : 0
        });
      } catch (e) {
        return text({ action: 'doc_sync_check', error: e.message });
      }
    }

    // ===== doc_sync_fix =====
    case 'doc_sync_fix': {
      const { source, docs, syncItems = [], cwd = process.cwd() } = args;

      const fixes = (syncItems.length > 0 ? syncItems : [{ file: 'auto-detect', changes: 'all out-of-sync items' }])
        .map(item => ({
          file: item.file,
          changes: item.changes,
          action: '建议使用 code_edit 或 code_create_file 更新/创建对应的文档文件'
        }));

      return text({
        action: 'doc_sync_fix',
        source, docs,
        totalFixes: fixes.length,
        fixes,
        hint: '请根据以上同步建议，使用 code_edit/code_create_file 更新文档'
      });
    }

    // ===== doc_template =====
    case 'doc_template': {
      const { action: tplAction, name: tplName, variables = {} } = args;

      switch (tplAction) {
        case 'list':
          return text({
            action: 'doc_template',
            templates: Object.entries(DOC_TEMPLATES).map(([key, tpl]) => ({
              id: key,
              name: tpl.name,
              sections: tpl.sections
            }))
          });

        case 'get': {
          const tpl = DOC_TEMPLATES[tplName];
          if (!tpl) return text({ error: `模板不存在: ${tplName}`, available: Object.keys(DOC_TEMPLATES) });
          return text({
            action: 'doc_template',
            name: tpl.name,
            sections: tpl.sections,
            format: tpl.format
          });
        }

        case 'apply': {
          const tpl = DOC_TEMPLATES[tplName];
          if (!tpl) return text({ error: `模板不存在: ${tplName}` });

          let content = tpl.format;
          for (const [key, value] of Object.entries(variables)) {
            content = content.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
          }

          return text({
            action: 'doc_template',
            name: tpl.name,
            appliedContent: content,
            hint: '请补充剩余的模板变量，然后使用 code_create_file 写入文档'
          });
        }

        default:
          return text({ error: `未知操作: ${tplAction}` });
      }
    }

    // ===== doc_search_semantic =====
    case 'doc_search_semantic': {
      const { query, topK = 5, threshold = 0.3 } = args;

      // 尝试调用Git记忆进行搜索
      try {
        const Git记忆 = await import('../../../tools/Git存储/记忆仓库.js');
        if (Git记忆.搜索记忆) {
          const results = await Git记忆.搜索记忆({ 查询: query, 返回数量: topK });
          return text({
            action: 'doc_search_semantic',
            query, topK, threshold,
            results: results?.data || [],
            hint: '基于关键词搜索结果，可使用 code_read_file 读取完整文档内容'
          });
        }
      } catch (e) { logger.warn(`Git记忆不可用: ${e.message}`); }

      return text({ error: 'Git记忆不可用，无法执行搜索' });
    }

    default:
      return null; // 不认识的工具返回 null，让其他扩展处理
  }
}
