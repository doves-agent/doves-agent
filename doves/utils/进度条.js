/**
 * @file utils/进度条
 * @description 终端流式调用进度条，通过终端输出管理器统一输出
 */

import { 终端输出 } from './终端输出管理器.js';

// 进度条计数器（用于生成唯一ID）
let 进度条计数器 = 0;

/**
 * 流式进度显示器
 */
export class 流式进度 {
  constructor(选项 = {}) {
    this.ID = `progress_${Date.now()}_${++进度条计数器}`;
    this.标签 = 选项.标签 || '流式调用';
    this.总字节数 = 0;
    this.总字符数 = 0;
    this.开始时间 = null;
    this.上次更新 = 0;
    this.更新间隔 = 选项.更新间隔 || 200; // ms，增加间隔减少更新频率
    this.已完成 = false;
    this.最后内容预览 = '';
  }

  /**
   * 开始进度显示
   */
  开始() {
    this.开始时间 = Date.now();
    this.总字节数 = 0;
    this.总字符数 = 0;
    this.已完成 = false;
    this._更新显示();
  }

  /**
   * 追加内容
   * @param {string} 内容 - 接收到的内容
   */
  追加(内容) {
    if (this.已完成) return;
    
    this.总字节数 += Buffer.byteLength(内容, 'utf8');
    this.总字符数 += 内容.length;
    this.最后内容预览 = 内容.slice(-20); // 保留最后20个字符
    
    const now = Date.now();
    if (now - this.上次更新 >= this.更新间隔) {
      this._更新显示();
      this.上次更新 = now;
    }
  }

  /**
   * 完成进度显示
   * @param {string} 错误 - 可选的错误信息
   */
  完成(错误 = null) {
    if (this.已完成) return; // 防止重复完成
    this.已完成 = true;
    // 清除进度行，让暂存日志先输出
    终端输出.清除进度(this.ID);
    // 完成信息直接用原始 console 输出（避免被拦截进缓冲区与其他进度行冲突）
    const 消息 = this._构建完成消息(错误);
    终端输出._输出原始('log', 消息);
  }

  /**
   * 构建进度消息（实时更新用）
   * @private
   */
  _构建消息(错误 = null) {
    const 耗时 = this.开始时间 ? ((Date.now() - this.开始时间) / 1000).toFixed(1) : '0.0';
    const 速度 = this.开始时间 && 耗时 > 0 
      ? (this.总字节数 / 耗时).toFixed(0) 
      : '0';
    
    const 状态图标 = 错误 ? '❌' : '⏳';
    const 字节显示 = this._格式化字节(this.总字节数);
    
    // 简化显示：只显示核心信息
    return `${状态图标}[${this.标签}] ${this.总字符数}字符 ${字节显示} | ${耗时}s ${速度}B/s`;
  }

  /**
   * 构建完成消息（简洁版本）
   * @private
   */
  _构建完成消息(错误 = null) {
    const 耗时 = this.开始时间 ? ((Date.now() - this.开始时间) / 1000).toFixed(1) : '0.0';
    const 字节显示 = this._格式化字节(this.总字节数);
    
    if (错误) {
      return `❌ [${this.标签}] 错误: ${错误.slice(0, 50)} | ${耗时}s`;
    }
    return `✅ [${this.标签}] 完成 | ${this.总字符数}字符 ${字节显示} | ${耗时}s`;
  }

  /**
   * 更新显示
   * @private
   */
  _更新显示(错误 = null) {
    const 消息 = this._构建消息(错误);
    // 通过终端输出管理器更新进度行（同行刷新，不换行）
    终端输出.更新进度(消息, this.ID);
  }

  /**
   * 格式化字节数
   * @private
   */
  _格式化字节(字节) {
    if (字节 < 1024) return `${字节}B`;
    if (字节 < 1024 * 1024) return `${(字节 / 1024).toFixed(1)}KB`;
    return `${(字节 / 1024 / 1024).toFixed(2)}MB`;
  }
}

/**
 * 创建流式进度实例
 * @param {Object} 选项 - 配置选项
 * @returns {流式进度}
 */
export function 创建进度(选项 = {}) {
  return new 流式进度(选项);
}

export default { 流式进度, 创建进度 };
