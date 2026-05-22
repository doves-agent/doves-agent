/**
 * @file tools/代码工具
 * @description 代码读取、搜索、编辑、文件创建与 Git 操作等工具
 */

import fs from 'fs/promises';
import fsc from 'fs';
import path from 'path';
import { EXCLUDED_DIRS, text, isExcludedDir, matchGlob, readDirRecursive, searchInDirectory, findFiles, extractSymbols } from './代码工具/代码搜索工具.js';
import { parseGitStatus, parseGitLog, classifyChange, parseGitBlame, parseNumstat } from './代码工具/Git解析工具.js';
import { handleGitTool } from './代码工具/Git操作.js';

// ========== 工具定义 ==========
export const codeTools = [
  {
    name: '代码读取',
    description: '读取文件内容，支持按行号范围截取。大文件可只返回指定范围行。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（必填）' },
        start_line: { type: 'number', description: '起始行号（从1开始，可选）' },
        end_line: { type: 'number', description: '结束行号（含，可选）' }
      },
      required: ['path']
    }
  },
  {
    name: '代码搜索',
    description: '递归搜索目录中的文件内容（正则匹配）。自动排除 node_modules/.git/dist 等目录。',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '正则表达式模式（必填）' },
        path: { type: 'string', description: '搜索目录（默认当前工作目录）' },
        context_lines: { type: 'number', description: '上下文行数（默认2）' },
        max_results: { type: 'number', description: '最大匹配数（默认50）' },
        glob: { type: 'string', description: '文件类型过滤，如 "*.js"（可选）' }
      },
      required: ['pattern']
    }
  },
  {
    name: '文件搜索',
    description: '按 glob 模式查找文件路径（支持 * 和 ** 通配符）。排除 node_modules/.git 等。',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'glob 模式，如 "**/*.js"（必填）' },
        path: { type: 'string', description: '搜索目录（默认当前工作目录）' },
        max_results: { type: 'number', description: '最大结果数（默认100）' }
      },
      required: ['pattern']
    }
  },
  {
    name: '目录列表',
    description: '列出目录结构，可递归展示。排除 node_modules/.git/dist 等目录。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径（必填）' },
        recursive: { type: 'boolean', description: '是否递归列出子目录（默认false）' },
        max_depth: { type: 'number', description: '递归最大深度（默认3）' }
      },
      required: ['path']
    }
  },
  {
    name: '符号分析',
    description: '提取文件中的符号定义（函数、类、变量、导出）。用正则匹配实现。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（必填）' },
        type: { type: 'string', enum: ['function', 'class', 'variable', 'export', 'all'], description: '符号类型过滤（默认all）' }
      },
      required: ['path']
    }
  },
  {
    name: '代码编辑',
    description: '精准文本替换：读取文件 → 按顺序执行多处替换 → 写回。如果某处 original 未找到则中断报错。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（必填）' },
        replacements: {
          type: 'array',
          description: '替换数组，每项含 original 和 replacement 字符串，可选 replace_all 布尔值（必填）',
          items: {
            type: 'object',
            properties: {
              original: { type: 'string', description: '要替换的原始文本' },
              replacement: { type: 'string', description: '替换后的文本' },
              replace_all: { type: 'boolean', description: '是否替换所有匹配（默认false）' }
            },
            required: ['original', 'replacement']
          }
        }
      },
      required: ['path', 'replacements']
    }
  },
  {
    name: '代码创建',
    description: '创建文件，自动创建中间目录。如文件已存在且 overwrite=false 则报错。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（必填）' },
        content: { type: 'string', description: '文件内容（必填）' },
        overwrite: { type: 'boolean', description: '是否覆盖已有文件（默认false）' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'Git操作',
    description: '执行 Git 操作：status/diff/log/add/commit/branch/show。通过 git 命令行实现，返回结构化 JSON。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'diff', 'log', 'add', 'commit', 'branch', 'show'], description: 'Git 操作类型（必填）' },
        args: {
          type: 'object',
          description: '附加参数（根据 action 不同而不同）',
          properties: {
            file: { type: 'string', description: '文件路径（diff/log 可选）' },
            staged: { type: 'boolean', description: '是否查看暂存区（diff 可选）' },
            count: { type: 'number', description: '提交数量（log，默认10）' },
            files: { type: 'array', items: { type: 'string' }, description: '要 add 的文件列表' },
            message: { type: 'string', description: '提交信息（commit 必填）' },
            name: { type: 'string', description: '分支名（branch 可选，不填则列出分支）' },
            ref: { type: 'string', description: 'Git 引用（show，默认HEAD）' }
          }
        }
      },
      required: ['action']
    }
  },
  {
    name: 'Git差异',
    description: '解析指定提交（或两个 ref 之间）的差异，返回结构化数据 + 自动分类变更类型。',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: '要分析的提交 hash 或 ref（默认 HEAD）' },
        base: { type: 'string', description: '比较基准（不填则与上一个提交比较）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: []
    }
  },
  {
    name: 'Git溯源',
    description: '对文件的指定行范围进行 git blame，返回每行的最后修改者和提交信息。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（必填）' },
        start_line: { type: 'number', description: '起始行' },
        end_line: { type: 'number', description: '结束行' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['path']
    }
  },
  {
    name: 'Git文件历史',
    description: '获取指定文件的变更历史，包括每次提交的修改摘要。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（必填）' },
        count: { type: 'number', description: '返回条数（默认 20）' },
        show_diff: { type: 'boolean', description: '是否包含每次的 diff 摘要（默认 false）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['path']
    }
  },
  {
    name: 'Git对比',
    description: '比较两个分支/tag/commit 之间的差异概览。',
    inputSchema: {
      type: 'object',
      properties: {
        base: { type: 'string', description: '基准 ref（必填）' },
        target: { type: 'string', description: '目标 ref（必填）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['base', 'target']
    }
  },
  {
    name: 'Git统计',
    description: '仓库级别统计分析——热点文件、贡献者排名、提交频率、最近活跃度。',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '统计最近多少天（默认 30）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: []
    }
  },
  {
    name: 'Git搜索',
    description: '搜索提交（按消息或内容变更）。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词（必填）' },
        search_type: { type: 'string', enum: ['message', 'content'], description: '搜索类型（默认 message）' },
        count: { type: 'number', description: '返回条数（默认 20）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['query']
    }
  }
];

// ========== 工具处理函数 ==========
export async function handleCodeTool(name, args) {
  // Git 相关操作委托给子模块
  if (name.startsWith('Git')) {
    return handleGitTool(name, args);
  }

  switch (name) {

    // ===== 1. 读取文件 =====
    case '代码读取': {
      const filePath = path.resolve(args.path);
      let content;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch (err) {
        return text({ error: `读取文件失败: ${err.message}`, path: filePath });
      }

      const lines = content.split('\n');
      const totalLines = lines.length;
      const startLine = args.start_line || 1;
      const endLine = args.end_line || totalLines;

      // 行号范围截取
      const selectedLines = lines.slice(startLine - 1, endLine);
      const result = {
        path: filePath,
        total_lines: totalLines,
        returned_range: { start: startLine, end: Math.min(endLine, totalLines) },
        content: selectedLines.join('\n')
      };

      return text(result);
    }

    // ===== 2. 代码搜索 =====
    case '代码搜索': {
      const searchPath = path.resolve(args.path || process.cwd());
      let regex;
      try {
        regex = new RegExp(args.pattern, 'i');
      } catch (err) {
        return text({ error: `正则表达式无效: ${err.message}` });
      }

      const contextLines = args.context_lines ?? 2;
      const maxResults = args.max_results ?? 50;
      const glob = args.glob || null;

      try {
        const matches = await searchInDirectory(searchPath, regex, { contextLines, maxResults, glob });
        return text({
          pattern: args.pattern,
          path: searchPath,
          total_matches: matches.length,
          matches
        });
      } catch (err) {
        return text({ error: `搜索失败: ${err.message}` });
      }
    }

    // ===== 3. 文件搜索 =====
    case '文件搜索': {
      const searchPath = path.resolve(args.path || process.cwd());
      const maxResults = args.max_results ?? 100;

      try {
        const files = await findFiles(searchPath, args.pattern, { maxResults });
        return text({
          pattern: args.pattern,
          path: searchPath,
          total_files: files.length,
          files
        });
      } catch (err) {
        return text({ error: `文件搜索失败: ${err.message}` });
      }
    }

    // ===== 4. 目录列表 =====
    case '目录列表': {
      const dirPath = path.resolve(args.path);
      const recursive = args.recursive ?? false;
      const maxDepth = args.max_depth ?? 3;

      // 检查目录是否存在
      try {
        const stat = await fs.stat(dirPath);
        if (!stat.isDirectory()) {
          return text({ error: '指定路径不是目录', path: dirPath });
        }
      } catch (err) {
        return text({ error: `目录不存在或无法访问: ${err.message}`, path: dirPath });
      }

      try {
        if (!recursive) {
          // 非递归：只列当前目录
          const entries = await fs.readdir(dirPath, { withFileTypes: true });
          const items = [];

          for (const entry of entries) {
            if (isExcludedDir(entry.name)) continue;
            const fullPath = path.join(dirPath, entry.name);
            let size = 0;
            try {
              size = (await fs.stat(fullPath)).size;
            } catch (e) {
              logger.debug(`获取文件大小失败: ${fullPath} | ${e.message}`);
            }
            items.push({
              name: entry.name,
              type: entry.isDirectory() ? 'dir' : 'file',
              path: fullPath,
              size
            });
          }

          return text({ path: dirPath, recursive: false, items });
        } else {
          // 递归：返回树形结构
          const allItems = await readDirRecursive(dirPath, maxDepth, 0);
          return text({ path: dirPath, recursive: true, max_depth: maxDepth, items: allItems });
        }
      } catch (err) {
        return text({ error: `列出目录失败: ${err.message}` });
      }
    }

    // ===== 5. 符号提取 =====
    case '符号分析': {
      const filePath = path.resolve(args.path);
      const type = args.type || 'all';

      let content;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch (err) {
        return text({ error: `读取文件失败: ${err.message}`, path: filePath });
      }

      const symbols = extractSymbols(content, type);
      return text({
        path: filePath,
        type_filter: type,
        total_symbols: symbols.length,
        symbols
      });
    }

    // ===== 6. 代码编辑 =====
    case '代码编辑': {
      const filePath = path.resolve(args.path);
      const replacements = args.replacements;

      if (!Array.isArray(replacements) || replacements.length === 0) {
        return text({ error: 'replacements 必须是非空数组' });
      }

      // 读取文件内容
      let content;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch (err) {
        return text({ error: `读取文件失败: ${err.message}`, path: filePath });
      }

      const appliedReplacements = [];

      // 按顺序执行替换
      for (let i = 0; i < replacements.length; i++) {
        const { original, replacement, replace_all = false } = replacements[i];

        if (!content.includes(original)) {
          return text({
            error: `第 ${i + 1} 个替换失败：未找到原始文本`,
            failed_index: i + 1,
            original_preview: original.substring(0, 200),
            applied_count: appliedReplacements.length,
            applied: appliedReplacements
          });
        }

        // 记录替换前的行号
        const beforeLines = content.split('\n');
        const startLine = beforeLines.findIndex(line => line.includes(original.split('\n')[0])) + 1;

        // 执行替换
        if (replace_all) {
          content = content.split(original).join(replacement);
        } else {
          content = content.replace(original, replacement);
        }

        const afterLines = content.split('\n');
        const endLine = Math.min(startLine + original.split('\n').length - 1, afterLines.length);

        appliedReplacements.push({
          index: i + 1,
          original_preview: original.substring(0, 100),
          replacement_preview: replacement.substring(0, 100),
          line_range: { start: startLine || '未知', end: endLine || '未知' }
        });
      }

      // 写回文件
      try {
        await fs.writeFile(filePath, content, 'utf-8');
      } catch (err) {
        return text({ error: `写回文件失败: ${err.message}`, path: filePath, applied: appliedReplacements });
      }

      return text({
        success: true,
        path: filePath,
        total_replacements: appliedReplacements.length,
        applied: appliedReplacements
      });
    }

    // ===== 7. 创建文件 =====
    case '代码创建': {
      const filePath = path.resolve(args.path);
      const content = args.content;
      const overwrite = args.overwrite ?? false;

      // 检查文件是否已存在
      const fileExists = fsc.existsSync(filePath);
      if (fileExists && !overwrite) {
        return text({ error: '文件已存在，如需覆盖请设置 overwrite=true', path: filePath });
      }

      // 自动创建中间目录
      const dirPath = path.dirname(filePath);
      try {
        await fs.mkdir(dirPath, { recursive: true });
      } catch (err) {
        return text({ error: `创建目录失败: ${err.message}`, path: dirPath });
      }

      // 写入文件
      try {
        await fs.writeFile(filePath, content, 'utf-8');
      } catch (err) {
        return text({ error: `写入文件失败: ${err.message}`, path: filePath });
      }

      const lineCount = content.split('\n').length;
      return text({
        success: true,
        path: filePath,
        lines: lineCount,
        overwritten: fileExists && overwrite
      });
    }

    default:
      return { content: [{ type: 'text', text: `Unknown code tool: ${name}` }], isError: true };
  }
}

// ========== 默认导出 ==========
export default {
  codeTools,
  handleCodeTool
};
