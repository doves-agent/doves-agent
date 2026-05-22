/**
 * OCR/视觉识别服务
 * 调用百炼视觉模型，从图片/视频中提取英文单词列表
 *
 * 【合规修复】所有 LLM 调用走 llm-service 合规管道，
 * 不再使用原生 https.request 直连 API。
 * - API Key：通过环境变量自动获取（与白鸽系统一致）
 * - 日志/重试/Token 统计：由提供商客户端自动处理
 * - 模型选择：走白鸽模型配置体系（默认视觉模型/快速模型）
 */
import { callVisionLLM, callLLM } from '../../llm-service.js';
import { 默认快速模型 } from '../../../常量.js';

/**
 * 从图片中识别英文单词
 * @param {string} imageUrl - 图片 URL 或 base64 data URI
 * @returns {Promise<Array>} [{ word, context }]
 */
export async function extractWordsFromImage(imageUrl) {
  const messages = [
    {
      role: 'system',
      content: '从图片中识别所有英文单词，返回结构化JSON。',
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `请仔细分析这张图片，识别其中出现的所有英文单词。对于每个单词，提供：
1. word: 单词本身（小写）
2. context: 该单词在图片中出现的上下文（如所在的句子或标题）

请严格按照以下 JSON 格式返回，不要添加其他内容：
{"words": [{"word": "example", "context": "This is an example sentence"}]}`,
        },
        {
          type: 'image_url',
          image_url: { url: imageUrl },
        },
      ],
    },
  ];

  // 使用合规视觉模型调用
  const result = await callVisionLLM({
    messages,
    temperature: 0.1,
    max_tokens: 4000,
    enable_thinking: false,
  });

  if (!result.success) {
    return { words: [], raw: '', error: result.error };
  }

  const response = result.content;
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { words: [], raw: response, error: '无法解析模型返回的JSON' };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return { words: parsed.words || [], raw: response };
  } catch {
    return { words: [], raw: response, error: 'JSON解析失败' };
  }
}

/**
 * 从视频分析文本中提取英文单词
 * @param {string} videoText - 视频字幕/分析结果文本
 * @returns {Promise<Array>} [{ word, context }]
 */
export async function extractWordsFromText(videoText) {
  const messages = [
    {
      role: 'system',
      content: '从文本中提取所有独立英文单词，返回结构化JSON。',
    },
    {
      role: 'user',
      content: `请从以下文本中提取所有独立的英文单词。忽略常见虚词（a, an, the, is, are, was, were, am, be, been, being, have, has, had, do, does, did, will, would, shall, should, may, might, can, could, must, of, in, on, at, to, for, with, by, from, as, into, through, during, before, after, above, below, between, out, off, over, under, again, further, then, once, here, there, when, where, why, how, all, both, each, few, more, most, other, some, such, no, nor, not, only, own, same, so, than, too, very, just, because, but, and, or, if, while, about, up, that, this, these, those, it, its, he, she, they, we, you, I, me, my, your, his, her, their, our, what, which, who, whom）。

对于每个单词，提供：
1. word: 单词本身（小写，原形）
2. context: 该单词出现的原始短语或句子

文本内容：
${videoText}

请严格按照以下 JSON 格式返回，不要添加其他内容：
{"words": [{"word": "example", "context": "This is an example"}]}`,
    },
  ];

  // 使用合规快速模型调用（文本提取不需要视觉模型）
  const result = await callLLM({
    messages,
    model: 默认快速模型,
    temperature: 0.1,
    max_tokens: 4000,
    enable_thinking: false,
  });

  if (!result.success) {
    return { words: [], raw: '', error: result.error };
  }

  const response = result.content;

  // 解析 JSON
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { words: [], raw: response, error: '无法解析模型返回的JSON' };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return { words: parsed.words || [], raw: response };
  } catch {
    return { words: [], raw: response, error: 'JSON解析失败' };
  }
}

/**
 * AI 辅助填充单词数据
 * @param {string} word - 单词
 * @param {Object} partial - 用户已填的部分数据
 * @returns {Promise<Object>} 完整的单词数据
 */
export async function aiFillWordData(word, partial = {}) {
  const emptyFields = [];
  if (!partial.phonetic) emptyFields.push('phonetic');
  if (!partial.definitions?.length) emptyFields.push('definitions');
  if (!partial.roots?.root) emptyFields.push('roots');
  if (!partial.syllables?.length) emptyFields.push('syllables');

  if (emptyFields.length === 0) {
    return { ...partial, auto_filled: [] };
  }

  const messages = [
    {
      role: 'system',
      content: '根据单词生成完整词汇数据，返回JSON。',
    },
    {
      role: 'user',
      content: `请为单词 "${word}" 生成以下缺失字段的数据：${emptyFields.join(', ')}

已有数据：${JSON.stringify(partial)}

请严格按照以下 JSON 格式返回完整的单词数据（包含已有和新增字段）：
{
  "word": "${word}",
  "phonetic": "/音标/",
  "syllables": [{"text":"音节","stress":true/false}],
  "roots": {"prefix":"前缀","root":"词根","suffix":"后缀","explanation":"解释"},
  "definitions": [{"pos":"词性","definition":"英文释义","meaning_cn":"中文释义","examples":["例句"]}],
  "synonyms": ["同义词"],
  "antonyms": ["反义词"],
  "phrases": [{"english":"短语","chinese":"中文"}],
  "difficulty_level": 3,
  "tags": ["标签"]
}

只返回JSON，不要其他内容。`,
    },
  ];

  // 使用合规快速模型调用
  const result = await callLLM({
    messages,
    model: 默认快速模型,
    temperature: 0.1,
    max_tokens: 4000,
    enable_thinking: false,
  });

  if (!result.success) {
    return { ...partial, auto_filled: [], error: result.error };
  }

  const response = result.content;

  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { ...partial, auto_filled: [], error: 'AI填充失败' };
  }

  try {
    const filled = JSON.parse(jsonMatch[0]);
    return { ...partial, ...filled, auto_filled: emptyFields };
  } catch {
    return { ...partial, auto_filled: [], error: 'AI填充JSON解析失败' };
  }
}
