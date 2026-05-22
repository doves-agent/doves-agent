/**
 * 视频工具 - 视频处理扩展包
 *
 * 统一视频能力：AI理解（百炼）+ ffmpeg处理
 * 依赖: ffmpeg/ffprobe 在系统环境变量中可用；百炼 API Key 用于AI能力
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import { 默认视觉模型, BAILIAN_API_HOST, getProviderApiKeyFromEnv } from '../../../常量.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('视频工具', { 前缀: '[视频处理]' });
const execFileAsync = promisify(execFile);

// ==================== 工具定义 ====================

export const extTools = [
  // ──── AI 理解层 ────
  {
    name: 'video_analyze',
    description: '视频内容分析 - 用AI视觉模型分析视频内容（场景/物体/动作/概要）',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '视频文件路径或URL' },
        analysisType: { type: 'string', enum: ['summary', 'scenes', 'objects', 'actions', 'all'], description: '分析类型：summary概要/scenes场景/objects物体/actions动作/all全部', default: 'summary' },
        startTime: { type: 'number', description: '分析起始秒数（可选）' },
        endTime: { type: 'number', description: '分析结束秒数（可选）' },
      },
      required: ['input']
    }
  },
  {
    name: 'video_qa',
    description: '视频问答 - 针对视频内容提问（"视频里有几个人？""第30秒在做什么？"）',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '视频文件路径或URL' },
        question: { type: 'string', description: '要提问的问题' },
        timestamp: { type: 'number', description: '关注的时间点秒数（可选）' },
      },
      required: ['input', 'question']
    }
  },
  {
    name: 'video_transcribe',
    description: '视频转录 - 提取视频语音生成字幕文本（支持SRT/VTT/纯文本）',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '视频文件路径或URL' },
        language: { type: 'string', description: '语言：zh/en/ja/ko/auto', default: 'auto' },
        outputFormat: { type: 'string', enum: ['text', 'srt', 'vtt', 'json'], description: '输出格式', default: 'srt' },
        speakerDiarization: { type: 'boolean', description: '是否说话人分离', default: false },
      },
      required: ['input']
    }
  },
  // ──── 信息探测层 ────
  {
    name: 'video_info',
    description: '视频信息探测 - 获取时长/编码/分辨率/帧率/码率/音轨等元数据',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '视频文件路径' },
      },
      required: ['input']
    }
  },
  // ──── 格式转换层 ────
  {
    name: 'video_convert',
    description: '视频转码 - 转换格式/编码/分辨率/帧率/码率',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '输入文件路径' },
        output: { type: 'string', description: '输出文件路径' },
        codec: { type: 'string', enum: ['libx264', 'libx265', 'libvpx-vp9', 'libaom-av1', 'copy'], description: '视频编码器', default: 'libx264' },
        resolution: { type: 'string', description: '分辨率，如 1920x1080' },
        fps: { type: 'number', description: '帧率' },
        bitrate: { type: 'string', description: '码率，如 2M' },
        crf: { type: 'number', description: 'CRF质量 0-51，越低越好', default: 23 },
        audioCodec: { type: 'string', enum: ['aac', 'mp3', 'copy', 'libopus'], description: '音频编码器', default: 'aac' },
      },
      required: ['input', 'output']
    }
  },
  // ──── 剪辑处理层 ────
  {
    name: 'video_trim',
    description: '视频剪辑 - 按起止时间截取片段',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '输入文件路径' },
        output: { type: 'string', description: '输出文件路径' },
        start: { type: 'string', description: '开始时间 HH:MM:SS 或秒数' },
        end: { type: 'string', description: '结束时间（与duration二选一）' },
        duration: { type: 'string', description: '持续时间（与end二选一）' },
        accurate: { type: 'boolean', description: '精确模式（重新编码，较慢但帧精确）', default: false },
      },
      required: ['input', 'output']
    }
  },
  {
    name: 'video_merge',
    description: '合并多个视频文件（要求编码参数一致）',
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: '输入文件列表（按顺序）' },
        output: { type: 'string', description: '输出文件路径' },
      },
      required: ['files', 'output']
    }
  },
  {
    name: 'video_split',
    description: '视频分割 - 按时长或段数拆分',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '输入文件路径' },
        outputPattern: { type: 'string', description: '输出文件模式，如 output_%03d.mp4' },
        segmentTime: { type: 'number', description: '每段秒数（与segmentCount二选一）' },
        segmentCount: { type: 'number', description: '分割段数（与segmentTime二选一）' },
      },
      required: ['input']
    }
  },
  // ──── 特效增强层 ────
  {
    name: 'video_screenshot',
    description: '视频截图 - 指定时间点截图或生成缩略图序列',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '视频文件路径' },
        output: { type: 'string', description: '输出图片路径' },
        time: { type: 'string', description: '截图时间点', default: '00:00:01' },
        width: { type: 'number', description: '缩略图宽度' },
        count: { type: 'number', description: '均匀截取N张（生成序列）' },
      },
      required: ['input', 'output']
    }
  },
  {
    name: 'video_extract_audio',
    description: '提取视频音轨为独立音频文件',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '视频文件路径' },
        output: { type: 'string', description: '输出音频文件路径' },
        codec: { type: 'string', enum: ['mp3', 'aac', 'flac', 'wav', 'libopus'], description: '音频编码', default: 'mp3' },
        bitrate: { type: 'string', description: '码率如 192k' },
      },
      required: ['input', 'output']
    }
  },
  {
    name: 'video_add_audio',
    description: '添加/替换视频音轨',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '视频文件路径' },
        audio: { type: 'string', description: '音频文件路径' },
        output: { type: 'string', description: '输出文件路径' },
        replace: { type: 'boolean', description: '替换原音频', default: true },
        volume: { type: 'number', description: '音量比例 1.0=原始', default: 1.0 },
      },
      required: ['input', 'audio', 'output']
    }
  },
  {
    name: 'video_subtitle_add',
    description: '为视频烧入字幕（SRT/ASS）',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '视频文件路径' },
        subtitle: { type: 'string', description: '字幕文件路径' },
        output: { type: 'string', description: '输出文件路径' },
      },
      required: ['input', 'subtitle', 'output']
    }
  },
  {
    name: 'video_subtitle_extract',
    description: '提取视频内嵌字幕流',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '视频文件路径' },
        output: { type: 'string', description: '输出字幕文件路径' },
        streamIndex: { type: 'number', description: '字幕流索引', default: 0 },
      },
      required: ['input', 'output']
    }
  },
  {
    name: 'video_watermark',
    description: '添加图片/文字水印',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '视频文件路径' },
        output: { type: 'string', description: '输出文件路径' },
        image: { type: 'string', description: '水印图片路径（与text二选一）' },
        text: { type: 'string', description: '水印文字（与image二选一）' },
        position: { type: 'string', enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'], description: '位置', default: 'bottom-right' },
        opacity: { type: 'number', description: '不透明度 0-1', default: 0.8 },
      },
      required: ['input', 'output']
    }
  },
  {
    name: 'video_speed',
    description: '视频变速（加速/减速，保持音调）',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '视频文件路径' },
        output: { type: 'string', description: '输出文件路径' },
        speed: { type: 'number', description: '倍数，2.0=2倍速，0.5=半速' },
        keepPitch: { type: 'boolean', description: '保持音频音调', default: true },
      },
      required: ['input', 'output', 'speed']
    }
  },
  {
    name: 'video_gif',
    description: '视频片段转高质量GIF（调色板优化）',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '视频文件路径' },
        output: { type: 'string', description: '输出GIF路径' },
        start: { type: 'string', description: '开始时间' },
        duration: { type: 'string', description: '持续时长' },
        fps: { type: 'number', description: '帧率', default: 10 },
        width: { type: 'number', description: '宽度', default: 320 },
      },
      required: ['input', 'output', 'start', 'duration']
    }
  },
  {
    name: 'video_filter',
    description: '视频滤镜 - 亮度/对比度/饱和度/模糊/锐化/灰度/旋转/翻转',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '视频文件路径' },
        output: { type: 'string', description: '输出文件路径' },
        brightness: { type: 'number', description: '亮度 -1.0~1.0' },
        contrast: { type: 'number', description: '对比度 -1.0~1.0' },
        saturation: { type: 'number', description: '饱和度 -1.0~1.0' },
        blur: { type: 'number', description: '模糊程度' },
        sharpen: { type: 'number', description: '锐化程度' },
        grayscale: { type: 'boolean', description: '灰度化' },
        rotate: { type: 'number', enum: [90, 180, 270], description: '旋转角度' },
        flip: { type: 'string', enum: ['horizontal', 'vertical'], description: '翻转方向' },
      },
      required: ['input', 'output']
    }
  },
];

// ==================== 安全分级 ====================

export const extToolSafetyLevels = {
  video_analyze: '安全',
  video_qa: '安全',
  video_transcribe: '安全',
  video_info: '安全',
  video_convert: '谨慎',
  video_trim: '谨慎',
  video_merge: '谨慎',
  video_split: '谨慎',
  video_screenshot: '安全',
  video_extract_audio: '谨慎',
  video_add_audio: '谨慎',
  video_subtitle_add: '谨慎',
  video_subtitle_extract: '安全',
  video_watermark: '谨慎',
  video_speed: '谨慎',
  video_gif: '谨慎',
  video_filter: '谨慎',
};

// ==================== 工具分类 ====================

export const extToolCategories = {
  'AI视频理解': ['video_analyze', 'video_qa', 'video_transcribe'],
  '视频信息': ['video_info'],
  '格式转换': ['video_convert'],
  '剪辑处理': ['video_trim', 'video_merge', 'video_split'],
  '音频处理': ['video_extract_audio', 'video_add_audio'],
  '字幕处理': ['video_subtitle_add', 'video_subtitle_extract'],
  '特效增强': ['video_watermark', 'video_speed', 'video_filter', 'video_screenshot', 'video_gif'],
};

// ==================== 工具能力映射 ====================

export const extToolAbilityMap = {
  video_analyze: ['视频理解', '视频分析'],
  video_qa: ['视频理解', '视频问答'],
  video_transcribe: ['视频理解', '语音转录', '字幕生成'],
  video_info: ['视频处理'],
  video_convert: ['视频处理', '视频转码'],
  video_trim: ['视频处理', '视频剪辑'],
  video_merge: ['视频处理', '视频合并'],
  video_split: ['视频处理', '视频剪辑'],
  video_screenshot: ['视频处理', '视频截图'],
  video_extract_audio: ['视频处理', '音频处理'],
  video_add_audio: ['视频处理', '音频处理'],
  video_subtitle_add: ['视频处理', '字幕处理'],
  video_subtitle_extract: ['视频处理', '字幕处理'],
  video_watermark: ['视频处理', '视频编辑'],
  video_speed: ['视频处理', '视频编辑'],
  video_gif: ['视频处理', 'GIF制作'],
  video_filter: ['视频处理', '视频编辑'],
};

// ==================== ffmpeg 执行引擎 ====================

async function ffmpeg(args, timeout = 600000) {
  try {
    const { stdout, stderr } = await execFileAsync('ffmpeg', ['-hide_banner', ...args], { timeout });
    return { success: true, output: stderr || stdout };
  } catch (e) {
    return { success: false, error: e.stderr || e.message };
  }
}

async function ffprobe(args) {
  try {
    const { stdout } = await execFileAsync('ffprobe', args, { timeout: 30000 });
    return { success: true, output: stdout };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ==================== 百炼 AI 调用 ====================

function getBailianKey() {
  return getProviderApiKeyFromEnv('百炼') || null;
}

function bailianRequest(path, body) {
  const apiKey = getBailianKey();
  if (!apiKey) return Promise.resolve({ success: false, error: '未配置百炼 API Key，请设置环境变量' });

  const data = JSON.stringify(body);
  return new Promise((resolve) => {
    const req = https.request({
      hostname: BAILIAN_API_HOST,
      path,
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    }, (res) => {
      let buf = '';
      res.on('data', chunk => buf += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(buf);
          if (res.statusCode === 200) resolve({ success: true, data: result });
          else resolve({ success: false, error: result.message || `HTTP ${res.statusCode}` });
        } catch (e) {
          resolve({ success: false, error: `响应解析失败: ${e.message}` });
        }
      });
    });
    req.on('error', (e) => resolve({ success: false, error: `网络请求失败: ${e.message}` }));
    req.write(data);
    req.end();
  });
}

function resolveVideoInput(videoPath) {
  if (videoPath.startsWith('http://') || videoPath.startsWith('https://')) {
    return { type: 'url', value: videoPath };
  }
  if (!existsSync(videoPath)) {
    return { type: 'error', value: '视频文件不存在' };
  }
  const stats = statSync(videoPath);
  const sizeMB = stats.size / (1024 * 1024);
  if (sizeMB > 20) {
    return { type: 'error', value: `文件${sizeMB.toFixed(0)}MB超过20MB限制，请先上传至OSS使用URL` };
  }
  const buffer = readFileSync(videoPath);
  const ext = path.extname(videoPath).slice(1) || 'mp4';
  return { type: 'base64', value: `data:video/${ext};base64,${buffer.toString('base64')}` };
}

// ==================== 工具处理器 ====================

export async function handleExtTool(toolName, args) {
  switch (toolName) {

    // ──────── AI 理解 ────────

    case 'video_analyze': {
      const { input, analysisType = 'summary', startTime, endTime } = args;
      const video = resolveVideoInput(input);
      if (video.type === 'error') return error(video.value);

      const prompts = {
        summary: '请分析这个视频的主要内容，给出简洁的概要描述，包括时长估计和关键画面。',
        scenes: '请分析视频中的场景变化，列出每个场景的时间段和内容描述。',
        objects: '请识别视频中出现的主要物体和人物，标注出现的大致时间段。',
        actions: '请分析视频中的动作和事件，按时间顺序描述。',
        all: '请全面分析这个视频：1.内容概要 2.场景变化及时间点 3.主要物体/人物 4.动作事件 5.关键时刻'
      };

      const videoContent = video.type === 'url' ? { video: video.value } : { video: video.value };
      const res = await bailianRequest('/api/v1/services/aigc/multimodal-generation/generation', {
        model: 默认视觉模型,
        input: {
          messages: [{ role: 'user', content: [videoContent, { text: prompts[analysisType] || prompts.summary }] }]
        },
        parameters: { start_time: startTime || 0, ...(endTime && { end_time: endTime }) }
      });

      if (!res.success) return error(`视频分析失败: ${res.error}`);
      const content = res.data?.output?.choices?.[0]?.message?.content;
      if (!content) return error('视频分析未返回结果');
      return text({ analysis: content, analysisType, input });
    }

    case 'video_qa': {
      const { input, question, timestamp } = args;
      const video = resolveVideoInput(input);
      if (video.type === 'error') return error(video.value);

      let fullQ = question;
      if (timestamp !== undefined) fullQ = `在视频的第${timestamp}秒处：${question}`;

      const res = await bailianRequest('/api/v1/services/aigc/multimodal-generation/generation', {
        model: 默认视觉模型,
        input: {
          messages: [{ role: 'user', content: [{ video: video.value }, { text: fullQ }] }]
        },
        parameters: { result_format: 'message' }
      });

      if (!res.success) return error(`视频问答失败: ${res.error}`);
      const answer = res.data?.output?.choices?.[0]?.message?.content;
      if (!answer) return error('视频问答未返回结果');
      return text({ answer, question, input });
    }

    case 'video_transcribe': {
      const { input, language = 'auto', outputFormat = 'srt', speakerDiarization = false } = args;

      // 转录需要音频URL——本地文件先用ffmpeg提取音频再上传，或直接要求URL
      let audioUrl = input;
      if (!input.startsWith('http://') && !input.startsWith('https://')) {
        if (!existsSync(input)) return error('视频文件不存在');
        // 本地文件：先提取音频到临时wav
        const tmpAudio = path.join(os.tmpdir(), `transcribe_${Date.now()}.wav`);
        const extractResult = await ffmpeg(['-i', input, '-vn', '-ac', '1', '-ar', '16000', '-y', tmpAudio]);
        if (!extractResult.success) return error(`提取音频失败: ${extractResult.error}`);
        // 小文件转base64传输
        const stats = statSync(tmpAudio);
        if (stats.size > 50 * 1024 * 1024) {
          await fs.unlink(tmpAudio).catch(() => {});
          return error('音频过大，请上传视频至OSS后使用URL');
        }
        const buf = readFileSync(tmpAudio);
        audioUrl = `data:audio/wav;base64,${buf.toString('base64')}`;
        await fs.unlink(tmpAudio).catch(() => {});
      }

      const res = await bailianRequest('/api/v1/services/audio/asr', {
        model: 'paraformer-v2',
        input: { file_urls: [audioUrl] },
        parameters: {
          ...(language !== 'auto' && { language_hints: [language] }),
          diarization_enabled: speakerDiarization,
        }
      });

      if (!res.success) return error(`转录失败: ${res.error}`);
      const transcripts = res.data?.output?.results;
      if (!transcripts || transcripts.length === 0) return error('转录未返回结果');

      const segments = transcripts[0]?.sentence_list || transcripts;
      let output;
      if (outputFormat === 'text') {
        output = segments.map(s => s.text).join('\n');
      } else if (outputFormat === 'srt') {
        output = segments.map((s, i) => `${i + 1}\n${formatSRT(s.begin_time)}  --> ${formatSRT(s.end_time)}\n${s.text}\n`).join('\n');
      } else if (outputFormat === 'vtt') {
        output = 'WEBVTT\n\n' + segments.map(s => `${formatVTT(s.begin_time)} --> ${formatVTT(s.end_time)}\n${s.text}\n`).join('\n');
      } else {
        output = segments;
      }

      return text({ transcript: output, format: outputFormat, segmentCount: segments.length, input });
    }

    // ──────── 信息探测 ────────

    case 'video_info': {
      if (!args.input) return error('input 不能为空');
      const result = await ffprobe(['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', args.input]);
      if (!result.success) return error(`视频信息获取失败: ${result.error}`);
      const info = JSON.parse(result.output);
      const videoStream = info.streams?.find(s => s.codec_type === 'video');
      const audioStream = info.streams?.find(s => s.codec_type === 'audio');
      return text({
        filename: path.basename(args.input),
        format: info.format?.format_name,
        duration: info.format?.duration ? parseFloat(info.format.duration).toFixed(2) + 's' : '未知',
        size: info.format?.size ? (parseInt(info.format.size) / 1024 / 1024).toFixed(2) + 'MB' : '未知',
        bitrate: info.format?.bit_rate ? (parseInt(info.format.bit_rate) / 1000).toFixed(0) + 'kbps' : '未知',
        video: videoStream ? {
          codec: videoStream.codec_name,
          resolution: `${videoStream.width}x${videoStream.height}`,
          fps: videoStream.r_frame_rate ? (Function(`return ${videoStream.r_frame_rate}`)()).toFixed(2) : '未知',
          bitrate: videoStream.bit_rate ? (parseInt(videoStream.bit_rate) / 1000).toFixed(0) + 'kbps' : '未知',
        } : null,
        audio: audioStream ? {
          codec: audioStream.codec_name,
          sampleRate: audioStream.sample_rate + 'Hz',
          channels: audioStream.channels,
        } : null,
      });
    }

    // ──────── 格式转换 ────────

    case 'video_convert': {
      const ffargs = ['-i', args.input];
      if (args.codec === 'copy') ffargs.push('-c:v', 'copy');
      else if (args.codec) ffargs.push('-c:v', args.codec);
      if (args.resolution) {
        const [w, h] = args.resolution.split('x');
        ffargs.push('-vf', `scale=${w}:${h}`);
      }
      if (args.fps) ffargs.push('-r', String(args.fps));
      if (args.bitrate) ffargs.push('-b:v', args.bitrate);
      if (args.crf !== undefined) ffargs.push('-crf', String(args.crf));
      ffargs.push('-c:a', args.audioCodec || 'aac');
      ffargs.push('-y', args.output);
      const result = await ffmpeg(ffargs);
      if (!result.success) return error(`转码失败: ${result.error}`);
      return text({ success: true, output: args.output });
    }

    // ──────── 剪辑处理 ────────

    case 'video_trim': {
      const ffargs = [];
      // 快速模式：-ss放在-i前面实现input seeking
      if (!args.accurate && args.start) ffargs.push('-ss', args.start);
      ffargs.push('-i', args.input);
      // 精确模式：-ss放在-i后面
      if (args.accurate && args.start) ffargs.push('-ss', args.start);
      if (args.end) ffargs.push('-to', args.end);
      if (args.duration) ffargs.push('-t', args.duration);
      if (!args.accurate) {
        ffargs.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
      } else {
        ffargs.push('-c:v', 'libx264', '-crf', '18', '-c:a', 'aac');
      }
      ffargs.push('-y', args.output);
      const result = await ffmpeg(ffargs);
      if (!result.success) return error(`剪辑失败: ${result.error}`);
      return text({ success: true, output: args.output });
    }

    case 'video_merge': {
      const listContent = args.files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
      const listFile = path.join(os.tmpdir(), `merge_${Date.now()}.txt`);
      await fs.writeFile(listFile, listContent);
      const result = await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-y', args.output]);
      await fs.unlink(listFile).catch(() => {});
      if (!result.success) return error(`合并失败: ${result.error}`);
      return text({ success: true, output: args.output, fileCount: args.files.length });
    }

    case 'video_split': {
      if (!args.segmentTime && !args.segmentCount) return error('请指定 segmentTime 或 segmentCount');
      let segTime = args.segmentTime;
      if (args.segmentCount) {
        const info = await ffprobe(['-v', 'quiet', '-print_format', 'json', '-show_format', args.input]);
        if (!info.success) return error('无法获取视频时长');
        const duration = parseFloat(JSON.parse(info.output).format?.duration || 0);
        if (!duration) return error('视频时长为0');
        segTime = Math.ceil(duration / args.segmentCount);
      }
      const pattern = args.outputPattern || `${path.basename(args.input, path.extname(args.input))}_%03d${path.extname(args.input)}`;
      const result = await ffmpeg(['-i', args.input, '-c', 'copy', '-f', 'segment', '-segment_time', String(segTime), '-reset_timestamps', '1', '-y', pattern]);
      if (!result.success) return error(`分割失败: ${result.error}`);
      return text({ success: true, segmentTime: segTime, outputPattern: pattern });
    }

    // ──────── 特效增强 ────────

    case 'video_screenshot': {
      if (args.count) {
        const info = await ffprobe(['-v', 'quiet', '-print_format', 'json', '-show_format', args.input]);
        if (!info.success) return error('无法获取视频信息');
        const duration = parseFloat(JSON.parse(info.output).format?.duration || 0);
        const interval = duration / (args.count + 1);
        const scaleFilter = args.width ? `,scale=${args.width}:-1` : '';
        const result = await ffmpeg(['-i', args.input, '-vf', `fps=1/${interval.toFixed(2)}${scaleFilter}`, '-frames:v', String(args.count), '-y', args.output]);
        if (!result.success) return error(`截图失败: ${result.error}`);
        return text({ success: true, count: args.count, output: args.output });
      }
      const ffargs = ['-i', args.input, '-ss', args.time || '00:00:01', '-frames:v', '1'];
      if (args.width) ffargs.push('-vf', `scale=${args.width}:-1`);
      ffargs.push('-y', args.output);
      const result = await ffmpeg(ffargs);
      if (!result.success) return error(`截图失败: ${result.error}`);
      return text({ success: true, output: args.output });
    }

    case 'video_extract_audio': {
      const ffargs = ['-i', args.input, '-vn', '-c:a', args.codec || 'mp3'];
      if (args.bitrate) ffargs.push('-b:a', args.bitrate);
      ffargs.push('-y', args.output);
      const result = await ffmpeg(ffargs);
      if (!result.success) return error(`提取音频失败: ${result.error}`);
      return text({ success: true, output: args.output });
    }

    case 'video_add_audio': {
      const ffargs = ['-i', args.input, '-i', args.audio];
      if (args.replace) {
        ffargs.push('-c:v', 'copy', '-map', '0:v:0', '-map', '1:a:0');
      } else {
        ffargs.push('-c:v', 'copy', '-map', '0:v:0', '-map', '0:a:0', '-map', '1:a:0');
      }
      if (args.volume !== undefined && args.volume !== 1.0) {
        ffargs.push('-af', `volume=${args.volume}`);
      }
      ffargs.push('-y', args.output);
      const result = await ffmpeg(ffargs);
      if (!result.success) return error(`添加音频失败: ${result.error}`);
      return text({ success: true, output: args.output });
    }

    case 'video_subtitle_add': {
      const subPath = args.subtitle.replace(/\\/g, '/').replace(/:/g, '\\:');
      const result = await ffmpeg(['-i', args.input, '-vf', `subtitles='${subPath}'`, '-c:a', 'copy', '-y', args.output]);
      if (!result.success) return error(`添加字幕失败: ${result.error}`);
      return text({ success: true, output: args.output });
    }

    case 'video_subtitle_extract': {
      const result = await ffmpeg(['-i', args.input, '-map', `0:s:${args.streamIndex || 0}`, '-y', args.output]);
      if (!result.success) return error(`提取字幕失败: ${result.error}`);
      return text({ success: true, output: args.output });
    }

    case 'video_watermark': {
      const posMap = {
        'top-left': '10:10',
        'top-right': 'W-w-10:10',
        'bottom-left': '10:H-h-10',
        'bottom-right': 'W-w-10:H-h-10',
        'center': '(W-w)/2:(H-h)/2',
      };
      const pos = posMap[args.position] || posMap['bottom-right'];
      if (args.image) {
        const result = await ffmpeg(['-i', args.input, '-i', args.image, '-filter_complex',
          `[1:v]format=rgba,colorchannelmixer=aa=${args.opacity || 0.8}[wm];[0:v][wm]overlay=${pos}`, '-c:a', 'copy', '-y', args.output]);
        if (!result.success) return error(`添加水印失败: ${result.error}`);
      } else if (args.text) {
        const [x, y] = pos.split(':');
        const filter = `drawtext=text='${args.text}':fontsize=24:fontcolor=white@${args.opacity || 0.8}:x=${x}:y=${y}:box=1:boxcolor=black@0.4:boxborderw=5`;
        const result = await ffmpeg(['-i', args.input, '-vf', filter, '-c:a', 'copy', '-y', args.output]);
        if (!result.success) return error(`添加水印失败: ${result.error}`);
      } else {
        return error('请指定 image 或 text');
      }
      return text({ success: true, output: args.output });
    }

    case 'video_speed': {
      const speed = args.speed;
      if (speed <= 0) return error('speed 必须大于 0');
      const videoPts = (1 / speed).toFixed(6);
      // 构建 atempo 链：atempo 限制 0.5~2.0，超出范围需串联
      const buildAtempo = (rate) => {
        const filters = [];
        let remaining = rate;
        while (remaining > 2.0) { filters.push('atempo=2.0'); remaining /= 2.0; }
        while (remaining < 0.5) { filters.push('atempo=0.5'); remaining /= 0.5; }
        filters.push(`atempo=${remaining.toFixed(4)}`);
        return filters.join(',');
      };

      let ffargs;
      if (args.keepPitch !== false) {
        const atempoChain = buildAtempo(speed);
        ffargs = ['-i', args.input, '-filter_complex',
          `[0:v]setpts=${videoPts}*PTS[v];[0:a]${atempoChain}[a]`,
          '-map', '[v]', '-map', '[a]', '-y', args.output];
      } else {
        ffargs = ['-i', args.input, '-vf', `setpts=${videoPts}*PTS`, '-an', '-y', args.output];
      }
      const result = await ffmpeg(ffargs);
      if (!result.success) return error(`变速失败: ${result.error}`);
      return text({ success: true, output: args.output, speed });
    }

    case 'video_gif': {
      const palettePath = path.join(os.tmpdir(), `palette_${Date.now()}.png`);
      const fps = args.fps || 10;
      const width = args.width || 320;
      const filters = `fps=${fps},scale=${width}:-1:flags=lanczos`;
      // 两步法：调色板 → 高质量GIF
      await ffmpeg(['-ss', args.start, '-t', args.duration, '-i', args.input,
        '-vf', `${filters},palettegen=stats_mode=diff`, '-y', palettePath]);
      const result = await ffmpeg(['-ss', args.start, '-t', args.duration, '-i', args.input, '-i', palettePath,
        '-lavfi', `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`, '-y', args.output]);
      await fs.unlink(palettePath).catch(() => {});
      if (!result.success) return error(`GIF生成失败: ${result.error}`);
      return text({ success: true, output: args.output });
    }

    case 'video_filter': {
      const filters = [];
      if (args.brightness !== undefined || args.contrast !== undefined || args.saturation !== undefined) {
        const eqParts = [];
        if (args.brightness !== undefined) eqParts.push(`brightness=${args.brightness}`);
        if (args.contrast !== undefined) eqParts.push(`contrast=${1 + args.contrast}`);
        if (args.saturation !== undefined) eqParts.push(`saturation=${1 + args.saturation}`);
        filters.push(`eq=${eqParts.join(':')}`);
      }
      if (args.blur) filters.push(`boxblur=${args.blur}`);
      if (args.sharpen) filters.push(`unsharp=5:5:${args.sharpen}:5:5:0`);
      if (args.grayscale) filters.push('format=gray');
      if (args.rotate === 90) filters.push('transpose=1');
      else if (args.rotate === 180) filters.push('transpose=1,transpose=1');
      else if (args.rotate === 270) filters.push('transpose=2');
      if (args.flip === 'horizontal') filters.push('hflip');
      if (args.flip === 'vertical') filters.push('vflip');
      if (filters.length === 0) return error('请至少指定一个滤镜参数');
      const result = await ffmpeg(['-i', args.input, '-vf', filters.join(','), '-c:a', 'copy', '-y', args.output]);
      if (!result.success) return error(`滤镜失败: ${result.error}`);
      return text({ success: true, output: args.output });
    }

    default:
      return null; // 未识别的工具交给链中下一个处理器
  }
}

// ==================== 辅助函数 ====================

function text(content) {
  return { content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }] };
}

function error(msg) {
  return { content: [{ type: 'text', text: msg }], isError: true };
}

function formatSRT(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mil = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(mil).padStart(3, '0')}`;
}

function formatVTT(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mil = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(mil).padStart(3, '0')}`;
}

// ==================== 默认导出 ====================

export default { extTools, handleExtTool, extToolCategories, extToolAbilityMap, extToolSafetyLevels };
