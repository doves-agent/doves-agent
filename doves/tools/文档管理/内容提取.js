/**
 * 文档管理 - 内容提取
 * 支持多种文档格式的内容提取
 */
import { readFileSync } from 'fs';
import { extname } from 'path';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('内容提取', { 前缀: '[文档管理]', 级别: 'debug', 显示调用位置: true });

/**
 * 提取文件内容
 */
export async function extractContent(filePath, encoding) {
  const ext = extname(filePath).toLowerCase();

  try {
    switch (ext) {
      case '.txt': case '.md': case '.json': case '.csv':
      case '.html': case '.xml': case '.js': case '.ts':
      case '.css': case '.py': case '.java': case '.c':
      case '.cpp': case '.h':
        return readFileSync(filePath, encoding);

      case '.pdf':
        return await extractPdfContent(filePath);
      case '.docx':
        return await extractDocxContent(filePath);
      case '.xlsx':
        return await extractXlsxContent(filePath);
      case '.pptx':
        return await extractPptxContent(filePath);
      default:
        try { return readFileSync(filePath, encoding); }
        catch (e) {
          logger.debug(`无法读取文件内容: ${filePath} | ${e.message}`);
          return '[二进制文件，无法提取文本内容]';
        }
    }
  } catch (error) {
        logger.error(`提取内容失败: ${filePath}`, error);
    return `[内容提取失败: ${error.message}]`;
  }
}

/**
 * 提取 PDF 内容
 */
async function extractPdfContent(filePath) {
  try {
    const pdfParse = await import('pdf-parse').catch(() => null);
    if (pdfParse) {
      const buffer = readFileSync(filePath);
      const data = await pdfParse.default(buffer);
      return data.text;
    }
  } catch (e) {
        logger.warn(`pdf-parse 不可用: ${e.message}`);
  }
  return '[PDF文件，需要安装 pdf-parse 库来提取内容]';
}

/**
 * 提取 DOCX 内容
 */
async function extractDocxContent(filePath) {
  try {
    const mammoth = await import('mammoth').catch(() => null);
    if (mammoth) {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    }
  } catch (e) {
        logger.warn(`mammoth 不可用: ${e.message}`);
  }
  return '[DOCX文件，需要安装 mammoth 库来提取内容]';
}

/**
 * 提取 XLSX 内容
 */
async function extractXlsxContent(filePath) {
  try {
    const XLSX = await import('xlsx').catch(() => null);
    if (XLSX) {
      const workbook = XLSX.readFile(filePath);
      const sheets = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        sheets.push(`=== ${sheetName} ===\n${csv}`);
      }
      return sheets.join('\n\n');
    }
  } catch (e) {
        logger.warn(`xlsx 库不可用: ${e.message}`);
  }
  return '[XLSX文件，需要安装 xlsx 库来提取内容]';
}

/**
 * 提取 PPTX 内容
 */
async function extractPptxContent(filePath) {
  try {
    const buffer = readFileSync(filePath);
    const slides = [];

    let offset = 0;
    const localFileHeaderSig = 0x04034B50;

    while (offset < buffer.length - 30) {
      const sig = buffer.readUInt32LE(offset);
      if (sig !== localFileHeaderSig) { offset++; continue; }

      const compressionMethod = buffer.readUInt16LE(offset + 8);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const fileNameLen = buffer.readUInt16LE(offset + 26);
      const extraFieldLen = buffer.readUInt16LE(offset + 28);

      const fileName = buffer.toString('utf8', offset + 30, offset + 30 + fileNameLen);
      const dataStart = offset + 30 + fileNameLen + extraFieldLen;
      const dataEnd = dataStart + compressedSize;

      if (fileName.startsWith('ppt/slides/slide') && fileName.endsWith('.xml')) {
        let content = '';
        if (compressionMethod === 0) {
          content = buffer.toString('utf8', dataStart, dataEnd);
        } else if (compressionMethod === 8) {
          try {
            const { inflateSync } = await import('zlib');
            const decompressed = inflateSync(buffer.subarray(dataStart, dataEnd));
            content = decompressed.toString('utf8');
          } catch (e) { logger.warn(`幻灯片解压失败: ${fileName}`); }
        }

        if (content) {
          const text = extractTextFromPptxXml(content);
          const slideNum = fileName.match(/slide(\d+)/)?.[1] || slides.length + 1;
          slides.push({ slide: parseInt(slideNum), text });
        }
      }
      offset = dataEnd;
    }

    if (slides.length === 0) return '[PPTX文件，未找到幻灯片内容]';

    slides.sort((a, b) => a.slide - b.slide);
    return slides.map(s => `=== 幻灯片 ${s.slide} ===\n${s.text}`).join('\n\n');
  } catch (e) {
        logger.warn(`PPTX 原生解析失败: ${e.message}`);
    return `[PPTX文件，内容提取失败: ${e.message}]`;
  }
}

/**
 * 从 PPTX 幻灯片 XML 中提取文本
 */
function extractTextFromPptxXml(xml) {
  const paragraphs = xml.split(/<a:p[^>]*>/);
  const result = [];
  for (const para of paragraphs) {
    const paraTexts = [];
    const tRegex = /<a:t>([^<]*)<\/a:t>/g;
    let m;
    while ((m = tRegex.exec(para)) !== null) {
      paraTexts.push(decodeXmlEntities(m[1]));
    }
    if (paraTexts.length > 0) result.push(paraTexts.join(''));
  }
  return result.join('\n');
}

/**
 * 解码 XML 实体
 */
function decodeXmlEntities(text) {
  const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.split(entity).join(char);
  }
  return result;
}
