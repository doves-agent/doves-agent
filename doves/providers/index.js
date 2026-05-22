/**
 * @file providers/index
 * @description LLM 提供商适配模块，支持阿里百炼/DeepSeek/智谱GLM等
 * 
 * 功能：
 * ├── 多提供商支持
 * ├── 流式/非流式调用
 * ├── 模型选择与回退
 * └── Token 统计
 */

import { 流式进度 } from '../utils/进度条.js';
import { getLLMLogger } from '../utils/llm-logger.js';
import { 提供商列表, 提供商名称映射, 环境变量键名映射 } from './providers-config.js';
import { PROVIDER_ENDPOINTS } from '../常量.js';
export { 提供商列表 };
import { 模型选择器 } from './providers-选择器.js';
export { 模型选择器 };
import { 是否熔断, 记录成功, 记录失败, 记录半开尝试, 获取熔断状态 } from './circuit-breaker.js';
export { 获取熔断状态 as 熔断状态 };
import { fetchWithRetry, Token统计器 as _Token统计器 } from './Token统计.js';
export { Token统计器 as _Token统计器 } from './Token统计.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('提供商', { 前缀: '[提供商]', 级别: 'debug', 显示调用位置: true });

// 全局 LLM 日志记录器
const llmLogger = getLLMLogger();

/**
 * 提供商客户端类
 */
export class 提供商客户端 {
  constructor(提供商名, 配置 = {}) {
    // 映射提供商名到中文
    const 中文名 = 提供商名称映射[提供商名.toLowerCase()] || 提供商名称映射[提供商名] || 提供商名;
    this.提供商 = 中文名;
    this.配置 = 提供商列表[中文名] || {};
    
    // 获取 API Key：优先使用传入的配置，其次尝试环境变量
    const envKey = 环境变量键名映射[中文名];
    this.API密钥 = 配置.API密钥 || 
                   (envKey && process.env[`${envKey}_API_KEY`]) ||
                   process.env[`${提供商名.toUpperCase()}_API_KEY`];
    
    this.端点 = 配置.端点 || this.配置.端点;
    
    // 端点未配置直接报错
    if (!this.端点) {
      throw new Error(`提供商 ${提供商名} 未配置端点`);
    }
  }

  /**
   * 调用 LLM（非流式）
   * @param {Object} 请求参数 - 请求参数
   * @returns {Object} 响应结果
   */
  async 调用(请求参数) {
    const _t0 = Date.now();
    // 熔断检查：如果提供商已熔断，直接返回错误（不浪费请求）
    if (是否熔断(this.提供商)) {
      logger.warn(`提供商 ${this.提供商} 熔断中，跳过调用`);
      return { 成功: false, 错误: `提供商 ${this.提供商} 当前不可用（熔断中）`, 内容: '', token数: { 输入: 0, 输出: 0 } };
    }
    记录半开尝试(this.提供商);
    
    // 开始日志记录
    const logContext = llmLogger.startCall({
      provider: this.提供商,
      model: 请求参数.model || this.配置.模型?.[0] || 'unknown',
      callType: 'call',
      messages: 请求参数.messages || [],
      tools: [],
      conversationId: 请求参数.conversationId || null
    });

    logger.debug(`非流式调用: model=${请求参数.model || this.配置.模型?.[0] || 'unknown'}`);

    if (!this.API密钥) {
      const errorResult = { 成功: false, 错误: 'API密钥未配置', 内容: '', token数: { 输入: 0, 输出: 0 } };
      await llmLogger.endCall(logContext, {
        success: false,
        error: 'API密钥未配置',
        content: '',
        tokenUsage: { input: 0, output: 0 }
      });
      return errorResult;
    }

    try {
      const 请求体 = {
        model: 请求参数.model || this.配置.模型[0],
        messages: 请求参数.messages || [],
        temperature: 请求参数.temperature || 0.7,
        max_tokens: 请求参数.max_tokens || 4096,
        // 禁用思考模式：Qwen3系列模型默认启用思考，意图分析等快速任务需要禁用
        ...(请求参数.enable_thinking === false ? { enable_thinking: false } : {})
      };

      const 响应 = await fetchWithRetry(`${this.端点}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.API密钥}`
        },
        body: JSON.stringify(请求体)
      }, { maxRetries: 3, baseDelay: 1000, logContext: `[${this.提供商}/call]`, signal: 请求参数.signal });

      if (!响应.ok) {
        const 错误文本 = await 响应.text();
        记录失败(this.提供商); // HTTP错误 → 记录熔断失败
        const errorResult = { 成功: false, 错误: `HTTP ${响应.status}: ${错误文本}`, 内容: '', token数: { 输入: 0, 输出: 0 } };
        await llmLogger.endCall(logContext, {
          success: false,
          error: `HTTP ${响应.status}: ${错误文本.slice(0, 200)}`,
          content: '',
          tokenUsage: { input: 0, output: 0 }
        });
        return errorResult;
      }

      const 数据 = await 响应.json();
      const 消息 = 数据.choices?.[0]?.message;
      const 内容 = 消息?.content || '';
      // 提取思考内容（思考模型如 glm-5、deepseek-r1 会返回 reasoning_content）
      const 思考内容 = 消息?.reasoning_content || '';

      const token数 = {
        输入: 数据.usage?.prompt_tokens || 0,
        输出: 数据.usage?.completion_tokens || 0
      };

      记录成功(this.提供商); // 调用成功 → 重置熔断器

      // 结束日志记录
      await llmLogger.endCall(logContext, {
        success: true,
        content: 内容,
        tokenUsage: { input: token数.输入, output: token数.输出 }
      });

      logger.info(`非流式调用完成: model=${请求体.model}, tokens=${token数.输入}+${token数.输出} (${Date.now() - _t0}ms)`);
      return { 成功: true, 内容, 思考内容, token数 };
    } catch (错误) {
      记录失败(this.提供商); // 异常 → 记录熔断失败
      await llmLogger.endCall(logContext, {
        success: false,
        error: 错误.message,
        content: '',
        tokenUsage: { input: 0, output: 0 }
      });
      return { 成功: false, 错误: 错误.message, 内容: '', token数: { 输入: 0, 输出: 0 } };
    }
  }

  /**
   * 调用 LLM（流式）
   * @param {Object} 请求参数 - 请求参数
   * @param {Function} 回调 - 流式回调函数
   * @param {Object} 选项 - 可选配置 { showProgress: true, label: '自定义标签' }
   */
  async 流式调用(请求参数, 回调, 选项 = {}) {
    const _t0 = Date.now();
    // 熔断检查
    if (是否熔断(this.提供商)) {
      const 错误 = `提供商 ${this.提供商} 当前不可用（熔断中）`;
      logger.warn(`流式调用熔断: ${错误}`);
      if (回调) await 回调({ 内容: '', 完成: true, 错误 });
      return;
    }
    记录半开尝试(this.提供商);
    
    const { showProgress = true, label } = 选项;
    const 进度标签 = label || `${this.提供商}/${请求参数.model || this.配置.模型?.[0] || 'unknown'}`;
    const 进度 = new 流式进度({ 标签: 进度标签 });
    
    // 开始日志记录
    const logContext = llmLogger.startCall({
      provider: this.提供商,
      model: 请求参数.model || this.配置.模型?.[0] || 'unknown',
      callType: 'stream',
      messages: 请求参数.messages || [],
      tools: [],
      conversationId: 请求参数.conversationId || null
    });

    logger.debug(`流式调用 LLM: ${请求参数.model || this.配置.模型?.[0] || 'unknown'}`);

    if (!this.API密钥) {
      const 错误 = 'API密钥未配置';
      if (showProgress) 进度.开始();
      if (showProgress) 进度.完成(错误);
      if (回调) await 回调({ 内容: '', 完成: true, 错误 });
      await llmLogger.endCall(logContext, {
        success: false,
        error: 'API密钥未配置',
        content: '',
        tokenUsage: { input: 0, output: 0 }
      });
      return;
    }

    if (showProgress) 进度.开始();

    let 流式完整内容 = '';

    try {
      const 请求体 = {
        model: 请求参数.model || this.配置.模型[0],
        messages: 请求参数.messages || [],
        temperature: 请求参数.temperature || 0.7,
        max_tokens: 请求参数.max_tokens || 4096,
        stream: true,
        // 禁用思考模式：Qwen3系列模型默认启用思考，意图分析等快速任务需要禁用
        ...(请求参数.enable_thinking === false ? { enable_thinking: false } : {})
      };

      const 响应 = await fetchWithRetry(`${this.端点}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.API密钥}`
        },
        body: JSON.stringify(请求体)
      }, { maxRetries: 3, baseDelay: 1000, logContext: `[${this.提供商}/stream]`, signal: 请求参数.signal });

      if (!响应.ok) {
        const 错误文本 = await 响应.text();
        记录失败(this.提供商); // 流式HTTP错误
        const 错误 = `HTTP ${响应.status}: ${错误文本.slice(0, 50)}`;
        if (showProgress) 进度.完成(错误);
        if (回调) await 回调({ 内容: '', 完成: true, 错误 });
        await llmLogger.endCall(logContext, {
          success: false,
          error: 错误,
          content: '',
          tokenUsage: { input: 0, output: 0 }
        });
        return;
      }

      // 处理 SSE 流
      const reader = 响应.body.getReader();
      const decoder = new TextDecoder();
      let 缓冲区 = '';
      let 总字节数 = 0;
      let 总字符数 = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // 统计原始字节数
        总字节数 += value.length;
        
        缓冲区 += decoder.decode(value, { stream: true });
        const 行列表 = 缓冲区.split('\n');
        缓冲区 = 行列表.pop() || '';

        for (const 行 of 行列表) {
          if (行.startsWith('data: ')) {
            const 数据文本 = 行.slice(6).trim();
            if (数据文本 === '[DONE]') {
              if (showProgress) 进度.完成();
              if (回调) 回调({ 内容: '', 完成: true, 统计: { 字节数: 总字节数, 字符数: 总字符数 } });
              // 结束日志记录
              await llmLogger.endCall(logContext, {
                success: true,
                content: 流式完整内容,
                tokenUsage: { input: 0, output: Math.ceil(流式完整内容.length / 2) }
              });
              return;
            }

            try {
              const 数据 = JSON.parse(数据文本);
              const choice = 数据.choices?.[0];
              const delta = choice?.delta;
              
              // 处理思考内容（reasoning_content）：思考模型如 glm-5、deepseek-r1
              // 思考阶段 delta.content 为 null，delta.reasoning_content 有值
              const reasoning = delta?.reasoning_content || '';
              const content = delta?.content || '';
              
              // 优先传递正式内容，思考内容作为附加字段
              // 思考阶段：只有 reasoning_content，content 为空
              // 回答阶段：content 有值，reasoning_content 为空
              if ((content || reasoning) && 回调) {
                流式完整内容 += content;
                总字符数 += content.length;
                if (showProgress && content) 进度.追加(content);
                await 回调({ 
                  内容: content, 
                  思考内容: reasoning,  // 思考模型的推理过程
                  完成: false 
                });
              }
            } catch (解析错误) {
              logger.debug(`SSE行解析失败: ${解析错误.message}`);
            }
          }
        }
      }

      if (showProgress) 进度.完成();
      if (回调) 回调({ 内容: '', 完成: true, 统计: { 字节数: 总字节数, 字符数: 总字符数 } });
      
      记录成功(this.提供商); // 流式调用成功
      logger.info(`流式调用完成: model=${请求体.model}, chars=${流式完整内容.length} (${Date.now() - _t0}ms)`);
      // 结束日志记录
      await llmLogger.endCall(logContext, {
        success: true,
        content: 流式完整内容,
        tokenUsage: { input: 0, output: Math.ceil(流式完整内容.length / 2) }
      });
    } catch (错误) {
      记录失败(this.提供商); // 流式调用异常
      if (showProgress) 进度.完成(错误.message);
      if (回调) 回调({ 内容: '', 完成: true, 错误: 错误.message });
      await llmLogger.endCall(logContext, {
        success: false,
        error: 错误.message,
        content: 流式完整内容,
        tokenUsage: { input: 0, output: Math.ceil(流式完整内容.length / 2) }
      });
    }
  }

  /**
   * 调用 LLM 并返回工具调用结果
   * @param {Object} 请求参数 - 请求参数（包含工具定义）
   * @returns {Object} 响应结果（可能包含工具调用）
   */
  async 工具调用(请求参数) {
    const _t0 = Date.now();
    // 熔断检查
    if (是否熔断(this.提供商)) {
      logger.warn(`工具调用熔断: 提供商 ${this.提供商}`);
      return { 成功: false, 错误: `提供商 ${this.提供商} 当前不可用（熔断中）`, 内容: '', 工具调用列表: [] };
    }
    记录半开尝试(this.提供商);
    
    // 转换工具定义为 OpenAI 兼容格式
    const 格式化工具 = (工具列表) => {
      if (!Array.isArray(工具列表)) return [];
      // 去重：同名工具只保留第一个（防御性编程，防止 API 报错 Tool names must be unique）
      const 已见名称 = new Set();
      return 工具列表.map(工具 => {
        // 兼容已为 OpenAI 格式的工具（如嵌套的 function.name）
        const toolName = 工具.name || 工具.function?.name;
        if (!toolName) {
          logger.warn(`跳过无name工具: ${JSON.stringify(工具).slice(0, 100)}`);
          return null;
        }
        if (已见名称.has(toolName)) {
          logger.warn(`跳过重复工具: ${toolName}`);
          return null;
        }
        已见名称.add(toolName);
        return {
          type: 'function',
          function: {
            name: toolName,
            description: 工具.description || 工具.function?.description || '',
            parameters: 工具.inputSchema || 工具.parameters || 工具.function?.parameters || { type: 'object', properties: {} }
          }
        };
      }).filter(Boolean);
    };

    const 格式化后的工具 = 格式化工具(请求参数.tools);

    // 开始日志记录
    const logContext = llmLogger.startCall({
      provider: this.提供商,
      model: 请求参数.model || this.配置.模型?.[0] || 'unknown',
      callType: 'tool',
      messages: 请求参数.messages || [],
      tools: 格式化后的工具,
      conversationId: 请求参数.conversationId || null
    });

    logger.debug('工具调用');

    if (!this.API密钥) {
      const errorResult = { 成功: false, 错误: 'API密钥未配置', 内容: '', 工具调用列表: [] };
      await llmLogger.endCall(logContext, {
        success: false,
        error: 'API密钥未配置',
        content: '',
        tokenUsage: { input: 0, output: 0 },
        toolCalls: []
      });
      return errorResult;
    }

    try {
      const 请求体 = {
        model: 请求参数.model || this.配置.模型[0],
        messages: 请求参数.messages || [],
        tools: 格式化后的工具,
        tool_choice: 请求参数.tool_choice || 'auto',
        temperature: 请求参数.temperature || 0.7
      };

      const 响应 = await fetchWithRetry(`${this.端点}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.API密钥}`
        },
        body: JSON.stringify(请求体)
      }, { maxRetries: 3, baseDelay: 1000, logContext: `[${this.提供商}/tool]`, signal: 请求参数.signal });

      if (!响应.ok) {
        const 错误文本 = await 响应.text();
        记录失败(this.提供商); // 工具调用HTTP错误
        const errorResult = { 成功: false, 错误: `HTTP ${响应.status}: ${错误文本}`, 内容: '', 工具调用列表: [] };
        await llmLogger.endCall(logContext, {
          success: false,
          error: `HTTP ${响应.status}: ${错误文本.slice(0, 200)}`,
          content: '',
          tokenUsage: { input: 0, output: 0 },
          toolCalls: []
        });
        return errorResult;
      }

      const 数据 = await 响应.json();
      const 消息 = 数据.choices?.[0]?.message;
      const 内容 = 消息?.content || '';
      // 提取思考内容（思考模型如 glm-5、deepseek-r1 会返回 reasoning_content）
      const 思考内容 = 消息?.reasoning_content || '';

      // 解析工具调用
      const 工具调用列表 = [];
      if (消息?.tool_calls && Array.isArray(消息.tool_calls)) {
        for (const 调用 of 消息.tool_calls) {
          工具调用列表.push({
            id: 调用.id,
            type: 调用.type || 'function',
            function: {
              name: 调用.function?.name,
              arguments: 调用.function?.arguments
            }
          });
        }
      }

      // 结束日志记录
      await llmLogger.endCall(logContext, {
        success: true,
        content: 内容,
        tokenUsage: { input: 数据.usage?.prompt_tokens || 0, output: 数据.usage?.completion_tokens || 0 },
        toolCalls: 工具调用列表
      });

      记录成功(this.提供商); // 工具调用成功
      logger.info(`工具调用完成: model=${请求体.model}, tools=${工具调用列表.length}个, tokens=${数据.usage?.prompt_tokens || 0}+${数据.usage?.completion_tokens || 0} (${Date.now() - _t0}ms)`);
      return { 成功: true, 内容, 思考内容, 工具调用列表, token数: { 输入: 数据.usage?.prompt_tokens || 0, 输出: 数据.usage?.completion_tokens || 0 } };
    } catch (错误) {
      记录失败(this.提供商); // 工具调用异常
      await llmLogger.endCall(logContext, {
        success: false,
        error: 错误.message,
        content: '',
        tokenUsage: { input: 0, output: 0 },
        toolCalls: []
      });
      return { 成功: false, 错误: 错误.message, 内容: '', 工具调用列表: [], token数: { 输入: 0, 输出: 0 } };
    }
  }

  /**
   * 获取可用模型列表
   * @returns {Array} 模型列表
   */
  获取模型列表() {
    return this.配置.模型 || [];
  }

  /**
   * 检查模型是否支持某能力
   * @param {string} 模型名 - 模型名称
   * @param {string} 能力 - 能力名称
   * @returns {boolean} 是否支持
   */
  支持能力(模型名, 能力) {
    const 提供商配置 = 提供商列表[this.提供商];
    return 提供商配置?.能力?.includes(能力) || false;
  }
}

/**
 * 创建提供商客户端
 * @param {string} 提供商名 - 提供商名称
 * @param {Object} 配置 - 配置参数
 * @returns {提供商客户端} 提供商客户端
 */
export function 创建客户端(提供商名, 配置 = {}) {
  return new 提供商客户端(提供商名, 配置);
}

export class Token统计器 extends _Token统计器 {}

export default {
  提供商列表,
  提供商客户端,
  创建客户端,
  模型选择器,
  Token统计器
};
