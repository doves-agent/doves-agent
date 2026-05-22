/**
 * 元素拆解工具 - 主入口
 * 3个工具：element_analyze / element_extract / element_pack
 *
 * 核心能力：万相2.7图像编辑模型驱动的智能元素拆解
 * - 识图识别元素（视觉模型，要求标注置信度）
 * - 组图模式批量拆解元素（wan2.7-image-pro，一次性拆出所有元素）
 * - 打包上传OSS（zip，UTF-8编码）
 *
 * 内部模块：_tool-defs / _wan-api / _image-utils / _pack-utils
 * 导出格式：extTools / handleExtTool / extToolCategories / extToolAbilityMap / extToolSafetyLevels
 */

import { mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { callVisionLLM } from '../../llm-service.js';
import config from '../_config.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

// 内部模块
import { extTools, extToolCategories, extToolAbilityMap, extToolSafetyLevels, MAX_BATCH_SIZE } from './_tool-defs.js';
import { callWanModel, getWanApiKey, WAN_MODEL } from './_wan-api.js';
import {
  buildImageContent, getWanImageUrl, buildExtractPrompt, buildGroupExtractPrompt,
  parseElementsFromLLM, replaceBackground,
  downloadImageToLocal, sanitizeFileName, cleanupDir,
} from './_image-utils.js';
import { createZip } from './_pack-utils.js';

const logger = 创建日志器('元素拆解', { 前缀: '[元素拆解]', 级别: 'debug', 显示调用位置: true });

// ==================== 通用工具执行入口 ====================

const text = (content) => ({
  content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }]
});

export async function handleExtTool(name, args) {
  try {
    switch (name) {
      case 'element_analyze':
        return await handleElementAnalyze(args);
      case 'element_extract':
        return await handleElementExtract(args);
      case 'element_pack':
        return await handleElementPack(args);
      default:
        return null; /* 不处理此工具，交给链中下一个处理器 */
    }
  } catch (e) {
    logger.error(`工具 ${name} 执行失败:`, e.message);
    return text({ error: `工具执行失败: ${e.message}` });
  }
}

// ==================== element_analyze 实现 ====================

async function handleElementAnalyze(args) {
  const { imageUrl, prompt = '' } = args;

  logger.debug('--- handleElementAnalyze 入口 ---');
  logger.debug(`imageUrl: ${imageUrl?.substring(0, 120) || '(无)'}`);
  logger.debug(`prompt: ${prompt || '(无)'}`);

  if (!imageUrl) {
    return text({ success: false, error: '请提供原图URL（imageUrl）' });
  }

  logger.info(`分析图片元素: ${imageUrl.substring(0, 80)}...`);

  try {
    const imageContent = await buildImageContent(imageUrl);
    if (!imageContent) {
      return text({ success: false, error: '图片路径无效或不支持（data URI 不支持，请先上传 OSS）' });
    }
    const basePrompt = `请分析这张图片，找出图中所有可以独立拆解出来的物体/元素。

识别原则：
1. 优先识别实物物体（建筑、车辆、家具、人物、动物、物品、装饰等），也识别边界清晰的图标和文字区域
2. 每个元素应该是独立可分离的实体
3. 不要遗漏小型独立物体（图标、装饰品、小物件等）
4. 为每个元素标注置信度（confidence，0-1），你有多确定它真实存在于图中
5. 尽量多识别，宁可多列一些让后续过滤，也不要遗漏
6. 优先识别最显著、最大的元素放在列表前面

请返回严格JSON格式（不要markdown标记）：
{"elements":[{"name":"元素名称","description":"元素特征描述（颜色/形状/位置/大小等）","position":"元素在图中的位置描述","priority":数字1-5（1=最重要/最大，5=最不重要/最小）,"confidence":0-1之间的浮点数（识别置信度）}]}`;

    const userMessage = prompt
      ? `请分析这张图片，根据用户需求"${prompt}"，识别图中所有可以独立拆解出来的元素。\n\n${basePrompt.split('\n').slice(6).join('\n')}`
      : basePrompt;

    const result = await callVisionLLM({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: userMessage },
          imageContent,
        ],
      }],
      temperature: config.analyze.temperature,
      max_tokens: config.analyze.maxTokens,
    });

    logger.debug(`callVisionLLM 结果: success=${result.success}, content长度=${result.content?.length || 0}`);
    if (!result.success) {
      logger.error(`视觉模型调用失败: ${result.error}`);
      return text({ success: false, error: `视觉模型调用失败: ${result.error}` });
    }

    logger.debug(`视觉模型原始返回(前300字符): ${result.content?.substring(0, 300)}`);
    let elements = parseElementsFromLLM(result.content);

    if (elements.length === 0) {
      logger.info(`主模型(${result.model || '视觉模型'})未识别到元素`);
    }

    // 过滤低置信度元素
    const minConfidence = 0.5;
    const filteredElements = elements.filter(e => (e.confidence ?? 1.0) >= minConfidence);

    if (filteredElements.length < elements.length) {
      logger.info(`置信度过滤: ${elements.length} → ${filteredElements.length} 个元素 (阈值≥${minConfidence})`);
    }

    logger.info(`识别到 ${filteredElements.length} 个可拆元素`);

    return text({
      success: true,
      elementCount: filteredElements.length,
      elements: filteredElements,
      rawElementCount: elements.length,
      confidenceFilter: `阈值≥${minConfidence}，过滤掉 ${elements.length - filteredElements.length} 个低置信度元素`,
      hint: filteredElements.length > 0
        ? `已识别 ${filteredElements.length} 个元素，可使用 element_extract 组图模式批量拆解（每批最多${MAX_BATCH_SIZE}个）`
        : '未识别到可拆元素（置信度不足或图中无可拆物体）',
    });
  } catch (error) {
    logger.error('元素分析失败:', error);
    return text({ success: false, error: error.message });
  }
}

// ==================== element_extract 实现 ====================

/**
 * 组图模式拆解：一次性将所有元素发给 Wan，每个元素独立输出一张图
 *
 * 设计依据：用户手动调用 Wan 2.7 的组图生成模式效果远优于逐个元素单独调用。
 * Wan 2.7 在一次性理解整个图的结构后，能更准确地定位和拆解每个元素。
 *
 * 分批策略：每批最多 MAX_BATCH_SIZE 个元素，组图模式一次性拆出
 */
async function handleElementExtract(args) {
  const { imageUrl, elements = [], size = '2K', background = 'white' } = args;

  logger.debug('--- handleElementExtract 入口（组图模式） ---');
  logger.debug(`imageUrl: ${imageUrl?.substring(0, 120) || '(无)'}`);
  logger.debug(`elements: [${elements.map(e => e.name).join(', ')}] (${elements.length}个)`);
  logger.debug(`size=${size}, background=${background}`);

  if (!imageUrl) {
    return text({ success: false, error: '请提供原图URL（imageUrl）' });
  }
  if (elements.length === 0) {
    return text({ success: false, error: '请提供要拆解的元素列表（elements）' });
  }

  const apiKey = getWanApiKey();
  logger.debug(`API Key: ${apiKey ? apiKey.substring(0, 8) + '...' : '(未配置!)'}`);
  if (!apiKey) {
    return text({ success: false, error: '未配置百炼 API Key，请设置 BAILIAN_API_KEY 环境变量' });
  }

  logger.info(`组图模式拆解 ${elements.length} 个元素: ${elements.map(e => e.name).join(', ')}`);

  // 统一校验图片 URL 可用性
  logger.debug(`校验图片 URL, 原始: ${imageUrl.substring(0, 80)}...`);
  const wanImageUrl = await getWanImageUrl(imageUrl);
  logger.debug(`getWanImageUrl 返回: ${wanImageUrl?.substring(0, 120) || '(null)'}...`);
  if (!wanImageUrl || wanImageUrl.startsWith('__upload_failed__')) {
    return text({ success: false, error: '图片路径无效或不支持（data URI 不支持，请先上传 OSS；本地文件上传 OSS 失败）' });
  }

  try {
    const extractedElements = [];

    // ===== 组图模式：分批拆解 =====
    for (let batchStart = 0; batchStart < elements.length; batchStart += MAX_BATCH_SIZE) {
      const batch = elements.slice(batchStart, batchStart + MAX_BATCH_SIZE);
      const batchIndex = Math.floor(batchStart / MAX_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(elements.length / MAX_BATCH_SIZE);

      logger.info(`组图拆解 第 ${batchIndex}/${totalBatches} 批: ${batch.length} 个元素 → [${batch.map(e => e.name).join(', ')}]`);

      const groupPrompt = buildGroupExtractPrompt(batch);
      const n = batch.length;

      const requestBody = {
        model: WAN_MODEL,
        input: {
          messages: [{
            role: 'user',
            content: [
              { image: wanImageUrl },
              { text: groupPrompt },
            ],
          }],
        },
        parameters: { size, n, watermark: config.wan.watermark },
      };

      logger.debug(`第${batchIndex}批 调用 callWanModel: n=${n}`);
      const result = await callWanModel(apiKey, requestBody);
      logger.debug(`第${batchIndex}批 callWanModel 结果: success=${result.success}, imageUrl=${result.imageUrl?.substring(0, 80) || '(无)'}, imageUrls数=${result.imageUrls?.length || 0}, error=${result.error || '(无)'}`);

      if (result.success) {
        // 收集结果图片 URL（单图 或 多图组图返回）
        const resultUrls = [];
        if (result.imageUrls && result.imageUrls.length > 0) {
          resultUrls.push(...result.imageUrls);
        } else if (result.imageUrl) {
          resultUrls.push(result.imageUrl);
        }

        logger.debug(`第${batchIndex}批 返回 ${resultUrls.length} 张图，预期 ${batch.length} 个元素`);

        // 按顺序映射：返回的图片按顺序对应元素列表
        for (let i = 0; i < batch.length; i++) {
          const url = resultUrls[i] || null;
          if (url) {
            let finalUrl = url;
            if (background !== 'white') {
              finalUrl = await replaceBackground(url, background);
            }
            extractedElements.push({
              name: batch[i].name, description: batch[i].description || '',
              imageUrl: finalUrl, background, status: 'success',
            });
            logger.info(`元素 ${batch[i].name} 拆解成功 (背景: ${background})`);
          } else {
            extractedElements.push({
              name: batch[i].name, description: batch[i].description || '',
              imageUrl: null, status: 'failed',
              error: '组图返回图片数量不足，该元素未获得对应输出',
            });
            logger.warn(`元素 ${batch[i].name} 拆解失败: 组图返回不足`);
          }
        }
      } else {
        // 整批失败
        logger.warn(`第${batchIndex}批组图拆解失败: ${result.error}`);
        for (const element of batch) {
          extractedElements.push({
            name: element.name, description: element.description || '',
            imageUrl: null, status: 'failed',
            error: result.error || '组图拆解失败',
          });
        }
      }
    }

    const successCount = extractedElements.filter(e => e.status === 'success').length;
    const failedCount = extractedElements.filter(e => e.status === 'failed').length;

    logger.info(`组图拆解完成: ${successCount} 成功, ${failedCount} 失败 (共 ${elements.length} 个)`);

    return text({
      success: successCount > 0,
      extractedElements,
      background,
      successCount,
      failedCount,
      totalCount: elements.length,
      mode: '组图模式',
      hint: successCount > 0
        ? `组图模式拆解完成：${successCount}/${elements.length} 个成功${failedCount > 0 ? `，${failedCount} 个失败` : ''}（${background === 'white' ? '白底' : background === 'black' ? '黑底' : '透明底'}）。可继续拆解更多或使用 element_pack 打包`
        : '所有元素拆解失败，建议检查元素描述是否准确或原图质量是否足够',
    });
  } catch (error) {
    logger.error('元素拆解失败:', error);
    return text({ success: false, error: error.message });
  }
}

// ==================== element_pack 实现 ====================

async function handleElementPack(args) {
  const { elements = [], zipName } = args;

  if (elements.length === 0) {
    return text({ success: false, error: '请提供拆解出的元素列表（elements）' });
  }

  const validElements = elements.filter(e => e.imageUrl && e.status !== 'failed');
  if (validElements.length === 0) {
    return text({ success: false, error: '没有成功的拆解结果可打包' });
  }

  logger.info(`打包 ${validElements.length} 个元素`);

  const workDir = join(tmpdir(), `element-extract-${randomUUID()}`);
  mkdirSync(workDir, { recursive: true });

  try {
    // 1. 下载所有元素图片
    const localFiles = [];
    for (const element of validElements) {
      const safeName = sanitizeFileName(element.name);
      const bg = element.background || 'white';
      const bgLabel = bg === 'black' ? '_黑底' : bg === 'transparent' ? '_透明底' : '';
      const localPath = join(workDir, `${safeName}${bgLabel}.png`);

      logger.info(`下载元素: ${element.name}`);
      const downloaded = await downloadImageToLocal(element.imageUrl, localPath);

      if (downloaded) {
        localFiles.push({ name: element.name, path: localPath });
      } else {
        logger.warn(`下载失败，跳过元素: ${element.name}`);
      }
    }

    if (localFiles.length === 0) {
      return text({ success: false, error: '所有元素图片下载失败' });
    }

    // 2. 打包为zip（UTF-8 编码）
    const zipFileName = zipName || `元素拆解_${Date.now()}.zip`;
    const zipPath = join(workDir, zipFileName);
    await createZip(localFiles, zipPath, workDir, sanitizeFileName);

    // 3. 上传zip到OSS（传文件路径，ali-oss SDK 内部 createReadStream 流式上传，不占内存）
    const uploadResult = await uploadToOSS(`${config.oss.pathPrefix}${zipFileName}`, zipPath);

    // 4. 清理
    // cleanupDir(workDir);

    if (uploadResult.success) {
      logger.info(`zip已上传到OSS: ${uploadResult.url || uploadResult.ossPath}`);
      return text({
        success: true,
        zipUrl: uploadResult.url,
        ossPath: uploadResult.ossPath,
        elementCount: localFiles.length,
        fileNames: localFiles.map(f => f.name),
        hint: `已打包 ${localFiles.length} 个元素并上传到OSS，用户可下载zip文件`,
      });
    } else {
      return text({
        success: false,
        error: `OSS上传失败: ${uploadResult.error}`,
        elementCount: localFiles.length,
        fileNames: localFiles.map(f => f.name),
        hint: 'OSS上传失败，请检查OSS配置',
      });
    }
  } catch (error) {
    logger.error('打包上传失败:', error);
    cleanupDir(workDir);
    return text({ success: false, error: error.message });
  }
}

// ==================== OSS上传 ====================

/**
 * 上传到OSS（通过DoveAppContext ctx.oss，受权限管控）
 * @param {string} ossPath - OSS 目标路径
 * @param {Buffer|string} content - 文件内容（Buffer）或本地文件路径（ali-oss SDK 内部流式上传）
 * 
 * ctx.oss 不可用时直接返回错误，禁止绕过权限管控直接 import OSS适配器
 */
async function uploadToOSS(ossPath, content) {
  try {
    const { getAppContext } = await import('../_app-context.js');
    const ctx = getAppContext();
    if (ctx?.oss) {
      // ctx.oss.upload(content, filename) → content 在前，filename 在后
      const result = await ctx.oss.upload(content, ossPath);
      // OSS适配器 返回中文 key：{ 成功, 网址, 路径, 错误 }
      if (result?.成功 === true || result?.网址 || result?.路径) {
        return { success: true, url: result.网址 || result.路径, ossPath };
      }
      if (result?.data?.url) {
        return { success: true, url: result.data.url, ossPath };
      }
      // 明确失败
      return { success: false, error: result?.错误 || result?.error || 'ctx.oss上传失败' };
    }
    // ctx.oss 不可用 = 权限未声明或未授权，直接返回错误
    return { success: false, error: 'OSS 权限不可用（ctx.oss 未注入），请检查 manifest permissions.storage.oss 声明' };
  } catch (e) {
    return { success: false, error: `OSS上传异常: ${e.message}` };
  }
}

// ==================== 默认导出 ====================

export default {
  extTools,
  handleExtTool,
  extToolCategories,
  extToolAbilityMap,
  extToolSafetyLevels,
};
