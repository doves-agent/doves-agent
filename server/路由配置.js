/**
 * 服务端路由配置模块
 * 职责：集中管理所有路由挂载、API版本发现、健康检查端点
 * 
 * 从 index.js 拆分，遵循KISS原则
 */

import { CONFIG, logger } from './core.js';
import { getMongoClient, getAdminDb, getUserDb } from './db.js';
import { apiLimiter } from './middleware/rate-limiter.js';
import { apiVersionMiddleware } from './middleware/api-version.js';
import { API_VERSIONS, PROTOCOL_DOCS } from './协议文档.js';
import { authMiddleware } from './routes/dove-auth.js';
import { createAdminIpWhitelistMiddleware } from './middleware/admin-ip-whitelist.js';

// 路由模块
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import userRoutes from './routes/user.js';
import apiRoutes from './routes/api.js';
import dbRoutes from './routes/db.js';
import fileRoutes from './routes/files.js';
import doveRoutes from './routes/dove.js';
import tempRoutes from './routes/temp.js';
import gitStorageRoutes from './routes/git-storage.js';
import ossTransferRoutes from './routes/oss-transfer.js';
import ossApiRoutes from './routes/oss-api.js';
import capabilityRoutes from './routes/capability.js';
import skillRoutes from './routes/skill.js';
import eventRoutes from './routes/event.js';
import profileRoutes from './routes/profile.js';
import taskRoutes from './routes/task.js';
import verificationRoutes from './routes/verification.js';
import breederRoutes from './routes/breeder.js';
import memoryRoutes from './routes/git-memory.js';
import experienceRoutes from './routes/experience.js';
import extensionRoutes, { initializeExtensionTools } from './routes/extension.js';
import cliCapabilityRoutes, { isCliOnline, getOnlineCliMachineIds, getCliCapabilitySummary } from './routes/cli-capability.js';
import cliActionRoutes from './routes/cli-action.js';
import extAssetsRoutes, { initializeExtensionAssets } from './routes/ext-assets.js';
import notifyRoutes from './routes/通知.js';
import imRoutes from './routes/im.js';
import wechatRoutes from './routes/wechat.js';
import dingtalkRoutes, { handleDingTalkWebhook } from './routes/dingtalk.js';
import feishuRoutes, { handleFeishuWebhook } from './routes/feishu.js';
import metricsRoutes from './routes/metrics.js';
import statsRoutes from './routes/stats.js';
import teamRoutes from './routes/team.js';
import { setupSwagger } from './swagger.js';

/**
 * 创建并配置路由
 * @param {Express} app - Express 应用实例
 */
export function setupRoutes(app) {
  // Swagger API 文档（无需认证）
  setupSwagger(app);

  // API 版本中间件（在路由之前）
  app.use('/api', apiVersionMiddleware);
  
  // API 版本发现端点（无需认证）
  app.get('/api/versions', (req, res) => {
    res.json({
      success: true,
      data: {
        currentVersion: API_VERSIONS.current,
        supportedVersions: API_VERSIONS.supported,
        versions: API_VERSIONS.versionInfo
      }
    });
  });
  
  // 协议文档端点（无需认证）
  app.get('/api/protocol-doc', (req, res) => {
    const { protocol } = req.query;
    if (protocol) {
      const doc = PROTOCOL_DOCS[protocol];
      if (!doc) {
        return res.status(404).json({
          success: false,
          error: `未找到协议: ${protocol}`,
          可用协议: Object.keys(PROTOCOL_DOCS)
        });
      }
      return res.json({ success: true, data: doc });
    }
    // 返回所有协议概览
    res.json({
      success: true,
      data: {
        协议版本: API_VERSIONS.current,
        协议列表: Object.entries(PROTOCOL_DOCS).map(([key, doc]) => ({
          协议名: key,
          方法: doc.方法,
          路径: doc.路径,
          描述: doc.描述
        })),
        查询详情: 'GET /api/protocol-doc?protocol=<协议名>'
      }
    });
  });
  
  // 全局 API 速率限制（1分钟100次）
  app.use('/api', apiLimiter);
  app.use('/db', apiLimiter);
  app.use('/files', apiLimiter);
  
  // 认证路由（全部挂载，认证逻辑在路由内部处理）
  app.use('/auth', authRoutes);

  // 数据库操作代理（需要认证）
  app.use('/db', authMiddleware, dbRoutes);

  // 文件操作代理（需要认证）
  app.use('/files', authMiddleware, fileRoutes);

  // 用户 Key 管理（需要认证）
  app.use('/api/user/keys', authMiddleware, userRoutes);

  // 管理员路由（需要 IP 白名单 + 认证 + 管理员权限）
  app.use('/api/admin', createAdminIpWhitelistMiddleware(), authMiddleware, adminRoutes);

  // 鸽子专用路由（需要认证）
  app.use('/api/dove', authMiddleware, doveRoutes);

  // OSS 临时目录管理（需要认证）
  app.use('/api/temp', authMiddleware, tempRoutes);

  // Git 存储（需要认证）
  app.use('/api/git-storage', authMiddleware, gitStorageRoutes);

  // OSS 流式文件传输（需要认证）
  app.use('/api/file', authMiddleware, ossTransferRoutes);

  // OSS API（需要认证，Doves 扩展通过 DovesProxy 调用）
  app.use('/api/oss', authMiddleware, ossApiRoutes);

  // 能力管理（需要认证）
  app.use('/api/capability', authMiddleware, capabilityRoutes);

  // 技能管理（需要认证）
  app.use('/api/skill', authMiddleware, skillRoutes);

  // 事件调度（需要认证）
  app.use('/api/event', authMiddleware, eventRoutes);

  // 通知服务（需要认证）
  app.use('/api/notify', authMiddleware, notifyRoutes);

  // 执行配置 Profile（需要认证）
  app.use('/api/profile', authMiddleware, profileRoutes);

  // 任务执行协议（需要认证）
  app.use('/api/task', authMiddleware, taskRoutes);

  // 验证系统（需要认证）
  app.use('/api/verification', authMiddleware, verificationRoutes);

  // 饲养员扩展（需要认证）
  app.use('/api/breeder', authMiddleware, breederRoutes);

  // 记忆代理（需要认证）
  app.use('/api/memory', authMiddleware, memoryRoutes);

  // 经验管理（需要认证）
  app.use('/api/experience', authMiddleware, experienceRoutes);

  // 扩展工具 API（需要认证，安全隔离）
  app.use('/api/extensions/tools', authMiddleware, extensionRoutes);

  // CLI 能力注册（需要认证，CLI 客户端注册自身能力）
  app.use('/api/cli/capabilities', authMiddleware, cliCapabilityRoutes);

  // CLI 操作请求/响应（需要认证，Doves/Server 请求 CLI 执行操作）
  app.use('/api/cli/action', authMiddleware, cliActionRoutes);

  // 扩展资源分发 API（轻量，版本/资源包查询）
  // 无需强制认证 — 扩展资源是公开的展示层，业务数据走 tools/call 需认证
  app.use('/api/ext', extAssetsRoutes);

  // 微信 iLink 通道管理（需要认证）
  app.use('/api/wechat', authMiddleware, wechatRoutes);

  // 钉钉企业应用通道管理
  // Webhook 无需认证（第三方回调无法提供 JWT），其余接口需要认证
  app.post('/api/dingtalk/webhook', handleDingTalkWebhook);
  app.use('/api/dingtalk', authMiddleware, dingtalkRoutes);

  // 飞书企业应用通道管理
  // Webhook 无需认证（第三方回调无法提供 JWT），其余接口需要认证
  app.post('/api/feishu/webhook', handleFeishuWebhook);
  app.use('/api/feishu', authMiddleware, feishuRoutes);

  // IM 管理 - webhook 回调无需认证
  app.use('/api/im/:platform/webhook', imRoutes);
  app.use('/api/im/config', authMiddleware, imRoutes);
  app.use('/api/im/test', authMiddleware, imRoutes);

  // Token 用量统计（需要认证，Doves 上报 + CLI 查询）
  app.use('/stats', authMiddleware, statsRoutes);

  // 多智能体团队配置（需要认证）
  app.use('/api/team', authMiddleware, teamRoutes);

  // Prometheus 指标端点（需要认证，或配置管理IP白名单）
  app.use('/metrics', authMiddleware, metricsRoutes);

  // API 路由（需要认证）
  app.use('/api', authMiddleware, apiRoutes);

  // Ping 接口（含 Server 实例标识）
  app.get('/ping', (req, res) => {
    res.json({
      success: true,
      pong: true,
      timestamp: Date.now(),
      service: 'dove-server',
      apiVersion: API_VERSIONS.current,
      machineId: CONFIG.machineId,
      serverIndex: req.app.locals.serverIndex ?? 0,
      isPrimary: req.app.locals.isPrimary !== false,
      port: req.app.locals.serverPort || CONFIG.port
    });
  });

  // 存活检查 — 进程存活即返回 200（K8s livenessProbe 用途）
  app.get('/health', (req, res) => {
    res.json({ success: true, status: 'alive', timestamp: Date.now() });
  });

  // 就绪检查 — MongoDB 连接正常才返回 200（K8s readinessProbe 用途）
  app.get('/ready', async (req, res) => {
    try {
      const client = await getMongoClient();
      await client.db('admin').command({ ping: 1 });
      res.json({ success: true, status: 'ready', timestamp: Date.now() });
    } catch (e) {
      res.status(503).json({ success: false, status: 'not_ready', error: e.message, timestamp: Date.now() });
    }
  });

  // 详细健康信息（需要认证，含 DB/鸽子/队列状态）
  app.get('/health/detailed', authMiddleware, async (req, res) => {
    try {
      const adminDb = getAdminDb();
      const userDb = getUserDb();

      // 基础检查
      const dbPing = await adminDb.command({ ping: 1 }).then(() => true);

      // 在线鸽子数
      const onlineDoves = await adminDb.collection('鸽子身份')
        .countDocuments({ 状态: '在线' });

      // 各状态任务积压数
      const taskStats = {};
      for (const status of ['已就绪', '执行中', '等待中']) {
        taskStats[status] = await userDb.collection('任务')
          .countDocuments({ 状态: status });
      }

      res.json({
        success: true,
        status: dbPing ? 'healthy' : 'degraded',
        timestamp: Date.now(),
        machineId: CONFIG.machineId,
        serverIndex: req.app.locals.serverIndex ?? 0,
        isPrimary: req.app.locals.isPrimary !== false,
        port: req.app.locals.serverPort || CONFIG.port,
        user: req.user ? { userId: req.user.userId, role: req.user.role, authType: req.user.authType, doveId: req.user.doveId } : null,
        checks: {
          database: dbPing ? 'ok' : 'error',
          oss: CONFIG.ossEnabled ? 'enabled' : 'disabled',
          gitStorage: CONFIG.gitStorage?.enabled ? 'enabled' : 'disabled',
        },
        metrics: {
          onlineDoves,
          taskStats
        }
      });
    } catch (e) {
      res.status(500).json({ success: false, status: 'error', error: e.message, timestamp: Date.now() });
    }
  });
}

export default { setupRoutes };
