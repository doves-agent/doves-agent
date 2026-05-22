/**
 * @file utils/llm-logger
 * @description LLM 调用日志记录器，终端摘要+文件详细记录
 */

import { appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('LLM日志', { 前缀: '[LLM日志]', 级别: 'debug', 显示调用位置: true });

// 获取当前模块目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 日志目录 - 统一到 ~/.dove/logs/llm/
const LOG_DIR = join(homedir(), '.dove', 'logs', 'llm');

/**
 * 确保日志目录存在
 */
async function ensureLogDir() {
  if (!existsSync(LOG_DIR)) {
    await mkdir(LOG_DIR, { recursive: true });
  }
}

/**
 * 格式化时间戳
 */
function formatTimestamp(date = new Date()) {
  return date.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * 格式化耗时
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

/**
 * 截断文本（用于终端展示）
 */
function truncateText(text, maxLen = 100) {
  if (!text) return '';
  const str = String(text);
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

/**
 * 获取日志文件路径（按对话ID分文件）
 * 同一对话的所有 LLM 调用写入同一文件，方便按对话追踪调试
 * @param {string} conversationId - 对话ID，无则按日期兜底
 */
function getLogFilePath(conversationId) {
  if (conversationId) {
    return join(LOG_DIR, `conv-${conversationId}.log`);
  }
  // 兜底：无对话ID时仍按日期分文件
  const date = new Date().toISOString().substring(0, 10);
  return join(LOG_DIR, `llm-call-${date}.log`);
}

/**
 * LLM 调用日志记录器类
 */
export class LLMLogger {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.logDir = options.logDir || LOG_DIR;
    this.showInTerminal = options.showInTerminal !== false;
    this.writeToFile = options.writeToFile !== false;
    
    // 日志计数器
    this.callCount = 0;
  }

  /**
   * 记录 LLM 调用开始
   * @param {Object} params - 调用参数
   * @param {string} [params.conversationId] - 对话ID，用于按对话分文件
   * @returns {Object} 调用上下文（用于结束记录）
   */
  startCall(params) {
    if (!this.enabled) return { id: null };

    const id = `llm_${Date.now()}_${++this.callCount}`;
    const startTime = Date.now();
    const startTimeStr = formatTimestamp();

    // 提取关键信息
    const {
      provider = '未知',
      model = '未知',
      callType = '未知', // 'call' | 'stream' | 'tool'
      messages = [],
      tools = [],
      conversationId = null
    } = params;

    // 计算输入 token 估算（简单估算：字符数 / 2）
    const inputText = messages.map(m => m.content || '').join('');
    const estimatedInputTokens = Math.ceil(inputText.length / 2);

    // 终端展示 - 开始
    if (this.showInTerminal) {
      console.log('');
      console.log('━'.repeat(60));
      console.log(`[LLM调用开始] ${startTimeStr}`);
      console.log(`  提供商: ${provider} | 模型: ${model} | 类型: ${callType}`);
      console.log(`  消息数: ${messages.length} | 工具数: ${tools.length}`);
      if (conversationId) console.log(`  对话ID: ${conversationId}`);
      console.log(`  估算输入token: ~${estimatedInputTokens}`);
      console.log('━'.repeat(60));
    }

    return {
      id,
      startTime,
      startTimeStr,
      provider,
      model,
      callType,
      messages,
      tools,
      estimatedInputTokens,
      conversationId
    };
  }

  /**
   * 记录 LLM 调用结束
   * @param {Object} context - 开始时返回的上下文
   * @param {Object} result - 调用结果
   */
  async endCall(context, result) {
    if (!this.enabled || !context.id) return;

    const endTime = Date.now();
    const duration = endTime - context.startTime;
    const endTimeStr = formatTimestamp();

    const {
      success = true,
      content = '',
      error = null,
      toolCalls = [],
      tokenUsage = { input: 0, output: 0 }
    } = result;

    // 计算输出 token 估算
    const estimatedOutputTokens = tokenUsage.output || Math.ceil(content.length / 2);

    // 终端展示 - 结束摘要
    if (this.showInTerminal) {
      console.log('');
      console.log('─'.repeat(60));
      console.log(`[LLM调用结束] ${endTimeStr}`);
      console.log(`  状态: ${success ? '✓ 成功' : '✗ 失败'}`);
      console.log(`  耗时: ${formatDuration(duration)}`);
      console.log(`  输出token: ${tokenUsage.output || estimatedOutputTokens} (实际: ${tokenUsage.output || '未知'})`);
      
      if (toolCalls.length > 0) {
        console.log(`  工具调用: ${toolCalls.length} 个`);
        toolCalls.forEach((tc, i) => {
          console.log(`    ${i + 1}. ${tc.function?.name || tc.name || '未知'}`);
        });
      }
      
      if (error) {
        console.log(`  错误: ${truncateText(error, 200)}`);
      }
      
      // 显示响应摘要（终端截断，日志文件写全）
      if (content) {
        console.log(`  响应摘要: ${truncateText(content.replace(/\n/g, ' '), 150)}`);
        // ★ 日志文件记录完整响应，终端才截断
        logger.info(`响应完整内容: ${content}`);
      }
      
      console.log('─'.repeat(60));
      console.log('');
    }

    // 写入详细日志文件
    if (this.writeToFile) {
      await this.writeLogToFile(context, {
        endTime,
        endTimeStr,
        duration,
        success,
        content,
        error,
        toolCalls,
        tokenUsage,
        estimatedOutputTokens
      });
    }
  }

  /**
   * 写入详细日志到文件
   */
  async writeLogToFile(context, result) {
    try {
      await ensureLogDir();
      
      const logEntry = {
        // 基本信息
        id: context.id,
        timestamp: {
          start: context.startTimeStr,
          end: result.endTimeStr,
          duration: result.duration,
          durationFormatted: formatDuration(result.duration)
        },
        
        // 调用信息
        call: {
          provider: context.provider,
          model: context.model,
          type: context.callType
        },
        
        // 输入
        input: {
          messages: context.messages,
          messageCount: context.messages.length,
          toolCount: context.tools.length,
          tools: context.tools.length > 0 ? context.tools.map(t => ({
            name: t.function?.name || t.name,
            description: truncateText(t.function?.description || t.description || '', 100)
          })) : [],
          estimatedInputTokens: context.estimatedInputTokens
        },
        
        // 输出
        output: {
          success: result.success,
          content: result.content,
          contentLength: result.content?.length || 0,
          toolCalls: result.toolCalls,
          error: result.error,
          tokenUsage: result.tokenUsage,
          estimatedOutputTokens: result.estimatedOutputTokens
        }
      };

      const logLine = JSON.stringify(logEntry, null, 2) + '\n' + '='.repeat(80) + '\n\n';
      const logFile = getLogFilePath(context.conversationId);
      
      await appendFile(logFile, logLine, 'utf-8');
    } catch (err) {
      logger.error(`写入日志文件失败: ${err.message}`);
    }
  }

  /**
   * 记录流式调用的增量内容（可选，用于调试）
   */
  logStreamChunk(context, chunk) {
    // 默认不记录流式增量，避免日志过多
    // 如果需要可以开启
    if (process.env.LLM_LOG_STREAM === 'true') {
      logger.debug(`流式 ${context.id}: ${truncateText(chunk, 50)}`);
    }
  }
}

// 全局单例实例
let globalLogger = null;

/**
 * 获取全局日志记录器实例
 */
export function getLLMLogger(options = {}) {
  if (!globalLogger) {
    globalLogger = new LLMLogger(options);
  }
  return globalLogger;
}

/**
 * 配置全局日志记录器
 */
export function configureLLMLogger(options = {}) {
  globalLogger = new LLMLogger(options);
  return globalLogger;
}

export default LLMLogger;
