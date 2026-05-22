/**
 * 白鸽服务端
 * 职责：认证 + 数据代理 + 配额管理
 * 
 * 架构说明：
 * - 核心模块拆分到独立文件，遵循KISS原则
 * - index.js 仅负责启动和生命周期管理
 * - 中间件 -> 中间件.js, 路由配置 -> 路由配置.js
 */

import express from 'express';
import { createServer } from 'http';
import { CONFIG, logger } from './core.js';
import { 初始化存储系统 } from './Git存储/仓库管理.js';
import { getMongoClient, getAdminDb, initializeSystemConfig, getOSSConfig, getOSSClient, startTaskArchiveScheduler, ensureIndexes, initializeExecutionProfiles } from './db.js';
import { ensureOfficialDevelopers } from './注册服务/开发者注册.js';
import { getEventScheduler } from './事件调度器.js';
import { handleWebSocketUpgrade } from './websocket.js';
import { 初始化审计日志, 关闭审计日志 } from './审计日志.js';
// 旧超时检查器已废弃，由 Doves 侧监工体系替代（扫描执行轨迹+打终止标记）
import { setupRoutes } from './路由配置.js';
import { setupMiddlewares } from './中间件.js';
// 扩展工具/资源由 Doves 启动时主动上报注册，Server 不主动扫描初始化（Server-Doves 隔离原则）
import { startWeChatListeners, wechatListenerManager } from './routes/wechat.js';
import { startDingTalkListeners, dingTalkListenerManager } from './routes/dingtalk.js';
import { startFeishuListeners, feishuListenerManager } from './routes/feishu.js';
import { startEncryptedServer } from './加密服务端.js';
import { startKeyExpiryScanner, stopKeyExpiryScanner } from './密钥过期扫描器.js';

// ==================== 启动 ====================

// 一次性初始化标记
let _appInitialized = false;

/**
 * 一次性初始化应用（DB连接、索引、系统配置等）
 * 多 Server 实例模式下只执行一次，后续调用直接跳过
 */
export async function initializeApp() {
  if (_appInitialized) return;
  _appInitialized = true;

  await getMongoClient();
  await ensureIndexes();
  await initializeSystemConfig();
  await initializeExecutionProfiles();
  await ensureOfficialDevelopers();

  const ossConfig = getOSSConfig();
  CONFIG.ossEnabled = ossConfig.enabled;

  if (CONFIG.ossEnabled) {
    await getOSSClient();
  }

  await 初始化存储系统();
}

/**
 * 启动主 Server 的后台任务（事件调度器、归档、IM监听等）
 * 多 Server 模式下只应调用一次
 */
export async function startBackgroundTasks() {
  startTaskArchiveScheduler();

  try {
    const eventScheduler = getEventScheduler();
    await eventScheduler.初始化();
    await eventScheduler.启动();
  } catch (e) {
    logger.error('事件调度器启动失败:', e.message);
  }

  try {
    await 初始化审计日志();
  } catch (e) {
    logger.error('审计日志初始化失败:', e.message);
  }

  try {
    await startWeChatListeners();
  } catch (e) {
    logger.error('微信监听启动失败:', e.message);
  }

  try {
    await startDingTalkListeners();
  } catch (e) {
    logger.error('钉钉监听启动失败:', e.message);
  }

  try {
    await startFeishuListeners();
  } catch (e) {
    logger.error('飞书监听启动失败:', e.message);
  }

  // 启动 API 密钥过期扫描器（每小时扫描一次）
  try {
    startKeyExpiryScanner();
  } catch (e) {
    logger.error('密钥过期扫描器启动失败:', e.message);
  }
}

// ==================== 加密通道请求处理 ====================

/**
 * Dove 关键操作路径：直连 DB 高性能（不经 HTTP 层）
 * 这些是 Doves 高频操作，每秒数百次，绕过 Express 减少开销
 */
const DIRECT_DB_PATHS = [
  '/api/dove/claim-task',     // 抢任务
  '/api/dove/task/claim',      // 抢任务（别名）
  '/api/dove/task/heartbeat',  // 心跳
  '/api/dove/task/result',     // 提交结果
  '/api/dove/submit-result',   // 提交结果（别名）
  '/api/dove/task/release',    // 释放任务
];

/**
 * 处理加密通道的内部请求
 *
 * 全链路统一加密后的路由策略：
 * - Dove 高频关键操作 → 直连 DB（高性能）
 * - 其余所有路径（CLI/Doves/外部）→ 转发 Express HTTP 层（完整中间件+路由+认证）
 *
 * @param {string} method - HTTP 方法
 * @param {string} path - 请求路径
 * @param {object} body - 请求体
 * @returns {Promise<object>}
 */
async function handleEncryptedRequest(method, path, body) {
  // ========== 分支1：Dove 高频关键操作 → 直连 DB ==========
  if (DIRECT_DB_PATHS.some(p => path.startsWith(p))) {
    return await handleDirectDbRequest(method, path, body);
  }

  // ========== 分支2：通用路径 → 转发 Express ==========
  return await forwardToExpress(method, path, body);
}

/**
 * Dove 高频关键操作：直连 DB
 */
async function handleDirectDbRequest(method, path, body) {
  try {
    const { getUserDb } = await import('./db.js');
    const userDb = getUserDb();

    // 抢任务
    if ((path === '/api/dove/claim-task' || path === '/api/dove/task/claim') && method === 'POST') {
      const { doveId, capabilities, machineId, apiKey } = body;
      const now = Date.now();

      if (apiKey) {
        const { 验证同机器鸽子, 从ApiKey提取DoveId } = await import('../common/机器标识.js');
        const authDoveId = 从ApiKey提取DoveId(apiKey);
        const 同机器 = 验证同机器鸽子(doveId, authDoveId);
        if (!同机器 && authDoveId && doveId) {
          return { success: false, error: '请求的鸽子ID与认证身份不属于同一台机器' };
        }
      }

      const result = await userDb.collection('任务').findOneAndUpdate(
        {
          $or: [
            { 状态: '已就绪' },
            { 状态: '等待中', 类型: { $nin: ['subtask', 'subtask_d1', 'subtask_d2', 'subtask_d3'] } },
          ],
          $and: [
            { $or: [{ 机器亲和: { $exists: false } }, { 机器亲和: false }, ...(machineId ? [{ 机器亲和: true, machineId }] : [])] },
            { $or: [{ 所需能力: { $exists: false } }, { 所需能力: { $size: 0 } }, ...(capabilities?.length ? [{ 所需能力: { $all: capabilities } }] : [])] },
            { $or: [{ 执行者: { $exists: false } }, { 执行者: null }, { 执行者: '' }] }
          ]
        },
        { $set: { 状态: '执行中', 执行者: doveId, 领取时间: new Date().toISOString(), 领取时间戳: now, 心跳时间: new Date().toISOString(), 心跳时间戳: now } },
        { returnDocument: 'after', sort: { 优先级: 1, 创建时间戳: 1 } }
      );
      return { success: true, data: { success: true, data: result } };
    }

    // 心跳
    if (path === '/api/dove/task/heartbeat' && method === 'POST') {
      const { taskId, doveId } = body;
      const now = new Date();
      await userDb.collection('任务').updateOne(
        { 任务ID: taskId, 执行者: doveId },
        { $set: { 心跳时间: now.toISOString(), 心跳时间戳: now.getTime() } }
      );
      return { success: true };
    }

    // 提交结果
    if ((path === '/api/dove/submit-result' || path === '/api/dove/task/result') && method === 'POST') {
      const { taskId, doveId, result, success, error, targetStatus } = body;
      const now = new Date();
      const 终态列表 = ['已完成', '已完成(部分失败)', '失败', '已取消'];
      const finalStatus = (targetStatus && 终态列表.includes(targetStatus))
        ? targetStatus
        : (success !== false ? '已完成' : '失败');
      const query = { 任务ID: taskId, 状态: { $nin: ['已完成', '失败', '已取消', '已终止', '已完成(部分失败)'] } };
      if (doveId) query.执行者 = doveId;
      const updateResult = await userDb.collection('任务').updateOne(
        query,
        { $set: { 结果: result, 状态: finalStatus, 完成时间: now.toISOString(), 完成时间戳: now.getTime() } }
      );
      if (updateResult.matchedCount === 0) {
        logger.warn(`[加密通道] 提交结果未匹配任务: taskId=${taskId}, doveId=${doveId}`);
        return { success: false, error: '未匹配到可更新的任务' };
      }
      return { success: true };
    }

    // 释放任务
    if (path === '/api/dove/task/release' && method === 'POST') {
      const { taskId, doveId, reason } = body;
      await userDb.collection('任务').findOneAndUpdate(
        { 任务ID: taskId, 执行者: doveId, 状态: { $in: ['执行中', '等待子任务'] } },
        { $set: { 状态: '已就绪', 执行者: null, 释放原因: reason || '鸽子释放' } }
      );
      return { success: true };
    }

    return { success: false, error: `未实现的直连路径: ${method} ${path}` };
  } catch (err) {
    logger.error(`[加密通道] 直连DB处理失败: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * 通用路径：转发到内部 Express 路由引擎
 * Express 仅绑定 127.0.0.1（外部不可达），完整走中间件链 + 路由匹配
 */
async function forwardToExpress(method, path, body) {
  try {
    const targetUrl = `http://127.0.0.1:${_internalExpressPort}${path}`;
    const headers = { 'Content-Type': 'application/json' };

    // 注入认证信息：加密通道已通过 Noise 握手验证身份，
    // 将 apiKey/JWT 传递给 Express 的 authMiddleware 做二次校验
    const apiKey = body?.apiKey;
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const fetchOptions = { method, headers };
    if (method !== 'GET' && body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get('content-type') || '';

    let data;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      return { success: false, error: (data?.error || data || `HTTP ${response.status}`), status: response.status };
    }

    return { success: true, data };
  } catch (err) {
    logger.error(`[加密通道] Express 转发失败: ${method} ${path}, ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * 停止后台任务（事件调度器、IM监听等）
 */
export async function stopBackgroundTasks() {
  stopKeyExpiryScanner();

  try {
    const eventScheduler = getEventScheduler();
    await eventScheduler.停止();
  } catch (e) { logger.warn('事件调度器停止异常:', e.message); }

  try {
    if (wechatListenerManager) {
      for (const [userId] of wechatListenerManager.listeners) {
        wechatListenerManager.stopListener(userId);
      }
    }
    if (dingTalkListenerManager) {
      for (const [userId] of dingTalkListenerManager.listeners) {
        dingTalkListenerManager.stopListener(userId);
      }
    }
    if (feishuListenerManager) {
      for (const [userId] of feishuListenerManager.listeners) {
        feishuListenerManager.stopListener(userId);
      }
    }
  } catch (e) { logger.warn('IM监听器停止异常:', e.message); }

  try { await 关闭审计日志(); } catch (e) { logger.warn('审计日志关闭异常:', e.message); }

  // 关闭加密服务端
  try {
    if (globalThis._encryptedServer) {
      await globalThis._encryptedServer.close();
      delete globalThis._encryptedServer;
    }
  } catch (e) { logger.error('加密服务端关闭异常:', e.message); }

  try {
    await Promise.race([
      mountManager.shutdown(),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  } catch (e) { logger.warn('挂载管理器关闭异常:', e.message); }
}

/**
 * 创建内部 Express 路由引擎（仅绑定 127.0.0.1，随机端口，外部不可达）
 * 所有外部通信走加密 TCP 通道，Express 仅作为进程内路由转发目标
 *
 * @param {Object} options - 配置选项
 * @param {boolean} options.isPrimary - 是否为主 Server
 * @param {number} options.serverIndex - Server 序号
 * @returns {Promise<Object>} { app, server, port }
 */
export async function createHttpServer(options = {}) {
  const app = express();
  app.use(express.json({ limit: '200mb' }));

  // 安装中间件（CORS、安全头、请求ID等）
  const { installPostMiddlewares } = setupMiddlewares(app);

  // 配置路由
  setupRoutes(app);

  // 后置中间件（错误处理、404兜底）
  installPostMiddlewares(app);

  const isPrimary = options.isPrimary !== false;
  const serverIndex = options.serverIndex || 0;
  const label = serverIndex === 0 ? '主' : `从${serverIndex}`;

  app.locals.serverIndex = serverIndex;
  app.locals.isPrimary = isPrimary;

  // 内部路由引擎：仅绑定 loopback，随机端口，外部不可达
  const server = await new Promise((resolve, reject) => {
    const srv = app.listen(0, '127.0.0.1', () => {
      const actualPort = srv.address().port;
      app.locals.serverPort = actualPort;
      logger.info(`[${label}Server] 内部路由引擎已启动: 127.0.0.1:${actualPort}`);
      if (isPrimary) {
        logger.info(`管理员数据库: ${CONFIG.adminDb}`);
        logger.info(`用户数据库: ${CONFIG.userDb}`);
        logger.info(`OSS: ${CONFIG.ossEnabled ? '已启用' : '未启用'}`);
      }
      logger.info(`机器标识: ${CONFIG.machineId} (${CONFIG.serverInstanceId})`);
      resolve(srv);
    });
    srv.on('error', (err) => {
      reject(new Error(`内部路由引擎启动失败: ${err.message}`));
    });
  });

  if (isPrimary) {
    handleWebSocketUpgrade(server);
  }

  return {
    app,
    server,
    port: server.address().port,
    关闭: async () => {
      return new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  };
}

// 模块级变量：内部 Express 端口（供 forwardToExpress 使用）
let _internalExpressPort = 0;

/**
 * 启动服务端
 * 启动顺序：初始化 → 内部 Express → 加密 TCP 主服务 → 后台任务
 * @param {Object} options - 配置选项
 * @returns {Promise<Object>} 服务实例
 */
export async function startServer(options = {}) {
  try {
    await initializeApp();

    // 1. 启动内部 Express 路由引擎（127.0.0.1:随机端口，外部不可达）
    const instance = await createHttpServer({
      isPrimary: true,
      serverIndex: 0
    });
    _internalExpressPort = instance.port;

    // 2. 启动加密 TCP 主服务（唯一对外端口）
    const encryptedPort = options.port || CONFIG.port;
    const encryptedServer = await startEncryptedServer({
      port: encryptedPort,
      host: CONFIG.host,
      onAuth: (clientPub, payload) => {
        logger.info(`[加密通道] 客户端认证: ${payload.clientId || 'unknown'}`);
        return { authorized: true, clientId: payload.clientId };
      },
      onConnection: (connection, clientInfo) => {
        logger.info(`[加密通道] 新连接: ${clientInfo.clientId} (${clientInfo.clientAddr})`);

        connection.on('data', async (payload) => {
          try {
            const { requestId, method, path, body, apiKey: frameApiKey } = payload;
            logger.info(`[加密通道] 请求: ${method} ${path} (req=${requestId})`);

            const enrichedBody = { ...body, apiKey: body.apiKey || frameApiKey };

            const result = await handleEncryptedRequest(method, path, enrichedBody);
            connection.send({ requestId, ...result });
          } catch (err) {
            connection.send({ requestId: payload.requestId, error: err.message });
          }
        });

        connection.on('close', (reason) => {
          logger.info(`[加密通道] 连接关闭: ${clientInfo.clientId}, 原因: ${reason}`);
        });

        connection.on('error', (err) => {
          logger.warn(`[加密通道] 连接错误: ${clientInfo.clientId}, ${err.message}`);
        });
      }
    });
    globalThis._encryptedServer = encryptedServer;

    // 3. 启动后台任务（IM监听、事件调度等）
    await startBackgroundTasks();

    logger.info(`[主Server] ✅ 白鸽服务端已就绪 (加密TCP: ${CONFIG.host}:${encryptedPort})`);

    return {
      app: instance.app,
      server: instance.server,
      port: encryptedPort,
      关闭: async () => {
        await stopBackgroundTasks();
        await instance.关闭();
      }
    };

  } catch (e) {
    logger.error('启动失败:', e.message);
    throw e;
  }
}

// 默认导出
export default {
  startServer,
  initializeApp,
  createHttpServer,
  startBackgroundTasks,
  stopBackgroundTasks
};

// 如果直接运行此文件，自动启动服务
import { fileURLToPath, pathToFileURL } from 'url';
const 当前文件路径 = fileURLToPath(import.meta.url);
const 命令参数路径 = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';

// ==================== --debug 参数解析 ====================
if (process.argv.includes('--debug')) {
  process.env.DOVE_DEBUG = '1';
}

// ==================== 进程级异常保护 ====================

let _shuttingDown = false;

process.on('uncaughtException', (error) => {
  logger.error('[进程保护] 未捕获的同步异常:', error.message);
  logger.error('[进程保护] 堆栈:', error.stack);
  if (error.message?.includes('EADDRINUSE') || error.message?.includes('EACCES')) {
    logger.error('[进程保护] 端口/权限错误，退出进程');
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason) => {
  logger.error('[进程保护] 未捕获的 Promise 异常:', reason);
});

async function gracefulShutdown(signal) {
  if (_shuttingDown) {
    logger.warn(`[进程保护] 已在关闭中，忽略重复信号 ${signal}`);
    return;
  }
  _shuttingDown = true;
  
  logger.info(`[进程保护] 收到 ${signal} 信号，开始优雅关闭...`);
  
  const forceExitTimeout = setTimeout(() => {
    logger.error('[进程保护] 优雅关闭超时（30秒），强制退出');
    process.exit(1);
  }, 30000);
  forceExitTimeout.unref();
  
  try {
    await Promise.race([
      stopBackgroundTasks(),
      new Promise(resolve => setTimeout(resolve, 10000))
    ]);
    logger.info('[进程保护] 后台任务已停止');
    
    try {
      const client = await getMongoClient();
      if (client) {
        await Promise.race([
          client.close(),
          new Promise(resolve => setTimeout(resolve, 5000))
        ]);
        logger.info('[进程保护] MongoDB 连接已关闭');
      }
    } catch (e) {
      logger.warn('[进程保护] MongoDB 关闭异常:', e.message);
    }
    
  } catch (e) {
    logger.error('[进程保护] 关闭过程异常:', e.message);
  } finally {
    clearTimeout(forceExitTimeout);
    logger.info('[进程保护] 优雅关闭完成');
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 判断是否为直接运行（兼容 PM2 等进程管理器）
// PM2 通过 ProcessContainerFork.js 包装启动，process.argv[1] 不是脚本路径
// 因此额外检查 PM2 注入的 pm_uptime 环境变量
const isMainModule = 命令参数路径 === import.meta.url
  || 当前文件路径 === process.argv[1]
  || (process.argv[1] && fileURLToPath(pathToFileURL(process.argv[1])) === 当前文件路径)
  || !!process.env.pm_uptime;  // PM2 进程管理器

if (isMainModule) {
  startServer().catch(err => {
    logger.error('启动失败:', err);
    process.exit(1);
  });
}
