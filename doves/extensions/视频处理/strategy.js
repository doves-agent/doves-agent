/**
 * 视频处理规划策略
 * AI理解 + ffmpeg处理 统一规划
 */
import { 生成策略提示词, 生成用户提示词 } from '../../prompts/strategy-base.js';

const 方法论段落 = [
  '【视频处理能力组】',
  '',
  '本扩展提供 AI理解 + ffmpeg处理 两层能力，可独立调用或联动组合：',
  '',
  '▸ AI 理解层（需百炼API）',
  '  video_analyze：视频内容分析（场景/物体/动作/概要）',
  '  video_qa：视频问答（针对内容提问）',
  '  video_transcribe：语音转录（生成SRT/VTT/纯文本字幕）',
  '',
  '▸ 信息探测',
  '  video_info：获取元数据（时长/编码/分辨率/帧率/码率）',
  '',
  '▸ 格式转换',
  '  video_convert：转换格式/编码/分辨率/帧率/码率',
  '',
  '▸ 剪辑处理',
  '  video_trim：按时间截取片段',
  '  video_merge：合并多个视频',
  '  video_split：按时长或段数分割',
  '',
  '▸ 特效增强',
  '  video_subtitle_add：烧入字幕',
  '  video_subtitle_extract：提取内嵌字幕',
  '  video_watermark：图片/文字水印',
  '  video_speed：变速（保持音调）',
  '  video_screenshot：截图/缩略图序列',
  '  video_gif：高质量GIF生成',
  '  video_extract_audio：提取音频',
  '  video_add_audio：添加/替换音轨',
  '  video_filter：滤镜（亮度/对比/饱和/模糊/锐化/灰度/旋转/翻转）',
  '',
  '【核心联动模式】',
  '- 智能剪辑：video_transcribe(定位) → video_trim(截取)',
  '- 自动字幕：video_transcribe(生成SRT) → video_subtitle_add(烧入)',
  '- 内容截图：video_analyze(分析场景) → video_screenshot(截关键帧)',
  '- 常规处理：video_info → 具体处理工具',
  '',
  '【关键规则】',
  '- 需要基于内容定位时，优先用AI工具获取时间点再处理',
  '- AI工具需百炼API Key，不可用时提示用户配置',
  '- ffmpeg命令由工具自动生成，不需要手写参数',
  '- 危险操作（覆盖源文件）需先备份或确认',
].join('\n');

const 输出格式 = '"videoOperation": {\n    "phase": "understand|process",\n    "tool": "工具名",\n    "inputFile": "输入路径",\n    "outputFile": "输出路径",\n    "params": {}\n  },';

const 方法论指引 = '根据用户需求判断：需要理解内容时先用AI工具，需要编辑处理时用ffmpeg工具，复杂需求两层联动。';

export default {
  strategies: {
    video_processor: {
      系统: (最大子任务数 = 10, 当前深度 = 0) => 生成策略提示词(
        '视频处理',
        方法论段落,
        输出格式,
        最大子任务数,
        当前深度
      ),

      用户: (任务描述, 能力列表, 可用技能 = []) => 生成用户提示词(
        任务描述,
        能力列表,
        可用技能,
        方法论指引
      ),
    },
  },
};
