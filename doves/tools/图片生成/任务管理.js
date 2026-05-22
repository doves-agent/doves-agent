/**
 * @file tools/图片生成/任务管理
 * @description 异步任务轮询和图片下载
 */

import { writeFileSync } from 'fs';
import https from 'https';
import { BAILIAN_API_HOST } from '../../常量.js';

/**
 * 轮询任务结果
 */
async function pollTaskResult(taskId, apiKey, maxAttempts = 60) {
  return new Promise((resolve) => {
    let attempts = 0;
    
    const poll = () => {
      attempts++;
      
      const req = https.request({
        hostname: BAILIAN_API_HOST,
        path: `/api/v1/tasks/${taskId}`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            
            if (result.output?.task_status === 'SUCCEEDED') {
              resolve({
                success: true,
                images: result.output.results,
                taskId
              });
            } else if (result.output?.task_status === 'FAILED') {
              resolve({
                success: false,
                error: result.output.message || '任务失败',
                taskId
              });
            } else if (attempts >= maxAttempts) {
              resolve({
                success: false,
                error: '任务超时',
                taskId
              });
            } else {
              // 继续轮询
              setTimeout(poll, 2000);
            }
          } catch (e) {
            resolve({ success: false, error: `解析响应失败: ${e.message}` });
          }
        });
      });
      
      req.on('error', (e) => resolve({ success: false, error: `请求失败: ${e.message}` }));
      req.end();
    };
    
    poll();
  });
}

/**
 * 下载图片
 */
async function downloadImage(url, outputPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadImage(res.headers.location, outputPath).then(resolve).catch(reject);
        return;
      }
      
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks);
          writeFileSync(outputPath, buffer);
          resolve({ success: true, path: outputPath });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

export { pollTaskResult, downloadImage };
