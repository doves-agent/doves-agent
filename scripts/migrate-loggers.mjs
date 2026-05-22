#!/usr/bin/env node
/**
 * 批量迁移扩展包文件中的手动logger对象到创建日志器
 * 用法: node 白鸽系统/scripts/migrate-loggers.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOVES_ROOT = resolve(__dirname, '..');

const FILES_TO_MIGRATE = [
  'doves/extensions/代码审查/execution.js',
  'doves/extensions/代码审查/tools/审查工具.js',
  'doves/extensions/MongoDB/tools/MongoDB工具.js',
  'doves/extensions/MongoDB/skills/query_analyzer/index.js',
  'doves/extensions/MongoDB/skills/data_migration/index.js',
  'doves/extensions/MongoDB/skills/index_advisor/index.js',
  'doves/extensions/进度管理/execution.js',
  'doves/extensions/进度管理/tools/进度工具.js',
  'doves/extensions/进度管理/skills/zentao/index.js',
  'doves/extensions/进度管理/skills/jira/index.js',
  'doves/extensions/进度管理/skills/weekly_report/index.js',
  'doves/extensions/进度管理/skills/progress_sync/index.js',
  'doves/extensions/MySQL/skills/data_migration/index.js',
  'doves/extensions/MySQL/skills/query_analyzer/index.js',
  'doves/extensions/MySQL/skills/index_advisor/index.js',
  'doves/extensions/MySQL/skills/backup_restore/index.js',
  'doves/extensions/Git版本控制/tools/高级Git工具.js',
  'doves/extensions/Git版本控制/skills/pr_manager/index.js',
  'doves/extensions/Git版本控制/skills/git_analysis/helpers.js',
  'doves/extensions/Git版本控制/skills/conflict_resolver/index.js',
  'doves/extensions/分身/skills/persona_chat/index.js',
  'doves/extensions/分身/skills/auto_reply/index.js',
  'doves/extensions/分身/skills/style_learning/index.js',
  'doves/extensions/分身/skills/chat_import/index.js',
  'doves/extensions/分身/tools/分身工具.js',
  'doves/extensions/文档/execution.js',
  'doves/extensions/文档/skills/doc_sync/index.js',
  'doves/extensions/文档/skills/changelog/index.js',
  'doves/extensions/文档/skills/api_doc/index.js',
  'doves/extensions/文档/tools/文档工具.js',
  'doves/extensions/数据分析/skills/report_generator/index.js',
  'doves/extensions/数据分析/skills/query_builder/index.js',
  'doves/extensions/数据分析/tools/数据工具.js',
  'doves/extensions/词阵对弈/services/game-server.js',
  'doves/extensions/词阵对弈/execution.js',
  'doves/extensions/词阵对弈/tools/index.js',
  'doves/extensions/编码/tools/LSP客户端.js',
  'doves/extensions/编码/skills/code_execute/index.js',
  'doves/extensions/元素拆解/manifest.js',
  'doves/extensions/背单词/manifest.js',
  'doves/extensions/背单词/data/colors.js',
  'doves/extensions/背单词/skills/vocabulary_review/index.js',
  'doves/tools/GUI自动化工具/依赖.js',
  'doves/tools/文档转图片.js',
  'doves/tools/存储索引.js',
];

function getImportPath(filePath) {
  const fileDir = dirname(filePath);
  const commonDir = resolve(DOVES_ROOT, 'doves/common');
  let rel = relative(resolve(DOVES_ROOT, fileDir), commonDir).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel + '/日志管理器.js';
}

function extractLoggerInfo(content) {
  const m = content.match(/info:\s*\(\.\.\.args\)\s*=>\s*console\.log\(\s*[\x27`\[]\[?([^\]'\x27`]+)/);
  if (m) return { name: m[1].trim(), prefix: `[${m[1].trim()}]` };
  return null;
}

function replaceManualLogger(content, importPath, name, prefix) {
  // Simple approach: find the logger object block and replace it
  // Match: const logger = { ... };  (multiline, greedy until closing };)
  const loggerBlockRe = /(?:\/\/[^\n]*\n)*const\s+logger\s*=\s*\{[^}]*\};?/s;
  const match = content.match(loggerBlockRe);
  if (!match) return null;

  const extractedName = name || 'unknown';
  const loggerPrefix = prefix || `[${extractedName}]`;

  const hasExistingImport = content.includes('创建日志器');
  let replacement;
  if (hasExistingImport) {
    replacement = `const logger = 创建日志器('${extractedName}', { 前缀: '${loggerPrefix}', 级别: 'debug', 显示调用位置: true });`;
  } else {
    replacement = `import { 创建日志器 } from '${importPath}';\n\nconst logger = 创建日志器('${extractedName}', { 前缀: '${loggerPrefix}', 级别: 'debug', 显示调用位置: true });`;
  }

  return content.replace(loggerBlockRe, replacement);
}

let migrated = 0, skipped = 0, failed = 0;

for (const relPath of FILES_TO_MIGRATE) {
  const absPath = resolve(DOVES_ROOT, relPath);
  const importPath = getImportPath(relPath);

  try {
    const content = readFileSync(absPath, 'utf-8');

    if (content.includes('创建日志器')) {
      console.log(`SKIP (already migrated): ${relPath}`);
      skipped++;
      continue;
    }

    const info = extractLoggerInfo(content);
    const newContent = replaceManualLogger(content, importPath, info?.name, info?.prefix);

    if (newContent) {
      writeFileSync(absPath, newContent, 'utf-8');
      console.log(`OK: ${relPath} (${info?.name || '?'})`);
      migrated++;
    } else {
      console.log(`NO MATCH: ${relPath}`);
      failed++;
    }
  } catch (e) {
    console.log(`ERROR: ${relPath}: ${e.message}`);
    failed++;
  }
}

console.log(`\nResults: ${migrated} migrated, ${skipped} skipped, ${failed} failed`);
