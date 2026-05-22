/**
 * 代码执行技能
 * 
 * 支持 JavaScript 安全执行：
 * - 表达式求值
 * - 函数定义和调用
 * - 异步代码执行（Promise/async-await）
 * - 安全沙箱，禁止访问危险 API
 * 
 * 迁移自 skills/code/execute/index.js
 */

// ============================================================================
// 日志器
// ============================================================================

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('code/execute', { 前缀: '[code/execute]', 级别: 'debug', 显示调用位置: true });

// ============================================================================
// 安全配置
// ============================================================================

// 禁止访问的全局对象和属性
const BLOCKED_GLOBALS = [
  'require', 'import', 'process', 'global',
  '__dirname', '__filename', 'exports', 'module',
  'fetch', 'XMLHttpRequest', 'WebSocket',
  'child_process', 'fs', 'net', 'http', 'https',
  'crypto', 'os', 'path', 'stream', 'buffer',
  'eval', 'Function'
];

// 允许的数学和工具函数
const SAFE_GLOBALS = {
  // 数学
  Math,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  Number,
  String,
  Boolean,
  Array,
  Object,
  Map,
  Set,
  Date,
  JSON,
  RegExp,
  Error,
  TypeError,
  RangeError,
  SyntaxError,
  // Promise 和异步
  Promise,
  // 控制台（安全输出）
  console: {
    log: (...args) => args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
    error: (...args) => args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
    warn: (...args) => args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
    info: (...args) => args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
    table: (data) => JSON.stringify(data)
  },
  // 定时器（异步场景）
  setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5000)),
  setInterval: (fn, ms) => setInterval(fn, Math.min(ms, 1000)),
  clearTimeout,
  clearInterval
};

// ============================================================================
// 安全执行
// ============================================================================

function safeExecute(code, language = 'javascript', timeout = 10000) {
  if (language.toLowerCase() !== 'javascript' && language.toLowerCase() !== 'js') {
    return {
      success: false,
      error: `不支持的语言: ${language}，目前仅支持 JavaScript`
    };
  }

  // 安全检查：禁止使用危险 API
  for (const blocked of BLOCKED_GLOBALS) {
    const identifierPattern = new RegExp(`\\b${blocked}\\b`, 'g');
    const matches = code.match(identifierPattern);
    if (matches) {
      const codeWithoutCommentsAndStrings = code
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/'[^']*'/g, '""')
        .replace(/"[^"]*"/g, '""')
        .replace(/`[^`]*`/g, '""');
      const realMatches = codeWithoutCommentsAndStrings.match(identifierPattern);
      if (realMatches) {
        return {
          success: false,
          error: `安全限制：禁止使用 ${blocked}`
        };
      }
    }
  }

  // 收集 console.log 输出
  const outputs = [];
  const mockConsole = {
    log: (...args) => outputs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')),
    error: (...args) => outputs.push('[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')),
    warn: (...args) => outputs.push('[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')),
    info: (...args) => outputs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')),
    table: (data) => outputs.push(JSON.stringify(data, null, 2))
  };

  try {
    const sandboxKeys = Object.keys(SAFE_GLOBALS);
    const sandboxValues = Object.values(SAFE_GLOBALS).map(v => {
      if (v === console) return mockConsole;
      return v;
    });

    let isExpression = false;
    let wrappedCode = code;
    
    try {
      new Function(`"use strict"; return (${code})`);
      isExpression = true;
    } catch {
      isExpression = false;
    }

    if (isExpression) {
      wrappedCode = `"use strict"; return (${code})`;
    } else {
      wrappedCode = `"use strict"; ${code}`;
    }

    const sandboxFn = new Function(...sandboxKeys, wrappedCode);

    let result;
    let timedOut = false;
    
    const timeoutId = setTimeout(() => { timedOut = true; }, timeout);
    
    try {
      result = sandboxFn(...sandboxValues);
      
      if (result && typeof result.then === 'function') {
        result = Promise.race([
          result,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('异步执行超时')), timeout)
          )
        ]);
      }
    } finally {
      clearTimeout(timeoutId);
    }

    if (timedOut) {
      return {
        success: false,
        error: `执行超时（${timeout}ms）`
      };
    }

    if (result instanceof Promise) {
      return result.then(
        (resolvedValue) => ({
          success: true,
          output: outputs.join('\n'),
          result: typeof resolvedValue === 'object' ? JSON.stringify(resolvedValue, null, 2) : String(resolvedValue),
          returnValue: resolvedValue
        })
      ).catch(err => ({
        success: false,
        output: outputs.join('\n'),
        error: `执行错误: ${err.message}`
      }));
    }

    return {
      success: true,
      output: outputs.join('\n'),
      result: typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result),
      returnValue: result
    };

  } catch (error) {
    return {
      success: false,
      output: outputs.join('\n'),
      error: `执行错误: ${error.message}`,
      errorType: error.constructor.name
    };
  }
}

// ============================================================================
// 主执行函数
// ============================================================================

async function execute(args, context) {
  const {
    code,
    language = 'javascript',
    timeout = 10000,
    action = 'execute'
  } = args;

  logger.info(`执行: ${action}, language: ${language}`);

  try {
    switch (action) {
      case 'execute':
      case 'run': {
        if (!code) {
          return { 成功: false, 错误: '缺少必填参数: code' };
        }
        const result = await safeExecute(code, language, timeout);
        if (!result.success) {
          return { 成功: false, 错误: result.error };
        }
        return {
          成功: true,
          数据: {
            output: result.output || '',
            result: result.result || '',
            language
          }
        };
      }

      case 'eval':
      case 'evaluate': {
        if (!code) {
          return { 成功: false, 错误: '缺少必填参数: code' };
        }
        const evalCode = `return (${code})`;
        const result = await safeExecute(evalCode, language, timeout);
        if (!result.success) {
          return { 成功: false, 错误: result.error };
        }
        return {
          成功: true,
          数据: {
            result: result.result || '',
            language
          }
        };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return {
      成功: false,
      错误: error.message
    };
  }
}

// ============================================================================
// 导出
// ============================================================================

export default {
  name: 'code_execute',
  description: '代码执行技能 - 安全执行 JavaScript 代码，支持表达式求值和函数执行',
  
  abilities: ['编程', 'python', 'javascript', '代码执行', '计算'],
  
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['execute', 'run', 'eval', 'evaluate'],
        default: 'execute',
        description: '操作类型：execute/run(执行代码)、eval/evaluate(表达式求值)'
      },
      code: {
        type: 'string',
        description: '要执行的 JavaScript 代码'
      },
      language: {
        type: 'string',
        enum: ['javascript', 'js'],
        default: 'javascript',
        description: '编程语言（目前仅支持 JavaScript）'
      },
      timeout: {
        type: 'integer',
        default: 10000,
        description: '执行超时时间（毫秒），默认10秒'
      }
    },
    required: ['code']
  },
  
  execute
};
