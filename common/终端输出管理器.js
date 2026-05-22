/**
 * @file common/终端输出管理器
 * @description 拦截 console 输出到缓冲区，避免并发日志冲散流式进度条
 * - 进度条活跃时：普通日志暂存，进度条在同一行 \r 刷新
 * - 进度条完成后：输出暂存日志，再输出完成行
 * - 同时写入日志文件 (~/.dove/logs/doves/)
 * 
 * 使用方式：
 *   import { 终端输出 } from './终端输出管理器.js';
 *   终端输出.安装();  // 在入口最前面调用，拦截 console
 */

import { 创建日志器, 获取调用位置 } from './日志管理器.js';
import { formatLocalTime } from './时间工具.js';

/**
 * 获取终端宽度
 */
function getTerminalWidth() {
  return process.stdout.columns || 120;
}

/**
 * 清除当前行并回到行首（兼容 Windows）
 */
function clearLine() {
  process.stdout.write('\r\x1b[K');
}

class 终端输出管理器 {
  constructor() {
    this.缓冲 = [];
    this.当前进度行 = null;
    this.当前进度ID = null;
    this.活跃进度条 = new Map();
    this.循环定时器 = null;
    this.已安装 = false;
    this.原始console = {};
    this.输出间隔 = 50;
    this.正在刷新 = false;
    this.上次进度更新 = 0;
    this.进度更新间隔 = 100;
    this.进度行已显示 = false;
    this._文件日志器 = null;
    this._log拦截 = this._log拦截.bind(this);
    this._warn拦截 = this._warn拦截.bind(this);
    this._error拦截 = this._error拦截.bind(this);
  }

  安装() {
    if (this.已安装) return;
    this.已安装 = true;
    // 标记终端输出管理器已激活，供日志管理器判断是否需要自行添加调用位置
    globalThis.__DOVE_终端输出已安装 = true;
    this._文件日志器 = 创建日志器('doves', {
      前缀: '[Doves]',
      终端输出: false
    });
    this.原始console = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };
    console.log = this._log拦截;
    console.warn = this._warn拦截;
    console.error = this._error拦截;
    this.启动输出循环();
  }

  卸载() {
    if (!this.已安装) return;
    this.已安装 = false;
    this._刷新输出();
    if (this.循环定时器) {
      clearInterval(this.循环定时器);
      this.循环定时器 = null;
    }
    console.log = this.原始console.log;
    console.warn = this.原始console.warn;
    console.error = this.原始console.error;
  }

  更新进度(内容, 进度ID = null) {
    const now = Date.now();
    if (now - this.上次进度更新 < this.进度更新间隔) {
      this.当前进度行 = 内容;
      return;
    }
    this.上次进度更新 = now;
    if (进度ID) {
      this.活跃进度条.set(进度ID, { 内容, 开始时间: Date.now() });
      this.当前进度ID = 进度ID;
    }
    this.当前进度行 = 内容;
    this.进度行已显示 = true;
    this._刷新输出();
  }

  清除进度(进度ID = null) {
    if (进度ID) {
      this.活跃进度条.delete(进度ID);
    }
    if (进度ID && this.当前进度ID === 进度ID) {
      const nextEntry = this.活跃进度条.entries().next().value;
      if (nextEntry) {
        const [nextId, nextData] = nextEntry;
        this.当前进度ID = nextId;
        this.当前进度行 = nextData.内容;
      } else {
        this.当前进度ID = null;
        this.当前进度行 = null;
      }
    } else if (!进度ID) {
      this.当前进度行 = null;
      this.当前进度ID = null;
      this.活跃进度条.clear();
    }
    if (this.进度行已显示 && this.当前进度行 === null) {
      clearLine();
      this._刷新输出();
      this.进度行已显示 = false;
    } else {
      this._刷新输出();
    }
  }

  _log拦截(...args) {
    const 内容 = args.map(a => typeof a === 'string' ? a : this._格式化(a)).join(' ');
    // debug 模式：捕获调用位置（跳过内部日志帧，避免与日志管理器重复）
    const 调用位置 = 获取调用位置(0, true);
    this.缓冲.push({ 内容, 类型: 'log', 调用位置 });
  }

  _warn拦截(...args) {
    const 内容 = args.map(a => typeof a === 'string' ? a : this._格式化(a)).join(' ');
    const 调用位置 = 获取调用位置(0, true);
    this.缓冲.push({ 内容, 类型: 'warn', 调用位置 });
  }

  _error拦截(...args) {
    const 内容 = args.map(a => typeof a === 'string' ? a : this._格式化(a)).join(' ');
    const 调用位置 = 获取调用位置(0, true);
    this._输出原始('error', 内容, 调用位置);
  }

  _格式化(obj) {
    try {
      if (obj instanceof Error) return obj.stack || obj.message;
      if (typeof obj === 'object' && obj !== null) return JSON.stringify(obj);
      return String(obj);
    } catch (e) {
      // 格式化失败，退化为字符串（非加密场景，仅用于终端展示）
      console.error('[终端输出] 格式化对象失败:', e.message);
      return String(obj);
    }
  }

  启动输出循环() {
    if (this.循环定时器) return;
    this.循环定时器 = setInterval(() => {
      this._刷新输出();
    }, this.输出间隔);
    if (this.循环定时器.unref) {
      this.循环定时器.unref();
    }
  }

  _刷新输出() {
    if (this.正在刷新) return;
    this.正在刷新 = true;
    try {
      const 有缓冲 = this.缓冲.length > 0;
      const 有进度 = this.当前进度行 !== null;
      if (!有缓冲 && !有进度) return;
      if (有进度) {
        if (有缓冲) {
          if (this.进度行已显示) {
            clearLine();
          }
          while (this.缓冲.length > 0) {
            const 条目 = this.缓冲.shift();
            this._输出原始(条目.类型, 条目.内容, 条目.调用位置);
          }
          process.stdout.write(`\r${this.当前进度行}`);
          this.进度行已显示 = true;
        } else {
          if (this.进度行已显示) {
            process.stdout.write(`\r${this.当前进度行}`);
          } else {
            process.stdout.write(`${this.当前进度行}`);
            this.进度行已显示 = true;
          }
        }
      } else {
        while (this.缓冲.length > 0) {
          const 条目 = this.缓冲.shift();
          this._输出原始(条目.类型, 条目.内容, 条目.调用位置);
        }
        this.进度行已显示 = false;
      }
    } finally {
      this.正在刷新 = false;
    }
  }

  _输出原始(类型, 内容, 调用位置 = null) {
    const 写入 = this.原始console[类型] || this.原始console.log;
    const 时间戳 = formatLocalTime(new Date(), 'log');
    const 位置后缀 = 调用位置 ? ` ${调用位置}` : '';
    // 终端级别标签：复制文本后也能分辨日志类型（颜色信息会丢失）
    const 级别标签 = { log: 'INFO', warn: 'WARN', error: 'ERR!' }[类型] || 'INFO';
    // 终端彩色输出：warn 黄色，error 红色，log 默认色
    const isTTY = process.stdout.isTTY;
    const 原始文本 = `${时间戳} ${级别标签}${位置后缀} ${内容}`;
    let 彩色内容 = 原始文本;
    if (isTTY) {
      if (类型 === 'warn') 彩色内容 = `\x1b[33m${原始文本}\x1b[0m`;
      else if (类型 === 'error') 彩色内容 = `\x1b[31m${原始文本}\x1b[0m`;
    }
    写入(彩色内容);
    if (this._文件日志器) {
      const 级别 = 类型 === 'error' ? 'error' : 类型 === 'warn' ? 'warn' : 'info';
      const 日志行 = this._文件日志器._格式化日志行(级别, [内容]);
      this._文件日志器._写入文件(日志行, 级别 === 'error');
    }
  }
}

export const 终端输出 = new 终端输出管理器();
export default 终端输出;
