/**
 * @file server/middleware/api-version
 * @description API 版本中间件，从 server/index.js 拆分
 * 
 * 职责：
 * - 从请求头 X-API-Version 读取客户端期望的版本
 * - 如果版本不支持，返回 400 错误
 * - 注入 res.locals.apiVersion 供后续路由使用
 * - 在响应头中添加 API-Version 和 Deprecation 警告
 */

import { API_VERSIONS } from '../协议文档.js';

export function apiVersionMiddleware(req, res, next) {
  const requestedVersion = req.headers['x-api-version'] || API_VERSIONS.current;

  if (!API_VERSIONS.supported.includes(requestedVersion)) {
    return res.status(400).json({
      success: false,
      error: `不支持的 API 版本: ${requestedVersion}`,
      supportedVersions: API_VERSIONS.supported,
      currentVersion: API_VERSIONS.current
    });
  }

  // 注入版本信息到响应头
  res.setHeader('X-API-Version', requestedVersion);
  res.setHeader('X-API-Current-Version', API_VERSIONS.current);

  res.locals.apiVersion = requestedVersion;
  next();
}
