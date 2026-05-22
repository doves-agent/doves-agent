/**
 * 扩展工具 API
 * 
 * Server 作为 API 网关：认证/校验/任务入队
 * 工具注册由 Doves 启动时通过 HTTP 上报
 * 工具执行由 Doves 自主从任务队列拉取
 * 
 * API:
 *   POST /api/extensions/tools/register  — Doves 上报工具元数据（鸽子级认证）
 *   POST /api/extensions/tools/unregister — Doves 注销工具元数据（鸽子级认证）
 *   GET  /api/extensions/tools/list       — 列出所有可调用工具
 *   POST /api/extensions/tools/call       — 创建扩展工具调用任务，返回 taskId
 *   GET  /api/extensions/tools/call/:taskId — 查询任务结果
 * 
 * 安全隔离：
 *   - 仅 safe / caution 级别工具可调用
 *   - JWT 认证必须
 *   - 工具不存在时明确报错（不暴露扩展内部路径）
 */

import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { logger } from '../core.js';
import { getAdminDb, createTimestampFields } from '../db.js';

const router = Router();

// ==================== 工具注册表（由 Doves HTTP 上报填充） ====================

/**
 * 工具注册表
 * Map<toolName, { extension, description, inputSchema, safetyLevel, doveId }>
 * 
 * 不再存 handler 和 toolPath — 这些是 Doves 的事
 */
const toolRegistry = new Map();

/**
 * 获取扩展工具注册表（供其他模块查询已注册的扩展工具）
 * @returns {Map} toolRegistry
 */
export function getToolRegistry() {
  return toolRegistry;
}

/**
 * POST /api/extensions/tools/register
 * Doves 启动时上报工具元数据
 * 
 * Body:
 *   doveId     (必填) 上报的鸽子 ID
 *   tools      (必填) 工具元数据数组
 *   extension  (必填) 扩展包名称
 * 
 * 每个工具对象: { name, description, inputSchema, safetyLevel }
 */
router.post('/register', async (req, res) => {
  const { doveId, tools, extension } = req.body;

  if (!doveId || !tools || !extension) {
    return res.status(400).json({
      success: false,
      error: '缺少必填参数: doveId, tools, extension',
    });
  }

  if (!Array.isArray(tools)) {
    return res.status(400).json({
      success: false,
      error: 'tools 必须是数组',
    });
  }

  let 注册数 = 0;
  let 跳过数 = 0;

  for (const tool of tools) {
    if (!tool.name) {
      跳过数++;
      continue;
    }

    const safetyLevel = tool.safetyLevel || '谨慎';

    if (safetyLevel === '危险') {
      跳过数++;
      continue;
    }

    toolRegistry.set(tool.name, {
      extension,
      description: tool.description || '',
      inputSchema: tool.inputSchema || {},
      safetyLevel,
      doveId,
      registeredAt: Date.now(),
    });
    注册数++;
  }

  logger.info(`[extensions] 鸽子 ${doveId} 注册工具: ${注册数} 个 (跳过 ${跳过数})`);

  res.json({
    success: true,
    data: { 注册数, 跳过数, 总工具数: toolRegistry.size },
  });
});

/**
 * POST /api/extensions/tools/unregister
 * Doves 注销工具元数据（卸载扩展时调用）
 * 
 * Body:
 *   doveId     (必填) 鸽子 ID
 *   extension  (必填) 扩展包名称
 */
router.post('/unregister', async (req, res) => {
  const { doveId, extension } = req.body;

  if (!doveId || !extension) {
    return res.status(400).json({
      success: false,
      error: '缺少必填参数: doveId, extension',
    });
  }

  let 注销数 = 0;
  for (const [name, entry] of toolRegistry) {
    if (entry.extension === extension && entry.doveId === doveId) {
      toolRegistry.delete(name);
      注销数++;
    }
  }

  logger.info(`[extensions] 鸽子 ${doveId} 注销扩展 ${extension}: ${注销数} 个工具`);

  res.json({
    success: true,
    data: { 注销数, 总工具数: toolRegistry.size },
  });
});

// ==================== 初始化（空操作，不再扫描目录） ====================

export async function initializeExtensionTools() {
  // 不再扫描 doves/extensions 目录
  // 工具注册表由 Doves 启动时通过 POST /register 上报填充
  logger.info('[extensions] 工具注册表已就绪（等待 Doves 上报）');
}

// ==================== 查询 API ====================

/**
 * GET /api/extensions/tools/list
 * 列出所有可调用工具（含安全级别、所属扩展等信息）
 */
router.get('/list', (req, res) => {
  const tools = [];
  for (const [name, entry] of toolRegistry) {
    tools.push({
      name,
      extension: entry.extension,
      description: entry.description || '',
      safetyLevel: entry.safetyLevel,
      inputSchema: entry.inputSchema || {},
    });
  }

  res.json({ success: true, data: { tools, total: tools.length } });
});

// ==================== 异步调用 API ====================

/**
 * POST /api/extensions/tools/call
 * 创建扩展工具调用任务
 * 
 * Server 只做：认证 + 参数校验 + 任务入队
 * Doves 自主从任务队列拉取执行
 * 
 * Body:
 *   tool       (必填) 工具名称
 *   args       (可选) 工具参数对象（支持 _cliParts 数组）
 *   extension  (可选) 指定扩展名，不填则自动查找
 * 
 * 响应:
 *   { success: true, data: { taskId } }
 */
router.post('/call', async (req, res) => {
  try {
    const { tool, args = {}, extension } = req.body;

    if (!tool) {
      return res.status(400).json({ success: false, error: '缺少必填参数: tool' });
    }

    // 查找工具
    const entry = toolRegistry.get(tool);

    if (entry && extension && entry.extension !== extension) {
      return res.status(400).json({
        success: false,
        error: `工具 "${tool}" 属于扩展 "${entry.extension}"，非 "${extension}"`,
      });
    }

    if (!entry) {
      return res.status(404).json({
        success: false,
        error: `未找到工具: "${tool}"。可用 GET /api/extensions/tools/list 查看所有工具`,
      });
    }

    // CLI args 转换：_cliParts → 结构化 args
    if (args._cliParts && Array.isArray(args._cliParts)) {
      const schema = entry.inputSchema || {};
      const required = schema.required || [];
      const properties = schema.properties || {};
      const cliParts = args._cliParts;
      delete args._cliParts;

      for (let i = 0; i < required.length && i < cliParts.length; i++) {
        const fieldName = required[i];
        const rawValue = cliParts[i];
        const fieldType = properties[fieldName]?.type;

        if (fieldType === 'number') {
          args[fieldName] = Number(rawValue);
        } else if (fieldType === 'boolean') {
          args[fieldName] = rawValue === 'true' || rawValue === '1';
        } else {
          args[fieldName] = rawValue;
        }
      }
    }

    // 注入认证用户 ID
    if (req.user?.userId && !args.user_id) {
      args.user_id = req.user.userId;
    }

    // 安全隔离：检查安全级别
    if (entry.safetyLevel === '危险') {
      return res.status(403).json({
        success: false,
        error: `工具 "${tool}" 为高风险操作，不可通过 Web API 调用`,
      });
    }

    // 参数校验
    if (entry.inputSchema?.required) {
      for (const requiredField of entry.inputSchema.required) {
        if (args[requiredField] === undefined || args[requiredField] === null) {
          return res.status(400).json({
            success: false,
            error: `缺少必填参数: ${requiredField}`,
          });
        }
      }
    }

    // 创建扩展工具调用任务
    const adminDb = getAdminDb();
    const ts = createTimestampFields();
    const { ObjectId } = await import('@dove/common/对象标识.js');
    const taskId = new ObjectId().toString();

    const task = {
      任务ID: taskId,
      类型: 'extension_tool',
      状态: '已就绪',
      扩展工具: {
        name: tool,
        extension: entry.extension,
        args,
        safetyLevel: entry.safetyLevel,
      },
      用户ID: req.user?.userId || null,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp,
      更新时间: ts.localTime,
      更新时间戳: ts.timestamp
    };

    await adminDb.collection('任务').insertOne(task);

    logger.info(`[extensions] 工具调用任务已创建: ${tool} (${entry.extension}) → taskId: ${taskId}`);

    res.json({
      success: true,
      data: {
        taskId,
        status: '已就绪',
        message: '任务已创建，Doves 将自主拉取执行。使用 GET /api/extensions/tools/call/:taskId 查询结果',
      },
    });
  } catch (e) {
    logger.error(`[extensions] 工具调用任务创建异常: ${e.message}`);
    res.status(500).json({ success: false, error: `任务创建异常: ${e.message}` });
  }
});

/**
 * GET /api/extensions/tools/call/:taskId
 * 查询扩展工具调用任务结果
 */
router.get('/call/:taskId', async (req, res) => {
  const { taskId } = req.params;

  try {
    const adminDb = getAdminDb();
    const task = await adminDb.collection('任务').findOne({ 任务ID: taskId });

    if (!task) {
      return res.status(404).json({
        success: false,
        error: `任务不存在: ${taskId}`,
      });
    }

    if (task.类型 !== 'extension_tool') {
      return res.status(400).json({
        success: false,
        error: `任务 ${taskId} 不是扩展工具调用任务`,
      });
    }

    res.json({
      success: true,
      data: {
        taskId,
        status: task.状态,
        tool: task.扩展工具?.name,
        extension: task.扩展工具?.extension,
        result: task.结果 || null,
        error: task.错误 || null,
        elapsed: task.执行耗时 || null,
      },
    });
  } catch (e) {
    logger.error(`[extensions] 查询任务结果异常: ${e.message}`);
    res.status(500).json({ success: false, error: `查询异常: ${e.message}` });
  }
});

// ==================== SSE 实时推送 API ====================

/**
 * GET /api/extensions/tools/call/stream/:taskId
 * 使用 MongoDB Change Stream 监听 extension_tool 任务完成，SSE 推送结果
 *
 * DoveSDK.callTool() 异步路径使用此端点，零轮询。
 * 复用 task-stream.js 的 Change Stream + 租约续期模式。
 */
router.get('/call/stream/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const userId = req.user?.userId;

  // SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.writeHead(200);

  try {
    const adminDb = getAdminDb();
    const tasksColl = adminDb.collection('任务');

    // 先检查任务是否存在且属于当前用户
    const task = await tasksColl.findOne({ 任务ID: taskId });
    if (!task) {
      res.write(`event: error_event\ndata: ${JSON.stringify({ error: '任务不存在' })}\n\n`);
      res.end();
      return;
    }

    if (task.类型 !== 'extension_tool') {
      res.write(`event: error_event\ndata: ${JSON.stringify({ error: '不是扩展工具任务' })}\n\n`);
      res.end();
      return;
    }

    // 权限检查：任务创建者或管理员
    if (userId && task.用户ID && task.用户ID !== userId) {
      res.write(`event: error_event\ndata: ${JSON.stringify({ error: '无权访问此任务' })}\n\n`);
      res.end();
      return;
    }

    // 发送连接确认
    res.write(`event: connected\ndata: ${JSON.stringify({ taskId })}\n\n`);

    // 如果任务已完成，直接推送结果
    const status = task.状态;
    if (status === '已完成') {
      res.write(`event: result\ndata: ${JSON.stringify(task.结果 || null)}\n\n`);
      res.write('event: done\ndata: {}\n\n');
      res.end();
      return;
    }
    if (status === '失败') {
      res.write(`event: error_event\ndata: ${JSON.stringify({ error: task.错误 || '执行失败' })}\n\n`);
      res.end();
      return;
    }

    // 使用 Change Stream 监听任务变化
    const changeStream = tasksColl.watch(
      [{ $match: { 'fullDocument.任务ID': taskId } }],
      { fullDocument: 'updateLookup' }
    );

    // 超时保护：5分钟租约，最多续期 12 次（共 65 分钟）
    const LEASE_MS = 5 * 60 * 1000;
    const MAX_RENEWALS = 12;
    let renewalCount = 0;
    let settled = false;
    let leaseTimer = null;

    const startLease = () => {
      leaseTimer = setTimeout(() => {
        if (settled) return;
        // 检查任务是否还活着
        tasksColl.findOne({ 任务ID: taskId }).then(fresh => {
          if (settled) return;
          const s = fresh?.状态;
          if (s && !['已完成', '失败', '已取消', '已终止'].includes(s) && renewalCount < MAX_RENEWALS) {
            renewalCount++;
            startLease();
          } else {
            settled = true;
            changeStream.close();
            res.write(`event: error_event\ndata: ${JSON.stringify({ error: '监听超时' })}\n\n`);
            res.end();
          }
        }).catch((err) => {
          logger.error(`[extensions] SSE 租约检查失败: ${err.message}`);
          if (settled) return;
          settled = true;
          changeStream.close();
          res.write(`event: error_event\ndata: ${JSON.stringify({ error: '租约检查失败: ' + err.message })}\n\n`);
          res.end();
        });
      }, LEASE_MS);
    };

    startLease();

    changeStream.on('change', (change) => {
      if (settled) return;
      const updated = change.fullDocument;
      if (!updated) return;

      const st = updated.状态;

      // 任务完成：推送结果
      if (st === '已完成') {
        settled = true;
        clearTimeout(leaseTimer);
        changeStream.close();
        res.write(`event: result\ndata: ${JSON.stringify(updated.结果 || null)}\n\n`);
        res.write('event: done\ndata: {}\n\n');
        res.end();
        return;
      }

      // 任务失败：推送错误
      if (st === '失败') {
        settled = true;
        clearTimeout(leaseTimer);
        changeStream.close();
        res.write(`event: error_event\ndata: ${JSON.stringify({ error: updated.错误 || '执行失败' })}\n\n`);
        res.end();
        return;
      }

      // 非终态变化：续期租约
      renewalCount = 0;
      clearTimeout(leaseTimer);
      startLease();
    });

    changeStream.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(leaseTimer);
      res.write(`event: error_event\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    });

    // 客户端断开时清理
    req.on('close', () => {
      settled = true;
      clearTimeout(leaseTimer);
      changeStream.close();
    });

  } catch (e) {
    logger.error(`[extensions] SSE 监听异常: ${e.message}`);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: e.message }));
    } else {
      res.write(`event: error_event\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    }
  }
});

// ==================== 同步执行 API（已移除） ====================
//
// 原设计中 Server 直接 import doves/extensions 下的处理器代码进行同步执行，
// 违反 Server-Doves 隔离原则（Server 不 import Doves 代码）。
//
// 现已统一走任务队列：所有工具调用通过 POST /api/extensions/tools/call → Doves 自主拉取执行。
// DoveSDK.callTool() 已移除同步路径，直接走异步 + SSE 推送。

export default router;
