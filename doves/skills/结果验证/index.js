/**
 * 结果验证技能
 * 
 * 验证任务结果与饲养员需求的匹配度：
 * - 将各类文档转换为图片
 * - 使用视觉 LLM 识别图片内容
 * - 与饲养员需求进行语义匹配
 * - 返回匹配度评分（0-100）
 */

import { 提供商客户端 } from '../../providers/index.js';
import { existsSync, readFileSync } from 'fs';
import { 默认推理模型, 默认视觉模型, getProviderApiKeyFromEnv } from '../../常量.js';

import { 创建日志器 } from '@dove/common/日志管理器.js';

// 日志器
const logger = 创建日志器('结果验证', { 前缀: '[结果验证]', 级别: 'debug', 显示调用位置: true });

// ============================================================================
// 文档转图片（内联实现）
// ============================================================================

/**
 * 简化的文档转图片
 * 直接读取图片文件，或为其他文档生成预览
 */
async function convertToImages(inputPath, content) {
  const images = [];
  
  // 如果是图片文件，直接读取
  if (inputPath) {
    const ext = inputPath.toLowerCase().split('.').pop();
    const imageExts = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
    
    if (imageExts.includes(ext)) {
      const buffer = readFileSync(inputPath);
      const mimeType = ext === 'png' ? 'image/png' :
                       ext === 'webp' ? 'image/webp' :
                       ext === 'gif' ? 'image/gif' : 'image/jpeg';
      
      images.push({
        data: buffer.toString('base64'),
        mimeType,
        url: `data:${mimeType};base64,${buffer.toString('base64')}`
      });
      
      return images;
    }
    
    // 尝试读取文本内容
    if (['txt', 'md', 'json', 'js', 'ts', 'html', 'css'].includes(ext)) {
      content = content || readFileSync(inputPath, 'utf-8');
    }
  }
  
  // 对于文本内容，生成简单的预览（或直接使用文本分析）
  if (content) {
    // 将文本内容作为分析输入
    images.push({
      type: 'text',
      content: content.substring(0, 10000)  // 限制长度
    });
  }
  
  return images;
}

// ============================================================================
// 视觉 LLM 调用
// ============================================================================

/**
 * 调用视觉模型分析图片
 */
async function analyzeWithVisionLLM(images, requirement, context) {
  // 获取 API 配置
  const apiKey = getProviderApiKeyFromEnv('百炼') ||
                 context?.systemConfig?.llm?.百炼?.apiKey;
    
  if (!apiKey) {
    throw new Error('未配置视觉模型 API Key（请设置 BAILIAN_API_KEY 环境变量）');
  }
  
  // 创建提供商客户端
  const client = new 提供商客户端('百炼', { API密钥: apiKey });
  
  // 构建消息
  const messages = [];
  
  // 添加图片内容
  const imageContents = [];
  for (const img of images) {
    if (img.type === 'text') {
      // 文本内容直接添加
      imageContents.push({
        type: 'text',
        text: `【文档内容】\n${img.content}`
      });
    } else if (img.url) {
      // 图片 URL
      imageContents.push({
        type: 'image_url',
        image_url: { url: img.url }
      });
    }
  }
  
  // 如果没有图片内容，使用文本分析
  if (imageContents.length === 0) {
    imageContents.push({
      type: 'text',
      text: '【无文档内容】'
    });
  }
  
  // 构建系统提示
  const systemPrompt = `分析文档内容，对比用户需求，给出匹配度评分。

严格返回JSON:
{
  "识别内容": "文档主要内容摘要",
  "匹配度": 数字(0-100),
  "评价": "高度匹配/部分匹配/不匹配",
  "分析": "详细分析说明",
  "建议": "改进建议（如有）"
}`;

  // 用户消息
  const userMessage = `请分析以下文档内容，判断是否满足用户需求。

【用户需求】
${requirement}

【文档内容】`;

  // 组合消息
  messages.push({
    role: 'system',
    content: systemPrompt
  });
  
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: userMessage },
      ...imageContents
    ]
  });
  
  // 调用视觉模型
  try {
    const result = await client.调用({
      model: 默认视觉模型,  // 使用视觉模型
      messages,
      temperature: 0.3,
      max_tokens: 2000
    });
    
    if (!result.成功) {
      throw new Error(result.错误 || '视觉模型调用失败');
    }
    
    return result.内容;
  } catch (error) {
    logger.error(`视觉模型调用失败: ${error.message}`);
    throw error;
  }
}

/**
 * 解析 LLM 返回的 JSON
 */
function parseValidationResult(content) {
  try {
    // 尝试直接解析
    let json = JSON.parse(content);
    return {
      识别内容: json.识别内容 || json.summary || '',
      匹配度: parseInt(json.匹配度 || json.score || 0),
      评价: json.评价 || json.rating || '未知',
      分析: json.分析 || json.analysis || '',
      建议: json.建议 || json.suggestion || ''
    };
  } catch {
    // 尝试从文本中提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // 继续使用默认解析
      }
    }
    
    // 从文本中提取评分
    const scoreMatch = content.match(/(\d+)\s*[分%]/);
    const score = scoreMatch ? parseInt(scoreMatch[1]) : 50;
    
    return {
      识别内容: content.substring(0, 500),
      匹配度: score,
      评价: score > 80 ? '高度匹配' : score > 50 ? '部分匹配' : '不匹配',
      分析: content,
      建议: ''
    };
  }
}

// ============================================================================
// 主执行函数
// ============================================================================

async function execute(args, context) {
  const {
    resultFile,         // 结果文件路径
    resultContent,      // 或者直接提供结果内容
    requirement,        // 饲养员需求
    detailLevel = 'full' // 分析详细程度：simple | full
  } = args;

  logger.info(`开始验证结果，需求: ${requirement?.substring(0, 50)}...`);

  try {
    // 参数验证
    if (!requirement) {
      return {
        成功: false,
        错误: '缺少必填参数: requirement（饲养员需求）',
        错误码: 'INVALID_PARAMS'
      };
    }

    if (!resultFile && !resultContent) {
      return {
        成功: false,
        错误: '请提供 resultFile 或 resultContent 参数',
        错误码: 'INVALID_PARAMS'
      };
    }

    // 检查文件是否存在
    if (resultFile && !existsSync(resultFile)) {
      return {
        成功: false,
        错误: `结果文件不存在: ${resultFile}`,
        错误码: 'FILE_NOT_FOUND'
      };
    }

    // 1. 将结果转换为可分析的格式
    logger.info('步骤 1: 转换文档格式...');
    const images = await convertToImages(resultFile, resultContent);
    
    if (images.length === 0) {
      return {
        成功: false,
        错误: '无法提取文档内容',
        错误码: 'CONTENT_EXTRACTION_FAILED'
      };
    }

    // 2. 使用视觉 LLM 分析内容
    logger.info('步骤 2: 调用视觉模型分析...');
    const analysisContent = await analyzeWithVisionLLM(images, requirement, context);
    
    // 3. 解析结果
    logger.info('步骤 3: 解析验证结果...');
    const result = parseValidationResult(analysisContent);

    logger.info(`验证完成，匹配度: ${result.匹配度}分`);

    return {
      成功: true,
      数据: {
        匹配度: result.匹配度,
        评价: result.评价,
        识别内容: result.识别内容,
        分析: result.分析,
        建议: result.建议,
        原始响应: detailLevel === 'full' ? analysisContent : undefined
      }
    };

  } catch (error) {
    logger.error(`验证失败: ${error.message}`);
    return {
      成功: false,
      错误: error.message,
      错误码: 'VALIDATION_ERROR'
    };
  }
}

// ============================================================================
// 导出
// ============================================================================

export default {
  name: '结果验证',
  description: '结果验证技能 - 验证任务结果与饲养员需求的匹配度，支持文档转图片+视觉LLM分析',

  // 内置技能，不需要拥有权检查
  需要拥有权: false,

  // 能力声明
  abilities: ['结果验证', '文档对比', '内容分析', '质量检查'],
  
  parameters: {
    type: 'object',
    properties: {
      resultFile: {
        type: 'string',
        description: '结果文件路径（PDF、图片、文本等）'
      },
      resultContent: {
        type: 'string',
        description: '结果内容（可选，与 resultFile 二选一）'
      },
      requirement: {
        type: 'string',
        description: '饲养员需求描述（必填）'
      },
      detailLevel: {
        type: 'string',
        enum: ['simple', 'full'],
        default: 'full',
        description: '分析详细程度'
      }
    },
    required: ['requirement']
  },
  
  execute
};
