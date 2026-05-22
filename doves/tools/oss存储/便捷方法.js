/**
 * @file tools/oss存储/便捷方法
 * @description 便捷封装：上传截图、上传任务文件、测试连接
 */

import { randomBytes } from 'crypto';
import { basename } from 'path';
import { logger, 是否可用, 获取客户端, ossConfig } from './核心.js';
import { 上传 } from './上传.js';
import { 路径常量 } from './路径工具.js';

/**
 * 上传浏览器截图
 * @param {Buffer|string} 源 - 截图 Buffer 或文件路径
 * @param {string} 任务ID - 任务ID
 * @param {object} 选项 - 选项
 * @returns {Promise<{成功: boolean, 网址?: string, 错误?: string}>}
 */
export async function 上传截图(源, 任务ID, 选项 = {}) {
  const 时间戳 = Date.now();
  const 随机 = randomBytes(4).toString('hex');
  const 文件名 = 选项.文件名 || `screenshot_${时间戳}_${随机}.png`;
  const oss路径 = `${路径常量.浏览器截图}${任务ID}/${文件名}`;
  
  const 结果 = await 上传(源, 文件名, { 路径: oss路径 });
  
  if (结果.成功) {
    结果.分类 = 'browser_screenshot';
    结果.任务ID = 任务ID;
  }
  
  return 结果;
}

/**
 * 上传任务文件
 * @param {Buffer|string} 源 - 文件 Buffer 或路径
 * @param {string} 任务ID - 任务ID
 * @param {string} 类型 - 类型 (input/output)
 * @param {object} 选项 - 选项
 * @returns {Promise<{成功: boolean, 网址?: string, 错误?: string}>}
 */
export async function 上传任务文件(源, 任务ID, 类型 = 'output', 选项 = {}) {
  const 基础文件名 = basename(选项.文件名 || `file_${Date.now()}`);
  const 基础路径 = 类型 === 'input' ? 路径常量.Docker输入 : 路径常量.Docker输出;
  const oss路径 = `${基础路径}${任务ID}/${基础文件名}`;
  
  const 结果 = await 上传(源, 选项.文件名 || 基础文件名, { 路径: oss路径 });
  
  if (结果.成功) {
    结果.分类 = 'task_file';
    结果.任务ID = 任务ID;
    结果.类型 = 类型;
  }
  
  return 结果;
}

/**
 * 测试连接
 * @returns {Promise<{成功: boolean, 信息?: string, 错误?: string}>}
 */
export async function 测试连接() {
  if (!是否可用()) {
    return { 成功: false, 错误: 'OSS 未配置' };
  }
  
  try {
    const 客户端 = await 获取客户端();
    if (!客户端) {
      return { 成功: false, 错误: '客户端初始化失败' };
    }
    
    // 尝试列出文件来验证连接
    await 客户端.list({ 'max-keys': 1 });
    
    return { 成功: true, 信息: `已连接到 ${ossConfig.bucket}` };
  } catch (e) {
    return { 成功: false, 错误: e.message };
  }
}
