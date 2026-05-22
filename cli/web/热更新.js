/**
 * 热更新模块
 * 监听扩展变更，更新 web-root，通过 SSE 通知前端
 */

import fs from 'fs';
import path from 'path';
import { 加载单个扩展, 移除扩展, 获取WebRoot } from './预加载.js';

const sseClients = new Set();
let watcher = null;

/**
 * 注册 SSE 客户端
 */
export function 注册SSE客户端(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write('data: {"type":"connected"}\n\n');

  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}

/**
 * 向所有 SSE 客户端广播事件
 */
export function 广播事件(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
}

/**
 * 通知扩展已更新
 */
export function 通知扩展更新(extName, action = 'updated') {
  广播事件({ type: 'extension-changed', name: extName, action });
}

/**
 * 安装扩展并通知前端
 */
export function 安装扩展通知(extName) {
  const result = 加载单个扩展(extName);
  if (result) {
    通知扩展更新(extName, 'installed');
  }
  return result;
}

/**
 * 卸载扩展并通知前端
 */
export function 卸载扩展通知(extName) {
  移除扩展(extName);
  通知扩展更新(extName, 'uninstalled');
}

/**
 * 启动开发模式文件监听
 * @param {string} extensionsDir - 扩展目录路径
 */
export function 启动开发监听(extensionsDir) {
  if (watcher) return;
  if (!fs.existsSync(extensionsDir)) return;

  watcher = fs.watch(extensionsDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    // 只关心 web/ 目录下的变更
    const parts = filename.split(path.sep);
    const webIdx = parts.indexOf('web');
    if (webIdx === -1) return;

    const extName = parts[0];
    if (!extName || extName.startsWith('_')) return;

    // 防抖：100ms 内只处理一次
    clearTimeout(启动开发监听._debounce);
    启动开发监听._debounce = setTimeout(() => {
      加载单个扩展(extName);
      通知扩展更新(extName, 'updated');
    }, 100);
  });
}

/**
 * 停止文件监听
 */
export function 停止监听() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  sseClients.clear();
}
