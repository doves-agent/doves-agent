/**
 * 元素拆解 - 图像处理工具集
 * PNG编解码、背景替换、图片下载、元素解析
 */

import zlib from 'zlib';
import https from 'https';
import { createHash } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import config from '../_config.js';
import { crc32 } from './_crc32.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('元素拆解-图像', { 前缀: '[元素拆解/图像]', 级别: 'debug', 显示调用位置: true });

// ==================== 图片内容构建 ====================

/**
 * 上传本地文件到 OSS（通过 DoveAppContext）
 * 禁止将本地文件转为 base64 内联，必须先上传 OSS 获取 URL
 *
 * @param {string} localPath - 本地文件路径
 * @param {string} [ossSubDir] - OSS 子目录
 * @returns {Promise<string|null>} OSS URL，失败返回 null
 */
async function uploadLocalFileToOSS(localPath, ossSubDir = 'images') {
  logger.debug(`上传本地文件到OSS: ${localPath} → ${ossSubDir}/`);
  try {
    const { getAppContext } = await import('../_app-context.js');
    const ctx = getAppContext();
    if (!ctx?.oss) {
      logger.error('DoveAppContext.oss 不可用，无法上传本地文件');
      return null;
    }

    const buffer = readFileSync(localPath);
    const ext = localPath.split('.').pop().toLowerCase();
    const hash = createHash('sha256').update(buffer).digest('hex').substring(0, 12);
    const ossPath = `${config.oss.pathPrefix}${ossSubDir}/${hash}.${ext}`;
    logger.debug(`OSS路径: ${ossPath}, 文件大小: ${buffer.length} bytes`);

    const result = await ctx.oss.upload(ossPath, buffer.toString('base64'));
    logger.debug(`OSS上传结果: ${JSON.stringify(result).substring(0, 200)}`);
    if (result?.url || result?.路径) return result.url || result.路径;
    if (result?.data?.url) return result.data.url;
    if (result?.success !== false) return result?.url || null;

    logger.warn(`OSS 上传失败: ${result?.error || result?.错误 || '未知错误'}`);
    return null;
  } catch (e) {
    logger.error(`本地文件上传 OSS 失败: ${e.message}`);
    return null;
  }
}

/**
 * 构建图片内容（本地文件先上传 OSS，禁止 base64 内联）
 *
 * @param {string} imageUrl - 图片路径（URL 或本地路径）
 * @returns {Promise<{ type: string, image_url: { url: string } }>}
 */
export async function buildImageContent(imageUrl) {
  logger.debug(`buildImageContent 输入: ${imageUrl?.substring(0, 100) || '(null)'}`);
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    logger.debug('URL类型: HTTP，直接使用');
    return { type: 'image_url', image_url: { url: imageUrl } };
  }
  if (imageUrl.startsWith('data:')) {
    // data URI 不支持，必须走 OSS 上传获取 URL
    logger.error(`检测到 data URI 内联图片，不支持此格式，请先上传 OSS: ${imageUrl.substring(0, 50)}...`);
    return null;
  }
  if (existsSync(imageUrl)) {
    // 本地文件：先上传 OSS，禁止转 base64 内联
    logger.debug('URL类型: 本地文件，上传OSS');
    const ossUrl = await uploadLocalFileToOSS(imageUrl);
    if (ossUrl) {
      logger.info(`本地文件已上传 OSS: ${imageUrl} → ${ossUrl.substring(0, 80)}...`);
      return { type: 'image_url', image_url: { url: ossUrl } };
    }
    // OSS 上传失败，返回错误标记
    logger.error(`本地文件上传 OSS 失败，无法构建图片内容: ${imageUrl}`);
    return { type: 'image_url', image_url: { url: `__upload_failed__${imageUrl}` } };
  }
  logger.debug('URL类型: 未知格式，原样传递');
  return { type: 'image_url', image_url: { url: imageUrl } };
}

/**
 * 构建万相模型的图片 URL（本地文件先上传 OSS，禁止 base64 内联）
 *
 * @param {string} imageUrl - 图片路径（URL 或本地路径）
 * @returns {Promise<string>}
 */
export async function getWanImageUrl(imageUrl) {
  logger.debug(`getWanImageUrl 输入: ${imageUrl?.substring(0, 100) || '(null)'}`);
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    logger.debug('URL类型: HTTP，直接使用');
    return imageUrl;
  }
  if (imageUrl.startsWith('data:')) {
    // data URI 不支持，必须走 OSS 上传获取 URL
    logger.error(`检测到 data URI 内联图片，不支持此格式，请先上传 OSS: ${imageUrl.substring(0, 50)}...`);
    return null;
  }
  if (existsSync(imageUrl)) {
    // 本地文件：先上传 OSS，禁止转 base64 内联
    logger.debug('URL类型: 本地文件，上传OSS(wan)');
    const ossUrl = await uploadLocalFileToOSS(imageUrl, 'wan-input');
    if (ossUrl) {
      logger.info(`本地文件已上传 OSS (wan): ${imageUrl} → ${ossUrl.substring(0, 80)}...`);
      return ossUrl;
    }
    // OSS 上传失败，返回错误标记
    logger.error(`本地文件上传 OSS 失败，无法传给万相模型: ${imageUrl}`);
    return `__upload_failed__${imageUrl}`;
  }
  logger.debug('URL类型: 未知格式，原样传递');
  return imageUrl;
}

// ==================== 提示词构建 ====================

/**
 * 构建拆解提示词（单个元素模式，保留兼容）
 * 新代码推荐使用 buildGroupExtractPrompt 组图模式
 */
export function buildExtractPrompt(element) {
  const desc = element.description ? `，特征为${element.description}` : '';
  const prompt = `将图中的"${element.name}"${desc}拆出来，保持该元素完整清晰，白色背景。原图中该元素所在位置用纯白色填充，使填充后的区域与周围背景自然融合，不要留下明显的修改痕迹。只输出拆出的元素图片，背景为纯白色。`;
  logger.debug(`buildExtractPrompt[${element.name}]: ${prompt.substring(0, 200)}`);
  return prompt;
}

/**
 * 构建组图拆解提示词（推荐）
 * 一次性请求 Wan 将所有元素拆出，每个元素单独一张图。
 * Wan 2.7 在组图模式下对整体结构的理解远优于逐个元素单独调用。
 *
 * 参照用户手动调用的成功经验：
 * "把里面所有的元素扣出来，给所有元素单独生成一张图，图的剩余部分用空白填充"
 *
 * @param {Array} elements - 元素列表 [{name, description}]
 * @returns {string} 组图拆解提示词
 */
export function buildGroupExtractPrompt(elements) {
  const names = elements.map(e => e.name).join('、');
  const descLines = elements.map((e, i) => {
    const desc = e.description ? `（${e.description}）` : '';
    return `${i + 1}. ${e.name}${desc}`;
  }).join('\n');

  const prompt = `从图中依次拆出以下 ${elements.length} 个元素，每个元素单独输出一张图，白色背景：

${descLines}

要求：
1. 严格按上述列表顺序输出，每个元素对应一张图
2. 每张图只包含对应的拆出元素，背景为纯白色
3. 原图中该元素位置用纯白色填充并与周围自然融合，不留修改痕迹
4. 保持元素完整清晰，不做额外修改或补充图中不存在的内容
5. 只输出拆出的元素图片，背景为纯白色`;

  logger.debug(`buildGroupExtractPrompt: ${elements.length}个元素 → [${names}]`);
  return prompt;
}

// ==================== 元素解析 ====================

/**
 * 解析LLM返回的元素列表
 */
export function parseElementsFromLLM(content) {
  if (!content || typeof content !== 'string') return [];

  let cleaned = content.replace(/<think[\s\S]*?<\/think>/gi, '').trim();

  const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) cleaned = codeBlockMatch[1].trim();

  const mapElement = (e, i) => ({
    name: e.name || `元素${i + 1}`,
    description: e.description || '',
    position: e.position || '',
    priority: e.priority || 3,
    confidence: e.confidence ?? 1.0,
  });

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.elements && Array.isArray(parsed.elements)) return parsed.elements.map(mapElement);
    if (Array.isArray(parsed)) return parsed.map(mapElement);
  } catch (e) {
    logger.warn(`JSON.parse 解析失败: ${e.message}`, {
      内容长度: cleaned.length,
      前200字符: cleaned.substring(0, 200),
      后200字符: cleaned.length > 200 ? cleaned.substring(cleaned.length - 200) : '',
    });
  }

  const elementsKey = cleaned.indexOf('"elements"');
  if (elementsKey >= 0) {
    const jsonFromElements = cleaned.substring(cleaned.lastIndexOf('{', elementsKey));
    const repaired = repairTruncatedElements(jsonFromElements);
    if (repaired && repaired.length > 0) return repaired.map(mapElement);
  }

  // 所有解析路径失败，记录完整原始内容便于快速定位问题
  logger.warn(`元素解析失败，所有解析路径均未成功，原始内容长度=${content.length}，详见debug日志`);
  logger.debug(`元素解析失败-完整原始内容:\n${content}`);
  return [];
}

/**
 * 修复截断的JSON
 */
function repairTruncatedElements(jsonStr) {
  let lastCompleteIdx = -1;
  for (let i = jsonStr.length - 1; i >= 0; i--) {
    if (jsonStr[i] === ',') {
      let j = i - 1;
      while (j >= 0 && /\s/.test(jsonStr[j])) j--;
      if (j >= 0 && jsonStr[j] === '}') {
        lastCompleteIdx = i;
        break;
      }
    }
  }

  if (lastCompleteIdx < 0) {
    for (const suffix of [']}', '}]', '}]}', '}]}}']) {
      try {
        const parsed = JSON.parse(jsonStr + suffix);
        if (parsed.elements && Array.isArray(parsed.elements) && parsed.elements.length > 0) return parsed.elements;
      } catch (e) {
        logger.warn(`截断修复尝试失败(无逗号边界 suffix=${suffix}): ${e.message}`);
      }
    }
    return null;
  }

  const truncated = jsonStr.substring(0, lastCompleteIdx);
  for (const suffix of [']}', ']}', '}]}', ']}}']) {
    try {
      const parsed = JSON.parse(truncated + suffix);
      if (parsed.elements && Array.isArray(parsed.elements) && parsed.elements.length > 0) {
        logger.info(`截断JSON恢复成功，解析出 ${parsed.elements.length} 个元素`);
        return parsed.elements;
      }
    } catch (e) {
      logger.warn(`截断修复尝试失败(有逗号边界 suffix=${suffix}): ${e.message}`);
    }
  }
  return null;
}

// ==================== 背景替换 ====================

/**
 * 背景替换：将模型输出的白底图片转换为黑底或透明底
 * 透明底优先上传OSS返回URL，降级返回data URI
 */
export async function replaceBackground(imageUrl, background) {
  if (background === 'white') return imageUrl;

  const workDir = join(tmpdir(), `element-bg-${randomUUID()}`);
  mkdirSync(workDir, { recursive: true });

  try {
    const inputPath = join(workDir, 'input.png');
    const downloaded = await downloadImageToLocal(imageUrl, inputPath);
    if (!downloaded) {
      logger.warn('背景替换：图片下载失败，返回原始URL');
      return imageUrl;
    }

    const pngBuffer = readFileSync(inputPath);
    const rgba = decodePNG(pngBuffer);
    if (!rgba) {
      logger.warn('背景替换：PNG解码失败，返回原始URL');
      return imageUrl;
    }

    const { width, height, data } = rgba;
    const { whiteThreshold, edgeThreshold } = config.background;

    for (let i = 0; i < width * height; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];

      if (background === 'black') {
        if (r >= whiteThreshold && g >= whiteThreshold && b >= whiteThreshold) {
          data[i * 4] = 0;
          data[i * 4 + 1] = 0;
          data[i * 4 + 2] = 0;
        }
      } else if (background === 'transparent') {
        if (r >= whiteThreshold && g >= whiteThreshold && b >= whiteThreshold) {
          data[i * 4 + 3] = 0;
        } else if (r >= edgeThreshold && g >= edgeThreshold && b >= edgeThreshold) {
          const maxChannel = Math.max(r, g, b);
          const alpha = Math.round(255 * (whiteThreshold - maxChannel) / (whiteThreshold - edgeThreshold));
          data[i * 4 + 3] = Math.max(0, Math.min(255, alpha));
        }
      }
    }

    const outputBuffer = encodePNG(width, height, data, background);

    // 优先上传 OSS，OSS 失败时返回错误（禁止 base64 降级）
    const ossUrl = await uploadBufferToOSS(outputBuffer, `${config.oss.pathPrefix}bg_${Date.now()}.png`);
    if (ossUrl) {
      logger.info(`背景替换完成: white → ${background}，已上传OSS (${width}x${height})`);
      cleanupDir(workDir);
      return ossUrl;
    }

    // OSS 上传失败，不降级到 base64，返回错误信息
    logger.error(`背景替换 OSS 上传失败 (${width}x${height})，不降级到 base64`);
    cleanupDir(workDir);
    return imageUrl;  // 返回原始 URL（白底图）
  } catch (error) {
    logger.error(`背景替换失败: ${error.message}`);
    cleanupDir(workDir);
    return imageUrl;
  }
}

/**
 * 上传Buffer到OSS（通过DoveAppContext）
 */
async function uploadBufferToOSS(buffer, ossPath) {
  try {
    const { getAppContext } = await import('../_app-context.js');
    const ctx = getAppContext();
    if (ctx?.oss) {
      const result = await ctx.oss.upload(ossPath, buffer.toString('base64'));
      if (result?.url || result?.路径) return result.url || result.路径;
      if (result?.data?.url) return result.data.url;
    }
  } catch (e) {
    logger.warn(`OSS上传失败: ${e.message}`);
  }
  return null;
}

// ==================== PNG 编解码 ====================

/**
 * 解码PNG为RGBA像素数据
 */
export function decodePNG(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) {
    logger.error('不是有效的PNG文件');
    return null;
  }

  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  let idatData = [];
  let offset = 8;

  while (offset < buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkType = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const chunkData = buffer.subarray(offset + 8, offset + 8 + chunkLength);

    if (chunkType === 'IHDR') {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8];
      colorType = chunkData[9];
    } else if (chunkType === 'IDAT') {
      idatData.push(chunkData);
    } else if (chunkType === 'IEND') {
      break;
    }
    offset += 12 + chunkLength;
  }

  if (width === 0 || height === 0 || idatData.length === 0) {
    logger.error('PNG缺少必要数据');
    return null;
  }

  const compressed = Buffer.concat(idatData);
  let rawPixels;
  try {
    rawPixels = zlib.inflateSync(compressed);
  } catch {
    logger.error('PNG deflate解压失败');
    return null;
  }

  const channels = colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 1;
  const bytesPerPixel = channels * (bitDepth / 8);
  const stride = 1 + width * bytesPerPixel;

  if (rawPixels.length < height * stride) {
    logger.error(`PNG像素数据不完整: 期望 ${height * stride} 字节, 实际 ${rawPixels.length} 字节`);
    return null;
  }

  const rgba = new Uint8Array(width * height * 4);
  const prevLine = new Uint8Array(width * bytesPerPixel);

  for (let y = 0; y < height; y++) {
    const lineOffset = y * stride;
    const filterType = rawPixels[lineOffset];
    const lineData = rawPixels.subarray(lineOffset + 1, lineOffset + 1 + width * bytesPerPixel);
    const curLine = new Uint8Array(width * bytesPerPixel);

    for (let x = 0; x < width * bytesPerPixel; x++) {
      const raw = lineData[x] || 0;
      const a = x >= bytesPerPixel ? curLine[x - bytesPerPixel] : 0;
      const b = prevLine[x] || 0;
      const c = x >= bytesPerPixel ? prevLine[x - bytesPerPixel] : 0;

      switch (filterType) {
        case 0: curLine[x] = raw; break;
        case 1: curLine[x] = (raw + a) & 0xFF; break;
        case 2: curLine[x] = (raw + b) & 0xFF; break;
        case 3: curLine[x] = (raw + ((a + b) >> 1)) & 0xFF; break;
        case 4: curLine[x] = (raw + paethPredictor(a, b, c)) & 0xFF; break;
        default: curLine[x] = raw;
      }
    }

    for (let x = 0; x < width; x++) {
      const srcIdx = x * bytesPerPixel;
      const dstIdx = (y * width + x) * 4;

      if (colorType === 2) {
        rgba[dstIdx] = curLine[srcIdx]; rgba[dstIdx + 1] = curLine[srcIdx + 1];
        rgba[dstIdx + 2] = curLine[srcIdx + 2]; rgba[dstIdx + 3] = 255;
      } else if (colorType === 6) {
        rgba[dstIdx] = curLine[srcIdx]; rgba[dstIdx + 1] = curLine[srcIdx + 1];
        rgba[dstIdx + 2] = curLine[srcIdx + 2]; rgba[dstIdx + 3] = curLine[srcIdx + 3];
      } else if (colorType === 0) {
        rgba[dstIdx] = curLine[srcIdx]; rgba[dstIdx + 1] = curLine[srcIdx];
        rgba[dstIdx + 2] = curLine[srcIdx]; rgba[dstIdx + 3] = 255;
      } else if (colorType === 4) {
        rgba[dstIdx] = curLine[srcIdx]; rgba[dstIdx + 1] = curLine[srcIdx];
        rgba[dstIdx + 2] = curLine[srcIdx]; rgba[dstIdx + 3] = curLine[srcIdx + 1];
      } else {
        rgba[dstIdx] = 255; rgba[dstIdx + 1] = 255; rgba[dstIdx + 2] = 255; rgba[dstIdx + 3] = 255;
      }
    }
    prevLine.set(curLine);
  }
  return { width, height, data: rgba };
}

/**
 * 编码RGBA像素数据为PNG
 * 透明底图片使用 sub filter 优化体积，其他使用 None filter
 */
export function encodePNG(width, height, rgbaData, background = 'white') {
  const useSubFilter = background === 'transparent';
  const bytesPerPixel = 4; // RGBA
  const rawRowSize = width * bytesPerPixel;
  const rowSize = 1 + rawRowSize; // 1 byte filter + pixel data

  const chunks = [];
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  chunks.push(createChunk('IHDR', ihdr));

  const rawData = Buffer.alloc(height * rowSize);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowSize;
    const srcRowStart = y * rawRowSize;

    if (useSubFilter) {
      // Sub filter (1): 每个字节减去同通道前一个像素值，有效压缩渐变区域
      rawData[rowStart] = 1;
      for (let x = 0; x < width; x++) {
        const srcIdx = srcRowStart + x * bytesPerPixel;
        const dstIdx = rowStart + 1 + x * bytesPerPixel;
        for (let c = 0; c < bytesPerPixel; c++) {
          const cur = rgbaData[srcIdx + c];
          const prev = x > 0 ? rgbaData[srcIdx + c - bytesPerPixel] : 0;
          rawData[dstIdx + c] = (cur - prev) & 0xFF;
        }
      }
    } else {
      // None filter (0): 原始数据，适用于白底/黑底图片
      rawData[rowStart] = 0;
      for (let x = 0; x < width; x++) {
        const srcIdx = srcRowStart + x * bytesPerPixel;
        const dstIdx = rowStart + 1 + x * bytesPerPixel;
        rawData[dstIdx] = rgbaData[srcIdx]; rawData[dstIdx + 1] = rgbaData[srcIdx + 1];
        rawData[dstIdx + 2] = rgbaData[srcIdx + 2]; rawData[dstIdx + 3] = rgbaData[srcIdx + 3];
      }
    }
  }
  chunks.push(createChunk('IDAT', zlib.deflateSync(rawData)));
  chunks.push(createChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcVal = crc32(Buffer.concat([typeBuffer, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuf]);
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// ==================== 图片下载 & 文件工具 ====================

/**
 * 下载图片到本地（带超时控制）
 */
export async function downloadImageToLocal(url, localPath) {
  const DOWNLOAD_TIMEOUT = 30000; // 30秒超时

  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return await new Promise((resolve) => {
        const timer = setTimeout(() => {
          req.destroy();
          logger.warn(`下载图片超时: ${url.substring(0, 80)}`);
          resolve(false);
        }, DOWNLOAD_TIMEOUT);

        const req = https.get(url, (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            clearTimeout(timer);
            downloadImageToLocal(response.headers.location, localPath).then(resolve);
            return;
          }
          if (response.statusCode !== 200) {
            clearTimeout(timer);
            logger.warn(`下载图片失败，HTTP ${response.statusCode}: ${url.substring(0, 80)}`);
            resolve(false);
            return;
          }
          const file = createWriteStream(localPath);
          response.pipe(file);
          file.on('finish', () => { file.close(); clearTimeout(timer); resolve(true); });
          file.on('error', () => { clearTimeout(timer); resolve(false); });
        });
        req.on('error', () => { clearTimeout(timer); resolve(false); });
      });
    }
    if (url.startsWith('data:')) {
      const base64Match = url.match(/^data:image\/[^;]+;base64,(.+)$/);
      if (base64Match) {
        writeFileSync(localPath, Buffer.from(base64Match[1], 'base64'));
        return true;
      }
    }
    return false;
  } catch (error) {
    logger.error(`下载图片失败: ${error.message}`);
    return false;
  }
}

export function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '_').substring(0, 50) || 'element';
}

export function cleanupDir(dir) {
  try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); } catch (e) { logger.debug(`清理目录失败: ${e.message}`); }
}
