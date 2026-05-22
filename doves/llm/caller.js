/**
 * @file llm/caller
 * @description 统一的 LLM 调用接口
 */

import { 提供商客户端, 提供商列表 } from '../providers/index.js';
import { KeyManager, 提供商名称映射 } from './key-manager.js';
import { 默认推理模型, 默认模型配置 } from '../常量.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('LLM调用器', { 前缀: '[LLM]', 级别: 'debug', 显示调用位置: true });

/**
 * LLM 调用器类
 */
export class LLMCaller {
  constructor(配置 = {}) {
    this.ID = 配置.ID || 'llm_caller';
    this.keyManager = 配置.keyManager || new KeyManager(配置);
    this.模型选择器 = 配置.模型选择器;
    this.token统计 = 配置.token统计;
    this.任务队列 = 配置.任务队列;
  }

  /**
   * 调用 LLM
   * @param {Object} 任务 - 任务对象
   * @param {Array} 对话历史 - 对话历史
   * @param {Object} 选项 - 可选参数
   * @returns {Object} LLM 响应结果
   */
  async 调用(任务, 对话历史 = [], 选项 = {}) {
    const 任务ID = 任务?.任务ID || 任务?.id || 'unknown';
        logger.info(`调用 LLM 执行任务: ${任务ID}`);

    const 任务描述 = 任务.描述 || '';
    // 消息内容：优先用 提示词（event_llm_judge 等场景），否则用 描述
    const 消息内容 = 任务.提示词 || 任务描述;

    // 构建消息
    const messages = [
      ...对话历史,
      { role: 'user', content: 消息内容 }
    ];

    // 选择模型
    // 优先级：选项中指定的模型 > 模型选择器自动选择 > 默认值
    let 模型配置;
    if (选项.模型) {
      // 调用方明确指定了模型，查找对应提供商
      let foundProvider = 选项.提供商 || 默认模型配置.推理模型.provider;
      for (const [名称, 配置] of Object.entries(提供商列表)) {
        if (配置.模型?.includes(选项.模型)) {
          foundProvider = 名称;
          break;
        }
      }
      模型配置 = { 提供商: foundProvider, 模型: 选项.模型 };
    } else if (this.模型选择器?.选择推理模型) {
      模型配置 = this.模型选择器.选择推理模型(任务);
    } else {
      模型配置 = {
        提供商: 选项.提供商 || 默认模型配置.推理模型.provider,
        模型: 选项.模型 || 默认推理模型
      };
    }

    const 提供商名 = 模型配置.提供商;

    try {
      // 获取 API Key
      const userId = 任务.用户ID;
      let keyConfig;

      if (userId) {
        keyConfig = await this.keyManager.获取用户APIKey(userId, 提供商名);
      } else {
        keyConfig = this.keyManager.获取官方Key(提供商名);
      }

      if (!keyConfig.apiKey) {
                logger.error(`未找到 ${提供商名} 的 API Key`);
        return { 成功: false, 错误: 'API Key 未配置' };
      }

            logger.info(`使用 ${提供商名} API Key (${keyConfig.source})`);

      // 创建提供商客户端
      const 客户端 = new 提供商客户端(提供商名, { API密钥: keyConfig.apiKey });

      // 调用 LLM（流式）
      let 完整内容 = '';
      let 完整推理过程 = '';
      const 任务ID = 任务.任务ID;
      // 进度条标签：优先用 标签字段，再取 描述 前20字，兜底用任务ID
      const 任务标签 = 任务.标签 || 任务描述?.substring(0, 20) || 任务ID?.slice(-8) || 'LLM调用';

      await 客户端.流式调用({
        model: 模型配置.模型,
        messages,
        temperature: 选项.temperature || 0.7,
        max_tokens: 选项.maxTokens || 4096,
        conversationId: 任务.对话ID || null
      }, async (chunk) => {
        if (chunk.内容) {
          完整内容 += chunk.内容;
          // 写入流式缓冲
          if (this.任务队列 && 任务ID) {
            try {
              await this.任务队列.追加流式内容?.(任务ID, chunk.内容, 'text');
            } catch (流式写入错误) {
                            logger.error(`写入流式内容失败: ${流式写入错误.message}`);
            }
          }
        }
        // 思考模型的推理过程（reasoning_content）
        if (chunk.思考内容) {
          完整推理过程 += chunk.思考内容;
          if (this.任务队列 && 任务ID) {
            try {
              await this.任务队列.追加流式内容?.(任务ID, chunk.思考内容, 'reasoning');
            } catch (流式写入错误) {
                            logger.error(`写入思考内容失败: ${流式写入错误.message}`);
            }
          }
        }
        if (chunk.错误) {
                    logger.error('LLM 流式错误:', chunk.错误);
        }
      }, { showProgress: 选项.showProgress ?? true, label: 任务标签 });

      // 记录 token 使用
      if (this.token统计 && 任务ID) {
        this.token统计.记录?.(任务ID, 提供商名, 模型配置.模型, { 输入: 0, 输出: 0 });
      }

      return {
        成功: true,
        内容: 完整内容,
        推理过程: 完整推理过程,
        模型: 模型配置.模型,
        提供商: 提供商名,
        keySource: keyConfig.source
      };
      
    } catch (调用错误) {
            logger.error(`LLM调用异常: ${调用错误.message}`);
      return { 成功: false, 错误: 调用错误.message, 内容: '' };
    }
  }

  /**
   * 调用 LLM（带工具）
   * @param {Object} 任务 - 任务对象
   * @param {Array} 对话历史 - 对话历史
   * @param {Array} 工具列表 - 可用工具列表
   * @param {Object} 选项 - 可选参数
   * @returns {Object} LLM 响应结果
   */
  async 调用带工具(任务, 对话历史 = [], 工具列表 = [], 选项 = {}) {
    const 任务ID = 任务?.任务ID || 任务?.id || 'unknown';
        logger.info(`调用 LLM（带工具）执行任务: ${任务ID}`);

    const 任务描述 = 任务.描述 || '';

    // 构建消息
    const messages = [
      ...对话历史,
      { role: 'user', content: 任务描述 }
    ];

    // 选择模型
    // 优先级：选项中指定的模型 > 模型选择器自动选择 > 默认值
    let 模型配置;
    if (选项.模型) {
      // 调用方明确指定了模型，查找对应提供商
      let foundProvider = 选项.提供商 || 默认模型配置.推理模型.provider;
      for (const [名称, 配置] of Object.entries(提供商列表)) {
        if (配置.模型?.includes(选项.模型)) {
          foundProvider = 名称;
          break;
        }
      }
      模型配置 = { 提供商: foundProvider, 模型: 选项.模型 };
    } else if (this.模型选择器?.选择推理模型) {
      模型配置 = this.模型选择器.选择推理模型(任务);
    } else {
      模型配置 = {
        提供商: 选项.提供商 || 默认模型配置.推理模型.provider,
        模型: 选项.模型 || 默认推理模型
      };
    }

    try {
      // 获取 API Key
      const userId = 任务.用户ID;
      let keyConfig;

      if (userId) {
        keyConfig = await this.keyManager.获取用户APIKey(userId, 模型配置.提供商);
      } else {
        keyConfig = this.keyManager.获取官方Key(模型配置.提供商);
      }

      if (!keyConfig.apiKey) {
        return { 成功: false, 错误: 'API Key 未配置' };
      }

      // 创建提供商客户端
      const 客户端 = new 提供商客户端(模型配置.提供商, { API密钥: keyConfig.apiKey });

      // 调用 LLM（工具调用）
      const 结果 = await 客户端.工具调用({
        model: 模型配置.模型,
        messages,
        tools: 工具列表,
        temperature: 选项.temperature || 0.7,
        conversationId: 任务.对话ID || null
      });

      if (!结果.成功) {
        return 结果;
      }

      // 处理工具调用
      if (结果.工具调用列表 && 结果.工具调用列表.length > 0) {
        for (const 调用 of 结果.工具调用列表) {
                    logger.info(`工具调用: ${调用.function?.name}`);
        }
      }

      return 结果;
      
    } catch (调用错误) {
            logger.error(`LLM工具调用异常: ${调用错误.message}`);
      return { 成功: false, 错误: 调用错误.message, 内容: '', 工具调用列表: [] };
    }
  }
}

export { KeyManager, 提供商名称映射 };
