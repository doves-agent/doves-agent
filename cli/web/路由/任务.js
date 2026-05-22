/**
 * 任务路由 - /api/task/*
 * 包含任务查询和 SSE 任务监控
 */

import * as 命令执行器 from '../命令执行器.js';

export function 注册(server) {
  server.route('GET', '/api/task/list', handleList);
  server.route('GET', '/api/task/watch', handleWatch);
  server.route('GET', '/api/task/:id', handleGet);
  server.route('GET', '/api/task/:id/trace', handleTrace);
  server.route('POST', '/api/task/cancel', handleCancel);
}

async function handleList(req) {
  const url = new URL(req.url, 'http://localhost');
  const limit = url.searchParams.get('limit') || 20;
  const result = await 命令执行器.get('/api/task/list', { limit }, {
    source: 'task', command: 'task list'
  });
  return { status: 200, data: result };
}

async function handleGet(req, body, params) {
  const result = await 命令执行器.get(`/api/task/${params.id}`, {}, {
    source: 'task', command: `task get ${params.id}`
  });
  return { status: 200, data: result };
}

async function handleTrace(req, body, params) {
  const result = await 命令执行器.get(`/api/task/${params.id}/trace`, {}, {
    source: 'task', command: `task trace ${params.id}`
  });
  return { status: 200, data: result };
}

async function handleCancel(req, body) {
  const { taskId } = body;
  if (!taskId) {
    return { status: 400, data: { success: false, error: '缺少 taskId' } };
  }
  const result = await 命令执行器.post(`/api/task/${taskId}/cancel`, {}, {
    source: 'task', command: `task cancel ${taskId}`
  });
  return { status: 200, data: result };
}

/**
 * SSE 任务监控
 * 前端通过 EventSource 连接，实时接收任务状态变化
 */
function handleWatch(req, body, params, res) {
  const url = new URL(req.url, 'http://localhost');
  const taskId = url.searchParams.get('taskId');
  if (!taskId) {
    return { status: 400, data: { success: false, error: '缺少 taskId' } };
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  let closed = false;
  req.on('close', () => { closed = true; });

  const poll = async () => {
    if (closed) return;

    const result = await 命令执行器.get(`/api/task/${taskId}`, {}, {
      source: 'task-watch', command: `poll ${taskId}`
    });

    if (closed) return;

    if (result.success && result.data) {
      const task = result.data;
      res.write(`data: ${JSON.stringify({ type: 'update', task })}\n\n`);

      if (task.status === '已完成' || task.status === '失败' || task.status === '已取消') {
        res.write(`data: ${JSON.stringify({ type: 'done', task })}\n\n`);
        res.end();
        return;
      }
    }

    setTimeout(poll, 2000);
  };

  poll();
  return null; // 表示已自行处理响应
}
