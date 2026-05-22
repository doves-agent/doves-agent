/**
 * 元素拆解技能
 * 万相2.7图像编辑模型驱动的智能元素拆解（组图模式）
 * 
 * 直接调用工具函数完成全流程：识图→组图拆解→打包
 * 不依赖 LLM 工具调用发现，确保无论规划器如何分配 skill 都能正常执行
 */

import { handleExtTool } from '../../tools/元素拆解工具.js';
import config from '../../_config.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

/**
 * 从任务描述文本中提取图片路径
 * 支持：Windows路径(C:\xxx)、Unix路径(/xxx)、HTTP URL
 */
function extractImageUrlFromTask(taskText) {
  if (!taskText || typeof taskText !== 'string') return null;

  // 1. 带引号的路径（Windows/Unix均可，引号内可含空格）
  const quotedMatch = taskText.match(/["']([A-Za-z]:[\\\/][^"']+?\.(?:png|jpg|jpeg|gif|bmp|webp))["']/i);
  if (quotedMatch) return quotedMatch[1];

  // 2. 图片路径前缀 + Windows路径
  const winPrefixMatch = taskText.match(/(?:图片路径|image|路径|path)[:\s]*([A-Za-z]:[\\\/][^\s"'<>]+?\.(?:png|jpg|jpeg|gif|bmp|webp))/i);
  if (winPrefixMatch) return winPrefixMatch[1];

  // 3. 图片路径前缀 + Unix路径
  const unixPrefixMatch = taskText.match(/(?:图片路径|image|路径|path)[:\s]*(\/[^\s"'<>]+?\.(?:png|jpg|jpeg|gif|bmp|webp))/i);
  if (unixPrefixMatch) return unixPrefixMatch[1];

  // 4. 裸 Windows 路径 (C:\path\file.png)
  const winMatch = taskText.match(/([A-Za-z]:[\\\/][^\s"'<>]+?\.(?:png|jpg|jpeg|gif|bmp|webp))/i);
  if (winMatch) return winMatch[1];

  // 5. 裸 Unix 路径 (/path/file.png)
  const unixMatch = taskText.match(/(\/[^\s"'<>]+?\.(?:png|jpg|jpeg|gif|bmp|webp))/i);
  if (unixMatch) return unixMatch[1];

  // 6. HTTP URL
  const urlMatch = taskText.match(/(https?:\/\/\S+\.(?:png|jpg|jpeg|gif|bmp|webp))/i);
  if (urlMatch) return urlMatch[1];

  return null;
}

/**
 * 从任务描述中提取背景模式
 */
function extractBackgroundFromTask(taskText) {
  if (!taskText) return 'white';
  if (/透明底|透明背景|transparent/i.test(taskText)) return 'transparent';
  if (/黑底|黑色背景|black/i.test(taskText)) return 'black';
  return 'white';
}

const logger = 创建日志器('元素拆解-技能', { 前缀: '[element_extract]', 级别: 'debug', 显示调用位置: true });

/**
 * 执行全流程：识图→组图拆解→打包
 * 直接调用工具函数，不依赖 LLM 工具调用发现
 */
async function execute(args, context) {
  const task = args.task || '';
  const imageUrl = args.imageUrl || extractImageUrlFromTask(task);
  const background = extractBackgroundFromTask(task);
  const prompt = args.prompt || '';

  logger.debug('=== element_extract 技能执行入口 ===');
  logger.debug(`args: ${JSON.stringify(args).substring(0, 300)}`);
  logger.debug(`task文本(前200字符): ${task.substring(0, 200)}`);
  logger.debug(`提取imageUrl: ${imageUrl?.substring(0, 120) || '(未提取到)'}`);
  logger.debug(`提取background: ${background}`);
  logger.debug(`prompt: ${prompt || '(无)'}`);

  logger.info(`开始元素拆解: imageUrl=${imageUrl || '(未提供)'}, background=${background}`);

  if (!imageUrl) {
    return { 成功: false, 错误: '请提供图片路径（imageUrl）或在任务描述中包含图片路径' };
  }

  try {
    // Step 1: 分析图片元素（视觉模型，含置信度过滤）
    logger.info('Step 1/3: 分析图片元素...');
    logger.debug(`调用 element_analyze, imageUrl=${imageUrl?.substring(0, 80)}...`);
    const analyzeResult = await handleExtTool('element_analyze', { imageUrl, prompt });

    logger.debug(`element_analyze 返回: content长度=${analyzeResult?.content?.[0]?.text?.length || 0}`);

    if (!analyzeResult?.content?.[0]?.text) {
      return { 成功: false, 错误: '元素分析未返回有效结果' };
    }

    let analyzeData;
    try {
      analyzeData = JSON.parse(analyzeResult.content[0].text);
    } catch (e) {
      return { 成功: false, 错误: `元素分析结果解析失败: ${e.message}` };
    }

    if (!analyzeData.success || !analyzeData.elements?.length) {
      return { 成功: false, 错误: analyzeData.error || '未识别到可拆元素（置信度不足或图中无可拆物体）' };
    }

    const elements = analyzeData.elements;
    logger.info(`识别到 ${elements.length} 个元素${analyzeData.confidenceFilter ? `（${analyzeData.confidenceFilter}）` : ''}`);

    // Step 2: 组图模式批量拆解（每批最多4个，一次 Wan 调用拆出整批）
    const BATCH_SIZE = config.process.maxBatchSize;
    const totalBatches = Math.ceil(elements.length / BATCH_SIZE);
    logger.info(`Step 2/3: 组图模式拆解 ${totalBatches} 批 (共 ${elements.length} 个元素)...`);

    const allExtractedElements = [];

    for (let batchStart = 0; batchStart < elements.length; batchStart += BATCH_SIZE) {
      const batch = elements.slice(batchStart, batchStart + BATCH_SIZE);
      const batchIndex = Math.floor(batchStart / BATCH_SIZE) + 1;
      logger.info(`  组图拆解 第 ${batchIndex}/${totalBatches} 批 (${batch.length} 个元素)...`);
      logger.debug(`  本批元素: [${batch.map(e => e.name).join(', ')}]`);

      const extractResult = await handleExtTool('element_extract', {
        imageUrl,
        elements: batch,
        background,
        size: '2K',
      });

      logger.debug(`  element_extract 工具返回: content长度=${extractResult?.content?.[0]?.text?.length || 0}`);

      if (!extractResult?.content?.[0]?.text) {
        logger.warn(`  第 ${batchIndex} 批拆解无结果`);
        continue;
      }

      let extractData;
      try {
        extractData = JSON.parse(extractResult.content[0].text);
      } catch (e) {
        logger.warn(`  第 ${batchIndex} 批拆解结果解析失败`);
        continue;
      }

      if (extractData.extractedElements) {
        const batchSuccess = extractData.extractedElements.filter(e => e.status === 'success');
        allExtractedElements.push(...batchSuccess);
        logger.info(`  第 ${batchIndex} 批完成: ${batchSuccess.length}/${batch.length} 成功 (组图模式)`);
      }
    }

    if (allExtractedElements.length === 0) {
      return { 成功: false, 错误: '所有元素拆解失败，无法打包。建议检查元素描述是否准确' };
    }

    // Step 3: 打包上传
    logger.info(`Step 3/3: 打包 ${allExtractedElements.length} 个元素...`);
    logger.debug(`待打包元素: [${allExtractedElements.map(e => e.name).join(', ')}]`);
    const packResult = await handleExtTool('element_pack', {
      elements: allExtractedElements,
    });

    logger.debug(`element_pack 返回: content长度=${packResult?.content?.[0]?.text?.length || 0}`);

    if (!packResult?.content?.[0]?.text) {
      return { 成功: false, 错误: '打包未返回有效结果' };
    }

    let packData;
    try {
      packData = JSON.parse(packResult.content[0].text);
    } catch (e) {
      return { 成功: false, 错误: `打包结果解析失败: ${e.message}` };
    }

    logger.info(`元素拆解完成: ${allExtractedElements.length} 个元素已拆解并${packData.success ? '上传成功' : '上传失败'}`);
    if (packData.zipUrl) {
      logger.info(`下载链接: ${packData.zipUrl}`);
    }

    return {
      成功: packData.success || false,
      数据: {
        elementCount: allExtractedElements.length,
        elements: allExtractedElements.map(e => ({ name: e.name, imageUrl: e.imageUrl })),
        zipUrl: packData.zipUrl || null,
        ossPath: packData.ossPath || null,
        background,
        mode: '组图模式',
      },
      提示: packData.success
        ? `成功拆解 ${allExtractedElements.length} 个元素（组图模式），zip下载: ${packData.zipUrl || packData.ossPath || '请查看OSS'}`
        : `元素已拆解但打包上传失败: ${packData.error || '未知错误'}`,
    };

  } catch (error) {
    logger.error(`元素拆解执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'element_extract',
  description: '元素拆解技能 - 万相2.7组图模式智能元素拆解，识图→组图拆解→打包',
  abilities: ['元素拆解', '图片拆元素', '元素提取', '图像分割'],

  parameters: {
    type: 'object',
    properties: {
      imageUrl: { type: 'string', description: '原图URL或本地路径' },
      prompt: { type: 'string', description: '用户提示词，指导识别/拆解哪些元素' },
    },
  },

  execute
};
