/**
 * @file providers-选择器.js
 * @description 模型选择器，从 providers/index.js 抽取
 */

import { 默认模型配置 } from '../常量.js';
import { 提供商列表 } from './providers-config.js';

/**
 * 模型选择器 - 根据任务选择合适的模型
 */
export class 模型选择器 {
  constructor() {
    this.可用模型 = [];
  }

  /**
   * 注册可用模型
   * @param {string} 提供商名 - 提供商名称
   * @param {Array} 模型列表 - 模型列表
   */
  注册模型(提供商名, 模型列表) {
    模型列表.forEach(模型 => {
      this.可用模型.push({ 提供商: 提供商名, 模型 });
    });
  }

  /**
   * 选择推理模型
   */
  选择推理模型(任务) {
    const 默认推理 = 默认模型配置.推理模型;
    if (!默认推理.model || !默认推理.provider) {
      throw new Error('默认推理模型未配置');
    }
    return { 提供商: 默认推理.provider, 模型: 默认推理.model };
  }

  /**
   * 选择快速模型
   */
  选择快速模型() {
    const 默认快速 = 默认模型配置.快速模型;
    if (!默认快速.model || !默认快速.provider) {
      throw new Error('默认快速模型未配置');
    }
    return { 提供商: 默认快速.provider, 模型: 默认快速.model };
  }

  /**
   * 根据能力需求选择模型
   */
  按能力选择(所需能力) {
    if (!所需能力 || 所需能力.length === 0) {
      return this.选择推理模型({});
    }

    for (const [提供商名, 配置] of Object.entries(提供商列表)) {
      const 能力匹配 = 所需能力.every(能力 => 配置.能力?.includes(能力));
      if (!能力匹配 || 配置.模型.length === 0) continue;

      if (配置.按能力选模型) {
        for (const 能力 of 所需能力) {
          const 模型配置 = 配置.按能力选模型[能力];
          if (模型配置?.model && 配置.模型.includes(模型配置.model)) {
            return { 提供商: 提供商名, 模型: 模型配置.model };
          }
        }
      }

      const 默认模型 = 配置.默认模型 || 配置.模型[0];
      return { 提供商: 提供商名, 模型: 默认模型 };
    }

    throw new Error(`未找到支持能力 [${所需能力.join(', ')}] 的模型`);
  }
}
