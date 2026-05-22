/**
 * @file tools/用户交互
 * @description 询问用户问题、发送通知、显示进度
 * 
 * 交互流程（事件集合模式）:
 * 1. 鸽子通过 Server DB 代理写事件集合（事件类型=user_interaction，状态=pending）
 * 2. Server 监听事件集合 Change Stream，推送给 CLI 的 SSE 连接
 * 3. CLI 展示问题，用户回答
 * 4. CLI 调用 POST /api/event/:id/answer，更新事件状态为 answered
 * 5. 鸽子轮询事件集合，发现 answered 状态，消费答案
 */

// 问题类型

import { QUESTION_TYPES, interactionTools } from './用户交互/工具定义.js';
import { setCurrentTaskId, setDovesProxy, setRootTaskId, setUserId, setLocalOpAutoApprove, setProgressCallback, setTerminalInputFn, getProgressCallback, registerQuestionCallback, handleUserAnswer, getPendingQuestions, cleanupAllPendingQuestions } from './用户交互/状态管理.js';
import { askUser } from './用户交互/提问.js';
import { sendNotification, sendProgress } from './用户交互/通知进度.js';

async function handleInteractionTool(name, args, onProgress) {
  switch (name) {
    case '询问用户': return askUser(args, onProgress);
    case '通知用户': return sendNotification(args, onProgress);
    case '进度更新': return sendProgress(args, onProgress);
    default:
      return { content: [{ type: 'text', text: `Unknown interaction tool: ${name}` }], isError: true };
  }
}

// 导出问题和通知类型
export { QUESTION_TYPES, handleInteractionTool, interactionTools, setCurrentTaskId, setDovesProxy, setRootTaskId, setUserId, setLocalOpAutoApprove, setProgressCallback, setTerminalInputFn, getProgressCallback, registerQuestionCallback, handleUserAnswer, getPendingQuestions, cleanupAllPendingQuestions };

// 默认导出
export default {
  interactionTools,
  handleInteractionTool,
  setProgressCallback,
  setTerminalInputFn,
  getProgressCallback,
  setCurrentTaskId,
  setDovesProxy,
  setRootTaskId,
  setUserId,
  setLocalOpAutoApprove,
  registerQuestionCallback,
  handleUserAnswer,
  getPendingQuestions,
  cleanupAllPendingQuestions,
  QUESTION_TYPES
};
