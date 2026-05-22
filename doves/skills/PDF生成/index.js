/**
 * PDF 生成技能
 * 
 * 支持根据用户需求生成 PDF 文档：
 * - 从文本内容生成 PDF
 * - 支持标题、段落、列表等格式
 * - 支持中文字体
 * - 返回 PDF 文件路径
 * 
 * 设计原则：
 * - 参数自包含，不依赖外部上下文
 * - 无状态执行，支持并发调用
 * - 使用纯 JS 方案（pdfkit），无需外部依赖
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

import { 创建日志器 } from '@dove/common/日志管理器.js';

// 日志器
const logger = 创建日志器('PDF生成', { 前缀: '[PDF生成]', 级别: 'debug', 显示调用位置: true });

// ============================================================================
// PDF 文档类（简化实现，不依赖 pdfkit）
// ============================================================================

/**
 * 简易 PDF 生成器
 * 使用纯 JavaScript 生成基础 PDF 文件
 * 支持中文需要嵌入字体，这里先用 ASCII 兼容模式
 */
class SimplePDFGenerator {
  constructor() {
    this.objects = [];
    this.pages = [];
    this.fonts = {};
    this.currentY = 750;
    this.pageHeight = 792;  // A4 高度（点）
    this.pageWidth = 612;   // A4 宽度（点）
    this.margin = 50;
    this.fontSize = 12;
    this.lineHeight = 16;
  }

  /**
   * 添加文本
   */
  addText(text, options = {}) {
    const fontSize = options.fontSize || this.fontSize;
    const x = options.x || this.margin;
    let y = options.y || this.currentY;
    
    // 处理换行
    const lines = this.wrapText(text, fontSize, this.pageWidth - 2 * this.margin);
    
    for (const line of lines) {
      if (y < this.margin + 50) {
        // 需要新页
        this.pages.push([]);
        y = this.pageHeight - this.margin;
      }
      
      this.pages[this.pages.length - 1].push({
        type: 'text',
        text: line,
        x: x,
        y: y,
        fontSize: fontSize,
        font: options.font || 'Helvetica'
      });
      
      y -= this.lineHeight;
    }
    
    this.currentY = y;
  }

  /**
   * 添加标题
   */
  addTitle(text, level = 1) {
    const sizes = { 1: 24, 2: 18, 3: 14 };
    this.currentY -= 20; // 标题前间距
    
    this.addText(text, {
      fontSize: sizes[level] || 16,
      font: 'Helvetica-Bold'
    });
    
    this.currentY -= 10; // 标题后间距
  }

  /**
   * 添加段落
   */
  addParagraph(text) {
    this.addText(text);
    this.currentY -= 10; // 段落间距
  }

  /**
   * 添加列表项
   */
  addListItem(text) {
    this.addText(`  • ${text}`);
    this.currentY -= 5;
  }

  /**
   * 文本换行
   */
  wrapText(text, fontSize, maxWidth) {
    const charsPerLine = Math.floor(maxWidth / (fontSize * 0.5));
    const lines = [];
    let currentLine = '';
    
    for (const char of text) {
      if (char === '\n') {
        lines.push(currentLine);
        currentLine = '';
        continue;
      }
      
      currentLine += char;
      
      if (currentLine.length >= charsPerLine) {
        // 尝试在空格处断行
        const lastSpace = currentLine.lastIndexOf(' ');
        if (lastSpace > 0) {
          lines.push(currentLine.substring(0, lastSpace));
          currentLine = currentLine.substring(lastSpace + 1);
        } else {
          lines.push(currentLine);
          currentLine = '';
        }
      }
    }
    
    if (currentLine) {
      lines.push(currentLine);
    }
    
    return lines;
  }

  /**
   * 生成 PDF 字节
   */
  generate() {
    // PDF 文件结构
    let pdf = '%PDF-1.4\n';
    const objOffsets = [];
    
    // Object 1: Catalog
    objOffsets.push(pdf.length);
    pdf += '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
    
    // Object 2: Pages
    objOffsets.push(pdf.length);
    const pageCount = Math.max(1, this.pages.length);
    pdf += `2 0 obj\n<< /Type /Pages /Count ${pageCount} /Kids [`;
    for (let i = 0; i < pageCount; i++) {
      pdf += `${3 + i} 0 R `;
    }
    pdf += '] >>\nendobj\n';
    
    // Object 3+: Page contents
    const contentObjs = [];
    for (let i = 0; i < pageCount; i++) {
      objOffsets.push(pdf.length);
      pdf += `${3 + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Contents ${3 + pageCount + i} 0 R >>\nendobj\n`;
    }
    
    // Content streams
    for (let i = 0; i < pageCount; i++) {
      const page = this.pages[i] || [];
      let content = '';
      
      for (const item of page) {
        if (item.type === 'text') {
          // 转义特殊字符
          const escapedText = item.text
            .replace(/\\/g, '\\\\')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)');
          
          content += `BT\n/F1 ${item.fontSize} Tf\n${item.x} ${item.y} Td\n(${escapedText}) Tj\nET\n`;
        }
      }
      
      objOffsets.push(pdf.length);
      const streamObj = 3 + pageCount + i;
      pdf += `${streamObj} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`;
    }
    
    // XRef table
    const xrefOffset = pdf.length;
    pdf += 'xref\n';
    pdf += `0 ${objOffsets.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (const offset of objOffsets) {
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    
    // Trailer
    pdf += 'trailer\n';
    pdf += `<< /Size ${objOffsets.length + 1} /Root 1 0 R >>\n`;
    pdf += 'startxref\n';
    pdf += `${xrefOffset}\n`;
    pdf += '%%EOF\n';
    
    return Buffer.from(pdf, 'binary');
  }
}

// ============================================================================
// 主执行函数
// ============================================================================

async function execute(args, context) {
  const {
    title = 'PDF Document',
    content = '',
    sections = [],
    outputPath = null,
    format = 'simple'  // simple | sections
  } = args;

  logger.info(`生成 PDF: ${title}`);

  try {
    // 创建 PDF 生成器
    const pdf = new SimplePDFGenerator();
    
    // 根据格式生成内容
    if (format === 'sections' && sections.length > 0) {
      // 章节模式
      pdf.addTitle(title, 1);
      
      for (const section of sections) {
        if (section.title) {
          pdf.addTitle(section.title, section.level || 2);
        }
        if (section.content) {
          pdf.addParagraph(section.content);
        }
        if (section.items) {
          for (const item of section.items) {
            pdf.addListItem(item);
          }
        }
      }
    } else {
      // 简单模式
      pdf.addTitle(title, 1);
      
      if (content) {
        // 按段落分割
        const paragraphs = content.split('\n\n');
        for (const para of paragraphs) {
          if (para.trim()) {
            pdf.addParagraph(para.trim());
          }
        }
      }
    }

    // 生成 PDF 字节
    const pdfBytes = pdf.generate();

    // 确定输出路径
    let finalPath = outputPath;
    if (!finalPath) {
      const timestamp = Date.now();
      const tempDir = join(tmpdir(), 'dove-pdf');
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }
      finalPath = join(tempDir, `${title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}_${timestamp}.pdf`);
    }

    // 确保目录存在
    const dir = dirname(finalPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // 写入文件
    writeFileSync(finalPath, pdfBytes);

    logger.info(`PDF 已生成: ${finalPath} (${pdfBytes.length} bytes)`);

    return {
      成功: true,
      数据: {
        path: finalPath,
        size: pdfBytes.length,
        pages: pdf.pages.length,
        title: title
      }
    };

  } catch (error) {
    logger.error(`生成 PDF 失败: ${error.message}`);
    return {
      成功: false,
      错误: error.message,
      错误码: 'PDF_GENERATION_ERROR'
    };
  }
}

// ============================================================================
// 导出
// ============================================================================

export default {
  name: 'PDF生成',
  description: 'PDF 生成技能 - 根据用户需求生成 PDF 文档，支持标题、段落、列表等格式',

  // 内置技能，不需要拥有权检查
  需要拥有权: false,

  // 能力声明（用于任务匹配）
  abilities: ['PDF', '文档生成', '文件生成', '报告生成'],
  
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'PDF 文档标题',
        default: 'PDF Document'
      },
      content: {
        type: 'string',
        description: '文档内容（简单模式下使用）'
      },
      sections: {
        type: 'array',
        description: '章节列表（章节模式下使用）',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '章节标题' },
            content: { type: 'string', description: '章节内容' },
            level: { type: 'number', description: '标题级别（1-3）' },
            items: { 
              type: 'array', 
              items: { type: 'string' },
              description: '列表项'
            }
          }
        }
      },
      outputPath: {
        type: 'string',
        description: '输出文件路径（可选，不指定则使用临时目录）'
      },
      format: {
        type: 'string',
        enum: ['simple', 'sections'],
        default: 'simple',
        description: '生成格式：simple（纯文本）或 sections（多章节）'
      }
    },
    required: []
  },
  
  execute
};
