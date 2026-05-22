/**
 * 智能压缩技能
 * 探测 → 推荐参数 → 压缩 → 对比
 */
export default {
  name: 'video_compress',
  description: '智能压缩 - 分析视频并以最优参数压缩（保质量减体积）',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string', description: '视频文件路径' },
      output: { type: 'string', description: '输出路径' },
      quality: { type: 'string', enum: ['high', 'medium', 'low'], description: '质量偏好', default: 'medium' },
      codec: { type: 'string', enum: ['libx264', 'libx265'], description: '编码器（x265压缩率更高）', default: 'libx265' },
    },
    required: ['input'],
  },
  async execute(args, context) {
    const { input, output, quality = 'medium', codec = 'libx265' } = args;
    const { handleExtTool } = await import('../../tools/视频工具.js');
    const path = await import('path');

    const infoResult = await handleExtTool('video_info', { input });
    if (infoResult.isError) return infoResult;
    const info = JSON.parse(infoResult.content[0].text);

    const crfMap = { high: 23, medium: 28, low: 33 };
    const crf = crfMap[quality] || 28;
    const ext = path.extname(input);
    const outPath = output || input.replace(new RegExp(`${ext}$`), `_compressed${ext}`);

    const result = await handleExtTool('video_convert', { input, output: outPath, codec, crf });
    if (result.isError) return result;

    const compressedInfo = await handleExtTool('video_info', { input: outPath });
    const compressed = compressedInfo.isError ? {} : JSON.parse(compressedInfo.content[0].text);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          output: outPath,
          comparison: {
            original: { size: info.size, bitrate: info.bitrate },
            compressed: { size: compressed.size, bitrate: compressed.bitrate },
          },
          params: { quality, codec, crf },
        }, null, 2)
      }]
    };
  }
};
