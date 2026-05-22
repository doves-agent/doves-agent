/**
 * 命令路由 - POST /api/cmd
 * 前端所有命令执行的统一入口
 */

import * as 命令执行器 from '../命令执行器.js';

/**
 * 命令路由映射
 * 将前端的命令字符串映射为对 Server 的 API 调用
 */
const COMMAND_MAP = {
  'ping': { method: 'GET', path: '/ping' },
  'status': { method: 'GET', path: '/api/status' },
  'task list': { method: 'GET', path: '/api/task/list', params: { limit: 20 } },
  'task get': { method: 'GET', path: '/api/task/{id}' },
  'task trace': { method: 'GET', path: '/api/task/{id}/trace' },
  'chat send': { method: 'POST', path: '/api/chat' },
  'event list': { method: 'GET', path: '/api/event/list' },
  'event answer': { method: 'POST', path: '/api/event/{id}/answer' },
  'dove list': { method: 'GET', path: '/api/dove/list' },
  'dove capability list': { method: 'GET', path: '/api/capability/list' },
  'dove skill list': { method: 'GET', path: '/api/skill/list' },
  'data ls': { method: 'GET', path: '/api/storage/directories' },
  'data read': { method: 'GET', path: '/api/storage/read/{path}' },
  'memory list': { method: 'GET', path: '/api/memory/list' },
  'file ls': { method: 'GET', path: '/files/list/{path}' },
  'file read': { method: 'GET', path: '/files/{path}' },
  'config get': { method: 'GET', path: '/api/config' },
  'storage status': { method: 'GET', path: '/api/storage/status' },
};

export function 注册(server) {
  server.route('POST', '/api/cmd', handleCmd);
}

async function handleCmd(req, body) {
  const { cmd, context = {} } = body;
  if (!cmd) {
    return { status: 400, data: { success: false, error: '缺少 cmd 参数' } };
  }

  const parts = cmd.trim().split(/\s+/);
  const result = await 路由命令(parts, context);
  return { status: 200, data: result };
}

async function 路由命令(parts, context) {
  const fullCmd = parts.join(' ');

  // 尝试精确匹配
  for (const [pattern, config] of Object.entries(COMMAND_MAP)) {
    const patternParts = pattern.split(' ');
    if (parts.length < patternParts.length) continue;

    const matched = patternParts.every((p, i) => p === parts[i]);
    if (!matched) continue;

    const args = parts.slice(patternParts.length);
    return await 执行映射命令(config, args, context, fullCmd);
  }

  // 未匹配的命令尝试作为扩展工具调用
  return await 尝试扩展工具(fullCmd, context);
}

async function 执行映射命令(config, args, context, fullCmd) {
  let { method, path, params = {} } = config;

  // 替换路径参数
  if (path.includes('{id}')) {
    const id = args[0] || context.id;
    if (!id) return { success: false, error: '缺少 id 参数' };
    path = path.replace('{id}', id);
  }
  if (path.includes('{path}')) {
    const p = args.join('/') || context.path || '/';
    path = path.replace('{path}', encodeURIComponent(p));
  }

  const meta = { source: context.source || 'web', command: fullCmd };

  if (method === 'GET') {
    const queryParams = { ...params, ...context.params };
    return await 命令执行器.get(path, queryParams, meta);
  }

  const body = { ...context.body, ...context };
  delete body.source;
  delete body.params;
  return await 命令执行器.post(path, body, meta);
}

async function 尝试扩展工具(cmd, context) {
  return await 命令执行器.post('/api/extensions/tools/call', {
    tool: cmd,
    args: context.args || {},
    extension: context.extension || ''
  }, { source: context.source || 'web', command: `tool:${cmd}` });
}
