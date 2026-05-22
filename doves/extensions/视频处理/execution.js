/**
 * 视频处理执行增强
 */
export default {
  conditionalPrompts: [
    {
      match: (任务, tools) => {
        const 能力需求 = 任务.能力需求 || [];
        return 能力需求.some(a => ['视频处理', '视频转码', '视频剪辑', 'GIF制作', '视频理解', '视频分析', '语音转录'].includes(a));
      },
      prompt: `【视频能力工具速查】

▸ AI理解（需百炼API Key）
  - 内容分析 → video_analyze（场景/物体/动作/概要）
  - 视频问答 → video_qa（针对视频内容提问）
  - 语音转录 → video_transcribe（生成SRT/VTT字幕）

▸ ffmpeg处理
  - 视频信息 → video_info
  - 格式转换 → video_convert
  - 剪辑截取 → video_trim（精确模式accurate=true）
  - 合并视频 → video_merge
  - 分割视频 → video_split
  - 截图 → video_screenshot
  - 提取音频 → video_extract_audio
  - 添加音频 → video_add_audio
  - 烧入字幕 → video_subtitle_add
  - 提取字幕 → video_subtitle_extract
  - 水印 → video_watermark
  - 变速 → video_speed
  - 滤镜 → video_filter
  - GIF → video_gif（调色板优化，高质量）

【联动模式】
- 需要根据内容定位时间点 → 先 video_transcribe/video_analyze，再 video_trim
- 需要自动字幕 → video_transcribe 生成 SRT → video_subtitle_add 烧入
- 大文件操作（转码/合并）耗时较长，先用 询问用户 确认

【注意事项】
- pipeline 模式按顺序执行，中间产物用临时路径
- 最终输出用有意义的文件名
- 不覆盖源文件`,
    },
  ],

  hooks: {
    afterToolCall: async (工具名, 工具结果, 任务) => {
      if (!工具结果.isError && 工具结果.content?.[0]?.text) {
        try {
          const data = JSON.parse(工具结果.content[0].text);
          if (data.output) 任务.lastOutputFile = data.output;
        } catch {}
      }
      return null;
    },
  },
};
