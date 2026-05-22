/**
 * @file tools/用户交互/状态管理
 * @description 等待队列、回调管理、状态变量与 setter 函数
 */

// 等待队列 - 存储等待用户回答的请求
const pendingQuestions = new Map();

// 进度回调函数（用于 SSE 流式推送）
let progressCallback = null;

// 终端输入函数（用于终端模式）
let terminalInputFn = null;

// 当前任务ID（由智能体设置）
let currentTaskId = null;

// Server 客户端引用（用于事件集合模式）
let DovesProxyRef = null;

// 当前根任务ID（事件集合关联用）
let rootTaskIdRef = null;

// 当前用户ID（事件集合关联用）
let userIdRef = null;

// 本地操作自动审批模式
let 本地操作自动审批 = false;
let 本地操作审批超时 = 0;

export function setCurrentTaskId(taskId) {
  currentTaskId = taskId;
}

export function setDovesProxy(client) {
  DovesProxyRef = client;
}

export function setRootTaskId(rootTaskId) {
  rootTaskIdRef = rootTaskId;
}

export function setUserId(userId) {
  userIdRef = userId;
}

export function setLocalOpAutoApprove(enabled, 超时秒 = 0) {
  本地操作自动审批 = enabled;
  本地操作审批超时 = 超时秒;
}

export function setProgressCallback(fn) {
  progressCallback = fn;
}

export function setTerminalInputFn(fn) {
  terminalInputFn = fn;
}

export function getProgressCallback() {
  return progressCallback;
}

export function getState() {
  return { DovesProxyRef, rootTaskIdRef, userIdRef, currentTaskId, 本地操作自动审批, 本地操作审批超时 };
}

export function canUseEventMode() {
  return !!(DovesProxyRef && rootTaskIdRef);
}

export function registerQuestionCallback(questionId, callback, timeout = 0) {
  pendingQuestions.set(questionId, { callback, createdAt: Date.now(), timeout });
  if (timeout > 0) {
    setTimeout(() => {
      const pending = pendingQuestions.get(questionId);
      if (pending) {
        pendingQuestions.delete(questionId);
        callback({ success: false, error: '用户未在规定时间内回答', timeout: true });
      }
    }, timeout * 1000);
  }
}

export function handleUserAnswer(questionId, answer) {
  const pending = pendingQuestions.get(questionId);
  if (pending) {
    pendingQuestions.delete(questionId);
    pending.callback({ success: true, answer });
    return true;
  }
  return false;
}

export function getPendingQuestions() {
  return Array.from(pendingQuestions.entries()).map(([id, data]) => ({
    id, createdAt: data.createdAt, timeout: data.timeout
  }));
}

export function addPendingQuestion(questionId, data) {
  pendingQuestions.set(questionId, data);
}

export function deletePendingQuestion(questionId) {
  pendingQuestions.delete(questionId);
}

export function cleanupAllPendingQuestions() {
  for (const [id, data] of pendingQuestions.entries()) {
    if (data.cleanup) data.cleanup();
    pendingQuestions.delete(id);
  }
}
