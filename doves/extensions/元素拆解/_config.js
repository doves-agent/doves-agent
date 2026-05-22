/**
 * 元素拆解应用配置
 * 集中管理所有可调参数，避免硬编码
 */

export default {
  // ===== 万相模型配置 =====
  wan: {
    model: 'wan2.7-image-pro',          // 模型：wan2.7-image-pro / wan2.7-image
    defaultSize: '2K',                    // 输出分辨率：1K / 2K（图像编辑最高2K）
    imagesPerGeneration: {                // 单次生成图片数范围（动态计算，配置仅控上下限）
      min: 1,                             // 最少产出数
      max: 4,                             // 普通模式上限4，组图模式上限12
    },
    watermark: false,                     // 是否添加AI水印
    apiTimeout: 120000,                   // API请求超时（毫秒）
    pollInterval: 5000,                   // 异步任务轮询间隔（毫秒）
    pollMaxAttempts: 60,                  // 异步任务最大轮询次数
  },

  // ===== 元素拆解流程配置 =====
  process: {
    maxBatchSize: 4,                      // 每批最大拆解元素数
  },

  // ===== 视觉分析模型配置 =====
  analyze: {
    temperature: 0.3,                     // 识别温度（越低越精确）
    maxTokens: 16384,                     // 最大输出token（增大避免复杂场景截断，实测图片多元素时 4096 不够）
  },

  // ===== 背景替换阈值 =====
  background: {
    whiteThreshold: 240,                  // 白色判定阈值（RGB三通道≥此值视为白色）
    edgeThreshold: 200,                   // 边缘柔化阈值（此值~whiteThreshold间做渐变透明）
  },

  // ===== OSS 存储配置 =====
  oss: {
    pathPrefix: '元素拆解/',              // OSS存储路径前缀
  },
};
