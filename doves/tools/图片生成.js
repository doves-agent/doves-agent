/**
 * @file tools/图片生成
 * @description 文生图与图像编辑工具，调用阿里百炼图像生成模型
 */

import { imageTools } from './图片生成/工具定义.js';
import { generateImage, generateImageBatch } from './图片生成/文生图.js';
import { editImage } from './图片生成/图像编辑.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('图片生成', { 前缀: '[图片生成]', 级别: 'debug', 显示调用位置: true });

export async function handleImageTool(name, args) {
  const text = (content) => ({
    content: [{
      type: 'text',
      text: typeof content === 'string' ? content : JSON.stringify(content, null, 2)
    }]
  });
  
  try {
    switch (name) {
      case '图片生成':
        return text(await generateImage(args));
        
      case '批量图片生成':
        return text(await generateImageBatch(args));
        
      case '图片编辑':
        return text(await editImage(args));
        
      default:
        return {
          content: [{ type: 'text', text: 'Unknown image tool: ' + name }],
          isError: true
        };
    }
  } catch (error) {
    logger.error(`图片工具错误: ${error.message}`);
    return text({ success: false, error: error.message });
  }
}

export { imageTools };

export default { imageTools, handleImageTool };
