/**
 * @file tools/图片生成/文生图
 * @description 文生图和批量文生图
 */

import https from 'https';
import crypto from 'crypto';
import { downloadImage, pollTaskResult } from './任务管理.js';
import { getProviderApiKeyFromEnv, BAILIAN_API_HOST } from '../../常量.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('文生图', { 前缀: '[图片工具]', 级别: 'debug', 显示调用位置: true });

/**
 * 获取 API Key
 */
function getApiKey() {
  const envKey = getProviderApiKeyFromEnv('百炼');
  return envKey || null;
}

/**
 * 文生图
 */
async function generateImage(args) {
  const { prompt, model = 'wanx-v1', style = 'auto', size = '1024x1024', n = 1, 
          negativePrompt, seed, outputPath, referenceImage } = args;
  
  if (!prompt) {
    return { success: false, error: '请提供图片描述' };
  }
  
  const apiKey = getApiKey();
  if (!apiKey) {
    return { success: false, error: '未配置百炼 API Key' };
  }
  
  try {
    logger.info(`生成图片: ${prompt.substring(0, 50)}...`);
    
    // 构建请求
    const requestData = JSON.stringify({
      model: model,
      input: {
        prompt: prompt,
        negative_prompt: negativePrompt,
        style: style,
        ...(referenceImage && { ref_image_url: referenceImage })
      },
      parameters: {
        size: size,
        n: Math.min(n, 4),
        ...(seed !== undefined && { seed })
      }
    });
    
    return new Promise((resolve) => {
      const req = https.request({
        hostname: BAILIAN_API_HOST,
        path: '/api/v1/services/aigc/text2image/image-synthesis',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', async () => {
          try {
            const result = JSON.parse(data);
            
            if (result.output?.task_id) {
              // 异步任务，轮询获取结果
              const taskResult = await pollTaskResult(result.output.task_id, apiKey);
              
              if (taskResult.success && taskResult.images && outputPath) {
                // 下载图片
                const downloadedImages = [];
                for (let i = 0; i < taskResult.images.length; i++) {
                  const img = taskResult.images[i];
                  const filePath = n > 1 ? `${outputPath}_${i + 1}.png` : `${outputPath}.png`;
                  await downloadImage(img.url, filePath);
                  downloadedImages.push(filePath);
                }
                resolve({
                  success: true,
                  images: taskResult.images,
                  localPaths: downloadedImages,
                  model,
                  style,
                  size,
                  prompt
                });
              } else {
                resolve(taskResult);
              }
            } else if (result.output?.results) {
              // 同步返回结果
              const images = result.output.results;
              
              if (outputPath) {
                const downloadedImages = [];
                for (let i = 0; i < images.length; i++) {
                  const img = images[i];
                  const filePath = n > 1 ? `${outputPath}_${i + 1}.png` : `${outputPath}.png`;
                  await downloadImage(img.url, filePath);
                  downloadedImages.push(filePath);
                }
                resolve({
                  success: true,
                  images,
                  localPaths: downloadedImages,
                  model,
                  style,
                  size,
                  prompt
                });
              } else {
                resolve({
                  success: true,
                  images,
                  model,
                  style,
                  size,
                  prompt
                });
              }
            } else {
              resolve({ success: false, error: result.message || '图片生成失败' });
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
    logger.error('图片生成失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 批量文生图
 */
async function generateImageBatch(args) {
  const { prompts, model = 'wanx-v1', style = 'auto', size = '1024x1024', 
          outputDir, naming = 'index', concurrency = 2 } = args;
  
  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
    return { success: false, error: '请提供图片描述数组' };
  }
  
  const apiKey = getApiKey();
  if (!apiKey) {
    return { success: false, error: '未配置百炼 API Key' };
  }
  
  try {
    logger.info(`批量生成图片: ${prompts.length} 张`);
    
    const results = [];
    const chunks = [];
    
    // 分块处理并发
    for (let i = 0; i < prompts.length; i += concurrency) {
      chunks.push(prompts.slice(i, i + concurrency));
    }
    
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      
      const promises = chunk.map((prompt, i) => {
        const index = chunkIndex * concurrency + i;
        let outputPath = null;
        
        if (outputDir) {
          const name = naming === 'index' 
            ? String(index + 1).padStart(4, '0')
            : naming === 'timestamp'
              ? Date.now().toString()
              : crypto.createHash('md5').update(prompt).digest('hex').substring(0, 8);
          outputPath = `${outputDir}/${name}`;
        }
        
        return generateImage({
          prompt,
          model,
          style,
          size,
          n: 1,
          outputPath
        });
      });
      
      const chunkResults = await Promise.all(promises);
      results.push(...chunkResults);
      
      logger.info(`进度: ${results.length}/${prompts.length}`);
    }
    
    const successCount = results.filter(r => r.success).length;
    
    return {
      success: successCount > 0,
      total: prompts.length,
      succeeded: successCount,
      failed: prompts.length - successCount,
      results: results.map((r, i) => ({
        index: i,
        prompt: prompts[i],
        ...r
      }))
    };
    
  } catch (error) {
    logger.error('批量生成失败:', error);
    return { success: false, error: error.message };
  }
}

export { generateImage, generateImageBatch };
