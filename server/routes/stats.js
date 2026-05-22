/**
 * Token 用量统计 API
 *
 * POST /stats/usage     — Doves 上报一次 Token 用量
 * GET  /stats/usage     — CLI 查询用量（支持 ?by=model|provider|day&from=&to=）
 */

import { Router } from 'express';
import { 记录Token用量, 查询Token用量 } from '../db.js';
import { logger } from '../core.js';
import { 错误码, 创建错误响应 } from '../../common/错误码.js';

const router = Router();

// ==================== Doves 上报用量 ====================

/**
 * @openapi
 * /stats/usage:
 *   post:
 *     summary: Doves 上报 Token 用量
 *     tags: [用量统计]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, provider, inputTokens, outputTokens]
 *             properties:
 *               userId:
 *                 type: string
 *               doveId:
 *                 type: string
 *               taskId:
 *                 type: string
 *               model:
 *                 type: string
 *               provider:
 *                 type: string
 *               inputTokens:
 *                 type: number
 *               outputTokens:
 *                 type: number
 *               cost:
 *                 type: number
 *     responses:
 *       200:
 *         description: 记录成功
 *       400:
 *         description: 参数缺失
 */
router.post('/usage', async (req, res) => {
  const { userId, doveId, taskId, model, provider, inputTokens, outputTokens, cost } = req.body;

  // 必填字段校验
  if (!userId || !provider || inputTokens === undefined || outputTokens === undefined) {
    return res.status(400).json(创建错误响应(错误码.GEN_001, req.requestId, '缺少必填字段: userId, provider, inputTokens, outputTokens'));
  }

  const ok = await 记录Token用量({
    userId,
    doveId: doveId || '',
    taskId: taskId || '',
    model: model || '',
    provider,
    inputTokens: Number(inputTokens) || 0,
    outputTokens: Number(outputTokens) || 0,
    cost: Number(cost) || 0,
  });

  if (ok) {
    res.json({ success: true });
  } else {
    res.status(500).json(创建错误响应(错误码.GEN_003, req.requestId, '记录失败'));
  }
});

// ==================== CLI 查询用量 ====================

/**
 * @openapi
 * /stats/usage:
 *   get:
 *     summary: 查询 Token 用量
 *     tags: [用量统计]
 *     security:
 *       - BearerToken: []
 *     parameters:
 *       - name: by
 *         in: query
 *         schema:
 *           type: string
 *           enum: [model, provider, day]
 *         description: 分组维度
 *       - name: from
 *         in: query
 *         schema:
 *           type: string
 *           format: date
 *         description: 起始日期 (YYYY-MM-DD)
 *       - name: to
 *         in: query
 *         schema:
 *           type: string
 *           format: date
 *         description: 截止日期 (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: 查询成功
 */
router.get('/usage', async (req, res) => {
  const userId = req.user?.userId || req.userId;
  if (!userId) {
    return res.status(401).json(创建错误响应(错误码.AUTH_001, req.requestId));
  }

  const { by, from, to } = req.query;

  // 解析时间范围
  const startDate = from ? new Date(from).getTime() : undefined;
  const endDate = to ? new Date(to).getTime() : undefined;

  // 超管且传了 ?all=1 则查全局
  const targetUserId = (req.user?.role === 'admin' && req.query.all) ? undefined : userId;

  const result = await 查询Token用量({
    userId: targetUserId,
    startDate,
    endDate,
    groupBy: by || null,
  });

  res.json(result);
});

export default router;
