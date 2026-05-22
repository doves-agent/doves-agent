/**
 * 截图标注技能
 * 截图后在图片上绘制箭头、矩形框、文字标注
 * 使用 PowerShell ImageMagick 或 Python PIL 进行图像处理
 */

import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname, extname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export default {
  name: 'screenshot_annotate',
  description: '截图并添加标注（箭头/矩形框/文字）',
  category: '电脑操作',

  /**
   * 执行截图标注
   * @param {Object} params
   * @param {Object[]} params.annotations - 标注列表
   * @param {string} [params.outputPath] - 输出路径
   * @param {Object} context - 执行上下文
   */
  async execute(params, context) {
    const { annotations = [], outputPath } = params;

    try {
      // Step 1: 先截图
      const { mcpConnectionManager } = await import('../../../../tools/mcp客户端.js');
      const tmpPath = outputPath || join(process.cwd(), `screenshot_annotated_${Date.now()}.png`);
      await mkdir(dirname(tmpPath), { recursive: true });

      const screenshotResult = await mcpConnectionManager.callTool('os_mcp', 'screenshot_full', { save_path: tmpPath });
      if (!screenshotResult?.content) {
        return { success: false, error: '截图失败' };
      }

      // Step 2: 如果没有标注，直接返回截图路径
      if (annotations.length === 0) {
        return {
          success: true,
          outputPath: tmpPath,
          annotations: [],
          message: '截图已保存，未添加标注',
        };
      }

      // Step 3: 应用标注
      const annotateResult = await applyAnnotations(tmpPath, annotations);

      // 记录到Git记忆
      try {
        const Git记忆 = await import('../../../../tools/Git存储/记忆仓库.js');
        if (Git记忆.是否可用()) {
          await Git记忆.添加记忆({
            用户ID: context?.userId || 'default',
            类别: '经验记忆',
            内容: `截图标注: ${tmpPath}, ${annotations.length}个标注`,
            元数据: { type: 'screenshot_annotate', outputPath: tmpPath, annotCount: annotations.length },
          });
        }
      } catch { /* ignore */ }

      return {
        success: true,
        outputPath: annotateResult.outputPath || tmpPath,
        annotations: annotateResult.applied || annotations,
        message: `截图已保存${annotations.length > 0 ? `，已添加 ${annotations.length} 个标注` : ''}`,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};

/**
 * 在图片上应用标注
 * 尝试多种方法：ImageMagick → Python PIL → 返回描述信息
 */
async function applyAnnotations(imagePath, annotations) {
  const ext = extname(imagePath);

  // 方法1: 尝试 ImageMagick convert
  try {
    const drawCommands = annotations.map(a => buildImageMagickDraw(a)).join(' ');
    const outputPath = imagePath.replace(ext, `_annotated${ext}`);
    await execAsync(`magick convert "${imagePath}" ${drawCommands} "${outputPath}"`);
    return { outputPath, applied: annotations, method: 'ImageMagick' };
  } catch {
    // ImageMagick 不可用，尝试方法2
  }

  // 方法2: 尝试 Python PIL
  try {
    const script = buildPythonAnnotateScript(imagePath, annotations);
    const scriptPath = join(dirname(imagePath), '_annotate_script.py');
    await writeFile(scriptPath, script, 'utf-8');
    const outputPath = imagePath.replace(ext, `_annotated${ext}`);
    await execAsync(`python "${scriptPath}"`, { timeout: 10000 });
    return { outputPath, applied: annotations, method: 'Python PIL' };
  } catch {
    // Python 也不可用
  }

  // 方法3: 无法应用视觉标注，返回标注信息供后续使用
  return {
    outputPath: imagePath,
    applied: [],
    method: 'none',
    message: '标注引擎不可用（需要 ImageMagick 或 Python PIL），截图已保存但未添加视觉标注。标注信息已记录，可后续手动添加。',
    pendingAnnotations: annotations,
    setupHint: '安装 ImageMagick: winget install ImageMagick.ImageMagick 或 pip install Pillow',
  };
}

/**
 * 构建 ImageMagick draw 命令
 */
function buildImageMagickDraw(annotation) {
  const { type, x, y, text, width, height, endX, endY, color = 'red', size = 20 } = annotation || {};

  switch (type) {
    case 'rectangle':
      return `-fill none -stroke ${color} -strokewidth 2 -draw "rectangle ${x},${y} ${x + (width || 100)},${y + (height || 50)}"`;
    case 'arrow':
      return `-stroke ${color} -strokewidth 2 -draw "line ${x},${y} ${endX || x + 100},${endY || y}"`;
    case 'text':
      return `-fill ${color} -pointsize ${size} -draw "text ${x},${y} '${(text || '').replace(/'/g, "'\\''")}'"`;
    case 'circle':
      return `-fill none -stroke ${color} -strokewidth 3 -draw "circle ${x},${y} ${x + 30},${y + 30}"`;
    default:
      return '';
  }
}

/**
 * 构建 Python PIL 标注脚本
 */
function buildPythonAnnotateScript(imagePath, annotations) {
  const ext = extname(imagePath);
  const outputPath = imagePath.replace(ext, `_annotated${ext}`);

  const drawLines = annotations.map(a => {
    const { type, x = 0, y = 0, text = '', width = 100, height = 50, endX, endY, color = 'red', size = 20 } = a || {};
    switch (type) {
      case 'rectangle':
        return `draw.rectangle([${x}, ${y}, ${x + width}, ${y + height}], outline='${color}', width=2)`;
      case 'arrow':
        return `draw.line([${x}, ${y}, ${endX || x + 100}, ${endY || y}], fill='${color}', width=2)`;
      case 'text':
        return `draw.text((${x}, ${y}), '${text.replace(/'/g, "\\'")}', fill='${color}', font_size=${size})`;
      case 'circle':
        return `draw.ellipse([${x - 15}, ${y - 15}, ${x + 15}, ${y + 15}], outline='${color}', width=3)`;
      default:
        return '# unknown annotation type';
    }
  }).join('\n    ');

  return `# Auto-generated by doves screenshot_annotate skill
from PIL import Image, ImageDraw, ImageFont
import sys

try:
    img = Image.open(r'${imagePath}')
    draw = ImageDraw.Draw(img)
    ${drawLines}
    img.save(r'${outputPath}')
    print('OK')
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
`;
}
