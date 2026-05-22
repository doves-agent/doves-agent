/**
 * @file tools/oss存储/路径工具
 * @description OSS 路径常量和路径生成函数
 */

import { OSS_PREFIX } from './OSS路径配置.js';

/**
 * OSS 路径常量
 */
export const 路径常量 = {
  浏览器截图: `${OSS_PREFIX}/browser/screenshots/`,
  浏览器上传: `${OSS_PREFIX}/browser/uploads/`,
  Docker输入: `${OSS_PREFIX}/docker/inputs/`,
  Docker输出: `${OSS_PREFIX}/docker/outputs/`,
  临时文件: `${OSS_PREFIX}/temp/`,
  用户交换: `${OSS_PREFIX}/exchange/`,
  任务文件: `${OSS_PREFIX}/tasks/`,
  用户文件: `${OSS_PREFIX}/users/`
};

/**
 * 生成用户文件路径
 * @param {string} 用户ID 
 * @param {string} 类型 
 * @param {string} 文件名 
 * @returns {string}
 */
export function 生成用户路径(用户ID, 类型 = 'workspace', 文件名 = '') {
  return `${路径常量.用户文件}${用户ID}/${类型}/${文件名}`;
}

/**
 * 生成任务文件路径
 * @param {string} 任务ID 
 * @param {string} 类型 
 * @param {string} 文件名 
 * @returns {string}
 */
export function 生成任务路径(任务ID, 类型 = 'output', 文件名 = '') {
  return `${路径常量.任务文件}${任务ID}/${类型}/${文件名}`;
}

/**
 * 生成交换文件路径
 * @param {string} 类型 - 文件类型
 * @param {string} 任务ID - 任务ID
 * @returns {string}
 */
export function 生成交换路径(类型, 任务ID) {
  return `${路径常量.用户交换}${类型}/${任务ID}/`;
}
