/**
 * CLI Web 子模块入口
 * 预加载 → 连接加密通道 → 注册路由 → 启动服务器
 */

import { 创建服务器 } from './服务器.js';
import { 预加载, 获取WebRoot } from './预加载.js';
import * as 命令执行器 from './命令执行器.js';
import { 启动开发监听, 停止监听 } from './热更新.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSIONS_DIR = path.resolve(__dirname, '../../doves/extensions');

/**
 * 创建并启动 Web 服务
 * @param {object} options
 * @param {number} options.port - 端口（默认 5173）
 * @param {string} options.host - 主机（默认 127.0.0.1）
 * @param {Function} options.onProgress - 进度回调
 * @returns {Promise<{ stop: Function, port: number, host: string }>}
 */
export async function 启动Web服务(options = {}) {
  const { port = 5173, host = '127.0.0.1', onProgress = () => {} } = options;

  // 1. 预加载所有页面到 web-root
  onProgress('预加载页面文件...');
  const preloadResult = await 预加载({ onProgress });

  // 2. 连接加密通道
  onProgress('连接加密通道...');
  try {
    await 命令执行器.初始化();
    onProgress('加密通道已连接');
  } catch (err) {
    onProgress(`加密通道连接失败: ${err.message}（部分功能不可用）`);
  }

  // 3. 创建服务器并注册路由
  onProgress('注册 API 路由...');
  const server = 创建服务器();
  await 注册所有路由(server);

  // 4. 启动 HTTP 服务器
  onProgress(`启动 HTTP 服务器 ${host}:${port}...`);
  await server.start(port, host);

  // 5. 启动开发模式监听
  if (process.env.DOVE_DEV_MODE === 'true') {
    启动开发监听(EXTENSIONS_DIR);
    onProgress('开发模式：已启动文件监听');
  }

  onProgress('Web 服务就绪');

  return {
    port,
    host,
    webRoot: 获取WebRoot(),
    preloadResult,
    stop: async () => {
      停止监听();
      await 命令执行器.断开();
      await server.stop();
    }
  };
}

async function 注册所有路由(server) {
  const { 注册: 注册命令路由 } = await import('./路由/命令.js');
  const { 注册: 注册认证路由 } = await import('./路由/认证.js');
  const { 注册: 注册任务路由 } = await import('./路由/任务.js');
  const { 注册: 注册扩展路由 } = await import('./路由/扩展.js');
  const { 注册: 注册事件路由 } = await import('./路由/事件.js');

  注册命令路由(server);
  注册认证路由(server);
  注册任务路由(server);
  注册扩展路由(server);
  注册事件路由(server);
}
