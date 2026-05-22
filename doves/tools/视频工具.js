/**
 * @file tools/视频工具
 * @description 视频内容分析、问答和字幕提取
 */

import { existsSync, readFileSync, statSync } from 'fs';
import https from 'https';
import { 默认视觉模型, PROVIDER_SPECIAL_ENDPOINTS, BAILIAN_API_HOST, getProviderApiKeyFromEnv } from '../常量.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('视频工具', { 前缀: '[视频工具]', 级别: 'debug', 显示调用位置: true });

// 视频理解 API 端点（从全局配置源获取）
const VIDEO_API = PROVIDER_SPECIAL_ENDPOINTS['百炼'].video;

// 视频工具定义
export const videoTools = [
  {
    name: '视频分析',
    description: '视频内容分析 - 分析视频内容，提取关键信息。[限制]依赖百炼视觉API Key，未配置则不可用；仅支持视觉模型可处理的视频格式和时长。',
    inputSchema: {
      type: 'object',
      properties: {
        videoPath: {
          type: 'string',
          description: '视频文件路径或URL'
        },
        analysisType: {
          type: 'string',
          enum: ['summary', 'scenes', 'objects', 'actions', 'all'],
          description: '分析类型：summary=概要，scenes=场景，objects=物体，actions=动作，all=全部',
          default: 'summary'
        },
        detailLevel: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: '细节级别',
          default: 'medium'
        },
        startTime: {
          type: 'number',
          description: '分析起始时间（秒）',
          default: 0
        },
        endTime: {
          type: 'number',
          description: '分析结束时间（秒），0表示到视频末尾'
        }
      },
      required: ['videoPath']
    }
  },
  {
    name: '视频问答',
    description: '视频问答 - 针对视频内容提问并获取答案。[限制]依赖百炼视觉API Key，未配置则不可用。',
    inputSchema: {
      type: 'object',
      properties: {
        videoPath: {
          type: 'string',
          description: '视频文件路径或URL'
        },
        question: {
          type: 'string',
          description: '要提问的问题'
        },
        context: {
          type: 'string',
          description: '问题上下文或参考信息'
        },
        timestamp: {
          type: 'number',
          description: '关注的时间点（秒）'
        }
      },
      required: ['videoPath', 'question']
    }
  },
  {
    name: '视频转录',
    description: '视频字幕提取 - 从视频中提取语音并生成字幕文本。[限制]依赖百炼API Key，未配置则不可用；不支持视频剪辑/转码，剪辑请用ffmpeg(执行命令)。',
    inputSchema: {
      type: 'object',
      properties: {
        videoPath: {
          type: 'string',
          description: '视频文件路径或URL'
        },
        language: {
          type: 'string',
          description: '语言：zh, en, ja, ko, auto',
          default: 'auto'
        },
        outputFormat: {
          type: 'string',
          enum: ['text', 'srt', 'vtt', 'json'],
          description: '输出格式：text=纯文本，srt=SRT字幕，vtt=WebVTT，json=JSON结构',
          default: 'text'
        },
        enableTimestamps: {
          type: 'boolean',
          description: '是否包含时间戳',
          default: true
        },
        speakerDiarization: {
          type: 'boolean',
          description: '是否进行说话人分离',
          default: false
        }
      },
      required: ['videoPath']
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
 * 视频内容分析
 */
async function analyzeVideo(args) {
  const { videoPath, analysisType = 'summary', detailLevel = 'medium', startTime = 0, endTime } = args;
  
  if (!videoPath) {
    return { success: false, error: '请提供视频文件路径' };
  }
  
  const apiKey = getApiKey();
  if (!apiKey) {
    return { success: false, error: '未配置百炼 API Key' };
  }
  
  try {
    logger.info(`分析视频: ${videoPath}`);
    
    let videoUrl = videoPath;
    let videoData = null;
    
    // 如果是本地文件，需要先上传到OSS或转base64
    if (!videoPath.startsWith('http://') && !videoPath.startsWith('https://')) {
      if (!existsSync(videoPath)) {
        return { success: false, error: '视频文件不存在' };
      }
      
      // 检查文件大小，如果太大需要先上传
      const stats = statSync(videoPath);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      if (fileSizeMB > 20) {
        // 大文件需要先上传到OSS
        return { 
          success: false, 
          error: '视频文件过大，请先上传到OSS并使用URL',
          suggestion: '使用OSS上传视频后，传递URL进行分析'
        };
      }
      
      // 小文件可以直接读取
      const buffer = readFileSync(videoPath);
      videoData = `data:video/mp4;base64,${buffer.toString('base64')}`;
    }
    
    // 构建分析提示词
    const analysisPrompts = {
      summary: '请分析这个视频的主要内容，给出简洁的概要描述。',
      scenes: '请分析这个视频中的场景变化，列出主要场景和时间点。',
      objects: '请识别视频中出现的物体，列出物体名称和出现时间。',
      actions: '请分析视频中人物的动作和行为，描述关键动作事件。',
      all: '请全面分析这个视频，包括：1. 内容概要 2. 场景变化 3. 主要物体 4. 人物动作 5. 关键事件'
    };
    
    const prompt = analysisPrompts[analysisType] || analysisPrompts.summary;
    
    const requestData = JSON.stringify({
      model: 默认视觉模型,
      input: {
        messages: [
          {
            role: 'user',
            content: [
              {
                video: videoData || videoUrl
              },
              {
                text: prompt
              }
            ]
          }
        ]
      },
      parameters: {
        detail_level: detailLevel,
        start_time: startTime,
        ...(endTime && { end_time: endTime })
      }
    });
    
    return new Promise((resolve) => {
      const req = https.request({
        hostname: BAILIAN_API_HOST,
        path: '/api/v1/services/aigc/multimodal-generation/generation',
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
            
            if (res.statusCode === 200 && result.output?.choices?.[0]?.message?.content) {
              const content = result.output.choices[0].message.content;
              resolve({
                success: true,
                analysis: content,
                analysisType,
                videoPath,
                model: 默认视觉模型
              });
            } else if (result.output?.task_id) {
              // 异步任务
              resolve({
                success: true,
                taskId: result.output.task_id,
                status: 'processing',
                message: '视频分析任务已提交，请使用task_id查询结果'
              });
            } else {
              resolve({ success: false, error: result.message || '视频分析失败' });
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
    logger.error(`视频分析失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 视频问答
 */
async function videoQA(args) {
  const { videoPath, question, context, timestamp } = args;
  
  if (!videoPath || !question) {
    return { success: false, error: '请提供视频路径和问题' };
  }
  
  const apiKey = getApiKey();
  if (!apiKey) {
    return { success: false, error: '未配置百炼 API Key' };
  }
  
  try {
    logger.info(`视频问答: ${question}`);
    
    let videoUrl = videoPath;
    let videoData = null;
    
    if (!videoPath.startsWith('http://') && !videoPath.startsWith('https://')) {
      if (!existsSync(videoPath)) {
        return { success: false, error: '视频文件不存在' };
      }
      
      const stats = statSync(videoPath);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      if (fileSizeMB > 20) {
        return { 
          success: false, 
          error: '视频文件过大，请先上传到OSS并使用URL'
        };
      }
      
      const buffer = readFileSync(videoPath);
      videoData = `data:video/mp4;base64,${buffer.toString('base64')}`;
    }
    
    // 构建问题
    let fullQuestion = question;
    if (context) {
      fullQuestion = `参考上下文: ${context}\n\n问题: ${question}`;
    }
    if (timestamp !== undefined) {
      fullQuestion = `在视频的 ${timestamp} 秒处: ${fullQuestion}`;
    }
    
    const requestData = JSON.stringify({
      model: 默认视觉模型,
      input: {
        messages: [
          {
            role: 'user',
            content: [
              {
                video: videoData || videoUrl
              },
              {
                text: fullQuestion
              }
            ]
          }
        ]
      },
      parameters: {
        result_format: 'message'
      }
    });
    
    return new Promise((resolve) => {
      const req = https.request({
        hostname: BAILIAN_API_HOST,
        path: '/api/v1/services/aigc/multimodal-generation/generation',
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
            
            if (res.statusCode === 200 && result.output?.choices?.[0]?.message?.content) {
              resolve({
                success: true,
                answer: result.output.choices[0].message.content,
                question,
                videoPath,
                model: 默认视觉模型
              });
            } else {
              resolve({ success: false, error: result.message || '视频问答失败' });
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
    logger.error(`视频问答失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 视频字幕提取
 */
async function transcribeVideo(args) {
  const { videoPath, language = 'auto', outputFormat = 'text', enableTimestamps = true, speakerDiarization = false } = args;
  
  if (!videoPath) {
    return { success: false, error: '请提供视频文件路径' };
  }
  
  const apiKey = getApiKey();
  if (!apiKey) {
    return { success: false, error: '未配置百炼 API Key' };
  }
  
  try {
    logger.info(`字幕提取: ${videoPath}`);
    
    let videoUrl = videoPath;
    
    if (!videoPath.startsWith('http://') && !videoPath.startsWith('https://')) {
      if (!existsSync(videoPath)) {
        return { success: false, error: '视频文件不存在' };
      }
      
      // 视频文件需要先上传
      const stats = statSync(videoPath);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      if (fileSizeMB > 100) {
        return { 
          success: false, 
          error: '视频文件过大，请先上传到OSS并使用URL'
        };
      }
      
      // 对于字幕提取，需要使用音视频转码服务先提取音频
      // 这里简化处理，直接使用视频URL
      return {
        success: false,
        error: '本地视频需要先上传到OSS',
        suggestion: '请使用OSS上传视频后传递URL'
      };
    }
    
    // 使用语音识别服务提取字幕
    const requestData = JSON.stringify({
      model: 'paraformer-v2',
      input: {
        audio_url: videoUrl
      },
      parameters: {
        language: language === 'auto' ? undefined : language,
        punctuation: 'true',
        inverse_text_normalization: 'true',
        format: outputFormat === 'json' ? 'json' : 'text'
      }
    });
    
    return new Promise((resolve) => {
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
              const segments = result.output.results;
              let output = '';
              
              if (outputFormat === 'text') {
                output = segments.map(s => s.text).join('\n');
              } else if (outputFormat === 'srt') {
                output = segments.map((s, i) => {
                  const start = formatSRTTime(s.begin_time || 0);
                  const end = formatSRTTime(s.end_time || 0);
                  return `${i + 1}\n${start} --> ${end}\n${s.text}\n`;
                }).join('\n');
              } else if (outputFormat === 'vtt') {
                output = 'WEBVTT\n\n' + segments.map((s, i) => {
                  const start = formatVTTTime(s.begin_time || 0);
                  const end = formatVTTTime(s.end_time || 0);
                  return `${start} --> ${end}\n${s.text}\n`;
                }).join('\n');
              } else {
                output = segments;
              }
              
              resolve({
                success: true,
                transcript: output,
                format: outputFormat,
                language: result.output.language || language,
                duration: result.output.duration,
                segments: enableTimestamps ? segments : undefined,
                wordCount: segments.reduce((sum, s) => sum + (s.text?.length || 0), 0)
              });
            } else {
              resolve({ success: false, error: result.message || '字幕提取失败' });
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
    logger.error(`字幕提取失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 格式化SRT时间
 */
function formatSRTTime(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

/**
 * 格式化VTT时间
 */
function formatVTTTime(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

/**
 * 处理视频工具调用
 */
export async function handleVideoTool(name, args) {
  const text = (content) => ({
    content: [{
      type: 'text',
      text: typeof content === 'string' ? content : JSON.stringify(content, null, 2)
    }]
  });
  
  try {
    switch (name) {
      case '视频分析':
        return text(await analyzeVideo(args));
        
      case '视频问答':
        return text(await videoQA(args));
        
      case '视频转录':
        return text(await transcribeVideo(args));
        
      default:
        return {
          content: [{ type: 'text', text: 'Unknown video tool: ' + name }],
          isError: true
        };
    }
  } catch (error) {
    logger.error(`视频工具错误: ${error.message}`);
    return text({ success: false, error: error.message });
  }
}

export default { videoTools, handleVideoTool };
