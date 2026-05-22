/**
 * @file 精简工具执行-媒体生成
 * @description KISS 精简工具 - 图像生成、元素拆解、TTS 语音合成、3D 模型生成
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import https from 'https';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('媒体生成', { 前缀: '[Skill]', 级别: 'debug' });

// ==================== 图像生成（万相2.7 / 千问图像2.0） ====================

const IMG_HOST = 'dashscope.aliyuncs.com';
const IMG_PATH = '/api/v1/services/aigc/multimodal-generation/generation';

function _imgRequest(apiKey, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: IMG_HOST,
      path: IMG_PATH,
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 120000,
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error(`图像生成响应解析失败: ${e.message}`)); }
      });
    });
    req.on('error', e => reject(new Error(`请求失败: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时(120s)')); });
    req.write(data);
    req.end();
  });
}

function _imgPoll(apiKey, taskId) {
  const max = 60, interval = 5000;
  return new Promise((resolve, reject) => {
    async function poll(n) {
      if (n > max) return reject(new Error('轮询超时'));
      await new Promise(r => setTimeout(r, interval));
      const result = await new Promise((res, rej) => {
        https.get({
          hostname: IMG_HOST, path: `/api/v1/tasks/${taskId}`,
          headers: { 'Authorization': `Bearer ${apiKey}` },
        }, (resp) => {
          let data = '';
          resp.on('data', c => data += c);
          resp.on('end', () => { try { res(JSON.parse(data)); } catch (e) { rej(new Error(`图像轮询响应解析失败: ${e.message}`)); } });
        }).on('error', e => rej(new Error(`请求失败: ${e.message}`)));
      });
      const status = result.output?.task_status;
      if (status === 'SUCCEEDED') return resolve({ success: true, output: result.output });
      if (status === 'FAILED') return resolve({ error: result.output?.message || '异步任务失败' });
      poll(n + 1);
    }
    poll(1);
  });
}

function _extractImages(output) {
  const urls = [];
  if (output.results) urls.push(...output.results.map(r => r.url).filter(Boolean));
  if (output.choices) {
    for (const c of output.choices) {
      for (const item of (c.message?.content || [])) {
        if (item.image) urls.push(item.image);
        if (item.url) urls.push(item.url);
      }
    }
  }
  return [...new Set(urls)];
}

export async function 生成图片(args) {
  const apiKey = process.env.BAILIAN_API_KEY;
  if (!apiKey) return '错误: 未配置 BAILIAN_API_KEY';

  const model = args.model || 'wan2.7-image-pro';
  const prompt = args.prompt;
  const imageUrl = args.image_url;
  const isWan = model.startsWith('wan');

  const content = imageUrl
    ? [{ image: imageUrl }, { text: prompt }]
    : [{ text: prompt }];

  const params = { watermark: false };
  if (isWan) {
    params.size = args.size || '2K';
    params.n = Math.min(Math.max(args.n || 1, 1), 4);
  } else {
    params.size = args.size || '2048*2048';
    params.n = Math.min(Math.max(args.n || 1, 1), 6);
    params.prompt_extend = true;
    if (args.negative_prompt) params.negative_prompt = args.negative_prompt;
  }

  const body = { model, input: { messages: [{ role: 'user', content }] }, parameters: params };
  const result = await _imgRequest(apiKey, body);
  if (result.error) return `${model} API错误: ${result.error}`;
  if (result.code || result.message) return `${model} API错误[${result.code}]: ${result.message}`;

  if (result.output?.task_status === 'PENDING' || result.output?.task_status === 'RUNNING') {
    logger.info(`异步任务 ${result.output.task_id}，等待完成...`);
    const pollResult = await _imgPoll(apiKey, result.output.task_id);
    if (pollResult.error) return `异步任务失败: ${pollResult.error}`;
    const urls = _extractImages(pollResult.output);
    if (urls.length === 0) return '异步任务完成但无图片返回';
    return `✅ ${model} 生成 ${urls.length} 张图片:\n${urls.map((u, i) => `${i + 1}. ${u}`).join('\n')}`;
  }

  const urls = _extractImages(result.output || {});
  if (urls.length === 0) return '模型未返回图片（可能内容不合规，或 image_url 不可访问）';
  return `✅ ${model} 生成 ${urls.length} 张图片:\n${urls.map((u, i) => `${i + 1}. ${u}`).join('\n')}`;
}

// ==================== 元素拆解（视觉识图 + 组图拆解） ====================

const VISION_HOST = 'dashscope.aliyuncs.com';
const VISION_PATH = '/compatible-mode/v1/chat/completions';

async function _视觉识图(imageUrl) {
  const apiKey = process.env.BAILIAN_API_KEY;
  if (!apiKey) throw new Error('未配置 BAILIAN_API_KEY，无法进行视觉识图');

  const prompt = `请分析这张图片，找出图中所有可以独立拆解出来的物体/元素。

识别原则：
1. 优先识别实物物体（建筑、车辆、家具、人物、动物、物品、装饰等），也识别边界清晰的图标和文字区域
2. 每个元素应该是独立可分离的实体
3. 不要遗漏小型独立物体（图标、装饰品、小物件等）
4. 为每个元素标注置信度（0-1）
5. 优先识别最显著、最大的元素放在列表前面

请返回严格JSON格式（不要markdown标记）：
{"elements":[{"name":"元素名称","description":"元素特征描述（颜色/形状/位置/大小等）","confidence":0.9}]}`;

  const body = JSON.stringify({
    model: 'qwen-vl-max',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: prompt },
      ],
    }],
    temperature: 0.3,
    max_tokens: 4096,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: VISION_HOST, path: VISION_PATH, method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 60000,
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          const text = parsed.choices?.[0]?.message?.content || '';
          const elements = _解析元素JSON(text);
          logger.info(`视觉识图: 识别到 ${elements.length} 个元素`);
          resolve(elements);
        } catch (e) {
          reject(new Error(`视觉识图解析失败: ${e.message}`));
        }
      });
    });
    req.on('error', e => reject(new Error(`视觉识图请求失败: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('视觉识图请求超时')); });
    req.write(body);
    req.end();
  });
}

function _解析元素JSON(text) {
  if (!text) return [];
  let cleaned = text.replace(/<think[\s\S]*?<\/think>/gi, '').trim();
  const codeMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeMatch) cleaned = codeMatch[1].trim();
  try {
    const parsed = JSON.parse(cleaned);
    const arr = parsed.elements || (Array.isArray(parsed) ? parsed : []);
    return arr.filter(e => (e.confidence ?? 1.0) >= 0.5).map((e, i) => ({
      name: e.name || `元素${i + 1}`,
      description: e.description || '',
    }));
  } catch (e) {
    throw new Error(`元素JSON解析失败: ${e.message}`);
  }
}

function _构建组图提示(elements, userPrompt) {
  const descLines = elements.map((e, i) => {
    const desc = e.description ? `（${e.description}）` : '';
    return `${i + 1}. ${e.name}${desc}`;
  }).join('\n');
  const customSection = userPrompt ? `\n${userPrompt}` : '';
  return `从图中依次拆出以下 ${elements.length} 个元素，每个元素单独输出一张图，白色背景：

${descLines}${customSection}

要求：
1. 严格按上述列表顺序输出，每个元素对应一张图
2. 每张图只包含对应的拆出元素，背景为纯白色
3. 原图中该元素位置用纯白色填充并与周围自然融合，不留修改痕迹
4. 保持元素完整清晰，不做额外修改或补充图中不存在的内容
5. 只输出拆出的元素图片，背景为纯白色`;
}

export async function 元素拆解(args) {
  const apiKey = process.env.BAILIAN_API_KEY;
  if (!apiKey) return '错误: 未配置 BAILIAN_API_KEY';

  const imageUrl = args.image_url;
  if (!imageUrl) return '错误: 请提供 image_url（原图公网URL）';

  const userPrompt = args.prompt || '';
  const imageSize = args.size || '2K';

  let elements = args.elements?.filter(e => e.name);
  if (!elements || elements.length === 0) {
    logger.info('未提供元素列表，调用视觉模型自动识别...');
    elements = await _视觉识图(imageUrl);
    if (elements.length === 0) {
      return '视觉模型未能识别到图片中的元素，请尝试手动提供 elements 参数';
    }
  }

  logger.info(`元素拆解: 共 ${elements.length} 个元素 → [${elements.map(e => e.name).join(', ')}]`);
  if (userPrompt) logger.info(`自定义拆解指令: ${userPrompt.substring(0, 100)}`);
  logger.info(`输出分辨率: ${imageSize}`);

  const BATCH_SIZE = 4;
  const allResults = [];

  for (let start = 0; start < elements.length; start += BATCH_SIZE) {
    const batch = elements.slice(start, start + BATCH_SIZE);
    const batchIdx = Math.floor(start / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(elements.length / BATCH_SIZE);

    logger.info(`组图拆解 第 ${batchIdx}/${totalBatches} 批: ${batch.map(e => e.name).join(', ')}`);

    const groupPrompt = _构建组图提示(batch, userPrompt);
    const body = {
      model: 'wan2.7-image-pro',
      input: {
        messages: [{
          role: 'user',
          content: [
            { image: imageUrl },
            { text: groupPrompt },
          ],
        }],
      },
      parameters: { size: imageSize, n: batch.length, watermark: false },
    };

    const result = await _imgRequest(apiKey, body);

    if (result.error) {
      logger.warn(`第 ${batchIdx} 批拆解失败: ${result.error}`);
      for (const e of batch) allResults.push({ name: e.name, status: 'failed', error: result.error });
      continue;
    }

    let output = result.output;
    if (output?.task_status === 'PENDING' || output?.task_status === 'RUNNING') {
      logger.info(`异步任务 ${output.task_id}，等待完成...`);
      const pollResult = await _imgPoll(apiKey, output.task_id);
      if (pollResult.error) {
        for (const e of batch) allResults.push({ name: e.name, status: 'failed', error: pollResult.error });
        continue;
      }
      output = pollResult.output;
    }

    const urls = _extractImages(output || {});
    if (urls.length === 0) {
      for (const e of batch) allResults.push({ name: e.name, status: 'failed', error: '模型未返回图片' });
      continue;
    }

    for (let i = 0; i < batch.length; i++) {
      const url = urls[i] || null;
      allResults.push({
        name: batch[i].name,
        imageUrl: url,
        status: url ? 'success' : 'failed',
        error: url ? undefined : '组图返回图片数量不足',
      });
    }
  }

  const successList = allResults.filter(r => r.status === 'success');
  const failedList = allResults.filter(r => r.status === 'failed');

  let report = `✅ 元素拆解完成: ${successList.length}/${allResults.length} 成功\n\n`;
  for (const r of allResults) {
    if (r.status === 'success') {
      report += `| **${r.name}** | [查看图片](${r.imageUrl}) |\n`;
    } else {
      report += `| **${r.name}** | ❌ ${r.error} |\n`;
    }
  }
  if (failedList.length > 0) {
    report += `\n${failedList.length} 个元素拆解失败，可用 element_extract 单独指定失败的元素重试。`;
  }
  return report;
}

// ==================== TTS 语音合成 ====================

export async function 语音合成(args) {
  const apiKey = process.env.BAILIAN_API_KEY;
  if (!apiKey) return '错误: 未配置 BAILIAN_API_KEY';

  const text = args.text?.substring(0, 1000);
  if (!text) return '错误: 请提供要合成的文本';
  const voice = args.voice || 'longanyang';
  const outputPath = args.output_path || join(tmpdir(), `tts_${Date.now()}.mp3`);

  const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/audio/speech', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'cosyvoice-v3.5-plus', input: text, voice, response_format: 'mp3' }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) {
    const err = await resp.text();
    return `TTS API 错误 ${resp.status}: ${err.substring(0, 300)}`;
  }
  const arrayBuf = await resp.arrayBuffer();
  writeFileSync(outputPath, Buffer.from(arrayBuf));
  return `✅ 语音合成完成: ${outputPath} (${Buffer.from(arrayBuf).length} bytes, 音色:${voice})`;
}

// ==================== 3D 模型生成 ====================

const TRIPO_HOST = 'dashscope.aliyuncs.com';
const TRIPO_PATH = '/api/v1/services/aigc/video-generation/3d-generation';

export async function 生成3D(args) {
  const apiKey = process.env.BAILIAN_API_KEY;
  if (!apiKey) return '错误: 未配置 BAILIAN_API_KEY';

  if (!args.prompt && !args.image_url && !args.image_urls?.length) {
    return '错误: 请提供 prompt（文生3D）、image_url（图生3D）或 image_urls（多图生3D）';
  }

  const input = {};
  if (args.prompt) input.prompt = args.prompt;
  else if (args.image_urls?.length) input.images = args.image_urls;
  else if (args.image_url) input.image = args.image_url;

  const body = {
    model: 'Tripo/Tripo-H3.1',
    input,
    parameters: { texture_quality: args.quality || 'standard' },
  };

  const submit = await new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: IMG_HOST, path: TRIPO_PATH, method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
      timeout: 60000,
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error(`3D提交响应解析失败: ${e.message}`)); } });
    });
    req.on('error', e => reject(new Error(`3D提交请求失败: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('3D提交请求超时')); });
    req.write(data);
    req.end();
  });

  const taskId = submit.output?.task_id;
  if (!taskId) return `Tripo 提交失败: ${JSON.stringify(submit).substring(0, 200)}`;

  logger.info(`3D任务 ${taskId}，等待完成（约1-5分钟）...`);

  const result = await new Promise((resolve, reject) => {
    async function poll(n) {
      if (n > 40) return reject(new Error('3D生成超时(10分钟)'));
      await new Promise(r => setTimeout(r, 15000));
      const r = await new Promise((res, rej) => {
        https.get({
          hostname: TRIPO_HOST, path: `/api/v1/tasks/${taskId}`,
          headers: { 'Authorization': `Bearer ${apiKey}` },
        }, (resp) => {
          let data = '';
          resp.on('data', c => data += c);
          resp.on('end', () => { try { res(JSON.parse(data)); } catch (e) { rej(new Error(`3D轮询响应解析失败: ${e.message}`)); } });
        }).on('error', e => rej(new Error(`3D轮询请求失败: ${e.message}`)));
      });
      const status = r.output?.task_status;
      if (status === 'SUCCEEDED') return resolve({ success: true, output: r.output });
      if (status === 'FAILED') return resolve({ error: r.output?.message || '3D生成失败' });
      if (status === 'CANCELED') return resolve({ error: '3D任务已取消' });
      logger.info(`3D: ${status} (${n}/40)`);
      poll(n + 1);
    }
    poll(1);
  });

  if (result.error) return `3D生成失败: ${result.error}`;

  const outputs = result.output.results || [];
  if (outputs.length === 0) return '3D任务完成但无模型返回';

  const lines = outputs.map((r, i) => {
    const parts = [`${i + 1}.`];
    if (r.rendered_image_url) parts.push(`预览图: ${r.rendered_image_url}`);
    if (r.pbr_model_url) parts.push(`PBR模型: ${r.pbr_model_url}`);
    if (r.base_model_url) parts.push(`基础模型: ${r.base_model_url}`);
    return parts.join(' ');
  });

  return `✅ 3D模型生成完成:\n${lines.join('\n')}`;
}
