/**
 * @file 精简工具执行-文件操作
 * @description KISS 精简工具 - 文件读写、目录列表、搜索
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync, rmdirSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('精简工具-文件操作', { 前缀: '[精简工具-文件操作]', 级别: 'debug' });

/** 安全解析路径 */
export function safePath(inputPath) {
  return resolve(inputPath);
}

export async function 读文件(args) {
  const p = safePath(args.path);
  if (!existsSync(p)) throw new Error(`文件不存在: ${p}`);
  const raw = readFileSync(p, 'utf-8');
  const allLines = raw.split('\n');
  const total = allLines.length;

  const start = args.start_line ? Math.max(1, args.start_line) - 1 : 0;
  const end = args.end_line ? Math.min(total, args.end_line) : total;
  const slice = allLines.slice(start, end);

  const maxLines = args.max_lines || 2000;
  const limited = slice.slice(0, maxLines);
  const truncated = slice.length > maxLines;

  const numbered = limited.map((line, i) => `${start + i + 1}\t${line}`).join('\n');
  const header = args.start_line
    ? `${p} (共 ${total} 行, 显示 ${start + 1}-${start + limited.length}):`
    : `${p} (共 ${total} 行):`;
  const footer = truncated ? `\n... 已截断，剩余 ${slice.length - maxLines} 行未显示` : '';
  return `${header}\n${numbered}${footer}`;
}

export async function 写文件(args) {
  const p = safePath(args.path);
  writeFileSync(p, args.content, 'utf-8');
  return `已写入: ${p} (${args.content.length} 字符)`;
}

export async function 编辑文件(args) {
  const p = safePath(args.path);
  if (!existsSync(p)) throw new Error(`文件不存在: ${p}`);

  const content = readFileSync(p, 'utf-8');
  const occurrences = content.split(args.old_string).length - 1;

  if (occurrences === 0) {
    const preview = content.substring(0, 200);
    throw new Error(`未找到匹配文本。请先用 read_file 确认文件当前内容，确保 old_string 与文件完全一致（包括缩进和空白）。\n文件开头预览:\n${preview}`);
  }
  if (!args.replace_all && occurrences > 1) {
    throw new Error(`找到 ${occurrences} 处匹配，old_string 不唯一。请包含更多上下文行使其唯一，或设置 replace_all: true`);
  }

  const newContent = args.replace_all
    ? content.replaceAll(args.old_string, args.new_string)
    : content.replace(args.old_string, args.new_string);

  writeFileSync(p, newContent, 'utf-8');

  const removed = args.old_string.split('\n').length;
  const added = args.new_string.split('\n').length;
  return `已编辑: ${p} (替换 ${occurrences} 处, -${removed} +${added} 行)`;
}

export async function 列目录(args) {
  const p = safePath(args.path);
  if (!existsSync(p)) throw new Error(`目录不存在: ${p}`);
  const entries = readdirSync(p, { withFileTypes: true });
  return entries.map(e => {
    const type = e.isDirectory() ? '[目录]' : e.isFile() ? '[文件]' : '[其他]';
    return `${type} ${e.name}`;
  }).join('\n');
}

export async function 删文件(args) {
  const p = safePath(args.path);
  if (!existsSync(p)) throw new Error(`不存在: ${p}`);
  const s = statSync(p);
  if (s.isDirectory()) {
    rmdirSync(p);
    return `已删除目录: ${p}`;
  } else {
    unlinkSync(p);
    return `已删除文件: ${p}`;
  }
}

export async function 搜文件(args) {
  const dir = args.directory ? safePath(args.directory) : process.cwd();
  const files = _globSearch(dir, args.pattern);
  return files.slice(0, 200).join('\n') || '未找到匹配文件';
}

/** 简单 glob 搜索 */
function _globSearch(baseDir, pattern) {
  const results = [];
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*\//g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/<<<GLOBSTAR>>>/g, '(.*/)?')
    .replace(/\?/g, '.');
  const regex = new RegExp('^' + regexStr + '$', 'i');

  function walk(dir, depth) {
    if (depth > 20) return;
    if (!existsSync(dir)) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const full = join(dir, e.name);
        const rel = relative(baseDir, full).replace(/\\/g, '/');
        if (e.isFile() && regex.test(rel)) {
          results.push(rel);
        }
        if (e.isDirectory()) {
          walk(full, depth + 1);
        }
      }
    } catch (_) { logger.debug(`目录遍历跳过 (权限不足): ${dir}`); }
  }
  walk(baseDir, 0);
  return results;
}

export async function 正则搜代码(args) {
  const dirPath = args.path ? safePath(args.path) : process.cwd();
  const results = [];
  const matchedFiles = new Set();
  const context = args.context || 0;
  const filesOnly = args.files_only || false;
  let regex;
  try {
    const flags = args.ignore_case ? 'gi' : 'g';
    regex = new RegExp(args.regex, flags);
  } catch (e) {
    return `正则表达式无效: ${e.message}`;
  }

  function searchFile(filePath) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const rel = relative(dirPath, filePath);
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          matchedFiles.add(rel);
          if (filesOnly) continue;
          if (context > 0) {
            const from = Math.max(0, i - context);
            const to = Math.min(lines.length - 1, i + context);
            results.push(`--- ${rel}:${i + 1} ---`);
            for (let j = from; j <= to; j++) {
              const marker = j === i ? '>' : ' ';
              results.push(`${marker} ${j + 1}\t${lines[j].substring(0, 300)}`);
            }
          } else {
            results.push(`${rel}:${i + 1}: ${lines[i].trim().substring(0, 200)}`);
          }
          if (results.length >= 200) return;
        }
      }
    } catch (_) { /* 跳过二进制/不可读文件 */ }
  }

  function walk(dir, depth) {
    if (depth > 20) return;
    if (!existsSync(dir)) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) { walk(full, depth + 1); continue; }
        if (args.glob) {
          const globRe = new RegExp(args.glob.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.'));
          if (!globRe.test(e.name)) continue;
        }
        searchFile(full);
        if (!filesOnly && results.length >= 200) return;
        if (filesOnly && matchedFiles.size >= 200) return;
      }
    } catch (_) { /* 目录遍历跳过 */ }
  }

  if (existsSync(dirPath) && statSync(dirPath).isFile()) {
    searchFile(dirPath);
  } else {
    walk(dirPath, 0);
  }

  if (filesOnly) {
    const fileList = [...matchedFiles];
    return fileList.length > 0
      ? `匹配 ${fileList.length} 个文件:\n${fileList.slice(0, 200).join('\n')}`
      : '无匹配文件';
  }
  return results.slice(0, 200).join('\n') || '无匹配';
}

// ==================== list_definitions ====================

const 定义模式 = [
  { regex: /^export\s+(default\s+)?(async\s+)?function\s+([\w一-鿿]+)/, type: 'function' },
  { regex: /^export\s+(default\s+)?class\s+([\w一-鿿]+)/,              type: 'class' },
  { regex: /^export\s+(default\s+)?(const|let|var)\s+([\w一-鿿]+)/,    type: 'variable' },
  { regex: /^(async\s+)?function\s+([\w一-鿿]+)/,                      type: 'function' },
  { regex: /^class\s+([\w一-鿿]+)/,                                    type: 'class' },
  { regex: /^(const|let|var)\s+([\w一-鿿]+)\s*=/,                      type: 'variable' },
  { regex: /^export\s*\{([^}]+)\}/,                                            type: 'export' },
  { regex: /^export\s+default\s+/,                                             type: 'export-default' },
  { regex: /^module\.exports\s*=/,                                              type: 'export' },
  // Python
  { regex: /^def\s+([\w一-鿿]+)\s*\(/,                                type: 'function' },
  { regex: /^class\s+([\w一-鿿]+)[\s:(]/,                             type: 'class' },
  // Go
  { regex: /^func\s+([\w一-鿿]+)/,                                    type: 'function' },
  { regex: /^type\s+([\w一-鿿]+)\s+struct/,                            type: 'struct' },
  { regex: /^type\s+([\w一-鿿]+)\s+interface/,                          type: 'interface' },
];

export async function 提取定义(args) {
  const p = safePath(args.path);
  if (!existsSync(p)) throw new Error(`文件不存在: ${p}`);
  const content = readFileSync(p, 'utf-8');
  const lines = content.split('\n');
  const defs = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(' ') || line.startsWith('\t')) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const { regex, type } of 定义模式) {
      const m = trimmed.match(regex);
      if (m) {
        const name = type === 'export'
          ? `{ ${m[1].trim()} }`
          : type === 'export-default'
            ? 'default'
            : m[m.length - 1] || m[1] || '';
        defs.push(`${i + 1}\t[${type}] ${name}`);
        break;
      }
    }
  }

  return defs.length > 0
    ? `${p} (${lines.length} 行, ${defs.length} 个定义):\n${defs.join('\n')}`
    : `${p} (${lines.length} 行): 未检测到顶层定义`;
}

// ==================== directory_tree ====================

export async function 目录树(args) {
  const p = safePath(args.path);
  if (!existsSync(p)) throw new Error(`目录不存在: ${p}`);
  const maxDepth = args.depth || 3;
  const showFiles = args.show_files !== false;
  const lines = [];
  let count = 0;
  const MAX_ENTRIES = 500;

  function walk(dir, prefix, depth) {
    if (depth > maxDepth || count >= MAX_ENTRIES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch { return; }

    entries = entries.filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist');
    const dirs = entries.filter(e => e.isDirectory());
    const files = showFiles ? entries.filter(e => e.isFile()) : [];
    const all = [...dirs, ...files];

    for (let i = 0; i < all.length && count < MAX_ENTRIES; i++) {
      const e = all[i];
      const isLast = i === all.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const icon = e.isDirectory() ? '📁 ' : '';
      lines.push(`${prefix}${connector}${icon}${e.name}`);
      count++;
      if (e.isDirectory()) {
        const nextPrefix = prefix + (isLast ? '    ' : '│   ');
        walk(join(dir, e.name), nextPrefix, depth + 1);
      }
    }
  }

  lines.push(p.split(/[/\\]/).pop() + '/');
  walk(p, '', 1);

  const footer = count >= MAX_ENTRIES ? `\n... 已达上限 ${MAX_ENTRIES} 条` : '';
  return lines.join('\n') + footer;
}

// ==================== batch_read ====================

export async function 批量读文件(args) {
  const paths = (args.paths || []).slice(0, 10);
  if (paths.length === 0) throw new Error('paths 不能为空');
  const maxLines = args.max_lines_per_file || 200;
  const results = [];

  for (const filePath of paths) {
    const p = safePath(filePath);
    if (!existsSync(p)) {
      results.push(`=== ${p} ===\n[文件不存在]`);
      continue;
    }
    const content = readFileSync(p, 'utf-8');
    const lines = content.split('\n');
    const limited = lines.slice(0, maxLines);
    const numbered = limited.map((line, i) => `${i + 1}\t${line}`).join('\n');
    const truncNote = lines.length > maxLines ? `\n... 剩余 ${lines.length - maxLines} 行未显示` : '';
    results.push(`=== ${p} (${lines.length} 行) ===\n${numbered}${truncNote}`);
  }

  return results.join('\n\n');
}

// ==================== find_and_replace ====================

export async function 多文件替换(args) {
  const dir = args.directory ? safePath(args.directory) : process.cwd();
  const dryRun = args.dry_run !== false;
  let search;
  if (args.is_regex) {
    try { search = new RegExp(args.search, 'g'); } catch (e) { throw new Error(`正则无效: ${e.message}`); }
  } else {
    search = args.search;
  }

  const changes = [];
  let fileCount = 0;

  function walk(d, depth) {
    if (depth > 20 || changes.length >= 200) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = join(d, e.name);
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      if (args.glob) {
        const globRe = new RegExp(args.glob.replace(/\./g, '\\.').replace(/\{([^}]+)\}/g, '($1)').replace(/,/g, '|').replace(/\*/g, '.*').replace(/\?/g, '.'));
        if (!globRe.test(e.name)) continue;
      }
      try {
        const content = readFileSync(full, 'utf-8');
        const lines = content.split('\n');
        let modified = false;
        const rel = relative(dir, full);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          let newLine;
          if (args.is_regex) {
            search.lastIndex = 0;
            if (search.test(line)) {
              search.lastIndex = 0;
              newLine = line.replace(search, args.replace);
            }
          } else if (line.includes(search)) {
            newLine = line.replaceAll(search, args.replace);
          }
          if (newLine !== undefined && newLine !== line) {
            changes.push(`${rel}:${i + 1}: ${line.trim().substring(0, 80)} → ${newLine.trim().substring(0, 80)}`);
            lines[i] = newLine;
            modified = true;
          }
        }
        if (modified) {
          fileCount++;
          if (!dryRun) {
            writeFileSync(full, lines.join('\n'), 'utf-8');
          }
        }
      } catch { /* 跳过不可读文件 */ }
      if (changes.length >= 200) return;
    }
  }

  walk(dir, 0);

  if (changes.length === 0) return '未找到匹配项';
  const mode = dryRun ? '[预览模式 - 未实际修改]' : `[已修改 ${fileCount} 个文件]`;
  return `${mode}\n共 ${changes.length} 处替换:\n${changes.join('\n')}`;
}
