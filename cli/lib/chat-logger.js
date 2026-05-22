/**
 * 对话日志记录器
 * 
 * 功能：将 CLI 对话的发送和接收消息实时记录到文件
 * - 用户消息和白鸽回复（含流式内容）都实时写入
 * - 日志文件按日期命名：~/.dove/logs/chat-YYYY-MM-DD.log
 * - 通过 dove config chat-log on/off 控制开关
 * - 日志文件中不截断任何内容，完整记录所有ID和消息
 * 
 * 使用方法：
 * import { 对话日志 } from '../lib/chat-logger.js';
 * 对话日志.用户消息(convId, text);
 * 对话日志.白鸽文本(convId, text);
 * 对话日志.白鸽思考(convId, text);
 * 对话日志.白鸽完成(convId, content, model, provider);
 * 对话日志.用户回答(convId, question, answer);
 */

import fs from 'fs';
import path from 'path';
import { loadConfig, getConfigDir } from './config.js';

// 日志目录
const LOG_DIR = path.join(getConfigDir(), 'logs');

/**
 * 确保日志目录存在
 */
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * 获取当日日志文件路径
 */
function getLogFilePath() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(LOG_DIR, `chat-${dateStr}.log`);
}

/**
 * 格式化时间戳（本地时间，精确到毫秒）
 */
function timestamp() {
  const now = new Date();
  return now.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
}

/**
 * 追加写入日志行
 */
function appendLine(line) {
  // 每次都重新读取配置，确保实时响应开关变化
  // DOVE_DEBUG 环境变量强制开启日志（--debug 模式）
  const config = loadConfig();
  if (!config.chatLog?.enabled && !process.env.DOVE_DEBUG) return;

  try {
    ensureLogDir();
    const logFile = getLogFilePath();
    fs.appendFileSync(logFile, line + '\n', 'utf-8');
  } catch (e) {
    // 日志写入失败不影响正常功能
    if (process.env.DEBUG_CHAT) {
      console.error(`[ChatLogger] 写入日志失败: ${e.message}`);
    }
  }
}

/**
 * 对话日志记录器
 */
export const 对话日志 = {
  /**
   * 记录用户发送的消息
   */
  用户消息(convId, text) {
    const ts = timestamp();
    const conv = convId ? `[${convId}] ` : '';
    appendLine(`${ts} ${conv}👤 用户: ${text}`);
  },

  /**
   * 记录白鸽流式文本输出（实时逐块写入）
   */
  白鸽文本(convId, text) {
    const ts = timestamp();
    const conv = convId ? `[${convId}] ` : '';
    appendLine(`${ts} ${conv}🕊️ 白鸽: ${text}`);
  },

  /**
   * 记录白鸽思考/推理内容（实时逐块写入）
   */
  白鸽思考(convId, text) {
    const ts = timestamp();
    const conv = convId ? `[${convId}] ` : '';
    appendLine(`${ts} ${conv}💭 思考: ${text}`);
  },

  /**
   * 记录白鸽完成（非流式最终结果）
   */
  白鸽完成(convId, content, model, provider) {
    const ts = timestamp();
    const conv = convId ? `[${convId}] ` : '';
    const modelInfo = model ? ` [${provider || '?'}/${model}]` : '';
    appendLine(`${ts} ${conv}🕊️ 白鸽${modelInfo}: ${content}`);
  },

  /**
   * 记录用户回答白鸽的问题
   */
  用户回答(convId, question, answer) {
    const ts = timestamp();
    const conv = convId ? `[${convId}] ` : '';
    appendLine(`${ts} ${conv}❓ 问题: ${question}`);
    appendLine(`${ts} ${conv}✅ 回答: ${typeof answer === 'object' ? JSON.stringify(answer) : answer}`);
  },

  /**
   * 记录任务状态变更
   */
  任务状态(convId, taskId, status) {
    const ts = timestamp();
    const conv = convId ? `[${convId}] ` : '';
    appendLine(`${ts} ${conv}📋 任务 ${taskId || '-'} ${status}`);
  },

  /**
   * 记录分隔线（新对话开始）
   */
  分隔线(convId) {
    const ts = timestamp();
    const conv = convId ? `[${convId}] ` : '';
    appendLine(`${ts} ${conv}${'═'.repeat(60)}`);
  },

  /**
   * 记录错误（不会被 TUI 覆盖，确保日志文件中有据可查）
   */
  错误(convId, error) {
    const ts = timestamp();
    const conv = convId ? `[${convId}] ` : '';
    appendLine(`${ts} ${conv}❌ 错误: ${typeof error === 'object' ? JSON.stringify(error) : error}`);
  },

  /**
   * 获取日志目录路径
   */
  getLogDir() {
    return LOG_DIR;
  },

  /**
   * 获取当日日志文件路径
   */
  getTodayLogFile() {
    return getLogFilePath();
  },

  /**
   * 检查是否启用
   */
  isEnabled() {
    const config = loadConfig();
    return !!config.chatLog?.enabled || !!process.env.DOVE_DEBUG;
  }
};

export default 对话日志;
