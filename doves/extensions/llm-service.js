/**
 * @file extensions/llm-service
 * @description 扩展工具合规 LLM 调用层
 * 
 * === 设计原则 ===
 * - 所有扩展工具的 LLM 调用必须经过此模块，禁止直连 API
 * - 复用白鸽的 提供商客户端 + KeyManager + LLM Logger
 * - 仅限 Dove 进程内调用，Server 和 CLI 不调用大模型
 * - 走标准管道：API Key 管理、日志记录、重试、Token 统计
 * 
 * === ⚠️ 架构边界 ===
 * - 此模块属于 Doves 领域，Server 不应 import 本模块
 * - Server 侧已通过 LLM任务代理 解耦，不再直接 import 本模块
 * 
 * === 用法 ===
 * // 在扩展工具代码中：
 * import { callLLM } from '../llm-service.js';
 * const result = await callLLM({ messages, model: 'qwen3.6-flash' });
 */

import { 提供商客户端, 提供商列表 } from '../providers/index.js';
import { 默认模型配置, 默认快速模型, 默认视觉模型, getProviderApiKeyFromEnv } from '../常量.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('扩展LLM服务', { 前缀: '[扩展LLM服务]', 级别: 'debug', 显示调用位置: true });

// API Key 获取已统一由 common/模型配置.js 的 getProviderApiKeyFromEnv 管理
// Dove 进程场景由 LLMCaller + KeyManager 管理，这里仅做环境变量回退

/**
 * 根据模型名查找提供商
 * 优先从默认模型配置匹配，其次按提供商列表查找
 */
function inferProvider(model) {
  // 1. 从默认模型配置中匹配（provider 与 model 已绑定）
  for (const 角色配置 of Object.values(默认模型配置)) {
    if (角色配置.model === model) return 角色配置.provider;
  }

  // 2. 回退：按提供商列表查找
  for (const [名称, 配置] of Object.entries(提供商列表)) {
    if (配置.模型?.includes(model)) return 名称;
  }
  return '百炼'; // 默认百炼
}

// ==================== 核心：合规 LLM 调用 ====================

/**
 * 合规 LLM 调用（非流式）
 * 
 * @param {Object} params
 * @param {Array}  params.messages - OpenAI 格式消息数组
 * @param {string} [params.model] - 模型名，默认使用快速模型
 * @param {string} [params.provider] - 提供商，不填则根据模型自动推断
 * @param {number} [params.temperature] - 温度，默认 0.3
 * @param {number} [params.max_tokens] - 最大输出 token，默认 4096
 * @param {boolean} [params.enable_thinking] - 是否启用思考模式，默认 false
 * @returns {Promise<{success: boolean, content: string, error?: string, tokenUsage: Object, model: string, provider: string}>}
 */
export async function callLLM(params) {
  const {
    messages,
    model = 默认快速模型,
    provider,
    temperature = 0.3,
    max_tokens = 4096,
    enable_thinking = false,
  } = params;

  const 提供商名 = provider || inferProvider(model);
  const apiKey = getProviderApiKeyFromEnv(提供商名);

  if (!apiKey) {
    logger.error(`未找到 ${提供商名} 的 API Key`);
    return { success: false, content: '', error: `API Key 未配置 (${提供商名})`, tokenUsage: { input: 0, output: 0 }, model, provider: 提供商名 };
  }

  try {
    const 客户端 = new 提供商客户端(提供商名, { API密钥: apiKey });

    const 请求体 = {
      model,
      messages,
      temperature,
      max_tokens,
      // Qwen3 系列默认启用思考，快速任务需要禁用
      ...(enable_thinking === false ? { enable_thinking: false } : {}),
    };

    const 结果 = await 客户端.调用(请求体);

    if (!结果.成功) {
      logger.error(`调用失败: ${结果.错误}`);
      return { success: false, content: '', error: 结果.错误, tokenUsage: 结果.token数 || { input: 0, output: 0 }, model, provider: 提供商名 };
    }

    return {
      success: true,
      content: 结果.内容,
      tokenUsage: 结果.token数 || { input: 0, output: 0 },
      model,
      provider: 提供商名,
    };
  } catch (e) {
    logger.error(`异常: ${e.message}`);
    return { success: false, content: '', error: e.message, tokenUsage: { input: 0, output: 0 }, model, provider: 提供商名 };
  }
}

/**
 * 合规视觉模型调用（支持图片输入）
 * 
 * @param {Object} params - 同 callLLM，messages 中可包含 image_url 类型
 * @returns {Promise<{success: boolean, content: string, error?: string}>}
 */
export async function callVisionLLM(params) {
  return callLLM({
    ...params,
    model: params.model || 默认视觉模型,
  });
}

export default { callLLM, callVisionLLM };
