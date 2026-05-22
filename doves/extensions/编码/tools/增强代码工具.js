/**
 * @file tools/增强代码工具
 * @description 实用增强工具集 - 文件删除、问题检查、后台终端执行
 * 
 * 注册工具：
 *   - code_delete_file       : 安全删除文件/目录
 *   - code_check_problems    : 检查编译/语法问题（LSP诊断）
 *   - code_terminal_run      : 后台执行命令（异步，支持标准输入）
 *   - code_terminal_output   : 获取后台命令的输出
 * 
 * 导出格式（兼容扩展加载器）：
 *   extTools / handleExtTool / extToolCategories / extToolAbilityMap / extToolSafetyLevels
 */

import { spawn } from 'child_process';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('增强代码工具', { 前缀: '[增强代码]', 级别: 'debug' });
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, relative, dirname } from 'path';
import { globalLSPManager } from './LSP客户端.js';

// ==============================
// 后台终端管理器
// ==============================

/**
 * 后台进程管理
 * 维护所有通过 code_terminal_run 启动的后台命令
 */
const _backgroundProcesses = new Map();
let _nextProcessId = 1;

// ==============================
// 工具定义
// ==============================

export const extTools = [
  {
    name: 'code_delete_file',
    description: '安全删除文件或空目录。仅在项目工作区内允许操作，会检查文件是否被 git 管理。支持单个文件或空目录。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要删除的文件或目录路径（必填）' },
        recursive: { type: 'boolean', description: '是否递归删除目录（默认false，仅对目录有效）' },
        force: { type: 'boolean', description: '是否忽略 git 跟踪检查（默认false）' },
      },
      required: ['path']
    }
  },
  {
    name: 'code_check_problems',
    description: '检查指定文件的编译/语法问题。使用 LSP 诊断获取所有错误和警告。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（必填）' },
        checkLevel: { type: 'string', enum: ['error', 'warning', 'all'], description: '检查级别（默认all）' },
      },
      required: ['path']
    }
  },
  {
    name: 'code_terminal_run',
    description: '在后台执行 shell 命令，返回进程 ID 和初始输出。可通过 code_terminal_output 获取后续输出。适合场景：运行测试（npm test）、编译（npm run build）、安装依赖（npm install）、启动服务。注意：会立刻返回，长时间运行的命令需要通过 code_terminal_output 轮询进度。与 执行命令 区别：code_terminal_run 是后台异步执行，执行命令 是前台同步等待。',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令（必填），例如 "npm test"、"python -m pytest"、"go build ./..."' },
        cwd: { type: 'string', description: '工作目录（默认当前工作目录）' },
        timeout: { type: 'number', description: '超时时间（毫秒，默认60000，最长300000）' },
        env: { type: 'object', description: '额外环境变量（可选，和原有环境变量合并）' },
      },
      required: ['command']
    }
  },
  {
    name: 'code_terminal_output',
    description: '获取后台命令的累积输出（不会清空缓冲区）。和 code_terminal_run 配合使用。适合场景：执行完 code_terminal_run 后，调用此工具获取持续输出；或轮询长时间运行命令的进度。使用步骤：(1) code_terminal_run → 得到 processId；(2) code_terminal_output({ processId }) → 获取输出。',
    inputSchema: {
      type: 'object',
      properties: {
        processId: { type: 'string', description: '进程 ID（来自 code_terminal_run 返回的 processId，必填）' },
      },
      required: ['processId']
    }
  },
];

// ==============================
// 辅助函数
// ==============================

const text = (obj) => ({
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }]
});

const error = (msg) => text({ error: msg });

/**
 * 检查路径是否在项目工作区内（防止越权删除）
 */
function isInsideProject(filePath) {
  const resolved = resolve(filePath);
  const cwd = resolve(process.cwd());
  const rel = relative(cwd, resolved);
  return !rel.startsWith('..') && !rel.startsWith('/..') && !rel.startsWith('\\..');
}

/**
 * 检测文件是否被 git 跟踪
 */
async function isGitTracked(filePath) {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('git', ['ls-files', '--error-unmatch', filePath], { cwd: process.cwd() });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * 检测项目根目录的语言类型，用于选择检查工具
 */
function detectCheckTool(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const base = filePath.split(/[\\/]/).pop().toLowerCase();
  
  // JS/TS - 优先 tsc/eslint
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext) || base === 'eslintrc') {
    return { linter: 'eslint', args: ['--no-eslintrc', '--format', 'json'] };
  }
  if (['ts', 'tsx', 'mts', 'cts'].includes(ext)) {
    return { linter: 'eslint', args: ['--ext', `.${ext}`, '--format', 'json'] };
  }
  // Python
  if (['py'].includes(ext)) {
    return { linter: 'pylint', args: ['--output-format', 'json'] };
  }
  return null;
}

/**
 * 运行外部检查工具并解析结果
 */
async function runLinter(filePath, linterName, linterArgs) {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    
    const { stdout } = await execFileAsync(linterName, [...linterArgs, filePath], { 
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024 
    }).catch(() => ({ stdout: '' }));
    
    if (!stdout.trim()) return [];

    const problems = [];
    try {
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) {
        // ESLint JSON 格式
        for (const fileResult of parsed) {
          if (fileResult.messages) {
            for (const msg of fileResult.messages) {
              problems.push({
                message: msg.message,
                severity: msg.severity === 2 ? 'error' : 'warning',
                line: msg.line || 0,
                column: msg.column || 0,
                source: 'eslint',
                ruleId: msg.ruleId || '',
              });
            }
          }
        }
      }
    } catch {
      // 非 JSON 格式，尝试按行解析
    }

    return problems;
  } catch {
    return [];
  }
}

// ==============================
// 工具调用处理器
// ==============================

export async function handleExtTool(name, args) {
  try {
    switch (name) {

      // ===== 1. 安全删除文件 =====
      case 'code_delete_file': {
        const { path: filePath, recursive = false, force = false } = args;
        const resolvedPath = resolve(filePath);

        // 安全检查：必须在项目工作区内
        if (!isInsideProject(resolvedPath)) {
          return error(`安全限制：只能删除项目工作区内的文件（${resolvedPath} 不在工作区内）`);
        }

        // 检查路径是否存在
        if (!existsSync(resolvedPath)) {
          return error(`文件/目录不存在: ${resolvedPath}`);
        }

        // 检查 git 跟踪（除非 force）
        if (!force) {
          try {
            const tracked = await isGitTracked(resolvedPath);
            if (tracked) {
              return error(`文件被 git 跟踪，请使用 git rm 或设置 force=true（注意：这会永久删除文件）`);
            }
          } catch {
            // 不在 git 仓库中，跳过检查
          }
        }

        try {
          const stat = await fs.stat(resolvedPath);
          if (stat.isDirectory()) {
            if (!recursive) {
              // 检查目录是否为空
              const contents = await fs.readdir(resolvedPath);
              if (contents.length > 0) {
                return error(`目录不为空，如需递归删除请设置 recursive=true`);
              }
            }
            await fs.rm(resolvedPath, { recursive, force: true });
          } else {
            await fs.unlink(resolvedPath);
          }

          return text({
            tool: 'code_delete_file',
            success: true,
            path: resolvedPath,
            type: stat.isDirectory() ? 'directory' : 'file',
            recursive: stat.isDirectory() ? recursive : undefined,
          });
        } catch (e) {
          return error(`删除失败: ${e.message}`);
        }
      }

      // ===== 2. 检查编译/语法问题 =====
      case 'code_check_problems': {
        const { path: filePath, checkLevel = 'all' } = args;
        const resolvedPath = resolve(filePath);

        if (!existsSync(resolvedPath)) {
          return error(`文件不存在: ${resolvedPath}`);
        }

        const problems = [];

        // 优先使用 LSP 诊断
        try {
          const lspProblems = await globalLSPManager.getDiagnostics(resolvedPath);
          for (const p of lspProblems) {
            problems.push({
              message: p.message,
              severity: p.severity === 1 ? 'error' : p.severity === 2 ? 'warning' : 'info',
              line: p.range.start.line,
              column: p.range.start.character,
              source: p.source || 'lsp',
              code: p.code || '',
            });
          }
        } catch (e) {
          logger.warn(`LSP 诊断失败: ${e.message}`);
          throw e;
        }

        // 按级别过滤
        let filtered = problems;
        if (checkLevel === 'error') {
          filtered = problems.filter(p => p.severity === 'error');
        } else if (checkLevel === 'warning') {
          filtered = problems.filter(p => p.severity === 'warning' || p.severity === 'error');
        }

        const errors = filtered.filter(p => p.severity === 'error');
        const warnings = filtered.filter(p => p.severity === 'warning');
        const infos = filtered.filter(p => p.severity === 'info');

        return text({
          tool: 'code_check_problems',
          path: resolvedPath,
          total: filtered.length,
          errorCount: errors.length,
          warningCount: warnings.length,
          infoCount: infos.length,
          errors,
          warnings,
          infos,
          // 简短摘要
          summary: filtered.length === 0
            ? '未发现问题'
            : `发现 ${errors.length} 个错误, ${warnings.length} 个警告, ${infos.length} 个信息`,
        });
      }

      // ===== 3. 后台执行命令 =====
      case 'code_terminal_run': {
        const { command, cwd, timeout = 60000, env = {} } = args;

        if (!command || typeof command !== 'string') {
          return error('缺少必填参数: command');
        }

        const processId = `term_${_nextProcessId++}`;
        const workDir = cwd ? resolve(cwd) : process.cwd();
        const isWin = process.platform === 'win32';
        const shell = isWin ? process.env.COMSPEC || 'cmd.exe' : '/bin/sh';
        const shellArg = isWin ? '/c' : '-c';

        const procEntry = {
          id: processId,
          command,
          cwd: workDir,
          startTime: Date.now(),
          stdout: '',
          stderr: '',
          running: true,
          exitCode: null,
          process: null,
        };

        return new Promise((resolvePromise) => {
          try {
            const child = spawn(shell, [shellArg, command], {
              cwd: workDir,
              env: { ...process.env, ...env },
              stdio: ['pipe', 'pipe', 'pipe'],
              // 不使用 shell 选项，避免双 shell 嵌套
            });

            procEntry.process = child;

            child.stdout.on('data', (data) => {
              procEntry.stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
              procEntry.stderr += data.toString();
            });

            child.on('error', (err) => {
              procEntry.running = false;
              procEntry.exitCode = -1;
              procEntry.stderr += `\n[进程错误] ${err.message}`;
            });

            child.on('close', (code) => {
              procEntry.running = false;
              procEntry.exitCode = code;
            });

            // 超时处理
            const timer = setTimeout(() => {
              if (procEntry.running) {
                try { child.kill(); } catch (e) { logger.debug(`终止子进程失败: ${e.message}`); }
                procEntry.running = false;
                procEntry.exitCode = -1;
                procEntry.stderr += '\n[超时] 命令执行超过限制时间';
              }
            }, timeout);

            // 存储引用
            _backgroundProcesses.set(processId, procEntry);

            // 先等一小段时间获取初始输出
            setTimeout(() => {
              clearTimeout(timer);
              resolvePromise(text({
                tool: 'code_terminal_run',
                processId,
                command,
                cwd: workDir,
                running: procEntry.running,
                exitCode: procEntry.exitCode,
                stdout: procEntry.stdout,
                stderr: procEntry.stderr,
                _tip: '使用 code_terminal_output 获取后续输出',
              }));
            }, 300);

          } catch (e) {
            resolvePromise(error(`启动命令失败: ${e.message}`));
          }
        });
      }

      // ===== 4. 获取后台命令输出 =====
      case 'code_terminal_output': {
        const { processId } = args;

        if (!processId) {
          return error('缺少必填参数: processId');
        }

        const procEntry = _backgroundProcesses.get(processId);
        if (!procEntry) {
          return error(`进程 ${processId} 不存在或已过期`);
        }

        return text({
          tool: 'code_terminal_output',
          processId,
          command: procEntry.command,
          running: procEntry.running,
          exitCode: procEntry.exitCode,
          stdout: procEntry.stdout,
          stderr: procEntry.stderr,
          elapsed: Date.now() - procEntry.startTime,
        });
      }

      default:
        return null; /* 不处理此工具，交给链中下一个处理器 */
    }
  } catch (e) {
    return error(`[${name}] ${e.message}`);
  }
}

// ==============================
// 工具分类
// ==============================

export const extToolCategories = {
  代码工具: ['code_delete_file', 'code_check_problems', 'code_terminal_run', 'code_terminal_output'],
};

// ==============================
// 工具能力映射
// ==============================

export const extToolAbilityMap = {
  code_delete_file: ['编程', '代码', '文件操作', '删除'],
  code_check_problems: ['编程', '代码', '调试', '检查', '分析'],
  code_terminal_run: ['编程', '代码', '执行', '命令', '构建'],
  code_terminal_output: ['编程', '代码', '执行', '监控', '日志'],
};

// ==============================
// 工具安全分级
// ==============================

export const extToolSafetyLevels = {
  code_delete_file: '危险',
  code_check_problems: '安全',
  code_terminal_run: '危险',
  code_terminal_output: '安全',
};

// ==============================
// 默认导出
// ==============================
export default {
  extTools,
  handleExtTool,
  extToolCategories,
  extToolAbilityMap,
  extToolSafetyLevels,
};
