/**
 * 统一日志管理器
 * 
 * 功能：
 * ├── 同时输出到终端 (console) 和文件
 * ├── 支持日志级别：debug / info / warn / error
 * ├── 按日期自动轮转日志文件
 * ├── 错误日志独立文件，方便排查
 * ├── 统一日志目录：~/.dove/logs/<module>/
 * └── 支持 CLI dove log 命令查看
 * 
 * 使用方式：
 *   import { 创建日志器 } from '../common/日志管理器.js';
 *   const logger = 创建日志器('server');
 *   logger.info('服务启动');
 *   logger.error('连接失败', error);
 */

import { appendFile, mkdir, readdir, stat, unlink, readFile } from 'fs/promises';
import { existsSync, createReadStream, readdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { formatLocalTime } from './时间工具.js';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';

// ==================== 调用位置捕获（debug 模式下输出可点击的文件链接） ====================

/**
 * 捕获调用位置（文件:行号:列号）
 * 输出格式兼容 VS Code / Windows Terminal 点击跳转
 * 
 * @param {number} skipFrames - 跳过的栈帧数（跳过内部调用链）
 * @param {boolean} skipInternal - 是否跳过内部日志帧（日志管理器/终端输出管理器）
 * @param {boolean} force - 是否强制捕获（不受 DOVE_DEBUG 限制）
 * @returns {string|null} 格式如 "F:\\doves\\白鸽系统\\server\\index.js:354:8"
 */
export function 获取调用位置(skipFrames = 0, skipInternal = false, force = false) {
  if (!force && process.env.DOVE_DEBUG !== '1') return null;

  const origPrepare = Error.prepareStackTrace;
  Error.prepareStackTrace = (err, stack) => stack;
  const err = new Error();
  const stack = err.stack;
  Error.prepareStackTrace = origPrepare;

  // 内部文件特征（需跳过的日志基础设施帧）
  const 内部特征 = ['日志管理器', '终端输出管理器', 'display'];

  const startIdx = skipFrames;
  for (let i = startIdx; i < stack.length; i++) {
    const frame = stack[i];
    const rawFileName = frame.getFileName();
    if (!rawFileName) continue;

    // ESM 的 getFileName() 返回 URL 编码路径（中文变 %XX），需解码后再匹配
    const fileName = rawFileName.startsWith('file://')
      ? decodeURIComponent(rawFileName)
      : rawFileName;

    // 跳过内部日志帧
    if (skipInternal && 内部特征.some(k => fileName.includes(k))) {
      continue;
    }

    const lineNumber = frame.getLineNumber();
    const columnNumber = frame.getColumnNumber();
    if (!lineNumber) continue;

    let filePath;
    try {
      filePath = rawFileName.startsWith('file://') ? fileURLToPath(rawFileName) : rawFileName;
    } catch (e) {
      console.error('[日志管理器] fileURLToPath 失败，使用手动路径转换:', e.message);
      // fileURLToPath 失败时手动转换
      filePath = rawFileName.replace(/^file:\/\//, '');
      // Windows: /F:/path → F:/path
      if (process.platform === 'win32' && filePath.startsWith('/') && filePath.length > 2 && filePath.charAt(2) === ':') {
        filePath = filePath.substring(1);
      }
    }

    return `${filePath}:${lineNumber}:${columnNumber}`;
  }
  return null;
}

// ==================== 日志级别 ====================

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

// ==================== 日志管理器类 ====================

class 日志管理器 {
  /**
   * @param {string} 模块名 - 模块标识，如 'server'、'doves'、'llm'
   * @param {Object} 选项 - 配置选项
   * @param {string} [选项.日志根目录] - 日志根目录，默认 ~/.dove/logs
   * @param {string} [选项.级别] - 最低输出级别，默认 'info'
   * @param {number} [选项.保留天数] - 日志保留天数，默认 30
   * @param {boolean} [选项.终端输出] - 是否输出到终端，默认 true
   * @param {boolean} [选项.文件输出] - 是否输出到文件，默认 true
   * @param {string} [选项.前缀] - 终端输出的前缀标识
   * @param {boolean} [选项.显示调用位置] - 是否始终显示代码定位（不受 DOVE_DEBUG 限制），默认 false
   */
  constructor(模块名, 选项 = {}) {
    this.模块名 = 模块名;
    this.日志根目录 = 选项.日志根目录 || join(homedir(), '.dove', 'logs');
    this.模块日志目录 = join(this.日志根目录, 模块名);
    this.级别 = 选项.级别 || (process.env.LOG_LEVEL || 'info');
    this.保留天数 = 选项.保留天数 || parseInt(process.env.LOG_KEEP_DAYS) || 30;
    this.终端输出 = 选项.终端输出 !== false;
    this.文件输出 = 选项.文件输出 !== false;
    this.前缀 = 选项.前缀 || `[${模块名.charAt(0).toUpperCase() + 模块名.slice(1)}]`;
    this.显示调用位置 = 选项.显示调用位置 || false;
    
    // 缓冲：避免高频写入时每次都 await mkdir
    this._目录就绪 = false;
    this._清理定时器 = null;
    
    // 启动时异步确保目录存在，并清理旧日志
    this._初始化目录();
    
    // 每6小时清理一次旧日志
    this._清理定时器 = setInterval(() => this._清理旧日志(), 6 * 60 * 60 * 1000);
    // 不阻止进程退出
    if (this._清理定时器.unref) this._清理定时器.unref();
  }

  /**
   * 异步初始化日志目录
   */
  async _初始化目录() {
    try {
      if (!existsSync(this.模块日志目录)) {
        await mkdir(this.模块日志目录, { recursive: true });
      }
      this._目录就绪 = true;
      // 启动时清理一次
      this._清理旧日志();
    } catch (e) {
      // 目录创建失败，无法写入日志文件
      console.error(`[日志管理器] 创建日志目录失败: ${e.message}`);
      this.文件输出 = false;
    }
  }

  /**
   * 确保目录存在后再写文件
   */
  async _确保目录() {
    if (!this._目录就绪) {
      await this._初始化目录();
    }
  }

  /**
   * 获取当前日志文件路径
   */
  _获取日志文件路径() {
    const 日期 = formatLocalTime(new Date(), 'date');
    return join(this.模块日志目录, `${this.模块名}.log`);
  }

  /**
   * 获取错误日志文件路径
   */
  _获取错误日志文件路径() {
    return join(this.模块日志目录, `${this.模块名}-error.log`);
  }

  /**
   * 获取按日期归档的日志文件名
   */
  _获取归档文件路径(日期) {
    return join(this.模块日志目录, `${this.模块名}.${日期}.log`);
  }

  /**
   * 格式化日志行
   */
  _格式化日志行(级别, args) {
    const 时间 = formatLocalTime(new Date(), 'log');
    const 级别标签 = 级别.toUpperCase().padEnd(5);
    const 内容 = args.map(a => {
      if (a instanceof Error) {
        return a.stack || a.message;
      }
      if (typeof a === 'object' && a !== null) {
        try { return JSON.stringify(a); } catch (e) { console.error('[日志管理器] JSON 序列化日志内容失败:', e.message); return String(a); }
      }
      return String(a);
    }).join(' ');
    return `${时间} ${级别标签} ${内容}\n`;
  }

  /**
   * 格式化终端输出
   * 当 DOVE_DEBUG=1 且终端输出管理器未激活时，附带调用位置
   * 当 显示调用位置=true 时，始终附带调用位置（不受 DOVE_DEBUG 限制）
   */
  _格式化终端输出(级别, args) {
    const 时间 = formatLocalTime(new Date(), 'log');
    // 终端级别标签：复制文本后也能分辨日志类型（颜色信息会丢失）
    const 级别标签 = { debug: 'DBG', info: 'INFO', warn: 'WARN', error: 'ERR!' }[级别] || 'INFO';
    const parts = [`${this.前缀} ${级别标签} ${时间}`];

    // 判断是否需要附带调用位置
    const 需要调用位置 = this.显示调用位置 ||
      (process.env.DOVE_DEBUG === '1' && !globalThis.__DOVE_终端输出已安装);

    if (需要调用位置) {
      // force=this.显示调用位置: 强制模式不受 DOVE_DEBUG 限制
      const 位置 = 获取调用位置(0, true, this.显示调用位置);
      if (位置) parts.push(位置);
    }

    return [...parts, ...args];
  }

  /**
   * 核心日志方法
   */
  async _写日志(级别, args) {
    // 级别过滤
    if (LOG_LEVELS[级别] < LOG_LEVELS[this.级别]) return;

    // 终端输出（同步）
    if (this.终端输出) {
      const 终端参数 = this._格式化终端输出(级别, args);
      switch (级别) {
        case 'error': console.error(...终端参数); break;
        case 'warn': console.warn(...终端参数); break;
        case 'debug': console.log(...终端参数); break;
        default: console.log(...终端参数); break;
      }
    }

    // 文件输出（异步，不阻塞主流程）
    if (this.文件输出) {
      const 日志行 = this._格式化日志行(级别, args);
      this._写入文件(日志行, 级别 === 'error');
    }
  }

  /**
   * 异步写入文件（fire-and-forget，出错不影响主流程）
   */
  async _写入文件(内容, 是错误 = false) {
    try {
      await this._确保目录();
      
      // 写入主日志文件
      const 主日志路径 = this._获取日志文件路径();
      await appendFile(主日志路径, 内容, 'utf-8');
      
      // 如果是错误，同时写入错误日志文件
      if (是错误) {
        const 错误日志路径 = this._获取错误日志文件路径();
        await appendFile(错误日志路径, 内容, 'utf-8');
      }
    } catch (e) {
      // 文件写入失败不阻塞主流程
      // 只在首次失败时打印一次警告
      if (!this._写入失败已警告) {
        console.error(`[日志管理器] 文件写入失败: ${e.message}`);
        this._写入失败已警告 = true;
      }
    }
  }

  /**
   * 清理超过保留天数的旧日志
   */
  async _清理旧日志() {
    if (!this.文件输出 || !existsSync(this.模块日志目录)) return;

    try {
      const 文件列表 = await readdir(this.模块日志目录);
      const 截止时间 = Date.now() - this.保留天数 * 24 * 60 * 60 * 1000;

      for (const 文件名 of 文件列表) {
        // 只清理带日期的归档日志（格式：模块名.YYYY-MM-DD.log）
        if (!/\.\d{4}-\d{2}-\d{2}\.log$/.test(文件名)) continue;

        const 文件路径 = join(this.模块日志目录, 文件名);
        try {
          const 文件状态 = await stat(文件路径);
          if (文件状态.mtimeMs < 截止时间) {
            await unlink(文件路径);
          }
        } catch (e) {
          // 单个文件清理失败，跳过
          console.warn(`[日志管理器] 清理日志文件失败: ${文件名}`, e.message);
        }
      }
    } catch (e) {
      console.warn(`[日志管理器] 清理旧日志失败:`, e.message);
    }
  }

  /**
   * 归档当前日志文件（按日期重命名）
   * 在日期变更时调用
   */
  async 归档日志() {
    if (!this.文件输出) return;

    try {
      const 当前日志路径 = this._获取日志文件路径();
      if (!existsSync(当前日志路径)) return;

      const 文件状态 = await stat(当前日志路径);
      const 修改日期 = formatLocalTime(new Date(文件状态.mtimeMs), 'date');
      const 今天 = formatLocalTime(new Date(), 'date');

      // 如果日志文件不是今天的，归档
      if (修改日期 !== 今天) {
        const 归档路径 = this._获取归档文件路径(修改日期);
        const { rename } = await import('fs/promises');
        await rename(当前日志路径, 归档路径);
      }
    } catch (e) {
      // 归档失败不影响主流程，但必须打印错误
      console.error(`[日志管理器] 归档日志失败: ${e.message}`);
    }
  }

  // ==================== 公共 API ====================

  info(...args) { this._写日志('info', args); }
  warn(...args) { this._写日志('warn', args); }
  error(...args) { this._写日志('error', args); }
  debug(...args) { this._写日志('debug', args); }

  /**
   * 关闭日志管理器
   */
  关闭() {
    if (this._清理定时器) {
      clearInterval(this._清理定时器);
      this._清理定时器 = null;
    }
  }
}

// ==================== 日志器实例缓存 ====================

const 日志器缓存 = new Map();

/**
 * 创建或获取日志器实例（单例模式）
 * 
 * @param {string} 模块名 - 模块标识
 * @param {Object} 选项 - 配置选项（仅首次创建时生效）
 * @returns {日志管理器}
 */
export function 创建日志器(模块名, 选项 = {}) {
  if (日志器缓存.has(模块名)) {
    return 日志器缓存.get(模块名);
  }
  const 实例 = new 日志管理器(模块名, 选项);
  日志器缓存.set(模块名, 实例);
  return 实例;
}

/**
 * 获取所有已注册的日志器
 */
export function 获取所有日志器() {
  return Array.from(日志器缓存.keys());
}

// ==================== 日志读取 API（供 CLI dove log 使用） ====================

/**
 * 获取指定模块的日志文件路径列表
 * 
 * @param {string} 模块名 - 模块标识
 * @param {Object} 选项 - 选项
 * @param {string} [选项.日志根目录] - 日志根目录
 * @param {boolean} [选项.仅错误] - 仅错误日志
 * @returns {string[]} 日志文件路径列表
 */
export function 获取日志文件列表(模块名, 选项 = {}) {
  const 日志根目录 = 选项.日志根目录 || join(homedir(), '.dove', 'logs');
  const 模块日志目录 = join(日志根目录, 模块名);
  
  if (!existsSync(模块日志目录)) return [];

  const 前缀 = 选项.仅错误 ? `${模块名}-error` : 模块名;
  
  try {
    const 文件列表 = readdirSync(模块日志目录)
      .filter(f => f.startsWith(前缀) && f.endsWith('.log'))
      .sort()
      .reverse(); // 最新的在前
    return 文件列表.map(f => join(模块日志目录, f));
  } catch (e) {
    console.error(`[日志管理器] 列出日志文件失败 (${模块名}):`, e.message);
    return [];
  }
}

/**
 * 读取日志文件的最后N行
 * 
 * @param {string} 文件路径 - 日志文件路径
 * @param {number} 行数 - 读取行数
 * @returns {Promise<string[]>} 日志行数组
 */
export async function 读取日志尾部(文件路径, 行数 = 100) {
  if (!existsSync(文件路径)) return [];

  return new Promise((resolve) => {
    const 行列表 = [];
    const 流 = createReadStream(文件路径, { encoding: 'utf-8' });
    const 读取器 = createInterface({ input: 流 });

    读取器.on('line', (行) => {
      行列表.push(行);
      if (行列表.length > 行数 * 2) {
        // 保留尾部行数的2倍缓冲，避免内存过大
        行列表.splice(0, 行列表.length - 行数);
      }
    });

    读取器.on('close', () => {
      resolve(行列表.slice(-行数));
    });

    读取器.on('error', (err) => {
      console.error(`[日志管理器] 读取日志尾部失败 (${文件路径}):`, err.message);
      resolve([]);
    });
  });
}

/**
 * 实时跟踪日志文件（类似 tail -f）
 * 
 * @param {string} 文件路径 - 日志文件路径
 * @param {Function} 回调 - 每行日志的回调函数
 * @returns {Object} 包含 stop() 方法的控制器
 */
export function 跟踪日志文件(文件路径, 回调) {
  const 流 = createReadStream(文件路径, { encoding: 'utf-8' });
  const 读取器 = createInterface({ input: 流 });
  
  读取器.on('line', 回调);
  
  return {
    停止() {
      读取器.close();
      流.destroy();
    }
  };
}

/**
 * 获取所有可用日志模块
 * 
 * @param {string} [日志根目录] - 日志根目录
 * @returns {string[]} 模块名列表
 */
export function 获取日志模块列表(日志根目录) {
  const 根目录 = 日志根目录 || join(homedir(), '.dove', 'logs');
  if (!existsSync(根目录)) return [];

  try {
    return readdirSync(根目录)
      .filter(f => statSync(join(根目录, f)).isDirectory());
  } catch (e) {
    console.error('[日志管理器] 列出日志模块失败:', e.message);
    return [];
  }
}

/**
 * 获取日志概览信息
 * 
 * @param {string} [日志根目录] - 日志根目录
 * @returns {Promise<Object>} 概览信息
 */
export async function 获取日志概览(日志根目录) {
  const 根目录 = 日志根目录 || join(homedir(), '.dove', 'logs');
  
  if (!existsSync(根目录)) {
    return { 存在: false, 模块: [] };
  }

  const 模块列表 = [];
  
  try {
    const 目录列表 = readdirSync(根目录);
    
    for (const 目录名 of 目录列表) {
      const 目录路径 = join(根目录, 目录名);
      if (!statSync(目录路径).isDirectory()) continue;
      
      const 文件列表 = readdirSync(目录路径).filter(f => f.endsWith('.log'));
      let 总大小 = 0;
      let 最新时间 = 0;
      
      for (const 文件名 of 文件列表) {
        const 文件路径 = join(目录路径, 文件名);
        try {
          const 文件状态 = statSync(文件路径);
          总大小 += 文件状态.size;
          if (文件状态.mtimeMs > 最新时间) 最新时间 = 文件状态.mtimeMs;
        } catch (e) {
          console.error(`[日志管理器] 读取文件状态失败 (${文件名}):`, e.message);
        }
      }
      
      模块列表.push({
        模块名: 目录名,
        文件数: 文件列表.length,
        总大小MB: (总大小 / 1024 / 1024).toFixed(2),
        最新时间: 最新时间 ? formatLocalTime(new Date(最新时间), 'datetime') : '-'
      });
    }
  } catch (e) {
    console.error('[日志管理器] 获取日志概览失败:', e.message);
  }
  
  return { 存在: true, 模块: 模块列表 };
}

/**
 * 清理指定天数的旧日志
 * 
 * @param {number} 天数 - 保留天数
 * @param {string} [日志根目录] - 日志根目录
 * @returns {Promise<number>} 清理的文件数
 */
export async function 清理旧日志(天数 = 30, 日志根目录) {
  const 根目录 = 日志根目录 || join(homedir(), '.dove', 'logs');
  if (!existsSync(根目录)) return 0;

  const 截止时间 = Date.now() - 天数 * 24 * 60 * 60 * 1000;
  let 清理数 = 0;

  try {
    const 目录列表 = readdirSync(根目录);
    
    for (const 目录名 of 目录列表) {
      const 目录路径 = join(根目录, 目录名);
      if (!statSync(目录路径).isDirectory()) continue;
      
      const 文件列表 = readdirSync(目录路径);
      for (const 文件名 of 文件列表) {
        // 只清理带日期的归档日志
        if (!/\.\d{4}-\d{2}-\d{2}\.log$/.test(文件名)) continue;
        
        const 文件路径 = join(目录路径, 文件名);
        try {
          const 文件状态 = statSync(文件路径);
          if (文件状态.mtimeMs < 截止时间) {
            unlinkSync(文件路径);
            清理数++;
          }
        } catch (e) {
          console.error(`[日志管理器] 清理日志文件失败 (${文件名}):`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('[日志管理器] 清理旧日志失败:', e.message);
  }

  return 清理数;
}

// 默认导出
export default {
  创建日志器,
  获取所有日志器,
  获取日志文件列表,
  读取日志尾部,
  跟踪日志文件,
  获取日志模块列表,
  获取日志概览,
  清理旧日志
};
