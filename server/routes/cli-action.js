/**
 * CLI 操作请求/响应 API
 *
 * Doves/Server 发起 CLI 操作请求，CLI 执行后回调结果。
 * 复用事件集合机制（Change Stream → SSE → CLI），与 user_interaction 并行。
 *
 * API:
 *   POST /api/cli/action/request   — Doves/Server 请求 CLI 执行操作
 *   POST /api/cli/action/complete  — CLI 执行完成后回调
 *   GET  /api/cli/action/status/:id — 查询操作状态
 */

import { Router } from 'express';
import { getUserDb, createTimestampFields } from '../db.js';
import { logger } from '../core.js';

const router = Router();

/**
 * POST /api/cli/action/request
 * Doves/Server 请求 CLI 执行操作
 *
 * Body:
 *   根任务ID    (必填) 关联的根任务ID
 *   操作请求    (必填) { capability, params, description }
 *   超时秒数    (可选) 超时时间(秒)，0=不超时
 */
router.post('/request', async (req, res) => {
  const { 根任务ID, 操作请求, 超时秒数 = 0 } = req.body;
  const userId = req.user?.userId;

  if (!根任务ID || !操作请求) {
    return res.status(400).json({
      success: false,
      error: '缺少必填参数: 根任务ID, 操作请求',
    });
  }

  if (!操作请求.capability || !操作请求.params) {
    return res.status(400).json({
      success: false,
      error: '操作请求必须包含 capability 和 params',
    });
  }

  try {
    const userDb = getUserDb();
    const ts = createTimestampFields();
    const actionId = 'act-' + Math.random().toString(16).substr(2, 8);

    const eventDoc = {
      事件ID: actionId,
      事件类型: 'cli_action',
      事件名称: 操作请求.description || `CLI操作: ${操作请求.capability}`,
      根任务ID,
      操作请求: {
        capability: 操作请求.capability,
        params: 操作请求.params,
        description: 操作请求.description || '',
      },
      状态: '等待中',
      用户ID: userId,
      答案: null,
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp,
      更新时间: ts.localTime,
      更新时间戳: ts.timestamp,
    };

    // 超时信息（供 CLI 端参考）
    if (超时秒数 > 0) {
      eventDoc.操作请求.timeout = 超时秒数;
    }

    await userDb.collection('事件').insertOne(eventDoc);

    logger.info(`[CLI操作] 请求已创建: ${actionId}, 能力: ${操作请求.capability}, 根任务: ${根任务ID}`);

    res.json({
      success: true,
      data: { actionId, 状态: '等待中' },
    });
  } catch (e) {
    logger.error('[CLI操作] 创建操作请求失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/cli/action/complete
 * CLI 执行完成后回调
 *
 * Body:
 *   actionId (必填) 操作ID
 *   result   (必填) 执行结果 { success, data?, error? }
 */
router.post('/complete', async (req, res) => {
  const { actionId, result } = req.body;
  const userId = req.user?.userId;

  if (!actionId || result === undefined) {
    return res.status(400).json({
      success: false,
      error: '缺少必填参数: actionId, result',
    });
  }

  try {
    const userDb = getUserDb();
    const ts = createTimestampFields();

    const updateResult = await userDb.collection('事件').findOneAndUpdate(
      { 事件ID: actionId, 用户ID: userId, 事件类型: 'cli_action', 状态: '等待中' },
      {
        $set: {
          状态: '已回复',
          答案: result,
          回答时间: ts.localTime,
          回答时间戳: ts.timestamp,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp,
        },
      },
      { returnDocument: 'after' }
    );

    if (!updateResult) {
      return res.status(404).json({
        success: false,
        error: '操作请求不存在或已完成',
      });
    }

    logger.info(`[CLI操作] 完成回调: ${actionId}, 成功: ${!!result?.success}`);

    res.json({
      success: true,
      data: { actionId, 状态: '已回复' },
    });
  } catch (e) {
    logger.error('[CLI操作] 完成回调失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/cli/action/status/:id
 * 查询操作状态
 */
router.get('/status/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.userId;

  try {
    const userDb = getUserDb();
    const event = await userDb.collection('事件').findOne(
      { 事件ID: id, 事件类型: 'cli_action' },
      { projection: { 事件ID: 1, 事件类型: 1, 状态: 1, 操作请求: 1, 答案: 1, 创建时间戳: 1, 回答时间戳: 1 } }
    );

    if (!event) {
      return res.status(404).json({
        success: false,
        error: '操作请求不存在',
      });
    }

    // 非本人只能看状态，不能看结果
    const isOwner = event.用户ID === userId;

    res.json({
      success: true,
      data: {
        actionId: event.事件ID,
        status: event.状态,
        request: event.操作请求,
        result: isOwner ? event.答案 : null,
        createdAt: event.创建时间戳,
        completedAt: event.回答时间戳,
      },
    });
  } catch (e) {
    logger.error('[CLI操作] 查询状态失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
