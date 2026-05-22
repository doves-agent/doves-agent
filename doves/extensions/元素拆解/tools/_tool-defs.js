/**
 * 元素拆解工具定义
 * 3个工具：element_analyze / element_extract / element_pack
 */

import config from '../_config.js';

export const MAX_BATCH_SIZE = config.process.maxBatchSize;

export const extTools = [
  {
    name: 'element_analyze',
    description: '分析图片中的所有可拆元素。使用视觉模型识别图中独立元素，返回元素列表（名称、位置、描述、优先级）。',
    inputSchema: {
      type: 'object',
      properties: {
        imageUrl: { type: 'string', description: '原图URL或本地路径（必填）' },
        prompt: { type: 'string', description: '用户提示词，指导识别哪些元素（可选）' },
      },
      required: ['imageUrl'],
    },
  },
  {
    name: 'element_extract',
    description: '拆解图片中的指定元素。调用万相2.7图像编辑模型，将指定元素从图中拆出。支持白底/黑底/透明底三种背景模式。每批最多4个元素。',
    inputSchema: {
      type: 'object',
      properties: {
        imageUrl: { type: 'string', description: '原图URL或本地路径（必填）' },
        elements: {
          type: 'array',
          description: '要拆解的元素列表（必填，最多4个）',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '元素名称' },
              description: { type: 'string', description: '元素描述/特征' },
            },
            required: ['name'],
          },
        },
        background: { type: 'string', enum: ['white', 'black', 'transparent'], description: '元素背景模式：white=白底/black=黑底/transparent=透明底（默认white）', default: 'white' },
        size: { type: 'string', enum: ['1K', '2K'], description: '输出分辨率（默认2K）', default: '2K' },
      },
      required: ['imageUrl', 'elements'],
    },
  },
  {
    name: 'element_pack',
    description: '将拆解出的所有元素图片打包为zip并上传到用户OSS。支持白底/黑底/透明底元素的混合打包。返回zip下载链接。',
    inputSchema: {
      type: 'object',
      properties: {
        elements: {
          type: 'array',
          description: '拆解出的元素列表（必填）',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '元素名称' },
              imageUrl: { type: 'string', description: '元素图片URL' },
            },
            required: ['name', 'imageUrl'],
          },
        },
        zipName: { type: 'string', description: 'zip文件名（默认：元素拆解_时间戳.zip）' },
      },
      required: ['elements'],
    },
  },
];

export const extToolCategories = {
  '元素拆解工具': ['element_analyze', 'element_extract', 'element_pack'],
};

export const extToolAbilityMap = {
  element_analyze: ['元素拆解', '图片拆元素', '视觉识别', '图片', '图像分析', '视觉', '拆解', '元素分析'],
  element_extract: ['元素拆解', '元素提取', '图像编辑', '图片', '图像分割', '拆解', '提取', '抠图'],
  element_pack: ['元素拆解', '文件打包', 'OSS上传', '图片', '打包', '压缩', '下载'],
};

export const extToolSafetyLevels = {
  element_analyze: '安全',
  element_extract: '谨慎',
  element_pack: '谨慎',
};
