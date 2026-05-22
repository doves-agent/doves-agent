/**
 * @file tools/图片生成/图像编辑
 * @description 图像编辑（局部重绘、扩展、修复、风格迁移等）
 */

import { readFileSync, existsSync } from 'fs';
import https from 'https';
import { downloadImage } from './任务管理.js';
import { getProviderApiKeyFromEnv, BAILIAN_API_HOST } from '../../常量.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('图像编辑', { 前缀: '[图片工具]', 级别: 'debug', 显示调用位置: true });

/**
 * 获取 API Key
 */
function getApiKey() {
  const envKey = getProviderApiKeyFromEnv('百炼');
  return envKey || null;
}

/**
 * 图像编辑
 */
async function editImage(args) {
  const { imagePath, editType, prompt, maskPath, scale = 2, outputPath } = args;
  
  if (!imagePath || !editType) {
    return { success: false, error: '请提供图片路径和编辑类型' };
  }
  
  const apiKey = getApiKey();
  if (!apiKey) {
    return { success: false, error: '未配置百炼 API Key' };
  }
  
  try {
    logger.info(`图像编辑: ${editType}`);
    
    let imageUrl = imagePath;
    
    if (!imagePath.startsWith('http://') && !imagePath.startsWith('https://')) {
      if (!existsSync(imagePath)) {
        return { success: false, error: '图片文件不存在' };
      }
      
      const buffer = readFileSync(imagePath);
      const ext = imagePath.split('.').pop().toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
      imageUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
    }
    
    // 根据编辑类型调用不同的API
    const apiPath = {
      inpaint: '/api/v1/services/aigc/image2image/image-inpainting',
      outpaint: '/api/v1/services/aigc/image2image/image-outpainting',
      upscale: '/api/v1/services/aigc/image2image/image-upsampling',
      style_transfer: '/api/v1/services/aigc/image2image/image-style-transfer',
      background_replace: '/api/v1/services/aigc/image2image/image-background-replacement'
    }[editType];
    
    if (!apiPath) {
      return { success: false, error: '不支持的编辑类型' };
    }
    
    const requestInput = {
      image_url: imageUrl
    };
    
    if (prompt) requestInput.prompt = prompt;
    if (maskPath) {
      if (!maskPath.startsWith('http')) {
        const maskBuffer = readFileSync(maskPath);
        requestInput.mask_image_url = `data:image/png;base64,${maskBuffer.toString('base64')}`;
      } else {
        requestInput.mask_image_url = maskPath;
      }
    }
    
    const parameters = {};
    if (editType === 'upscale') {
      parameters.scale = scale;
    }
    
    const requestData = JSON.stringify({
      model: editType === 'upscale' ? 'upscaler-v1' : 'style-transfer-v1',
      input: requestInput,
      parameters
    });
    
    return new Promise((resolve) => {
      const req = https.request({
        hostname: BAILIAN_API_HOST,
        path: apiPath,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', async () => {
          try {
            const result = JSON.parse(data);
            
            if (result.output?.image_url) {
              if (outputPath) {
                await downloadImage(result.output.image_url, outputPath);
                resolve({
                  success: true,
                  url: result.output.image_url,
                  localPath: outputPath,
                  editType
                });
              } else {
                resolve({
                  success: true,
                  url: result.output.image_url,
                  editType
                });
              }
            } else {
              resolve({ success: false, error: result.message || '图像编辑失败' });
            }
          } catch (e) {
            resolve({ success: false, error: `解析响应失败: ${e.message}` });
          }
        });
      });
      
      req.on('error', (e) => resolve({ success: false, error: `请求失败: ${e.message}` }));
      req.write(requestData);
      req.end();
    });
    
  } catch (error) {
    logger.error('图像编辑失败:', error);
    return { success: false, error: error.message };
  }
}

export { editImage };
