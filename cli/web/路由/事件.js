/**
 * 事件路由 - /api/events/*
 * SSE 事件推送（热更新通知、系统事件）+ 执行日志查询
 */

import { 注册SSE客户端 } from '../热更新.js';
import { 查询日志, 清空日志 } from '../执行日志.js';

export function 注册(server) {
  server.route('GET', '/api/events/stream', handleStream);
  server.route('GET', '/api/events/log', handleLogQuery);
  server.route('DELETE', '/api/events/log', handleLogClear);
}

/**
 * SSE 事件流（前端保持连接，接收热更新通知等）
 */
function handleStream(req, body, params, res) {
  注册SSE客户端(res);
  return null; // 已自行处理响应
}

/**
 * 查询执行日志
 */
function handleLogQuery(req) {
  const url = new URL(req.url, 'http://localhost');
  const limit = parseInt(url.searchParams.get('limit')) || 50;
  const offset = parseInt(url.searchParams.get('offset')) || 0;
  const source = url.searchParams.get('source') || undefined;
  const success = url.searchParams.has('success')
    ? url.searchParams.get('success') === 'true'
    : undefined;

  const result = 查询日志({ limit, offset, source, success });
  return { status: 200, data: { success: true, data: result } };
}

/**
 * 清空执行日志
 */
function handleLogClear() {
  清空日志();
  return { status: 200, data: { success: true } };
}
