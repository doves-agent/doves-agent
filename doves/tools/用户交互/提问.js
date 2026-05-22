/**
 * @file tools/用户交互/提问
 * @description 向用户提问：事件集合模式（写入事件 → 轮询等答案）
 */

import { toLocalISOString, getTimestamp } from '@dove/common/时间工具.js';
import { QUESTION_TYPES } from './工具定义.js';
import { getState, addPendingQuestion, deletePendingQuestion, getProgressCallback } from './状态管理.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('用户交互', { 前缀: '[用户交互]', 级别: 'debug', 显示调用位置: true });

async function askUser(args, onProgress) {
  const { question, type = QUESTION_TYPES.TEXT_INPUT, options = [], defaultAnswer, placeholder, required = true, timeout = 0, header, riskLevel = 'low' } = args;
  const { DovesProxyRef, rootTaskIdRef, userIdRef, currentTaskId, 本地操作自动审批, 本地操作审批超时 } = getState();

  if (!(DovesProxyRef && rootTaskIdRef)) {
    throw new Error('[用户交互] 事件集合模式不可用，请确保 DovesProxy 和根任务ID已设置');
  }

  const questionId = 'q-' + Math.random().toString(16).substr(2, 6);

  const questionObj = {
    id: questionId, question, type,
    options: type === QUESTION_TYPES.SINGLE_CHOICE || type === QUESTION_TYPES.MULTI_CHOICE ? options : undefined,
    defaultAnswer, placeholder, required, timeout, header, riskLevel,
    createdAt: toLocalISOString(), createdAtTs: getTimestamp()
  };

  logger.info(`向用户提问: ${question.substring(0, 50)}... (类型: ${type})`);

  // 双通道保障：1) onProgress回调（LLM执行器上下文） 2) 全局progressCallback 3) 直接写流缓冲
  // 无论哪种通道，都确保 CLI 的 SSE 监听能收到 user_question
  const progressCb = onProgress || getProgressCallback();
  if (progressCb) {
    progressCb({ type: 'user_question', data: questionObj });
  }
  // 当 onProgress 不可用时，直接通过 DovesProxy 写入任务流缓冲
  // 这是双通道保障的关键：即使事件集合通道（Change Stream）不工作，
  // CLI 也能通过 SSE 监听任务的 streamBuffer 收到审批问题
  // 注意：流缓冲必须写入 currentTaskId（branch 任务），而非 rootTaskIdRef（routing 任务），
  // 因为 CLI 在 routing→branch 切换后监听的是 branch 任务的 SSE
  if (!progressCb && DovesProxyRef && currentTaskId) {
    try {
      const ts = getTimestamp();
      await DovesProxyRef.dbOperation('任务', 'updateOne', {
        query: { 任务ID: currentTaskId },
        update: { $push: { 流缓冲: { 类型: 'user_question', 问题数据: questionObj, 来源事件ID: null, 时间: toLocalISOString(), 时间戳: ts } } }
      });
      logger.info(`已写入流缓冲(双通道保障): 任务=${currentTaskId}, 问题=${questionId}`);
    } catch (e) {
      logger.warn(`写入流缓冲失败(非致命): ${e.message}`);
    }
  }

  // 本地操作自动审批：confirmation 和 single_choice（审批类）类型均支持跳过
  // 但危险/高风险操作必须走完整确认流程（含 IM 审批推送），不自动审批
  const isApprovalType = type === QUESTION_TYPES.CONFIRMATION || type === QUESTION_TYPES.SINGLE_CHOICE;
  const isDangerous = riskLevel === '危险' || riskLevel === 'high';
  if (本地操作自动审批 && isApprovalType && !isDangerous) {
    logger.info(`本地操作自动审批: 跳过用户确认 (类型: ${type}, 风险等级: ${riskLevel})`);
    if (本地操作审批超时 > 0) {
      await new Promise(resolve => setTimeout(resolve, 本地操作审批超时 * 1000));
    }
    return { success: true, questionId, answer: { value: defaultAnswer || 'approve', autoApproved: true }, question: questionObj };
  }

  if (本地操作自动审批 && isDangerous) {
    logger.info(`检测到危险操作 (风险等级: ${riskLevel})，跳过自动审批，走完整确认流程`);
  }

  return _askViaEventCollection(questionObj, DovesProxyRef, rootTaskIdRef, userIdRef, timeout);
}

async function _askViaEventCollection(questionObj, DovesProxyRef, rootTaskIdRef, userIdRef, timeout = 0) {
  const questionId = questionObj.id;
  const ts = Date.now();
  const 事件ID = 'ask-' + Math.random().toString(16).substr(2, 6);

  const eventDoc = {
    事件ID, 事件类型: 'user_interaction', 事件名称: questionObj.header || '用户交互',
    根任务ID: rootTaskIdRef, 问题: questionObj, 状态: '等待中', 用户ID: userIdRef,
    答案: null,
    需要IM确认: questionObj.riskLevel === '危险',
    IM风险等级: questionObj.riskLevel || 'low',
    创建时间: toLocalISOString(), 创建时间戳: ts,
    更新时间: toLocalISOString(), 更新时间戳: ts
  };

  await DovesProxyRef.dbOperation('事件', 'insertOne', { doc: eventDoc });
  logger.info(`事件已写入: ${事件ID}, 根任务: ${rootTaskIdRef}`);

  if (questionObj.riskLevel === '危险') {
    try {
      const { broadcastApproval } = await import('../im-adapters/index.js');
      const approvalResults = await broadcastApproval({
        id: 事件ID, title: questionObj.header || '用户确认',
        description: questionObj.question, riskLevel: questionObj.riskLevel,
        operationType: questionObj.header || '未知',
        options: (questionObj.options || []).map(o => ({ label: o.label, value: o.value })),
        timeout,
      });
      const sentCount = approvalResults.filter(r => r.success).length;
      if (sentCount > 0) logger.info(`IM审批推送已发送到 ${sentCount} 个适配器`);
    } catch (e) {
      logger.info(`IM推送跳过: ${e.message}`);
    }
  }

  return new Promise((resolve) => {
    let pollingInterval = null;
    let timeoutTimer = null;
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (pollingInterval) clearInterval(pollingInterval);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      deletePendingQuestion(questionId);
    };

    addPendingQuestion(questionId, { createdAt: Date.now(), timeout, cleanup });

    const checkEventAnswer = async () => {
      try {
        const resp = await DovesProxyRef.dbOperation('事件', 'findOne', {
          query: { 事件类型: 'user_interaction', 根任务ID: rootTaskIdRef, 状态: '已回复', '问题.id': questionId }
        });
        const result = resp?.success ? resp.data : resp;
        if (result) {
          cleanup();
          try {
            await DovesProxyRef.dbOperation('事件', 'findOneAndUpdate', {
              query: { 事件ID: result.事件ID, 状态: '已回复' },
              update: { $set: { 状态: '已消费', 消费时间: toLocalISOString(), 消费时间戳: getTimestamp() } },
              options: { returnDocument: 'after' }
            });
          } catch (e) {
            logger.warn(`消费事件失败: ${e.message}`);
          }
          logger.info(`用户回答(事件模式): ${JSON.stringify(result.答案).substring(0, 100)}`);
          resolve({ success: true, questionId, answer: result.答案, question: questionObj });
        }
      } catch (err) {
        logger.error(`轮询事件集合出错: ${err.message}`);
      }
    };

    pollingInterval = setInterval(checkEventAnswer, 2000);
    checkEventAnswer();

    if (timeout > 0) {
      timeoutTimer = setTimeout(() => {
        cleanup();
        logger.info('用户未在规定时间内回答(事件模式)');
        resolve({ success: false, questionId, error: '用户未在规定时间内回答', timeout: true });
      }, timeout * 1000);
    }
  });
}

export { askUser };
