/**
 * @file providers-config.js
 * @description LLM 提供商配置数据，从 providers/index.js 抽取
 */

import { REASONING_MODELS, FAST_MODELS, 默认推理模型, 默认快速模型, 默认视觉模型, PROVIDER_NAME_MAP as 提供商名称映射 } from '../常量.js';

// ==================== 提供商列表 ====================

export const 提供商列表 = {
  百炼: {
    名称: 'bailian',
    端点: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    默认模型: 默认推理模型,
    模型: [
      // ========== Qwen3 系列（最新）==========
      'qwen3.6-plus',
      'qwen3-max', 'qwen3-max-preview',
      'qwen3.5-plus', 'qwen3.6-flash', 'qwen3.5-27b',
      'qwen3-0.6b', 'qwen3-1.7b', 'qwen3-4b', 'qwen3-8b', 'qwen3-14b', 'qwen3-32b',
      // ========== Qwen 系列（经典）==========
      'qwen-max', 'qwen-max-latest', 'qwen-plus', 'qwen-plus-latest', 'qwen-turbo', 'qwen-turbo-latest', 'qwen-flash',
      'qwen-long',
      // ========== Coder 系列（编程专用）==========
      'qwen3-coder-plus', 'qwen3-coder-flash', 'qwen3-coder-next',
      'qwen-coder-plus', 'qwen-coder-turbo',
      // ========== VL 系列（视觉理解）==========
      'qwen-vl-max', 'qwen-vl-max-latest', 'qwen-vl-plus', 'qwen-vl-plus-latest',
      'qwen3-vl-plus', 'qwen3-vl-flash',
      'qwen-vl-ocr', 'qwen-vl-ocr-latest',
      // ========== QVQ 系列（视频理解）==========
      'qvq-max', 'qvq-plus',
      // ========== 专用模型 ==========
      'gui-plus',                    // 界面理解
      'qwen-mt-plus', 'qwen-mt-turbo', 'qwen-mt-flash', 'qwen-mt-lite',  // 翻译
      'qwen-math-plus', 'qwen-math-turbo',  // 数学
      // ========== 图像生成/编辑 ==========
      'qwen-image-2.0', 'qwen-image-2.0-pro', 'qwen-image-max', 'qwen-image-plus',
      'qwen-image-edit-max', 'qwen-image-edit-plus',
      // ========== 语音模型 ==========
      'qwen3-tts-flash', 'qwen3-tts-instruct-flash',  // 语音合成
      'qwen3-asr-flash', 'qwen3-asr-flash-realtime',  // 语音识别
      'qwen3.5-omni-flash', 'qwen3.5-omni-flash-realtime',
      'qwen3.5-omni-plus', 'qwen3.5-omni-plus-realtime',  // 多模态增强版
      'qwen3-livetranslate-flash', 'qwen3-livetranslate-flash-realtime',
      // ========== 第三方模型（百炼平台托管）==========
      'deepseek-r1', 'deepseek-r1-distill-llama-70b', 'deepseek-r1-distill-qwen-14b',
      'deepseek-v3', 'deepseek-v3.1', 'deepseek-v3.2', 'deepseek-v4-flash', 'deepseek-v4-pro',
      'glm-5', 'glm-5.1', 'glm-4.7',
      'kimi-k2.5', 'kimi-k2-thinking',
      'MiniMax-M2.5', 'MiniMax-M2.7',
      'qwq-plus',
      'qwen-deep-research-2025-12-15'
    ],
    推荐模型: [
      { id: 默认推理模型, name: 默认推理模型, description: '默认推理模型', capabilities: ['推理', '编程', '创意', '工具调用', '长文本'], contextLength: 131072 },
      { id: 'qwen3.5-plus', name: 'Qwen3.5-Plus', description: '效果、速度、成本均衡，支持多模态', capabilities: ['推理', '编程', '快速', '长文本', '多模态', '视觉', '图片理解', '视频理解', '工具调用'], contextLength: 1000000 },
      { id: 'qwen3.6-flash', name: 'Qwen3.5-Flash', description: '速度快、成本低、支持多模态', capabilities: ['推理', '编程', '快速', '低成本', '长文本', '多模态'], contextLength: 1000000 },
      { id: 'qwen3.5-omni-plus', name: 'Qwen3.5-Omni-Plus', description: '多模态增强版，视觉+视频理解更强', capabilities: ['多模态', '视觉', '图片理解', 'OCR', '视频理解', '界面理解'], contextLength: 65536 },
      { id: 'qwen3.5-omni-flash', name: 'Qwen3-Omni-Flash', description: '多模态快速版，视觉+视频理解', capabilities: ['多模态', '视觉', '图片理解', 'OCR', '视频理解'], contextLength: 32768 },
      { id: 'qwen-long', name: 'Qwen-Long', description: '长文本专用模型', capabilities: ['长文本', '推理'], contextLength: 10000000 },
      { id: 'deepseek-r1', name: 'DeepSeek-R1', description: '深度推理模型，适合复杂推理任务', capabilities: ['推理', '长文本'], contextLength: 65536 },
      { id: 'deepseek-v3', name: 'DeepSeek-V3', description: '综合能力强，性价比高', capabilities: ['推理', '编程', '工具调用', '低成本'], contextLength: 65536 },
      { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', description: 'DeepSeek V4高速模型（百炼托管）', capabilities: ['推理', '编程', '快速', '低成本'], contextLength: 65536 },
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', description: 'DeepSeek V4专业推理模型（百炼托管）', capabilities: ['推理', '编程', '工具调用', '长文本'], contextLength: 131072 },
      { id: 'glm-5.1', name: 'GLM-5.1', description: '智谱最新模型，推理能力最强', capabilities: ['推理', '编程', '长文本', '工具调用', '多语言'], contextLength: 128000 },
      { id: 'glm-5', name: 'GLM-5', description: '智谱最新模型，推理能力强', capabilities: ['推理', '编程', '长文本', '工具调用', '多语言'], contextLength: 128000 },
    ],
    按能力选模型: {
      '推理': { model: 默认推理模型 },
      '编程': { model: 默认推理模型 },
      '创意': { model: 默认推理模型 },
      '快速': { model: 默认快速模型 },
      '长文本': { model: 'qwen-long' },
      '多模态': { model: 默认视觉模型 },
      '视觉': { model: 默认视觉模型 },
      '图片理解': { model: 默认视觉模型 },
      '视频理解': { model: 默认视觉模型 },
      'OCR': { model: 默认视觉模型 },
      '界面理解': { model: 默认视觉模型 },
      '工具调用': { model: 默认推理模型 },
      '多语言': { model: 'qwen-mt-plus' },
      '低成本': { model: 默认快速模型 },
      '图片生成': { model: 'qwen-image-2.0' },
      '图片编辑': { model: 'qwen-image-edit-max' },
      '语音合成': { model: 'qwen3-tts-flash' },
      '语音识别': { model: 'qwen3-asr-flash' },
      '数学推理': { model: 'qwen-math-plus' }
    },
    能力: ['推理', '编程', '创意', '快速', '长文本', '多模态', '视觉', '图片理解', '图片生成', '图片编辑', '视频理解', 'OCR', '界面理解', '工具调用', '多语言', '低成本', '语音合成', '语音识别', '数学推理']
  },
  DeepSeek: {
    名称: 'deepseek',
    端点: 'https://api.deepseek.com/v1',
    模型: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v3', 'deepseek-r1', 'deepseek-chat'],
    推荐模型: [
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', description: 'DeepSeek官方V4专业推理模型', capabilities: ['推理', '编程', '工具调用', '长文本'], contextLength: 131072 },
      { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', description: 'DeepSeek官方V4高速模型，速度快成本低', capabilities: ['推理', '编程', '快速', '低成本'], contextLength: 65536 },
      { id: 'deepseek-r1', name: 'DeepSeek-R1', description: '深度推理模型，适合复杂推理任务', capabilities: ['推理', '长文本'], contextLength: 65536 },
      { id: 'deepseek-v3', name: 'DeepSeek-V3', description: '综合能力强，性价比高', capabilities: ['推理', '编程', '工具调用', '低成本'], contextLength: 65536 },
    ],
    按能力选模型: {
      '推理': { model: 'deepseek-v4-pro' },
      '编程': { model: 'deepseek-v4-pro' },
      '快速': { model: 'deepseek-v4-flash' },
      '低成本': { model: 'deepseek-v4-flash' },
      '工具调用': { model: 'deepseek-v4-pro' },
    },
    能力: ['推理', '编程', '快速', '低成本', '工具调用']
  },
  GLM: {
    名称: 'glm',
    端点: 'https://open.bigmodel.cn/api/paas/v4',
    模型: ['glm-5.1', 'glm-5', 'glm-4v', 'glm-4-flash'],
    推荐模型: [
      { id: 'glm-5.1', name: 'GLM-5.1', description: '智谱最新模型，推理能力最强', capabilities: ['推理', '编程', '长文本', '工具调用', '多语言'], contextLength: 128000 },
      { id: 'glm-5', name: 'GLM-5', description: '智谱最新模型，推理能力强', capabilities: ['推理', '编程', '长文本', '工具调用'], contextLength: 128000 },
      { id: 'glm-4v', name: 'GLM-4V', description: '智谱视觉模型', capabilities: ['多模态', '视觉'], contextLength: 128000 },
      { id: 'glm-4-flash', name: 'GLM-4-Flash', description: '智谱快速模型', capabilities: ['快速', '低成本'], contextLength: 128000 },
    ],
    按能力选模型: {
      '推理': { model: 'glm-5.1' },
      '编程': { model: 'glm-5.1' },
      '快速': { model: 'glm-4-flash' },
      '低成本': { model: 'glm-4-flash' },
      '工具调用': { model: 'glm-5.1' },
      '多模态': { model: 'glm-4v' },
      '视觉': { model: 'glm-4v' },
    },
    能力: ['推理', '编程', '快速', '低成本', '工具调用', '多模态', '视觉', '多语言']
  },
  自定义: {
    名称: 'custom',
    端点: process.env.CUSTOM_BASE_URL || 'https://cxai2.yuwan-game.com/v1',
    默认模型: 'gpt-4o-mini',
    模型: [
      // ========== Claude 系列（最强推理+编程）==========
      'claude-sonnet-4-6', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-5-20250929-thinking',
      'claude-opus-4-6', 'claude-opus-4-5-20251101', 'claude-opus-4-5-20251101-thinking',
      'claude-haiku-4-5-20251001',
      // ========== GPT 系列（通用+编程）==========
      'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano',
      'gpt-5', 'gpt-5-mini', 'gpt-5-nano',
      'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini',
      'gpt-3.5-turbo-1106', 'gpt-3.5',
      // ========== Gemini 系列（多模态）==========
      'gemini-3-flash-preview', 'gemini-3-pro-preview', 'gemini-3-pro-image-preview',
      'gemini-2.5-flash-image', 'gemini-2.5-flash-lite',
      // ========== 图像生成模型 ==========
      'gpt-image-1',
      // ========== Embedding 模型 ==========
      'text-embedding-3-large', 'text-embedding-3-small', 'text-embedding-ada-002'
    ],
    推荐模型: [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', description: '最新推理+编程，速度快', capabilities: ['推理', '编程', '工具调用', '创意', '快速'], contextLength: 200000 },
      { id: 'gpt-4o-mini', name: 'GPT-4o-Mini', description: '通用快速模型，性价比高', capabilities: ['推理', '编程', '快速', '低成本', '工具调用'], contextLength: 128000 },
      { id: 'gpt-5-mini', name: 'GPT-5-Mini', description: '新一代推理模型', capabilities: ['推理', '编程', '工具调用'], contextLength: 128000 },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', description: '最强推理能力', capabilities: ['推理', '编程', '创意', '长文本'], contextLength: 200000 },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', description: '极速响应，低成本', capabilities: ['快速', '低成本', '推理'], contextLength: 200000 },
    ],
    按能力选模型: {
      '推理': { model: 'claude-sonnet-4-6' },
      '编程': { model: 'claude-sonnet-4-6' },
      '创意': { model: 'claude-sonnet-4-6' },
      '快速': { model: 'gpt-4o-mini' },
      '低成本': { model: 'gpt-4o-mini' },
      '长文本': { model: 'claude-sonnet-4-6' },
      '多模态': { model: 'gemini-3-flash-preview' },
      '视觉': { model: 'claude-sonnet-4-6' },
      '图片理解': { model: 'claude-sonnet-4-6' },
      '工具调用': { model: 'claude-sonnet-4-6' },
      '多语言': { model: 'claude-sonnet-4-6' },
      '数学推理': { model: 'claude-opus-4-6' },
      '图片生成': { model: 'gpt-image-1' }
    },
    能力: ['推理', '编程', '创意', '快速', '长文本', '多模态', '视觉', '图片理解', '图片生成', '工具调用', '多语言', '低成本', '数学推理', '向量嵌入']
  }
};

// ==================== 名称映射 ====================
// 提供商名称映射已从 common/模型配置.js 统一导入（通过常量.js 转发）
// 环境变量键名映射也统一由 PROVIDER_ENV_KEYS 管理，此处仅做兼容导出
export { PROVIDER_NAME_MAP as 提供商名称映射 } from '../常量.js';
export { PROVIDER_ENV_KEYS as 环境变量键名映射 } from '../常量.js';
