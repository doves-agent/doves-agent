/**
 * 批量视频处理技能
 * 遍历目录 → 逐个处理 → 汇报进度
 */
export default {
  name: 'video_batch',
  description: '批量视频处理 - 对目录下多个视频执行相同操作',
  inputSchema: {
    type: 'object',
    properties: {
      inputDir: { type: 'string', description: '输入目录路径' },
      extensions: { type: 'array', items: { type: 'string' }, description: '匹配的扩展名', default: ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv'] },
      operation: {
        type: 'object',
        description: '批量执行的操作',
        properties: {
          tool: { type: 'string', description: '工具名（video_convert/video_trim/video_extract_audio/video_screenshot等）' },
          params: { type: 'object', description: '操作参数（不含input/output）' },
        }
      },
      outputDir: { type: 'string', description: '输出目录（默认 inputDir/processed）' },
    },
    required: ['inputDir', 'operation'],
  },
  async execute(args, context) {
    const { inputDir, extensions = ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv'], operation, outputDir } = args;
    const { handleExtTool } = await import('../../tools/视频工具.js');
    const fs = await import('fs/promises');
    const path = await import('path');

    const files = await fs.readdir(inputDir);
    const videoFiles = files.filter(f => extensions.some(ext => f.toLowerCase().endsWith(ext)));

    if (videoFiles.length === 0) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: '目录中未找到视频文件' }) }], isError: true };
    }

    const outDir = outputDir || path.join(inputDir, 'processed');
    await fs.mkdir(outDir, { recursive: true }).catch(() => {});

    const results = [];
    for (let i = 0; i < videoFiles.length; i++) {
      const file = videoFiles[i];
      const inputPath = path.join(inputDir, file);
      const ext = path.extname(file);
      const outputPath = path.join(outDir, `${path.basename(file, ext)}_processed${ext}`);

      const result = await handleExtTool(operation.tool, { input: inputPath, output: outputPath, ...operation.params });
      results.push({
        file,
        progress: `${i + 1}/${videoFiles.length}`,
        success: !result.isError,
        output: result.isError ? null : outputPath,
      });
    }

    const successCount = results.filter(r => r.success).length;
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          summary: `批量处理完成：${successCount}/${videoFiles.length} 成功`,
          outputDir: outDir,
          results,
        }, null, 2)
      }]
    };
  }
};
