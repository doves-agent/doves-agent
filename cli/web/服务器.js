/**
 * Web 服务器
 * 纯静态文件服务 + API 路由
 * 所有资源从 ~/.dove/web-root/ 提供，无跨域问题
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { 获取WebRoot } from './预加载.js';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

export function 创建服务器(options = {}) {
  const routes = [];
  let httpServer = null;

  function route(method, pattern, handler) {
    const regex = 路径转正则(pattern);
    routes.push({ method: method.toUpperCase(), pattern, regex, handler });
  }

  function 路径转正则(pattern) {
    const escaped = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\:(\w+)/g, '(?<$1>[^/]+)');
    return new RegExp(`^${escaped}$`);
  }

  async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);

    // API 路由匹配
    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname);
    }

    // 静态文件服务
    serveStatic(req, res, pathname);
  }

  async function handleApi(req, res, pathname) {
    for (const r of routes) {
      if (req.method !== r.method) continue;
      const match = pathname.match(r.regex);
      if (!match) continue;

      const params = match.groups || {};

      try {
        let body = null;
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
          body = await 读取请求体(req);
        }

        const result = await r.handler(req, body, params, res);

        // handler 返回 null 表示已自行处理响应（如 SSE）
        if (result === null) return;

        res.writeHead(result.status || 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.data));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: '路由未找到' }));
  }

  function serveStatic(req, res, pathname) {
    const webRoot = 获取WebRoot();
    let filePath;

    if (pathname === '/') {
      filePath = path.join(webRoot, 'index.html');
    } else {
      filePath = path.join(webRoot, pathname);
    }

    // 路径遍历防护
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(webRoot))) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(resolved)) {
      // SPA fallback: 非文件请求返回 index.html
      const ext = path.extname(pathname);
      if (!ext || ext === '.html') {
        const indexPath = path.join(webRoot, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(fs.readFileSync(indexPath));
          return;
        }
      }
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      const indexPath = path.join(resolved, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(indexPath));
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(resolved);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(resolved).pipe(res);
  }

  function start(port, host) {
    return new Promise((resolve, reject) => {
      httpServer = http.createServer(handleRequest);
      httpServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`端口 ${port} 已被占用`));
        } else {
          reject(err);
        }
      });
      httpServer.listen(port, host, () => resolve());
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (httpServer) {
        httpServer.close(resolve);
        httpServer = null;
      } else {
        resolve();
      }
    });
  }

  return { route, start, stop };
}

function 读取请求体(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}
