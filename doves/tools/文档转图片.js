/**
 * @file tools/文档转图片
 * @description 将各类文档转换为图片，支持多页与 base64 编码
 * 
 * 设计原则：
 * - 优先使用系统命令（如 pdftoppm）
 * - pdftoppm 不可用时直接报错，不做降级
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, readdirSync, rmdirSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { tmpdir } from 'os';

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('文档转图片', { 前缀: '[文档转图片]', 级别: 'debug', 显示调用位置: true });

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 检查系统是否安装了 pdftoppm（Poppler 工具）
 */
function hasPdfToPpm() {
  try {
    execSync('pdftoppm -v', { stdio: 'ignore' });
    return true;
  } catch (e) {
    logger.debug(`pdftoppm 不可用: ${e.message}`);
    return false;
  }
}

/**
 * 检查是否在 Windows 上
 */
function isWindows() {
  return process.platform === 'win32';
}

/**
 * 使用 pdftoppm 将 PDF 转为图片
 */
async function convertPdfWithPdftoppm(pdfPath, outputDir, options = {}) {
  const { dpi = 150, format = 'png' } = options;
  const outputPrefix = join(outputDir, 'page');
  
  try {
    // pdftoppm -png -r 150 input.pdf output_prefix
    const cmd = `pdftoppm -${format} -r ${dpi} "${pdfPath}" "${outputPrefix}"`;
    logger.info(`执行命令: ${cmd}`);
    
    execSync(cmd, { 
      timeout: 60000,
      windowsHide: true 
    });
    
    // 收集生成的图片文件
    const files = readdirSync(outputDir)
      .filter(f => f.startsWith('page-') || f.startsWith('page'))
      .sort();
    
    const images = [];
    for (const file of files) {
      const filePath = join(outputDir, file);
      const buffer = readFileSync(filePath);
      const base64 = buffer.toString('base64');
      
      images.push({
        data: base64,
        mimeType: `image/${format}`,
        page: images.length + 1
      });
      
      // 清理临时文件
      unlinkSync(filePath);
    }
    
    return images;
  } catch (error) {
    logger.error(`pdftoppm 转换失败: ${error.message}`);
    throw error;
  }
}

/**
 * 使用 Canvas 渲染 PDF（纯 JS 方案，需要自行安装依赖）
 */
async function convertPdfWithCanvas(pdfPath, outputDir, options = {}) {
  throw new Error('pdftoppm 未安装，无法转换 PDF。请安装 poppler-utils: apt install poppler-utils / brew install poppler');
}

/**
 * 使用纯 JS 方案生成简单的文档预览图
 */
async function generatePreviewImage(content, options = {}) {
  // 尝试加载 canvas
  try {
    const canvasModule = await import('canvas');
    const { createCanvas } = canvasModule;
    
    const { width = 800, height = 1000 } = options;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // 填充白色背景
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    
    // 绘制边框
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 20, width - 40, height - 40);
    
    // 添加内容
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Document Preview', width / 2, 60);
    
    // 绘制文本内容
    if (content) {
      ctx.font = '14px Arial';
      ctx.textAlign = 'left';
      
      const lines = content.split('\n').slice(0, 40);
      let y = 100;
      
      for (const line of lines) {
        if (y > height - 60) break;
        
        // 截断过长行
        const maxChars = 70;
        const truncated = line.length > maxChars ? line.substring(0, maxChars) + '...' : line;
        ctx.fillText(truncated, 40, y);
        y += 22;
      }
    }
    
    // 添加页脚
    ctx.fillStyle = '#999999';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Generated at ${new Date().toISOString()}`, width / 2, height - 40);
    
    // 返回 base64
    const buffer = canvas.toBuffer('image/png');
    const base64 = buffer.toString('base64');
    
    return [{
      data: base64,
      mimeType: 'image/png',
      page: 1
    }];
    
  } catch (error) {
    throw error;
  }
}

// ============================================================================
// 主执行函数
// ============================================================================

/**
 * 将文档转换为图片
 * @param {Object} args - 参数
 * @param {Object} context - 上下文
 * @returns {Object} 结果
 */
async function execute(args, context) {
  const {
    inputPath,           // 输入文件路径
    content,             // 或者直接提供文本内容
    dpi = 150,           // 图片分辨率
    format = 'png',      // 输出格式
    maxPages = 10,       // 最大页数
    returnType = 'base64' // 返回类型：base64 | path
  } = args;

  logger.info(`开始转换文档: ${inputPath || '文本内容'}`);

  try {
    // 创建临时目录
    const tempDir = join(tmpdir(), 'dove-doc2img', Date.now().toString());
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    let images = [];

    // 根据输入类型选择转换方式
    if (inputPath) {
      // 检查文件是否存在
      if (!existsSync(inputPath)) {
        return {
          成功: false,
          错误: `文件不存在: ${inputPath}`,
          错误码: 'FILE_NOT_FOUND'
        };
      }

      const ext = extname(inputPath).toLowerCase();
      
      if (ext === '.pdf') {
        // PDF 文件转换
        if (!hasPdfToPpm()) {
          return {
            成功: false,
            错误: 'pdftoppm 未安装，无法转换 PDF。请安装 poppler-utils。',
            错误码: 'POPPLER_NOT_FOUND'
          };
        }
        images = await convertPdfWithPdftoppm(inputPath, tempDir, { dpi, format });
      } else if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
        // 已经是图片，直接读取
        const buffer = readFileSync(inputPath);
        const mimeType = ext === '.png' ? 'image/png' : 
                         ext === '.webp' ? 'image/webp' : 
                         ext === '.gif' ? 'image/gif' : 'image/jpeg';
        
        images = [{
          data: buffer.toString('base64'),
          mimeType,
          page: 1,
          path: inputPath
        }];
      } else {
        // 其他文档类型，尝试读取内容并生成预览
        const content = readFileSync(inputPath, 'utf-8');
        images = await generatePreviewImage(content.substring(0, 5000), { dpi });
      }
    } else if (content) {
      // 从文本内容生成预览图
      images = await generatePreviewImage(content.substring(0, 5000), { dpi });
    } else {
      return {
        成功: false,
        错误: '请提供 inputPath 或 content 参数',
        错误码: 'INVALID_PARAMS'
      };
    }

    // 限制页数
    if (images.length > maxPages) {
      logger.warn(`页数超过限制，只保留前 ${maxPages} 页`);
      images = images.slice(0, maxPages);
    }

    // 清理临时目录
    try {
      if (existsSync(tempDir)) {
        const files = readdirSync(tempDir);
        for (const file of files) {
          unlinkSync(join(tempDir, file));
        }
        rmdirSync(tempDir);
      }
    } catch (e) {
      logger.warn(`清理临时目录失败: ${e.message}`);
    }

    logger.info(`转换完成，共 ${images.length} 页`);

    return {
      成功: true,
      数据: {
        images: images,
        pageCount: images.length,
        format: format
      }
    };

  } catch (error) {
    logger.error(`转换失败: ${error.message}`);
    return {
      成功: false,
      错误: error.message,
      错误码: 'CONVERSION_ERROR'
    };
  }
}

// ============================================================================
// 导出
// ============================================================================

export default {
  name: '文档转图片',
  description: '将文档（PDF、图片等）转换为图片数组，支持多页文档，返回 base64 编码',
  
  parameters: {
    type: 'object',
    properties: {
      inputPath: {
        type: 'string',
        description: '输入文件路径（PDF、图片等）'
      },
      content: {
        type: 'string',
        description: '文本内容（可选，用于生成预览图）'
      },
      dpi: {
        type: 'number',
        default: 150,
        description: '图片分辨率（DPI）'
      },
      format: {
        type: 'string',
        enum: ['png', 'jpg', 'jpeg'],
        default: 'png',
        description: '输出图片格式'
      },
      maxPages: {
        type: 'number',
        default: 10,
        description: '最大转换页数'
      },
      returnType: {
        type: 'string',
        enum: ['base64', 'path'],
        default: 'base64',
        description: '返回类型'
      }
    },
    required: []
  },
  
  execute
};

// 导出工具函数
export {
  hasPdfToPpm,
  convertPdfWithPdftoppm,
  generatePreviewImage
};
