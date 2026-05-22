/**
 * 语音识别器
 * 百炼 ASR 语音识别后备方案
 * 当微信未提供 voice_item.text 时，下载 CDN 语音并调用百炼 ASR
 */

import { logger } from '../../core.js';
import { getProviderApiKeyFromEnv, PROVIDER_SPECIAL_ENDPOINTS } from '../../../common/模型配置.js';

/**
 * 百炼 ASR 语音识别
 * @param {Object} voiceItem - 微信语音消息项
 * @param {Object} state - 监听器状态（未使用）
 * @returns {Promise<string>} 识别文本
 */
export async function transcribeVoiceASR(voiceItem, state) {
  try {
    const cdnUrl = voiceItem.cdn_url || voiceItem.cdn_src_url || voiceItem.url;
    const aesKey = voiceItem.aes_key || voiceItem.aeskey;
    const duration = voiceItem.duration || voiceItem.voice_length || 0;

    if (!cdnUrl) {
      logger.warn('[微信监听] 语音消息无 CDN URL，无法识别');
      return '';
    }

    logger.info(`[微信监听] 尝试百炼 ASR 识别语音 (cdnUrl: ${cdnUrl.slice(0, 80)}..., duration: ${duration}ms)`);

    // 下载加密音频
    const audioResponse = await fetch(cdnUrl);
    if (!audioResponse.ok) {
      logger.warn(`[微信监听] 下载语音失败: ${audioResponse.status}`);
      return '';
    }
    let audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

    // AES-128-ECB 解密（如果有 aes_key）
    if (aesKey) {
      try {
        const crypto = await import('crypto');
        const key = Buffer.from(aesKey, 'base64');
        const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
        audioBuffer = Buffer.concat([decipher.update(audioBuffer), decipher.final()]);
        logger.info('[微信监听] 语音文件 AES 解密成功');
      } catch (decryptErr) {
        logger.warn(`[微信监听] 语音解密失败: ${decryptErr.message}，尝试直接识别`);
      }
    }

    // 调用百炼 ASR API
    const apiKey = getProviderApiKeyFromEnv('百炼');
    if (!apiKey) {
      logger.warn('[微信监听] 未配置百炼 API Key，无法使用 ASR');
      return '';
    }

    const audioBase64 = audioBuffer.toString('base64');
    const asrResponse = await fetch(PROVIDER_SPECIAL_ENDPOINTS['百炼'].asr, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'paraformer-v1',
        input: { audio: audioBase64 },
        parameters: {
          language: 'zh',
          format: 'wav',
          punctuation: 'true',
          inverse_text_normalization: 'true',
        },
      }),
    });

    if (!asrResponse.ok) {
      const errText = await asrResponse.text();
      logger.warn(`[微信监听] 百炼 ASR 失败: ${asrResponse.status} ${errText.slice(0, 200)}`);
      return '';
    }

    const asrResult = await asrResponse.json();
    if (asrResult.output?.results) {
      const transcript = asrResult.output.results.map(r => r.text).join('');
      return transcript;
    }

    logger.warn(`[微信监听] 百炼 ASR 无结果: ${JSON.stringify(asrResult).slice(0, 200)}`);
    return '';
  } catch (err) {
    logger.error(`[微信监听] 语音识别异常: ${err.message}`);
    return '';
  }
}
