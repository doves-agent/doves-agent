/**
 * @file tools/图片生成/工具定义
 * @description 图片生成工具定义（文生图、批量生成、图像编辑）
 */

import { PROVIDER_SPECIAL_ENDPOINTS } from '../../常量.js';

// 图像生成 API 端点（从全局配置源获取）
export const IMAGE_API = PROVIDER_SPECIAL_ENDPOINTS['百炼'].image;

export const imageTools = [
  {
    name: '图片生成',
    description: '文生图 - 根据文本描述生成图片。[限制]依赖百炼图像API Key，未配置则不可用；无法精确控制文字渲染；生成结果有随机性。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '图片描述/提示词'
        },
        model: {
          type: 'string',
          enum: ['wanx-v1', 'flux-schnell', 'flux-dev', 'sd3'],
          description: '模型选择：wanx-v1=阿里万象，flux-schnell=快速生成，flux-dev=高质量',
          default: 'wanx-v1'
        },
        style: {
          type: 'string',
          enum: ['auto', 'photography', 'illustration', '3d', 'anime', 'oil_painting', 'watercolor', 'sketch', 'chinese_painting', 'pixel'],
          description: '图片风格',
          default: 'auto'
        },
        size: {
          type: 'string',
          enum: ['512x512', '720x720', '1024x1024', '1024x720', '720x1024', '1280x720', '720x1280'],
          description: '图片尺寸',
          default: '1024x1024'
        },
        n: {
          type: 'integer',
          description: '生成图片数量 (1-4)',
          default: 1
        },
        negativePrompt: {
          type: 'string',
          description: '负面提示词（不想要的内容）'
        },
        seed: {
          type: 'integer',
          description: '随机种子（用于复现结果）'
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径（不含扩展名）'
        },
        referenceImage: {
          type: 'string',
          description: '参考图片路径或URL（用于风格迁移）'
        }
      },
      required: ['prompt']
    }
  },
  {
    name: '批量图片生成',
    description: '批量文生图 - 批量根据文本描述生成图片。[限制]依赖百炼图像API Key，未配置则不可用。',
    inputSchema: {
      type: 'object',
      properties: {
        prompts: {
          type: 'array',
          items: { type: 'string' },
          description: '图片描述数组'
        },
        model: {
          type: 'string',
          enum: ['wanx-v1', 'flux-schnell', 'flux-dev', 'sd3'],
          description: '模型选择',
          default: 'wanx-v1'
        },
        style: {
          type: 'string',
          description: '统一风格'
        },
        size: {
          type: 'string',
          description: '统一尺寸',
          default: '1024x1024'
        },
        outputDir: {
          type: 'string',
          description: '输出目录'
        },
        naming: {
          type: 'string',
          enum: ['index', 'timestamp', 'hash'],
          description: '命名方式：index=序号，timestamp=时间戳，hash=哈希',
          default: 'index'
        },
        concurrency: {
          type: 'integer',
          description: '并发数 (1-4)',
          default: 2
        }
      },
      required: ['prompts']
    }
  },
  {
    name: '图片编辑',
    description: '图像编辑 - 对图片进行局部重绘、扩展、修复等操作。[限制]依赖百炼图像API Key，未配置则不可用；编辑精度有限，复杂修图建议用专业软件。',
    inputSchema: {
      type: 'object',
      properties: {
        imagePath: {
          type: 'string',
          description: '原始图片路径或URL'
        },
        editType: {
          type: 'string',
          enum: ['inpaint', 'outpaint', 'upscale', 'style_transfer', 'background_replace'],
          description: '编辑类型'
        },
        prompt: {
          type: 'string',
          description: '编辑描述'
        },
        maskPath: {
          type: 'string',
          description: '蒙版图片路径（用于局部重绘）'
        },
        scale: {
          type: 'number',
          description: '放大倍数（用于upscale）',
          default: 2
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径'
        }
      },
      required: ['imagePath', 'editType']
    }
  }
];
