/**
 * @file 入口-直连服务
 * @description 鸽群管理器的直连服务模块
 * 
 * 包含直连 WebSocket 服务启动、离线消息拉取、直连对话/控制消息处理
 */

import { 鸽子直连服务 } from './鸽子直连服务.js';
import { 加密直连服务 } from './加密直连服务.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('鸽群管理器', { 前缀: '[鸽群管理器]', 级别: 'debug', 显示调用位置: true });

/**
 * 启动直连服务（WebSocket 供 CLI 直接连接）
 * 
 * 从鸽群管理器.启动全部中提取，负责：
 * 1. 获取鸽子饲养员ID
 * 2. 创建并启动直连服务
 * 3. 向 Server 注册直连端点
 * 4. 拉取离线暂存消息
 * 
 * @param {Object} 鸽群 - 鸽群管理器实例
 */
export async function 启动直连服务(鸽群) {
  try {
    const doveId = 鸽群.鸽子列表[0]?.ID;
    // 通过 DovesProxy 的认证身份获取 userId（即饲养员ID）
    // API Key 已绑定用户账号，无需额外查数据库
    let 饲养员ID = null;
    if (鸽群.服务端代理) {
      try {
        const 身份 = await 鸽群.服务端代理.getWhoAmI();
        饲养员ID = 身份?.userId || null;
      } catch (e) {
        logger.warn(`获取认证身份失败: ${e.message}`);
      }
    }

    if (doveId && 饲养员ID) {
      const jwtSecret = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'doves-default-secret';
      const directPort = parseInt(process.env.DOVE_DIRECT_PORT) || 0; // 0=自动分配

      鸽群.直连服务 = new 鸽子直连服务({
        doveId,
        饲养员ID,
        jwtSecret,
        port: directPort,
        onChatMessage: async (msg) => {
          return await handleDirectChatMessage(鸽群, msg);
        },
        onControlMessage: async (msg) => {
          return await handleDirectControlMessage(鸽群, msg);
        },
        onAudit: (record) => {
          // 通过 DovesProxy 记录审计日志到 Server
          if (鸽群.服务端代理) {
            鸽群.服务端代理._rawRequest('POST', '/api/dove/direct-audit', record).catch(() => {});
          }
        }
      });

      const actualPort = await 鸽群.直连服务.start();

      // 向 Server 注册直连端点
      if (鸽群.服务端代理) {
        const endpoint = 鸽群.直连服务.getEndpoint();
        if (endpoint) {
          try {
            await 鸽群.服务端代理.updateDoveIdentity(doveId, { directEndpoint: endpoint });
            logger.info(`直连端点已注册: ${endpoint.protocol}://${endpoint.host}:${endpoint.port}`);
          } catch (e) {
            logger.warn(`注册直连端点失败: ${e.message}`);
          }
        }
      }

      // === 启动加密直连服务（Noise NX TCP） ===
      const encryptedPort = parseInt(process.env.DOVE_ENCRYPTED_DIRECT_PORT) || 0;
      鸽群.加密直连服务 = new 加密直连服务({
        doveId,
        饲养员ID,
        jwtSecret,
        port: encryptedPort,
        onChatMessage: async (msg) => {
          return await handleDirectChatMessage(鸽群, msg);
        },
        onControlMessage: async (msg) => {
          return await handleDirectControlMessage(鸽群, msg);
        },
        onAudit: (record) => {
          if (鸽群.服务端代理) {
            鸽群.服务端代理._rawRequest('POST', '/api/dove/direct-audit', record).catch(() => {});
          }
        }
      });

      const actualEncryptedPort = await 鸽群.加密直连服务.start();

      // 向 Server 注册加密直连端点
      if (鸽群.服务端代理) {
        const encryptedEndpoint = 鸽群.加密直连服务.getEndpoint();
        if (encryptedEndpoint) {
          try {
            await 鸽群.服务端代理.updateDoveIdentity(doveId, { encryptedEndpoint });
            logger.info(`加密直连端点已注册: ${encryptedEndpoint.protocol}://${encryptedEndpoint.host}:${encryptedEndpoint.port}`);
          } catch (e) {
            logger.warn(`注册加密直连端点失败: ${e.message}`);
          }
        }
      }

      // 拉取鸽子离线期间的暂存消息
      await 拉取离线消息(鸽群);
    } else {
      logger.warn('缺少鸽子ID或饲养员ID，跳过直连服务启动');
    }
  } catch (e) {
    logger.warn(`直连服务启动失败: ${e.message}`);
  }
}

/**
 * 拉取鸽子离线期间的暂存消息
 * @param {Object} 鸽群 - 鸽群管理器实例
 */
async function 拉取离线消息(鸽群) {
  if (!鸽群.服务端代理) return;

  try {
    const bufferResult = await 鸽群.服务端代理._rawRequest('GET', '/api/dove/message-buffer');
    if (bufferResult?.success && bufferResult.data?.length > 0) {
      logger.info(`拉取到 ${bufferResult.data.length} 条离线暂存消息`);
      for (const msg of bufferResult.data) {
        try {
          await handleDirectChatMessage(鸽群, {
            userId: msg.userId,
            conversationId: msg.conversationId,
            content: msg.message,
            profile: msg.profile,
            constraints: msg.constraints,
            channel: 'local'  // 离线暂存消息来自本地直连
          });
        } catch (e) {
          logger.warn(`处理离线消息失败: ${e.message}`);
        }
      }
    }
  } catch (e) {
    // 拉取离线消息失败不阻塞启动
    logger.warn(`拉取离线暂存消息失败: ${e.message}`);
  }
}

/**
 * 处理直连对话消息
 * 核心策略：通过 DovesProxy 调用 Server 的 /api/chat 创建任务，
 * 鸽子会自动从任务队列中拉取并执行，结果通过直连 WS 回传
 * 
 * @param {Object} 鸽群 - 鸽群管理器实例
 * @param {Object} msg - 消息对象
 */
export async function handleDirectChatMessage(鸽群, msg) {
  const { userId, conversationId, content, profile, constraints, attachments, channel } = msg;

  if (!鸽群.服务端代理) {
    throw new Error('DovesProxy 未初始化，无法处理直连消息');
  }

  // 通过 DovesProxy 调用 Server 的 chat API 创建任务
  // 鸽子的任务循环会自动抢取并执行该任务
  const result = await 鸽群.服务端代理.createChatTask({
    message: content,
    conversationId,
    profile,
    constraints,
    attachments: attachments || [],
    userId,
    channel: channel || 'local'  // 直连消息默认 local
  });

  return result;
}

/**
 * 处理直连控制指令
 * 
 * 直连通道让 CLI 能从鸽子内存直接获取实况数据，
 * 不用绕 Server 查 MongoDB（数据库是快照，内存是实况）
 * 
 * @param {Object} 鸽群 - 鸽群管理器实例
 * @param {Object} msg - 控制消息 { action, params }
 */
export async function handleDirectControlMessage(鸽群, msg) {
  const { action } = msg;

  switch (action) {
    case 'status':
      return 鸽群.获取状态报告();

    case 'ping':
      return { pong: true, timestamp: Date.now() };

    // ===== 实时状态查询（内存直读，不经 DB） =====

    case 'doves':
      // 各鸽子详细实况（状态/当前任务/能力列表）
      return 鸽群.鸽子列表.map(d => d.获取状态报告());

    case 'tasks': {
      // 各鸽子当前正在执行的任务详情
      const tasks = [];
      for (const 鸽子 of 鸽群.鸽子列表) {
        if (鸽子.当前任务) {
          tasks.push({
            doveId: 鸽子.ID,
            taskId: 鸽子.当前任务.任务ID || 鸽子.当前任务.id,
            type: 鸽子.当前任务.类型 || 鸽子.当前任务.type,
            status: 鸽子.当前任务.状态 || 鸽子.当前任务.status,
            description: (鸽子.当前任务.描述 || 鸽子.当前任务.description || '').substring(0, 100),
            startTime: 鸽子.当前任务.开始时间 || 鸽子.当前任务.领取时间 || null
          });
        }
      }
      return { 总鸽子数: 鸽群.鸽子列表.length, 忙碌数: tasks.length, 空闲数: 鸽群.鸽子列表.length - tasks.length, 执行中任务: tasks };
    }

    case 'stats': {
      // Token 使用统计（实时累加，不需查 DB）
      const tokenStats = [];
      for (const 鸽子 of 鸽群.鸽子列表) {
        if (鸽子.Token统计) {
          const 全局 = 鸽子.Token统计.获取全局统计();
          tokenStats.push({ doveId: 鸽子.ID, ...全局 });
        }
      }
      const 合计 = tokenStats.reduce((acc, s) => ({
        总输入: acc.总输入 + s.总输入, 总输出: acc.总输出 + s.总输出, 总调用次数: acc.总调用次数 + s.总调用次数
      }), { 总输入: 0, 总输出: 0, 总调用次数: 0 });
      return { 合计, 各鸽子: tokenStats };
    }

    case 'capabilities': {
      // 能力列表（内存中的实况注册表，比 DB 查询更即时）
      if (鸽群.共享能力管理器) {
        return 鸽群.共享能力管理器.获取所有名称();
      }
      return 鸽群.鸽子列表.flatMap(d => d.能力列表 || []);
    }

    case 'skills': {
      // 技能索引（当前已加载的技能清单）
      if (鸽群.共享技能索引) {
        const entries = 鸽群.共享技能索引.getAll?.() || [];
        return entries.map(e => ({ name: e.name, description: e.description || '' }));
      }
      return [];
    }

    case 'models': {
      // 当前模型配置（鸽群实际在用的模型）
      const models = {};
      for (const 鸽子 of 鸽群.鸽子列表) {
        models[鸽子.ID] = {
          默认模型: 鸽子.默认模型,
          快速模型: 鸽子.快速模型,
          视觉模型: 鸽子.视觉模型,
          默认提供商: 鸽子.默认提供商
        };
        break; // 共享配置，只取第一个
      }
      return models;
    }

    case 'health': {
      // 健康检查（含进程资源使用）
      const mem = process.memoryUsage();
      return {
        pid: process.pid,
        uptime: Math.floor(process.uptime()),
        memory: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024)
        },
        鸽子数: 鸽群.鸽子列表.length,
        直连服务: 鸽群.直连服务 ? {
          端口: 鸽群.直连服务.actualPort,
          连接数: 鸽群.直连服务.connections.size
        } : null,
        加密直连服务: 鸽群.加密直连服务 ? {
          端口: 鸽群.加密直连服务.actualPort,
          连接数: 鸽群.加密直连服务.connections.size
        } : null,
        加密客户端: 鸽群.加密客户端 ? 'connected' : 'disconnected'
      };
    }

    default:
      throw new Error(`不支持的控制指令: ${action}`);
  }
}
