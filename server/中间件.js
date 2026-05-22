/**
 * 服务端中间件模块
 * 职责：CORS、安全头、请求ID追踪、全局错误处理、404兜底
 * 
 * 从 index.js 拆分，遵循KISS原则
 */

import { logger } from './core.js';
import { CONFIG } from './core.js';
import { getMongoClient } from './db.js';
import { 解析错误码 } from '../common/错误码.js';

/**
 * CORS 中间件（允许 CLI Web 等跨源调用）
 */
export function corsMiddleware(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Token, X-Auth-Token, Authorization, X-API-Key');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
}

/**
 * 安全头中间件
 */
export function securityHeadersMiddleware(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Powered-By', '');  // 隐藏 Express 标识
  next();
}

/**
 * 请求 ID 追踪中间件
 */
export function requestIdMiddleware(req, res, next) {
  const requestId = req.headers['x-request-id'] || `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}

/**
 * Express 全局错误处理中间件
 * 捕获所有路由中未处理的错误，返回 JSON 而非 HTML
 * 注意：Express 的 4 参数中间件只捕获 next(err) 传递的错误，不影响正常请求
 */
export function globalErrorHandler(err, req, res, _next) {
  const statusCode = err.status || err.statusCode || 500;

  // 检查是否为带错误码的业务错误
  const parsed = 解析错误码(err);

  let errorMessage;
  if (parsed) {
    // 业务错误：使用中文错误信息
    errorMessage = err.message || parsed.message;
  } else if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    // 生产环境隐藏内部错误详情
    errorMessage = '服务器内部错误';
  } else {
    errorMessage = err.message || '未知错误';
  }

  logger.error(`[全局错误] ${req.method} ${req.path} (${req.requestId || '-'}):`, {
    message: err.message,
    errorCode: parsed?.errorCode || null,
    stack: statusCode === 500 ? err.stack?.split('\n').slice(0, 3).join(' | ') : undefined,
    statusCode
  });

  res.status(statusCode).json({
    success: false,
    ...(parsed && { errorCode: parsed.errorCode }),
    error: errorMessage,
    requestId: req.requestId,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
}

/**
 * 全局 404 处理（所有路由之后，兜底）
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    errorCode: 'GEN_002',
    error: `未找到路由: ${req.method} ${req.path}`,
    requestId: req.requestId,
    hint: '请检查请求路径和方法是否正确'
  });
}

/**
 * 安装所有内置中间件到 Express 应用
 */
export function setupMiddlewares(app) {
  app.use(corsMiddleware);
  app.use(securityHeadersMiddleware);
  app.use(requestIdMiddleware);
  // 错误处理和404在后置阶段调用（路由挂载后）
  return {
    installPostMiddlewares: (app) => {
      app.use(globalErrorHandler);
      app.use(notFoundHandler);
    }
  };
}

export default {
  corsMiddleware,
  securityHeadersMiddleware,
  requestIdMiddleware,
  globalErrorHandler,
  notFoundHandler,
  setupMiddlewares
};
