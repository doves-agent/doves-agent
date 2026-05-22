/**
 * 视频处理角色定义
 */
export default {
  roles: {
    video_analyst: {
      description: '视频分析师 - 用AI理解视频内容、回答问题、转录语音',
      abilities: ['视频理解', '视频分析', '视频问答', '语音转录'],
    },
    video_detector: {
      description: '视频探测者 - 获取视频元数据（时长/编码/分辨率/帧率）',
      abilities: ['视频处理'],
    },
    video_planner: {
      description: '视频规划者 - 根据需求和视频信息规划处理方案',
      abilities: ['视频处理', '视频理解'],
    },
    video_operator: {
      description: '视频执行者 - 执行转码/剪辑/合并/滤镜等处理操作',
      abilities: ['视频处理', '视频转码', '视频剪辑', '视频合并', '字幕处理'],
    },
    video_validator: {
      description: '视频验证者 - 验证输出文件的正确性和质量',
      abilities: ['视频处理', '视频截图'],
    },
  },
};
