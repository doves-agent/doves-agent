/**
 * @file tools/语音工具
 * @description 语音合成(TTS)和语音识别(ASR)
 */

import { existsSync, writeFileSync, readFileSync } from 'fs';
import https from 'https';
import { PROVIDER_SPECIAL_ENDPOINTS, BAILIAN_API_HOST, getProviderApiKeyFromEnv } from '../常量.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('语音工具', { 前缀: '[语音工具]', 级别: 'debug', 显示调用位置: true });

// 语音合成 API 端点（从全局配置源获取）
const TTS_API = PROVIDER_SPECIAL_ENDPOINTS['百炼'].tts;
const ASR_API = PROVIDER_SPECIAL_ENDPOINTS['百炼'].asr;

// 语音工具定义
export const audioTools = [
  {
    name: '语音合成',
    description: '语音合成 - 将文本转换为语音。[限制]依赖百炼API Key，未配置则不可用；仅支持中文音色。',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '要合成的文本内容'
        },
        model: {
          type: 'string',
          enum: ['cosyvoice-v1', 'sambert-v1', 'sambert-v2'],
          description: '模型选择：cosyvoice-v1=高质量，sambert-v1=快速，sambert-v2=平衡',
          default: 'cosyvoice-v1'
        },
        voice: {
          type: 'string',
          description: '音色选择：longxiaochun, longwan, longyue, longfei 等',
          default: 'longxiaochun'
        },
        format: {
          type: 'string',
          enum: ['mp3', 'wav', 'pcm'],
          description: '输出音频格式',
          default: 'mp3'
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径'
        },
        speed: {
          type: 'number',
          description: '语速倍率 (0.5-2.0)',
          default: 1.0
        },
        pitch: {
          type: 'number',
          description: '音调 (-500 到 500)',
          default: 0
        }
      },
      required: ['text']
    }
  },
  {
    name: '语音识别',
    description: '语音识别 - 将语音转换为文本。[限制]依赖百炼API Key，未配置则不可用；支持常见音频格式(wav/mp3/pcm/opus)。',
    inputSchema: {
      type: 'object',
      properties: {
        audioPath: {
          type: 'string',
          description: '音频文件路径或URL'
        },
        model: {
          type: 'string',
          enum: ['paraformer-v1', 'paraformer-v2', 'sensevoice-v1'],
          description: '模型选择：paraformer=通用识别，sensevoice=情感识别',
          default: 'paraformer-v1'
        },
        language: {
          type: 'string',
          description: '语言：zh, en, ja, ko 等',
          default: 'zh'
        },
        format: {
          type: 'string',
          enum: ['pcm', 'wav', 'mp3', 'opus'],
          description: '音频格式',
          default: 'wav'
        },
        enablePunctuation: {
          type: 'boolean',
          description: '是否添加标点',
          default: true
        },
        enableInverseTextNormalization: {
          type: 'boolean',
          description: '是否进行逆文本正则化（数字、日期等）',
          default: true
        }
      },
      required: ['audioPath']
    }
  },
  {
    name: '语音翻译',
    description: '语音翻译 - 将语音翻译为另一种语言的文本。[限制]依赖百炼API Key，未配置则不可用。',
    inputSchema: {
      type: 'object',
      properties: {
        audioPath: {
          type: 'string',
          description: '音频文件路径或URL'
        },
        sourceLanguage: {
          type: 'string',
          description: '源语言：zh, en, ja, ko 等',
          default: 'auto'
        },
        targetLanguage: {
          type: 'string',
          description: '目标语言：zh, en, ja, ko 等',
          default: 'zh'
        }
      },
      required: ['audioPath']
    }
  }
];

/**
 * 获取 API Key
 */
function getApiKey() {
  const envKey = getProviderApiKeyFromEnv('百炼');
  return envKey || null;
}

/**
 * 语音合成
 */
async function textToSpeech(args) {
  const { text, model = 'cosyvoice-v1', voice = 'longxiaochun', format = 'mp3', outputPath, speed = 1.0, pitch = 0 } = args;
  
  if (!text) {
    return { success: false, error: '请提供要合成的文本' };
  }
  
  const apiKey = getApiKey();
  if (!apiKey) {
    return { success: false, error: '未配置百炼 API Key' };
  }
  
  try {
    logger.info(`语音合成: ${text.substring(0, 50)}...`);
    
    const requestData = JSON.stringify({
      model: model,
      input: {
        text: text
      },
      parameters: {
        voice: voice,
        format: format,
        speed: speed,
        pitch: pitch
      }
    });
    
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: BAILIAN_API_HOST,
        path: '/api/v1/services/audio/tts',
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
            
            if (res.statusCode === 200 && result.output?.audio_url) {
              const audioUrl = result.output.audio_url;
              
              // 下载音频
              if (outputPath) {
                await downloadAudio(audioUrl, outputPath);
                resolve({
                  success: true,
                  url: audioUrl,
                  localPath: outputPath,
                  model,
                  voice,
                  format,
                  message: `音频已保存到 ${outputPath}`
                });
              } else {
                resolve({
                  success: true,
                  url: audioUrl,
                  model,
                  voice,
                  format
                });
              }
            } else if (result.output?.task_id) {
              // 异步任务，需要轮询
              resolve({
                success: true,
                taskId: result.output.task_id,
                status: 'processing',
                message: '语音合成任务已提交，请使用 task_id 查询结果'
              });
            } else {
              resolve({ success: false, error: result.message || '语音合成失败' });
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
    logger.error(`语音合成失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 语音识别
 */
async function speechToText(args) {
  const { audioPath, model = 'paraformer-v1', language = 'zh', format = 'wav', 
          enablePunctuation = true, enableInverseTextNormalization = true } = args;
  
  if (!audioPath) {
    return { success: false, error: '请提供音频文件' };
  }
  
  const apiKey = getApiKey();
  if (!apiKey) {
    return { success: false, error: '未配置百炼 API Key' };
  }
  
  try {
    logger.info(`语音识别: ${audioPath}`);
    
    let audioData;
    let audioUrl = audioPath;
    
    // 如果是本地文件，读取并转为 base64
    if (!audioPath.startsWith('http://') && !audioPath.startsWith('https://')) {
      if (!existsSync(audioPath)) {
        return { success: false, error: '音频文件不存在' };
      }
      const buffer = readFileSync(audioPath);
      audioData = buffer.toString('base64');
    }
    
    const requestData = JSON.stringify({
      model: model,
      input: audioData ? { audio: audioData } : { audio_url: audioUrl },
      parameters: {
        language: language,
        format: format,
        punctuation: enablePunctuation ? 'true' : 'false',
        inverse_text_normalization: enableInverseTextNormalization ? 'true' : 'false'
      }
    });
    
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: BAILIAN_API_HOST,
        path: '/api/v1/services/audio/asr',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            
            if (res.statusCode === 200 && result.output?.results) {
              const transcript = result.output.results.map(r => r.text).join('');
              resolve({
                success: true,
                text: transcript,
                model,
                language,
                duration: result.output.duration,
                segments: result.output.results
              });
            } else {
              resolve({ success: false, error: result.message || '语音识别失败' });
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
    logger.error('语音识别失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 语音翻译
 */
async function speechTranslate(args) {
  const { audioPath, sourceLanguage = 'auto', targetLanguage = 'zh' } = args;
  
  if (!audioPath) {
    return { success: false, error: '请提供音频文件' };
  }
  
  const apiKey = getApiKey();
  if (!apiKey) {
    return { success: false, error: '未配置百炼 API Key' };
  }
  
  try {
    logger.info(`语音翻译: ${audioPath}`);
    
    // 使用 gummy 模型进行语音翻译
    let audioData;
    if (!audioPath.startsWith('http://') && !audioPath.startsWith('https://')) {
      if (!existsSync(audioPath)) {
        return { success: false, error: '音频文件不存在' };
      }
      const buffer = readFileSync(audioPath);
      audioData = buffer.toString('base64');
    }
    
    const requestData = JSON.stringify({
      model: 'gummy-v1',
      input: audioData ? { audio: audioData } : { audio_url: audioPath },
      parameters: {
        source_language: sourceLanguage,
        target_language: targetLanguage
      }
    });
    
    return new Promise((resolve) => {
      const req = https.request({
        hostname: BAILIAN_API_HOST,
        path: '/api/v1/services/audio/translation',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            
            if (res.statusCode === 200 && result.output?.translation) {
              resolve({
                success: true,
                text: result.output.translation,
                sourceLanguage: result.output.source_language || sourceLanguage,
                targetLanguage
              });
            } else {
              resolve({ success: false, error: result.message || '语音翻译失败' });
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
    logger.error('语音翻译失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 下载音频文件
 */
async function downloadAudio(url, outputPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadAudio(res.headers.location, outputPath).then(resolve).catch(reject);
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

/**
 * 处理语音工具调用
 */
export async function handleAudioTool(name, args) {
  const text = (content) => ({
    content: [{
      type: 'text',
      text: typeof content === 'string' ? content : JSON.stringify(content, null, 2)
    }]
  });
  
  try {
    switch (name) {
      case '语音合成':
        return text(await textToSpeech(args));
        
      case '语音识别':
        return text(await speechToText(args));
        
      case '语音翻译':
        return text(await speechTranslate(args));
        
      default:
        return {
          content: [{ type: 'text', text: 'Unknown audio tool: ' + name }],
          isError: true
        };
    }
  } catch (error) {
    logger.error('错误:', error);
    return text({ success: false, error: error.message });
  }
}

export default { audioTools, handleAudioTool };
