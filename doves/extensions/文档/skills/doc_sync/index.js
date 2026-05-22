/**
 * 文档同步技能
 * 检测代码变更(git diff) → 关联文档 → 生成同步建议
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('doc_sync', { 前缀: '[doc_sync]', 级别: 'debug', 显示调用位置: true });

async function runGit(args, cwd = process.cwd()) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    throw new Error(`git ${args.join(' ')} 失败: ${e.message}`);
  }
}

/**
 * 推断代码文件对应的文档文件
 */
function 推断文档路径(codeFile, docsDir) {
  const baseName = codeFile.replace(/\.[^.]+$/, '');
  const fileName = baseName.split('/').pop();

  // 常见映射规则
  const patterns = [
    `${docsDir}/${fileName}.md`,
    `${docsDir}/${fileName}_doc.md`,
    `${docsDir}/api/${fileName}.md`,
    `${docsDir}/${fileName}.md`,
    `${docsDir}/README.md`,
  ];

  return patterns;
}

async function execute(args, context) {
  const { action = 'check', source = '.', docs = '../白鸽文档', since = '7 days ago', cwd = process.cwd() } = args;

  logger.info(`执行: ${action}, source: ${source}, docs: ${docs}`);

  try {
    switch (action) {

      case 'check': {
        // 获取最近变更的代码文件
        const changedFilesOutput = await runGit(['diff', '--name-only', since, '--', source], cwd);
        const changedFiles = changedFilesOutput.trim().split('\n').filter(f => f.trim());

        // 过滤出代码文件
        const codeFiles = changedFiles.filter(f => /\.(js|ts|jsx|tsx|py|go|java|rb|php)$/.test(f));

        const syncItems = [];
        for (const codeFile of codeFiles) {
          const docPaths = 推断文档路径(codeFile, docs);
          syncItems.push({
            codeFile,
            possibleDocPaths: docPaths,
            needsUpdate: true,
            suggestion: `代码文件 ${codeFile} 有变更，请检查相关文档是否需要更新`
          });
        }

        return {
          成功: true,
          数据: {
            since,
            totalChanges: codeFiles.length,
            syncItems,
            summary: {
              needsDocUpdate: syncItems.length,
              upToDate: 0
            }
          }
        };
      }

      case 'generate_fixes': {
        // 生成文档同步修复建议
        const { syncItems = [] } = args;
        const fixes = syncItems.map(item => ({
          codeFile: item.codeFile || item,
          action: 'update_or_create_doc',
          suggestion: `基于 ${item.codeFile || item} 的变更，更新对应的文档文件`
        }));

        return {
          成功: true,
          数据: {
            totalFixes: fixes.length,
            fixes
          }
        };
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
  name: 'doc_sync',
  description: '文档同步技能 — 检测代码变更，关联文档，生成同步建议',
  abilities: ['文档管理'],
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['check', 'generate_fixes'], description: '操作类型' },
      source: { type: 'string', description: '代码目录（默认.）' },
      docs: { type: 'string', description: '文档目录（默认../白鸽文档）' },
      since: { type: 'string', description: '检查起始时间（默认7 days ago）' },
      syncItems: { type: 'array', description: '需要同步的项目（generate_fixes使用）' },
      cwd: { type: 'string', description: '工作目录' }
    },
    required: ['action']
  },
  execute
};
