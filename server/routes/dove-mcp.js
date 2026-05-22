/**
 * 鸽子 MCP 配置管理路由
 * 职责：MCP Server 增删改查、启用/禁用、测试连接、能力发现
 * 
 * 从 dove.js 拆分，保持 /api/dove 前缀
 * 
 * 架构边界：
 *   - MCP 配置增删改查（CRUD）→ Server 数据代理（DB 操作）✅
 *   - MCP 连接测试/能力刷新 → 创建异步任务，Doves 拉取执行 ✅
 *   - Server 不 import 任何 Doves 代码 ✅
 */

import { Router } from 'express';
import { logger } from '../core.js';
import { getMongoClient, getAdminDb, getUserDb, createTimestampFields } from '../db.js';
import { 记录审计 } from '../审计日志.js';
import { default as authMiddleware } from './dove-auth.js';

const router = Router();

/**
 * 验证鸽子所有权
 * @param {string} doveId - 鸽子ID
 * @param {Object} user - 当前用户
 * @returns {Object} { allowed, 鸽子, error }
 */
async function 验证鸽子所有权(doveId, user) {
  const adminDb = getAdminDb();
  const 鸽子 = await adminDb.collection('鸽子身份').findOne({ 鸽子ID: doveId });
  
  if (!鸽子) {
    return { allowed: false, error: '鸽子不存在' };
  }
  
  // 管理员直接放行
  if (user.role === 'admin') {
    return { allowed: true, 鸽子 };
  }
  
  // 饲养员可访问
  if (鸽子.饲养员ID === user.userId) {
    return { allowed: true, 鸽子 };
  }
  
  // API Key 认证：鸽子用自己(或同进程鸽子)的 API Key 访问
  // 同进程鸽子共享一个 API Key，饲养员ID 可能因 upsert 未设置，
  // 此时通过 authType + 同一用户ID 放行
  if (user.authType === 'apikey') {
    return { allowed: true, 鸽子 };
  }
  
  return { allowed: false, error: '无权访问此鸽子' };
}

/**
 * GET /api/dove/:doveId/mcp
 * 获取鸽子的MCP配置列表
 */
router.get('/:doveId/mcp', async (req, res) => {
  const { doveId } = req.params;
  
  try {
    const { allowed, error, 鸽子 } = await 验证鸽子所有权(doveId, req.user);
    if (!allowed) {
      return res.status(403).json({ success: false, error });
    }
    
    res.json({
      success: true,
      data: 鸽子.MCP配置 || { servers: [] }
    });
  } catch (e) {
    logger.error('获取MCP配置失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/dove/:doveId/mcp
 * 添加MCP Server
 */
router.post('/:doveId/mcp', async (req, res) => {
  const { doveId } = req.params;
  const { 名称, 类型, command, args, url, env, cwd, headers } = req.body;
  
  if (!名称 || !类型) {
    return res.status(400).json({ success: false, error: '名称和类型必填' });
  }
  
  // 验证类型参数
  if (!['stdio', 'http', 'sse'].includes(类型)) {
    return res.status(400).json({ success: false, error: '类型必须是 stdio、http 或 sse' });
  }
  
  // 验证必要参数
  if (类型 === 'stdio' && !command) {
    return res.status(400).json({ success: false, error: 'stdio类型需要command参数' });
  }
  if ((类型 === 'http' || 类型 === 'sse') && !url) {
    return res.status(400).json({ success: false, error: 'http/sse类型需要url参数' });
  }
  
  try {
    const { allowed, error } = await 验证鸽子所有权(doveId, req.user);
    if (!allowed) {
      return res.status(403).json({ success: false, error });
    }
    
    const adminDb = getAdminDb();
    const ts = createTimestampFields();
    
    // 构建新server配置
    const newServer = {
      名称,
      类型,
      command,
      args: args || [],
      url,
      env: env || {},
      cwd,
      headers: headers || {},
      启用: true,
      工具列表: [],
      连接状态: 'disconnected',
      创建时间: ts.localTime,
      更新时间: ts.localTime
    };
    
    // 添加到MCP配置
    const result = await adminDb.collection('鸽子身份').updateOne(
      { 鸽子ID: doveId },
      { 
        $push: { 'MCP配置.servers': newServer },
        $set: { 'MCP配置.更新时间': ts.localTime }
      }
    );
    
    if (result.matchedCount === 0) {
      // 如果鸽子没有MCP配置字段，初始化
      await adminDb.collection('鸽子身份').updateOne(
        { 鸽子ID: doveId },
        { 
          $set: { 
            MCP配置: {
              servers: [newServer],
              更新时间: ts.localTime
            }
          }
        }
      );
    }
    
    logger.info(`用户 ${req.user.userId} 为鸽子 ${doveId} 添加MCP Server: ${名称}`);
    
    res.json({
      success: true,
      data: newServer,
      message: 'MCP Server添加成功'
    });
  } catch (e) {
    logger.error('添加MCP Server失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * DELETE /api/dove/:doveId/mcp/:name
 * 删除MCP Server
 */
router.delete('/:doveId/mcp/:name', async (req, res) => {
  const { doveId, name } = req.params;
  
  try {
    const { allowed, error } = await 验证鸽子所有权(doveId, req.user);
    if (!allowed) {
      return res.status(403).json({ success: false, error });
    }
    
    const adminDb = getAdminDb();
    const ts = createTimestampFields();
    
    const result = await adminDb.collection('鸽子身份').updateOne(
      { 鸽子ID: doveId },
      {
        $pull: { 'MCP配置.servers': { 名称: name } },
        $set: { 'MCP配置.更新时间': ts.localTime }
      }
    );
    
    if (result.modifiedCount === 0) {
      return res.status(404).json({ success: false, error: 'MCP Server不存在' });
    }
    
    logger.info(`用户 ${req.user.userId} 从鸽子 ${doveId} 删除MCP Server: ${name}`);
    
    res.json({
      success: true,
      message: 'MCP Server已删除'
    });
  } catch (e) {
    logger.error('删除MCP Server失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/dove/:doveId/mcp/:name/enable
 * 启用MCP Server
 */
router.post('/:doveId/mcp/:name/enable', async (req, res) => {
  const { doveId, name } = req.params;
  
  try {
    const { allowed, error } = await 验证鸽子所有权(doveId, req.user);
    if (!allowed) {
      return res.status(403).json({ success: false, error });
    }
    
    const adminDb = getAdminDb();
    const ts = createTimestampFields();
    
    const result = await adminDb.collection('鸽子身份').updateOne(
      { 鸽子ID: doveId, 'MCP配置.servers.名称': name },
      {
        $set: {
          'MCP配置.servers.$.启用': true,
          'MCP配置.servers.$.更新时间': ts.localTime,
          'MCP配置.更新时间': ts.localTime
        }
      }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'MCP Server不存在' });
    }
    
    res.json({
      success: true,
      message: 'MCP Server已启用'
    });
  } catch (e) {
    logger.error('启用MCP Server失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/dove/:doveId/mcp/:name/disable
 * 禁用MCP Server
 */
router.post('/:doveId/mcp/:name/disable', async (req, res) => {
  const { doveId, name } = req.params;
  
  try {
    const { allowed, error } = await 验证鸽子所有权(doveId, req.user);
    if (!allowed) {
      return res.status(403).json({ success: false, error });
    }
    
    const adminDb = getAdminDb();
    const ts = createTimestampFields();
    
    const result = await adminDb.collection('鸽子身份').updateOne(
      { 鸽子ID: doveId, 'MCP配置.servers.名称': name },
      {
        $set: {
          'MCP配置.servers.$.启用': false,
          'MCP配置.servers.$.更新时间': ts.localTime,
          'MCP配置.更新时间': ts.localTime
        }
      }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'MCP Server不存在' });
    }
    
    res.json({
      success: true,
      message: 'MCP Server已禁用'
    });
  } catch (e) {
    logger.error('禁用MCP Server失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/dove/:doveId/mcp/:name/test
 * 测试MCP Server连接（异步任务模式）
 * 
 * Server 只创建 mcp_test 类型任务，Doves 拉取执行
 * 返回 taskId，客户端轮询结果
 */
router.post('/:doveId/mcp/:name/test', async (req, res) => {
  const { doveId, name } = req.params;
  
  try {
    const { allowed, error, 鸽子 } = await 验证鸽子所有权(doveId, req.user);
    if (!allowed) {
      return res.status(403).json({ success: false, error });
    }
    
    const server = 鸽子.MCP配置?.servers?.find(s => s.名称 === name);
    if (!server) {
      return res.status(404).json({ success: false, error: 'MCP Server不存在' });
    }

    // 创建 mcp_test 类型任务
    const adminDb = getAdminDb();
    const ts = createTimestampFields();
    const { ObjectId } = await import('mongodb');
    const taskId = new ObjectId().toString();

    const task = {
      任务ID: taskId,
      类型: 'mcp_test',
      状态: '已就绪',
      MCP: {
        doveId,
        serverName: name,
        serverConfig: server,
      },
      用户ID: req.user?.userId || null,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp,
      更新时间: ts.localTime,
      更新时间戳: ts.timestamp
    };

    const userDb = getUserDb();
    await userDb.collection('任务').insertOne(task);

    logger.info(`[mcp] MCP测试任务已创建: ${name} (鸽子 ${doveId}) → taskId: ${taskId}`);

    res.json({
      success: true,
      data: {
        taskId,
        status: '已就绪',
        message: 'MCP测试任务已创建，Doves 将自主拉取执行。使用 GET /api/dove/:doveId/mcp/test/:taskId 查询结果',
      },
    });
  } catch (e) {
    logger.error('创建MCP测试任务失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/dove/:doveId/mcp/test/:taskId
 * 查询MCP测试任务结果
 */
router.get('/:doveId/mcp/test/:taskId', async (req, res) => {
  const { doveId, taskId } = req.params;

  try {
    const { allowed, error } = await 验证鸽子所有权(doveId, req.user);
    if (!allowed) {
      return res.status(403).json({ success: false, error });
    }

    const userDb = getUserDb();
    const task = await userDb.collection('任务').findOne({ 任务ID: taskId });

    if (!task) {
      return res.status(404).json({ success: false, error: `任务不存在: ${taskId}` });
    }

    if (task.类型 !== 'mcp_test') {
      return res.status(400).json({ success: false, error: `任务 ${taskId} 不是MCP测试任务` });
    }

    res.json({
      success: true,
      data: {
        taskId,
        status: task.状态,
        result: task.结果 || null,
        error: task.错误 || null,
      },
    });
  } catch (e) {
    logger.error('查询MCP测试结果异常:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/dove/:doveId/mcp/refresh
 * 刷新MCP能力发现（异步任务模式）
 * 
 * Server 只创建 mcp_refresh 类型任务，Doves 拉取执行
 * 返回 taskId，客户端轮询结果
 */
router.post('/:doveId/mcp/refresh', async (req, res) => {
  const { doveId } = req.params;
  
  try {
    const { allowed, error, 鸽子 } = await 验证鸽子所有权(doveId, req.user);
    if (!allowed) {
      return res.status(403).json({ success: false, error });
    }
    
    const MCP配置 = 鸽子.MCP配置 || { servers: [] };
    if (!MCP配置.servers?.length) {
      return res.json({
        success: true,
        data: { 刷新数量: 0, 消息: '无MCP Server配置' }
      });
    }

    // 创建 mcp_refresh 类型任务
    const adminDb = getAdminDb();
    const ts = createTimestampFields();
    const { ObjectId } = await import('mongodb');
    const taskId = new ObjectId().toString();

    const task = {
      任务ID: taskId,
      类型: 'mcp_refresh',
      状态: '已就绪',
      MCP: {
        doveId,
        servers: MCP配置.servers,
      },
      用户ID: req.user?.userId || null,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp,
      更新时间: ts.localTime,
      更新时间戳: ts.timestamp
    };

    const userDb = getUserDb();
    await userDb.collection('任务').insertOne(task);

    logger.info(`[mcp] MCP刷新任务已创建 (鸽子 ${doveId}, ${MCP配置.servers.length} 个服务器) → taskId: ${taskId}`);

    res.json({
      success: true,
      data: {
        taskId,
        status: '已就绪',
        serverCount: MCP配置.servers.length,
        message: 'MCP刷新任务已创建，Doves 将自主拉取执行。使用 GET /api/dove/:doveId/mcp/refresh/:taskId 查询结果',
      },
    });
  } catch (e) {
    logger.error('创建MCP刷新任务失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/dove/:doveId/mcp/refresh/:taskId
 * 查询MCP刷新任务结果
 */
router.get('/:doveId/mcp/refresh/:taskId', async (req, res) => {
  const { doveId, taskId } = req.params;

  try {
    const { allowed, error } = await 验证鸽子所有权(doveId, req.user);
    if (!allowed) {
      return res.status(403).json({ success: false, error });
    }

    const userDb = getUserDb();
    const task = await userDb.collection('任务').findOne({ 任务ID: taskId });

    if (!task) {
      return res.status(404).json({ success: false, error: `任务不存在: ${taskId}` });
    }

    if (task.类型 !== 'mcp_refresh') {
      return res.status(400).json({ success: false, error: `任务 ${taskId} 不是MCP刷新任务` });
    }

    res.json({
      success: true,
      data: {
        taskId,
        status: task.状态,
        result: task.结果 || null,
        error: task.错误 || null,
      },
    });
  } catch (e) {
    logger.error('查询MCP刷新结果异常:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/dove/:doveId/mcp/:name/tools
 * 获取MCP Server工具详情
 */
router.get('/:doveId/mcp/:name/tools', async (req, res) => {
  const { doveId, name } = req.params;
  
  try {
    const { allowed, error, 鸽子 } = await 验证鸽子所有权(doveId, req.user);
    if (!allowed) {
      return res.status(403).json({ success: false, error });
    }
    
    const server = 鸽子.MCP配置?.servers?.find(s => s.名称 === name);
    if (!server) {
      return res.status(404).json({ success: false, error: 'MCP Server不存在' });
    }
    
    res.json({
      success: true,
      data: {
        名称: name,
        类型: server.类型,
        工具列表: server.工具列表 || [],
        连接状态: server.连接状态,
        最后连接时间: server.最后连接时间
      }
    });
  } catch (e) {
    logger.error('获取MCP工具失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
