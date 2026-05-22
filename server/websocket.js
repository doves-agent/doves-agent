/**
 * 白鸽服务端WebSocket模块
 * 职责：WebSocket连接管理、统一路由
 * 
 * 游戏功能已迁移到 Doves 扩展自启的 WebSocket 服务器
 * CLI Web 页面通过 externalUrls 直连 Doves 游戏服务器
 * Server 不处理任何游戏消息
 */

import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { CONFIG, logger } from './core.js';
import { getMongoClient } from './db.js';
import { readFile, writeFile, deleteFile, listFiles } from './file-service.js';
import { wsClients, userConnections, startWsKeepAlive, broadcastToUser } from './ws/shared.js';
import { handleDbOperation, handleAuthOperation, handleApiOperation } from './ws/操作处理.js';

export { broadcastToUser };

/**
 * 处理 WebSocket 连接升级
 */
export function handleWebSocketUpgrade(server) {
  // 【保活】启动 WebSocket 僵尸连接检测
  startWsKeepAlive();

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    
    if (pathname === '/ws') {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const token = url.searchParams.get('token');
      
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      
      try {
        const decoded = jwt.verify(token, CONFIG.jwtSecret);
        const wss = new WebSocketServer({ noServer: true });
        
        wss.handleUpgrade(request, socket, head, (ws) => {
          const clientId = 'ws-' + Math.random().toString(16).substr(2, 6);
          
          wsClients.set(clientId, {
            ws,
            userId: decoded.userId,
            username: decoded.username,
            authType: decoded.authType,
            role: decoded.role,
            subscriptions: new Set(),
            connectedAt: new Date()
          });
          
          ws.clientId = clientId;
          ws.userId = decoded.userId;
          
          // 更新用户连接计数
          if (!userConnections.has(decoded.userId)) {
            userConnections.set(decoded.userId, new Set());
          }
          userConnections.get(decoded.userId).add(clientId);
          
          logger.info(`WebSocket 连接: ${clientId} (用户: ${decoded.userId})`);
          
          ws.send(JSON.stringify({
            type: 'connected',
            clientId,
            userId: decoded.userId,
            authType: decoded.authType
          }));
          
          ws.on('message', (data) => {
            try {
              const message = JSON.parse(data.toString());
              handleWebSocketMessage(ws, message);
            } catch (e) {
              ws.send(JSON.stringify({ type: 'error', error: '无效的消息格式' }));
            }
          });
          
          ws.on('close', () => {
            wsClients.delete(clientId);
            
            // 更新用户连接计数
            const userConnSet = userConnections.get(decoded.userId);
            if (userConnSet) {
              userConnSet.delete(clientId);
              
              // 如果用户所有连接都断开
              if (userConnSet.size === 0) {
                userConnections.delete(decoded.userId);
                logger.info(`用户所有连接断开: ${decoded.userId}`);
              }
            }
            
            logger.info(`WebSocket 断开: ${clientId}`);
          });
          
          ws.on('error', (err) => {
            logger.error(`WebSocket 错误: ${clientId}`, err.message);
          });
        });
        
        wss.emit('connection', socket, request);
        
      } catch (e) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      }
    }
  });
}

/**
 * 处理 WebSocket 消息
 */
async function handleWebSocketMessage(ws, message) {
  const client = wsClients.get(ws.clientId);
  if (!client) return;
  
  switch (message.type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;
      
    case 'subscribe':
      if (message.taskId) {
        client.subscriptions.add(`task:${message.taskId}`);
        ws.send(JSON.stringify({ type: 'subscribed', taskId: message.taskId }));
      }
      break;
      
    case 'unsubscribe':
      if (message.taskId) {
        client.subscriptions.delete(`task:${message.taskId}`);
        ws.send(JSON.stringify({ type: 'unsubscribed', taskId: message.taskId }));
      }
      break;
      
    case 'subscribe_user_tasks':
      client.subscriptions.add(`user_tasks:${client.userId}`);
      ws.send(JSON.stringify({ type: 'subscribed', scope: 'user_tasks' }));
      break;
      
    case 'request':
      await handleWebSocketRequest(ws, message, client);
      break;
      
    default:
      ws.send(JSON.stringify({ type: 'error', error: '未知的消息类型', requestId: message.requestId }));
  }
}

/**
 * 处理 WebSocket 统一路由请求
 */
async function handleWebSocketRequest(ws, message, client) {
  const { requestId, method, path, body, query } = message;
  
  if (!requestId || !path) {
    return ws.send(JSON.stringify({
      type: 'response',
      requestId,
      success: false,
      error: '缺少 requestId 或 path'
    }));
  }
  
  try {
    const mockReq = {
      method: method || 'GET',
      path,
      params: {},
      query: query || {},
      body: body || {},
      user: {
        userId: client.userId,
        username: client.username,
        authType: client.authType,
        role: client.role
      }
    };
    
    const pathParts = path.split('/').filter(Boolean);
    let result = null;
    
    // MongoDB 操作代理
    if (pathParts[0] === 'db' && pathParts.length >= 3) {
      mockReq.params.collection = pathParts[1];
      mockReq.params.action = pathParts[2];
      result = await handleDbOperation(mockReq);
    }
    // 文件操作
    else if (pathParts[0] === 'files') {
      const filePath = pathParts.slice(1).join('/');
      mockReq.params.path = filePath;
      
      if (method === 'GET' && path.startsWith('/files/list/')) {
        mockReq.params.dir = filePath.replace('list/', '');
        result = await listFiles(mockReq.user.userId, mockReq.params.dir);
      } else if (method === 'GET') {
        result = await readFile(mockReq.user.userId, filePath);
      } else if (method === 'PUT') {
        result = await writeFile(mockReq.user.userId, filePath, mockReq.body);
      } else if (method === 'DELETE') {
        result = await deleteFile(mockReq.user.userId, filePath);
      }
    }
    // 认证相关
    else if (pathParts[0] === 'auth') {
      result = await handleAuthOperation(pathParts[1], mockReq);
    }
    // API 路由
    else if (pathParts[0] === 'api') {
      result = await handleApiOperation(pathParts, method, mockReq);
    }
    // 健康检查
    else if (path === '/health') {
      await getMongoClient();
      result = { status: 'healthy', adminDb: CONFIG.adminDb, userDb: CONFIG.userDb };
    }
    else {
      return ws.send(JSON.stringify({
        type: 'response',
        requestId,
        success: false,
        error: `未知路径: ${path}`
      }));
    }
    
    ws.send(JSON.stringify({
      type: 'response',
      requestId,
      success: true,
      data: result
    }));
    
  } catch (err) {
    logger.error('WebSocket 请求处理失败:', err.message);
    ws.send(JSON.stringify({
      type: 'response',
      requestId,
      success: false,
      error: err.message
    }));
  }
}

/**
 * 向订阅了任务的客户端推送更新
 */
export function broadcastTaskUpdate(taskId, update) {
  const message = JSON.stringify({
    type: 'task_update',
    taskId,
    data: update,
    timestamp: Date.now()
  });
  
  for (const [clientId, client] of wsClients) {
    if (client.subscriptions.has(`task:${taskId}`)) {
      try {
        client.ws.send(message);
      } catch (e) {
        logger.warn(`[WebSocket] 广播任务更新到客户端 ${clientId} 失败: ${e.message}`);
      }
    }
  }
}

export function broadcastTraceUpdate(rootTaskId, userId, traceNode) {
  const message = JSON.stringify({
    type: 'trace_update',
    根任务ID: rootTaskId,
    node: traceNode,
    timestamp: Date.now()
  });
  
  for (const [clientId, client] of wsClients) {
    if (client.userId === userId) {
      try {
        client.ws.send(message);
      } catch (e) {
        logger.warn(`[WebSocket] 发送消息到客户端 ${clientId} 失败: ${e.message}`);
      }
    }
  }
}
