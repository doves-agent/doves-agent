/**
 * 百炼 Embedding API 封装
 * 支持 text-embedding-v3（文本）和 multimodal-embedding-v1（万物向量化）
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('向量服务', { 前缀: '[Embedding]' });

const API_HOST = 'https://dashscope.aliyuncs.com';
const 文本向量路径 = '/api/v1/services/embeddings/text-embedding/text-embedding';
const 多模态向量路径 = '/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding';

const 默认文本模型 = 'text-embedding-v3';
const 默认多模态模型 = 'multimodal-embedding-v1';
const 默认维度 = 1024;
const 最大批量 = 10;
const 最大重试 = 3;

function 获取API密钥() {
  const key = process.env.BAILIAN_API_KEY;
  if (!key) throw new Error('BAILIAN_API_KEY 环境变量未设置');
  return key;
}

async function 请求百炼(路径, body, 重试次数 = 0) {
  const response = await fetch(`${API_HOST}${路径}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${获取API密钥()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const result = await response.json();

  if (result.code) {
    if (result.code === 'Throttling' && 重试次数 < 最大重试) {
      const 等待时间 = Math.pow(2, 重试次数) * 1000;
      logger.warn(`限流，${等待时间}ms 后重试 (${重试次数 + 1}/${最大重试})`);
      await new Promise(r => setTimeout(r, 等待时间));
      return 请求百炼(路径, body, 重试次数 + 1);
    }
    throw new Error(`百炼API错误: ${result.code} - ${result.message}`);
  }

  return result;
}

/**
 * 文本向量化
 * @param {string[]} texts - 文本数组（最多10条）
 * @param {object} options - { dimension: 1024, text_type: 'document'|'query' }
 * @returns {number[][]} 向量数组
 */
export async function 文本向量化(texts, options = {}) {
  if (!texts || texts.length === 0) return [];

  const { dimension = 默认维度, text_type = 'document' } = options;
  const 结果向量 = [];

  // 分批处理
  for (let i = 0; i < texts.length; i += 最大批量) {
    const 批次 = texts.slice(i, i + 最大批量);

    const result = await 请求百炼(文本向量路径, {
      model: 默认文本模型,
      input: { texts: 批次 },
      parameters: { text_type, dimension }
    });

    for (const item of result.output.embeddings) {
      结果向量.push(item.embedding);
    }
  }

  return 结果向量;
}

/**
 * 单文本向量化（便捷方法）
 */
export async function 单文本向量化(text, options = {}) {
  const [向量] = await 文本向量化([text], options);
  return 向量;
}

/**
 * 查询向量化（text_type=query，用于搜索）
 */
export async function 查询向量化(query, options = {}) {
  return 单文本向量化(query, { ...options, text_type: 'query' });
}

/**
 * 多模态向量化
 * @param {object[]} contents - 内容数组，每个元素: { text?, image?, audio?, video? }
 * @returns {{ embeddings: number[][], usage: object }}
 */
export async function 多模态向量化(contents) {
  if (!contents || contents.length === 0) return { embeddings: [], usage: {} };

  const 格式化内容 = contents.map(item => {
    const content = {};
    if (item.text) content.text = item.text;
    if (item.image) content.image = item.image;
    if (item.audio) content.audio = item.audio;
    if (item.video) content.video = item.video;
    return content;
  });

  const result = await 请求百炼(多模态向量路径, {
    model: 默认多模态模型,
    input: { contents: 格式化内容 },
    parameters: {}
  });

  return {
    embeddings: result.output.embeddings.map(e => e.embedding),
    usage: result.usage || {}
  };
}

/**
 * 多模态单条向量化（便捷方法）
 */
export async function 单多模态向量化(content) {
  const { embeddings } = await 多模态向量化([content]);
  return embeddings[0];
}

export const 配置 = {
  默认文本模型,
  默认多模态模型,
  默认维度,
  最大批量
};
