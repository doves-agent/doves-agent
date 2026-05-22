/**
 * 自动字幕技能（AI联动）
 * 转录语音 → 生成SRT → 烧入视频
 */
export default {
  name: 'video_auto_subtitle',
  description: '自动字幕 - AI转录语音并烧入字幕到视频（一键完成）',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string', description: '视频文件路径' },
      output: { type: 'string', description: '输出视频路径' },
      language: { type: 'string', description: '语言 zh/en/ja/auto', default: 'auto' },
      burnIn: { type: 'boolean', description: '是否烧入视频（false则只生成SRT文件）', default: true },
      srtOutput: { type: 'string', description: 'SRT字幕保存路径（可选）' },
    },
    required: ['input'],
  },
  async execute(args, context) {
    const { input, output, language = 'auto', burnIn = true, srtOutput } = args;
    const { handleExtTool } = await import('../../tools/视频工具.js');
    const path = await import('path');
    const fs = await import('fs/promises');
    const os = await import('os');

    // 1. AI 转录
    const transcribeResult = await handleExtTool('video_transcribe', { input, language, outputFormat: 'srt' });
    if (transcribeResult.isError) return transcribeResult;

    const data = JSON.parse(transcribeResult.content[0].text);
    const srtContent = data.transcript;

    if (!srtContent || srtContent.trim().length === 0) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: '转录未识别到语音内容' }) }], isError: true };
    }

    // 2. 保存 SRT 文件
    const ext = path.extname(input);
    const srtPath = srtOutput || path.join(os.tmpdir(), `subtitle_${Date.now()}.srt`);
    await fs.writeFile(srtPath, srtContent, 'utf-8');

    if (!burnIn) {
      const finalSrt = srtOutput || input.replace(new RegExp(`${ext}$`), '.srt');
      if (!srtOutput) await fs.rename(srtPath, finalSrt);
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, srtFile: srtOutput || finalSrt, segmentCount: data.segmentCount }) }]
      };
    }

    // 3. 烧入字幕
    const outPath = output || input.replace(new RegExp(`${ext}$`), `_subtitled${ext}`);
    const burnResult = await handleExtTool('video_subtitle_add', { input, subtitle: srtPath, output: outPath });

    // 清理临时SRT（如果用户没指定保存路径）
    if (!srtOutput) await fs.unlink(srtPath).catch(() => {});

    if (burnResult.isError) return burnResult;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          output: outPath,
          segmentCount: data.segmentCount,
          ...(srtOutput && { srtFile: srtOutput }),
        }, null, 2)
      }]
    };
  }
};
