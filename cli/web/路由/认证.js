/**
 * 认证路由 - /api/auth/*
 */

import * as 命令执行器 from '../命令执行器.js';
import { loadConfig, saveConfig } from '../../lib/config.js';

export function 注册(server) {
  server.route('POST', '/api/auth/login', handleLogin);
  server.route('POST', '/api/auth/anonymous', handleAnonymous);
  server.route('POST', '/api/auth/logout', handleLogout);
  server.route('GET', '/api/auth/verify', handleVerify);
  server.route('GET', '/api/auth/status', handleStatus);
}

async function handleLogin(req, body) {
  const { username, password } = body;
  if (!username || !password) {
    return { status: 400, data: { success: false, error: '用户名和密码不能为空' } };
  }

  const result = await 命令执行器.post('/auth/login', { username, password }, {
    source: 'auth', command: 'login'
  });

  if (result.success && result.data) {
    saveConfig({
      token: result.data.token,
      userId: result.data.userId,
      username: result.data.username,
      role: result.data.role,
      authType: 'account'
    });
  }

  return { status: 200, data: result };
}

async function handleAnonymous(req, body) {
  const result = await 命令执行器.post('/auth/anonymous', {}, {
    source: 'auth', command: 'login -a'
  });

  if (result.success && result.data) {
    saveConfig({
      token: result.data.token,
      userId: result.data.userId,
      username: result.data.username || '匿名用户',
      role: result.data.role || 'user',
      authType: 'anonymous',
      anonymous: true
    });
  }

  return { status: 200, data: result };
}

async function handleLogout(req, body) {
  const result = await 命令执行器.post('/auth/logout', {}, {
    source: 'auth', command: 'logout'
  });

  saveConfig({
    token: '',
    userId: '',
    username: '',
    role: '',
    authType: '',
    anonymous: false
  });

  return { status: 200, data: { success: true } };
}

async function handleVerify(req) {
  const result = await 命令执行器.get('/auth/verify', {}, {
    source: 'auth', command: 'verify'
  });
  return { status: 200, data: result };
}

async function handleStatus(req) {
  const config = loadConfig();
  return {
    status: 200,
    data: {
      success: true,
      data: {
        token: config.token || '',
        userId: config.userId || '',
        username: config.username || '',
        role: config.role || '',
        gateway: config.gateway || 'http://localhost:3003',
        isLoggedIn: !!config.token
      }
    }
  };
}
