/**
 * 万相2.7图像编辑模型 API
 * 调用百炼 multimodal-generation 接口
 *
 * 日志策略：每个关键环节都有 DEBUG 级别日志
 * - 请求入口：model、endpoint、imageUrl、prompt、requestBody
 * - HTTP 响应：状态码、响应体结构
 * - 结果解析：图片URL、异步任务ID
 * - 轮询过程：每次轮询状态
 * - 错误详情：完整错误信息
 */

import https from 'https';
import config from '../_config.js';
import { getApiKey, getBailianHost } from '../_app-context.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const { model: WAN_MODEL, apiTimeout, pollInterval, pollMaxAttempts } = config.wan;
const WAN_ENDPOINT = '/api/v1/services/aigc/multimodal-generation/generation';

const logger = 创建日志器('元素拆解-WAN', { 前缀: '[元素拆解/WAN]', 级别: 'debug', 显示调用位置: true });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 调用万相2.7图像编辑模型
 * @param {string} apiKey - 百炼 API Key
 * @param {Object} requestBody - 请求体
 * @returns {Promise<{success: boolean, imageUrl?: string, error?: string}>}
 */
export async function callWanModel(apiKey, requestBody) {
  // ===== DEBUG: 请求入口日志 =====
  const contentArr = requestBody?.input?.messages?.[0]?.content || [];
  const imageItem = contentArr.find(c => c.image);
  const textItem = contentArr.find(c => c.text);
  logger.debug('--- callWanModel 请求入口 ---');
  logger.debug(`模型: ${requestBody?.model} | 端点: ${WAN_ENDPOINT}`);
  logger.debug(`输入图片: ${imageItem?.image?.substring(0, 120) || '(无)'}...`);
  logger.debug(`提示词: ${textItem?.text?.substring(0, 150) || '(无)'}...`);
  logger.debug(`参数: size=${requestBody?.parameters?.size}, n=${requestBody?.parameters?.n}, watermark=${requestBody?.parameters?.watermark}`);
  logger.debug(`API Key: ${apiKey ? apiKey.substring(0, 8) + '...' : '(未配置!)'}`);
  logger.debug(`完整请求体: ${JSON.stringify(requestBody).substring(0, 500)}`);

  return new Promise((resolve) => {
    const requestData = JSON.stringify(requestBody);

    const req = https.request({
      hostname: getBailianHost(),
      path: WAN_ENDPOINT,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: apiTimeout,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // ===== DEBUG: HTTP 响应日志 =====
        logger.debug(`--- callWanModel HTTP 响应 ---`);
        logger.debug(`HTTP 状态码: ${res.statusCode}`);
        logger.debug(`响应体(前800字符): ${data.substring(0, 800)}`);

        try {
          const result = JSON.parse(data);

          // 检查 API 层错误
          if (result.code || result.message) {
            logger.error(`API 返回错误: code=${result.code}, message=${result.message}`);
            logger.debug(`完整错误响应: ${data.substring(0, 500)}`);
            resolve({ success: false, error: `API错误[${result.code}]: ${result.message}` });
            return;
          }

          // 检查异步任务
          if (result.output?.task_status === 'PENDING' || result.output?.task_status === 'RUNNING') {
            const taskId = result.output.task_id;
            logger.info(`异步任务已提交: ${taskId}，状态=${result.output.task_status}，开始轮询...`);
            pollTaskResult(apiKey, taskId)
              .then(resolve)
              .catch(err => resolve({ success: false, error: err.message }));
            return;
          }

          // 同步结果
          if (result.output?.choices) {
            const allImages = result.output.choices
              .flatMap(c => c.message?.content || [])
              .filter(c => c.type === 'image' || c.image);

            logger.debug(`同步返回: choices=${result.output.choices.length}, 图片数=${allImages.length}`);
            for (const choice of result.output.choices) {
              const contents = choice.message?.content || [];
              logger.debug(`choice 内容类型: [${contents.map(c => c.type || (c.image ? 'image' : 'unknown')).join(', ')}]`);
            }

            if (allImages.length === 0) {
              logger.error('模型未返回图片结果! 响应结构异常');
              logger.debug(`完整 choices: ${JSON.stringify(result.output.choices).substring(0, 500)}`);
              resolve({ success: false, error: '模型未返回图片结果' });
            } else if (allImages.length === 1) {
              const imgUrl = allImages[0].image || allImages[0].url;
              logger.debug(`返回1张图片: ${imgUrl?.substring(0, 120)}...`);
              resolve({ success: true, imageUrl: imgUrl });
            } else {
              // 多图返回（n>1 时模型可能一次返回多张图）
              const urls = allImages.map(img => img.image || img.url);
              logger.debug(`返回${urls.length}张图片`);
              resolve({ success: true, imageUrls: urls });
            }
          } else {
            logger.error(`响应无 choices 字段! 响应体: ${data.substring(0, 300)}`);
            resolve({ success: false, error: result.message || '模型调用失败' });
          }
        } catch (e) {
          logger.error(`解析响应失败: ${e.message}, 原始数据(前300字符): ${data.substring(0, 300)}`);
          resolve({ success: false, error: `解析响应失败: ${e.message}` });
        }
      });
    });

    req.on('error', (e) => {
      logger.error(`HTTP 请求失败: ${e.message}`);
      resolve({ success: false, error: `请求失败: ${e.message}` });
    });
    req.on('timeout', () => {
      logger.error(`HTTP 请求超时 (${apiTimeout}ms)`);
      req.destroy();
      resolve({ success: false, error: '请求超时（120秒）' });
    });
    req.write(requestData);
    req.end();
  });
}

/**
 * 轮询异步任务结果
 */
async function pollTaskResult(apiKey, taskId) {
  const maxAttempts = pollMaxAttempts;
  const interval = pollInterval;
  logger.debug(`开始轮询任务 ${taskId}, 间隔=${interval}ms, 最大次数=${maxAttempts}`);

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(interval);

    const result = await new Promise((resolve) => {
      const req = https.request({
        hostname: getBailianHost(),
        path: `/api/v1/tasks/${taskId}`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            logger.error(`轮询响应解析失败: ${data.substring(0, 200)}`);
            resolve({ output: { task_status: 'UNKNOWN' } });
          }
        });
      });
      req.on('error', (e) => {
        logger.error(`轮询请求失败: ${e.message}`);
        resolve({ output: { task_status: 'UNKNOWN' } });
      });
      req.end();
    });

    const status = result.output?.task_status;
    logger.info(`任务 ${taskId} 状态: ${status} (${i + 1}/${maxAttempts})`);

    if (status === 'SUCCEEDED') {
      logger.debug(`任务 ${taskId} 成功，解析结果...`);
      // 检查 results 数组（异步任务多图返回）
      const resultUrls = result.output.results?.map(r => r.url).filter(Boolean);
      if (resultUrls?.length > 1) {
        logger.debug(`异步返回${resultUrls.length}张图片(results)`);
        return { success: true, imageUrls: resultUrls };
      }
      if (resultUrls?.length === 1) {
        logger.debug(`异步返回1张图片(results): ${resultUrls[0].substring(0, 120)}...`);
        return { success: true, imageUrl: resultUrls[0] };
      }
      // 检查 choices
      const choices = result.output.choices || [];
      const allImgs = choices.flatMap(c => c.message?.content || []).filter(c => c.type === 'image' || c.image);
      if (allImgs.length > 1) {
        logger.debug(`异步返回${allImgs.length}张图片(choices)`);
        return { success: true, imageUrls: allImgs.map(img => img.image || img.url) };
      }
      if (allImgs.length === 1) {
        const url = allImgs[0].image || allImgs[0].url;
        logger.debug(`异步返回1张图片(choices): ${url?.substring(0, 120)}...`);
        return { success: true, imageUrl: url };
      }
      logger.error(`任务成功但无图片! 响应体: ${JSON.stringify(result.output).substring(0, 300)}`);
      return { success: false, error: '任务完成但未返回图片' };
    }

    if (status === 'FAILED') {
      logger.error(`任务 ${taskId} 失败: ${result.output?.message || '未知错误'}`);
      return { success: false, error: result.output?.message || '异步任务失败' };
    }
  }

  logger.error(`任务 ${taskId} 轮询超时 (${maxAttempts}次)`);
  return { success: false, error: '轮询超时' };
}

/**
 * 获取百炼 API Key（通过 _app-context.js 合规管道）
 */
export function getWanApiKey() {
  return getApiKey('百炼');
}

export { WAN_MODEL };
