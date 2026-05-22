/**
 * 综合视频编辑技能
 * 链式执行多步视频处理操作
 */
const OP_TO_TOOL = {
  trim: 'video_trim',
  convert: 'video_convert',
  filter: 'video_filter',
  speed: 'video_speed',
  watermark: 'video_watermark',
  subtitle: 'video_subtitle_add',
  screenshot: 'video_screenshot',
  extract_audio: 'video_extract_audio',
  gif: 'video_gif',
};

export default {
  name: 'video_edit',
  description: '综合视频编辑 - 链式执行多步处理操作（剪辑→滤镜→水印等）',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string', description: '视频文件路径' },
      operations: {
        type: 'array',
        description: '操作列表（按顺序执行）',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: Object.keys(OP_TO_TOOL), description: '操作类型' },
            params: { type: 'object', description: '该步骤的参数' },
          }
        }
      },
      output: { type: 'string', description: '最终输出文件路径' },
    },
    required: ['input'],
  },
  async execute(args, context) {
    const { input, operations, output } = args;
    const { handleExtTool } = await import('../../tools/视频工具.js');
    const path = await import('path');

    const info = await handleExtTool('video_info', { input });
    if (info.isError) return info;

    if (!operations || operations.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            videoInfo: JSON.parse(info.content[0].text),
            hint: '请根据视频信息和用户需求规划处理步骤',
            availableOps: Object.keys(OP_TO_TOOL).map(k => `${k}(${OP_TO_TOOL[k]})`),
          }, null, 2)
        }]
      };
    }

    let currentInput = input;
    const results = [];
    const ext = path.extname(input);

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const toolName = OP_TO_TOOL[op.type];
      if (!toolName) {
        return { content: [{ type: 'text', text: `未知操作类型: ${op.type}` }], isError: true };
      }

      const isLast = i === operations.length - 1;
      const os = await import('os');
      const opOutput = isLast
        ? (output || `${path.basename(input, ext)}_edited${ext}`)
        : path.join(os.default.tmpdir(), `_chain_${i}_${Date.now()}${ext}`);

      const result = await handleExtTool(toolName, { input: currentInput, output: opOutput, ...op.params });
      const parsed = result.isError ? { error: result.content[0].text } : JSON.parse(result.content[0].text);
      results.push({ step: i + 1, operation: op.type, tool: toolName, result: parsed });

      if (result.isError) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: `第${i + 1}步 ${op.type} 失败`, results }, null, 2) }], isError: true };
      }

      currentInput = opOutput;
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, finalOutput: currentInput, totalSteps: operations.length, results }, null, 2)
      }]
    };
  }
};
