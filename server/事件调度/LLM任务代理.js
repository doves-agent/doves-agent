/**
 * LLM 任务代理
 * 
 * Server 不直接调用 LLM，而是创建 event_llm_judge 异步任务，
 * 由 Doves 拉取执行，Server 轮询结果。
 * 
 * 数据流：
 *   Server 创建 event_llm_judge 任务 → MongoDB
 *   → Doves 拉取执行（调用 LLM）→ 提交结果
 *   → Server 轮询结果 → 返回解析后的 JSON
 */

import { getUserDb } from '../db.js';
import { createTimestampFields } from '@dove/common/时间工具.js';
import { ObjectId } from 'mongodb';
import { logger } from '../core.js';

/**
 * 请求 Doves 执行 LLM 调用，等待结果
 * 
 * @param {Object} params
 * @param {string} params.提示词 - 发给 LLM 的提示词
 * @param {number} [params.temperature=0.1] - 温度
 * @param {number} [params.max_tokens=500] - 最大 token 数
 * @param {string} [params.label='事件调度LLM'] - 标签（用于日志）
 * @param {string} [params.userId] - 用户 ID
 * @param {number} [params.timeout=30000] - 超时毫秒数
 * @returns {Object} LLM 返回的 JSON 对象
 */
export async function 请求LLM判断({ 提示词, temperature = 0.1, max_tokens = 500, label = '事件调度LLM', userId, timeout = 30000 }) {
  const userDb = getUserDb();
  const ts = createTimestampFields();
  const taskId = new ObjectId().toString();

  // 创建 event_llm_judge 任务
  const task = {
    任务ID: taskId,
    类型: 'event_llm_judge',
    状态: '已就绪',
    LLM请求: {
      提示词,
      temperature,
      max_tokens,
      label,
    },
    用户ID: userId || 'system',
    创建时间: ts.localTime,
    创建时间戳: ts.timestamp,
    更新时间: ts.localTime,
    更新时间戳: ts.timestamp
  };

  await userDb.collection('任务').insertOne(task);

  // 轮询等待结果
  const startTime = Date.now();
  const pollInterval = 500; // 500ms 轮询

  while (Date.now() - startTime < timeout) {
    const updated = await userDb.collection('任务').findOne({ 任务ID: taskId });

    if (!updated) {
      await sleep(pollInterval);
      continue;
    }

    // 任务完成
    if (updated.状态 === '已完成') {
      try {
        const result = typeof updated.结果 === 'string' ? JSON.parse(updated.结果) : updated.结果;
        return result;
      } catch (e) {
        logger.warn(`[LLM任务代理] 解析结果失败: ${e.message}`);
        return { raw: updated.结果 };
      }
    }

    // 任务失败
    if (updated.状态 === '失败') {
      throw new Error(updated.错误 || 'LLM判断任务执行失败');
    }

    await sleep(pollInterval);
  }

  // 超时
  throw new Error(`LLM判断任务超时 (${timeout}ms)`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
