/**
 * @file tools/用户交互/通知进度
 * @description 发送通知和进度信息给用户
 */

import { toLocalISOString } from '@dove/common/时间工具.js';
import { getProgressCallback, getState } from './状态管理.js';

async function sendNotification(args, onProgress) {
  const { message, type = 'info', duration = 5000 } = args;
  
  const callback = onProgress || getProgressCallback();
  if (callback) {
    callback({ type: 'notification', data: { message, type, duration, timestamp: toLocalISOString() } });
  }
  
  if (type === 'warning' || type === 'error') {
    try {
      const { broadcastAlert } = await import('../im-adapters/index.js');
      await broadcastAlert({
        id: `alert-${Date.now()}`,
        level: type === 'error' ? 'critical' : 'warning',
        title: type === 'error' ? '执行错误' : '执行警告',
        message, source: '白鸽系统',
      });
    } catch (e) { logger.debug(`IM广播失败: ${e.message}`); }
  }
  
  return { success: true, message: '通知已发送', notification: { message, type, duration } };
}

async function sendProgress(args, onProgress) {
  const { message, progress, status = '进行中', taskId, taskName } = args;
  const { currentTaskId } = getState();
  
  const callback = onProgress || getProgressCallback();
  if (callback) {
    callback({
      type: 'progress',
      data: {
        message,
        progress: progress !== undefined ? Math.min(100, Math.max(0, progress)) : undefined,
        status, timestamp: toLocalISOString()
      }
    });
  }
  
  if (['已完成', '失败', '阻塞中'].includes(status)) {
    try {
      const { broadcastProgress } = await import('../im-adapters/index.js');
      await broadcastProgress({
        taskId: taskId || currentTaskId || '未知',
        taskName: taskName || '任务', status,
        percent: progress || 0, message,
        currentStep: '-', totalSteps: '-',
      });
    } catch (e) { logger.debug(`IM广播失败: ${e.message}`); }
  }
  
  return { success: true, message: '进度已更新', progress: { message, progress, status } };
}

export { sendNotification, sendProgress };
