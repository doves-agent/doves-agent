/**
 * @file 入口
 * @description 白鸽鸽子框架模块入口，创建实例并启动任务执行循环
 * 
 * 并发执行：入口层管理多个鸽子实例同时运行
 * 
 * 拆分结构：
 * - 入口.js: 导出 + 直接运行入口
 * - 入口-鸽群管理器.js: 鸽群管理器类
 * - 入口-直连服务.js: 直连 WebSocket 服务启动 + 消息处理
 * - 入口-启动器.js: 创建鸽子/启动服务/认证凭证/参数解析
 */

// ===== 终端输出管理器（必须在所有 console 输出之前安装） =====
import { 终端输出 } from './utils/终端输出管理器.js';
终端输出.安装();

import 'dotenv/config';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('鸽群管理器', { 前缀: '[鸽群管理器]', 级别: 'debug', 显示调用位置: true });

// ===== 全局未捕获异常记录 =====
process.on('unhandledRejection', (reason, promise) => {
  logger.error('[未捕获异常] Promise 异常:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('[未捕获异常] 同步异常:', error.message);
  logger.error('[未捕获异常] 堆栈:', error.stack);
  if (error.message?.includes('SyntaxError') || error.message?.includes('Cannot find module')) {
    logger.error('[未捕获异常] 代码级错误，需要人工修复，退出进程');
    process.exit(1);
  }
});

// 加载上级目录的 .env 文件
config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../.env') });

// ===== 自动更新（静默模式，dotenv 加载后、鸽群初始化前） =====
import { doves静默更新 } from '@dove/common/自动更新.js';

// 导入鸽群管理器类
import { 鸽群管理器 } from './入口-鸽群管理器.js';
import { 创建鸽子 as 创建鸽子实例, 启动服务, 获取鸽子认证凭证, 解析参数 } from './入口-启动器.js';

/**
 * 创建鸽群管理器（推荐入口）
 * @param {Object} 配置 - 配置
 * @returns {鸽群管理器} 鸽群管理器
 */
export function 创建鸽群(配置 = {}) {
  return new 鸽群管理器(配置);
}

// 重新导出
export { 鸽群管理器 };
export { 创建鸽子实例 as 创建鸽子, 启动服务, 获取鸽子认证凭证, 解析参数 };

// 默认导出
export default {
  鸽群管理器,
  创建鸽群,
  创建鸽子: 创建鸽子实例,
  启动服务
};

// 如果直接运行此文件，自动启动服务
import { fileURLToPath as fileURLToPath2, pathToFileURL } from 'url';
import { 启动命令行入口 } from './入口-启动器.js';
const 当前文件路径 = fileURLToPath2(import.meta.url);
const 命令参数路径 = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';

if (命令参数路径 === import.meta.url || 当前文件路径 === process.argv[1]) {
  // 自动更新检查（异步，不阻塞启动；如已有新版本会替换重启）
  doves静默更新().catch(err => {
    logger.warn(`自动更新检查异常: ${err.message}`);
  });
  启动命令行入口();
}
