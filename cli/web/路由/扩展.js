/**
 * 扩展路由 - /api/extensions/*
 * 扩展列表、安装、卸载、工具调用
 */

import fs from 'fs';
import path from 'path';
import * as 命令执行器 from '../命令执行器.js';
import { 获取WebRoot } from '../预加载.js';
import { 安装扩展通知, 卸载扩展通知 } from '../热更新.js';

export function 注册(server) {
  server.route('GET', '/api/extensions/list', handleList);
  server.route('GET', '/api/extensions/store', handleStore);
  server.route('POST', '/api/extensions/install', handleInstall);
  server.route('POST', '/api/extensions/uninstall', handleUninstall);
  server.route('POST', '/api/extensions/tools/call', handleToolCall);
  server.route('GET', '/api/extensions/tools/call/stream/:taskId', handleToolStream);
  server.route('GET', '/api/extensions/tools/list', handleToolList);
}

async function handleList(req) {
  const registryPath = path.join(获取WebRoot(), 'ext', '_registry.json');
  if (!fs.existsSync(registryPath)) {
    return { status: 200, data: { success: true, data: [] } };
  }
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  return { status: 200, data: { success: true, data: registry } };
}

async function handleStore(req) {
  const result = await 命令执行器.get('/api/dove/app/store', {}, {
    source: 'extensions', command: 'app list'
  });
  return { status: 200, data: result };
}

async function handleInstall(req, body) {
  const { name } = body;
  if (!name) {
    return { status: 400, data: { success: false, error: '缺少扩展名称' } };
  }

  // 调用 Server 授权接口
  const authResult = await 命令执行器.post('/api/dove/app/authorize', { name }, {
    source: 'extensions', command: `app install ${name}`
  });

  if (!authResult.success) {
    return { status: 200, data: authResult };
  }

  // 本地加载扩展页面到 web-root
  const loadResult = 安装扩展通知(name);
  if (!loadResult) {
    return { status: 200, data: { success: true, data: { name, hasWeb: false } } };
  }

  return { status: 200, data: { success: true, data: { name, hasWeb: true, ...loadResult } } };
}

async function handleUninstall(req, body) {
  const { name } = body;
  if (!name) {
    return { status: 400, data: { success: false, error: '缺少扩展名称' } };
  }

  卸载扩展通知(name);

  return { status: 200, data: { success: true } };
}

async function handleToolCall(req, body) {
  const { tool, args = {}, extension = '' } = body;
  if (!tool) {
    return { status: 400, data: { success: false, error: '缺少 tool 参数' } };
  }

  const result = await 命令执行器.post('/api/extensions/tools/call', {
    tool, args, extension
  }, { source: 'extension-tool', command: `tool:${tool}` });

  return { status: 200, data: result };
}

/**
 * SSE 工具调用结果流
 */
function handleToolStream(req, body, params, res) {
  const { taskId } = params;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  let closed = false;
  req.on('close', () => { closed = true; });

  const poll = async () => {
    if (closed) return;

    const result = await 命令执行器.get(`/api/extensions/tools/call/${taskId}`, {}, {
      source: 'tool-stream', command: `poll tool ${taskId}`
    });

    if (closed) return;

    if (result.success && result.data) {
      const { status, result: toolResult } = result.data;

      if (status === '已完成' || status === 'completed') {
        res.write(`event: result\ndata: ${JSON.stringify(toolResult)}\n\n`);
        res.end();
        return;
      }
      if (status === '失败' || status === 'failed') {
        res.write(`event: error\ndata: ${JSON.stringify({ error: toolResult?.error || '执行失败' })}\n\n`);
        res.end();
        return;
      }

      res.write(`event: progress\ndata: ${JSON.stringify({ status })}\n\n`);
    }

    setTimeout(poll, 1000);
  };

  poll();
  return null;
}

async function handleToolList(req) {
  const result = await 命令执行器.get('/api/extensions/tools/list', {}, {
    source: 'extensions', command: 'tools list'
  });
  return { status: 200, data: result };
}
