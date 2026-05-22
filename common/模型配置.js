/**
 * 统一模型配置 - 全局唯一配置源
 *
 * 所有模块（Doves、Server、CLI）从此处读取默认模型，避免分散配置。
 * 环境变量优先，其次使用此处定义的默认值。
 *
 * 修改模型默认值只需改此文件，即可全局生效。
 *
 * 支持的环境变量：
 *   DEFAULT_PROVIDER           - 默认提供商（默认: 从推理模型提供商派生）
 *   DEFAULT_REASONING_MODEL    - 推理模型（默认: qwen3.7-max）
 *   DEFAULT_REASONING_PROVIDER - 推理模型提供商（默认: 百炼）
 *   DEFAULT_INTENT_MODEL       - 意图识别模型（默认: qwen3.7-max）
 *   DEFAULT_INTENT_PROVIDER    - 意图模型提供商（默认: 百炼）
 *   DEFAULT_PLANNING_MODEL     - 任务规划模型（默认: qwen3.7-max）
 *   DEFAULT_PLANNING_PROVIDER  - 规划模型提供商（默认: 百炼）
 *   DEFAULT_FLASH_MODEL        - 快速模型（默认: qwen3.7-max）
 *   DEFAULT_FLASH_PROVIDER     - 快速模型提供商（默认: 百炼）
 *   DEFAULT_VISION_MODEL       - 视觉模型（默认: qwen3.5-omni-plus）
 *   DEFAULT_VISION_PROVIDER    - 视觉模型提供商（默认: 百炼）
 *   DEFAULT_TOOL_FILTER_MODEL  - 工具筛选模型（默认: qwen3.7-max）
 *   DEFAULT_TOOL_FILTER_PROVIDER - 工具筛选模型提供商（默认: 百炼）
 */

// DEFAULT_PROVIDER 在默认模型配置之后定义（见下方）

// ==================== 提供商名称统一映射（全局唯一映射源） ====================
// 所有模块的提供商名称归一化都从这里取，禁止各自硬编码
// key = 各种可能的输入值（英文/中文/大小写），value = 统一的标准 key
export const PROVIDER_NAME_MAP = {
  'bailian': '百炼',
  '百炼': '百炼',
  'deepseek': 'DeepSeek',
  'DeepSeek': 'DeepSeek',
  'glm': 'GLM',
  '智谱': 'GLM',
  'GLM': 'GLM',
  'custom': '自定义',
  '自定义': '自定义',
};

/** 归一化提供商名称：任意输入 → 标准 key */
export function normalizeProvider(name) {
  return PROVIDER_NAME_MAP[name] || name;
}

// ==================== 提供商端点配置（全局唯一端点源） ====================
export const PROVIDER_ENDPOINTS = {
  '百炼': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'DeepSeek': 'https://api.deepseek.com/v1',
  'GLM': 'https://open.bigmodel.cn/api/paas/v4',
  '自定义': process.env.CUSTOM_BASE_URL || '',
};

/** 提供商模型列表测试端点（用于 Key 验证） */
export const PROVIDER_TEST_ENDPOINTS = {
  '百炼': 'https://dashscope.aliyuncs.com/api/v1/models',
  'DeepSeek': 'https://api.deepseek.com/v1/models',
  'GLM': 'https://open.bigmodel.cn/api/paas/v4/models',
};

/** 提供商专用 API 端点（TTS/ASR/图像/视频等非 LLM 接口） */
export const PROVIDER_SPECIAL_ENDPOINTS = {
  '百炼': {
    tts: 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts',
    asr: 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr',
    image: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis',
    video: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  },
};

/** 百炼 API 通用主机名（用于 HTTP 请求中 hostname 字段） */
export const BAILIAN_API_HOST = 'dashscope.aliyuncs.com';

// ==================== 提供商环境变量映射（全局唯一映射源） ====================
// 标准提供商名 → 对应的环境变量名
export const PROVIDER_ENV_KEYS = {
  '百炼': 'BAILIAN',
  'DeepSeek': 'DEEPSEEK',
  'GLM': 'GLM',
  '自定义': 'CUSTOM',
};

/** 获取提供商的 API Key 环境变量名 */
export function getProviderEnvKeyNames(provider) {
  const base = PROVIDER_ENV_KEYS[provider];
  if (!base) return [];
  return [`${base}_API_KEY`];
}

/** 从环境变量获取提供商 API Key */
export function getProviderApiKeyFromEnv(provider) {
  const keys = getProviderEnvKeyNames(provider);
  for (const key of keys) {
    if (process.env[key]) return process.env[key];
  }
  return '';
}

// ==================== 核心默认模型配置（中文键） ====================
// ★ 只改这里，全局生效 ★
// 每个角色 = { provider, model } 一体，模型和服务商绑定
export const 默认模型配置 = {
  推理模型: {
    provider: process.env.DEFAULT_REASONING_PROVIDER || '百炼',
    model: process.env.DEFAULT_REASONING_MODEL || 'qwen3.7-max',
  },
  意图模型: {
    provider: process.env.DEFAULT_INTENT_PROVIDER || '百炼',
    model: process.env.DEFAULT_INTENT_MODEL || 'qwen3.7-max',
  },
  规划模型: {
    provider: process.env.DEFAULT_PLANNING_PROVIDER || '百炼',
    model: process.env.DEFAULT_PLANNING_MODEL || 'qwen3.7-max',
  },
  快速模型: {
    provider: process.env.DEFAULT_FLASH_PROVIDER || '百炼',
    model: process.env.DEFAULT_FLASH_MODEL || 'qwen3.7-max',
  },
  视觉模型: {
    provider: process.env.DEFAULT_VISION_PROVIDER || '百炼',
    model: process.env.DEFAULT_VISION_MODEL || 'qwen3.5-omni-plus',
  },
  工具筛选模型: {
    provider: process.env.DEFAULT_TOOL_FILTER_PROVIDER || '百炼',
    model: process.env.DEFAULT_TOOL_FILTER_MODEL || 'qwen3.7-max',
  },
};

// ==================== 英文键导出（供 Server API 使用） ====================
// 从中文键自动派生，修改默认模型配置只需改上方一处
export const SYSTEM_MODEL_DEFAULTS = {
  intentModel: 默认模型配置.意图模型,
  reasoningModel: 默认模型配置.推理模型,
  planningModel: 默认模型配置.规划模型,
  visionModel: 默认模型配置.视觉模型,
  flashModel: 默认模型配置.快速模型,
  toolFilterModel: 默认模型配置.工具筛选模型,
};

// ==================== CLI 角色展示信息（供 CLI 展示使用） ====================
// 从统一配置自动派生
export const MODEL_ROLES = {
  intentModel: { name: '意图识别', ...默认模型配置.意图模型 },
  reasoningModel: { name: '深度思考', ...默认模型配置.推理模型 },
  planningModel: { name: '任务规划', ...默认模型配置.规划模型 },
  visionModel: { name: '视觉理解', ...默认模型配置.视觉模型 },
  flashModel: { name: '简单回复/闪回', ...默认模型配置.快速模型 },
  toolFilterModel: { name: '工具筛选', ...默认模型配置.工具筛选模型 },
};

// ==================== 默认提供商（从默认模型配置派生） ====================
// 不再硬编码'百炼'，而是取推理模型的提供商作为全局默认
export const DEFAULT_PROVIDER = 默认模型配置.推理模型.provider;

// ==================== 便捷导出 ====================
// 注意：这里只取 model 字符串，provider 需要从 默认模型配置.x.provider 获取
export const 默认推理模型 = 默认模型配置.推理模型.model;
export const 默认意图模型 = 默认模型配置.意图模型.model;
export const 默认规划模型 = 默认模型配置.规划模型.model;
export const 默认快速模型 = 默认模型配置.快速模型.model;
export const 默认视觉模型 = 默认模型配置.视觉模型.model;
export const 默认工具筛选模型 = 默认模型配置.工具筛选模型.model;

// ==================== 分类模型配置（按用途） ====================
// 推理模型配置
export const REASONING_MODELS = {
  primary: ['qwen3.7-max'],
  requiredCapabilities: ['推理', '工具调用']
};

// 快速模型配置
export const FAST_MODELS = {
  primary: ['qwen3.6-flash'],
  requiredCapabilities: ['快速', '低成本']
};

// 视觉/多模态模型配置
export const VISION_MODELS = {
  primary: ['qwen3.5-omni-plus', 'qwen3.5-omni-flash'],
  requiredCapabilities: ['多模态', '视觉']
};

// 中文别名导出
export const 推理模型 = REASONING_MODELS;
export const 快速模型 = FAST_MODELS;
export const 视觉模型 = VISION_MODELS;

// ==================== 模型列表（按用途分类） ====================
// 各模块可按需从此列表选择模型
export const 模型列表 = {
  // 推理模型：复杂任务推理、规划、分析
  推理: [
    'qwen3.7-max',      // 阿里百炼最新推理模型
    'qwen3-max',         // 百炼旗舰推理
    'qwen3.5-plus',      // 均衡选择
    'deepseek-r1',       // 深度推理（百炼托管）
    'deepseek-v3',       // 综合能力强（百炼托管）
  ],

  // 快速模型：简单任务、快速响应、路由判断
  快速: [
    'qwen3.6-flash',     // 阿里百炼快速模型
    'qwen-turbo',        // 百炼极速
    'qwen-flash',        // 百炼闪电
  ],

  // 视觉模型：图片理解、GUI截图、视频分析
  视觉: [
    'qwen3.5-omni-plus', // 多模态增强版（推荐）
    'qwen3.5-omni-flash',// 多模态快速版
    'qwen-vl-max',       // 视觉理解最强
    'qwen3-vl-plus'      // 视觉通用
  ],

  // 编程模型：代码生成、调试
  编程: [
    'qwen3-coder-plus',  // 代码专用
    'qwen3.7-max',      // 通用推理
    'qwen3-coder-flash', // 代码快速
  ],

  // 长文本模型：大文档处理
  长文本: [
    'qwen-long',         // 专用于长文本
    'qwen3.5-plus'       // 支持100万token
  ],

  // 工具筛选模型：从全量工具目录中精选趁手工具
  工具筛选: [
    'qwen3.6-flash',     // 阿里快速模型
    'qwen-turbo',        // 百炼极速（备用）
  ]
};

// 常用模型别名
export const 模型别名 = {
  // Flash 系列快速模型
  'flash': 'qwen3.6-flash',
  'omni-flash': 'qwen3.5-omni-flash',
  'omni-plus': 'qwen3.5-omni-plus',
  // 推理系列
  'reasoning': 'qwen3.7-max',
  'plus': 'qwen3.7-max',
  'r1': 'deepseek-r1',
  'max': 'qwen3-max',
  'coder': 'qwen3-coder-plus'
};

// 默认导出
export default {
  PROVIDER_NAME_MAP,
  normalizeProvider,
  DEFAULT_PROVIDER,
  PROVIDER_ENDPOINTS,
  PROVIDER_TEST_ENDPOINTS,
  PROVIDER_SPECIAL_ENDPOINTS,
  BAILIAN_API_HOST,
  PROVIDER_ENV_KEYS,
  getProviderEnvKeyNames,
  getProviderApiKeyFromEnv,

  默认模型配置,
  SYSTEM_MODEL_DEFAULTS,
  MODEL_ROLES,
  默认推理模型,
  默认意图模型,
  默认规划模型,
  默认快速模型,
  默认视觉模型,
  默认工具筛选模型,
  REASONING_MODELS,
  FAST_MODELS,
  VISION_MODELS,
  推理模型,
  快速模型,
  视觉模型,
  模型列表,
  模型别名,
};
