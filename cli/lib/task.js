import { AuthClient } from './auth.js';
import { 获取或生成机器标识 } from './machine-id.js';

export class TaskClient extends AuthClient {
  // ==================== 任务 API ====================

  async createTask(description, options = {}) {
    await this.ensureAuth();
    const machineId = 获取或生成机器标识();
    return await this.post('/api/task', { description, machineId, channel: 'local', ...options });
  }

  async publishTask(taskConfig) {
    await this.ensureAuth();

    const taskData = {
      描述: taskConfig.描述 || taskConfig.description,
      类型: taskConfig.类型 || taskConfig.type,
      参数: taskConfig.参数 || taskConfig.params || {},
      饲料奖励: taskConfig.饲料奖励 || taskConfig.reward || 1,
      超时时间: taskConfig.超时时间 || taskConfig.timeout || 300000,
      信誉要求: taskConfig.信誉要求 || taskConfig.minReputation || 0,
      requiredCapabilities: taskConfig.requiredCapabilities || taskConfig.能力要求 || [],
      userId: this.userId,
      ...taskConfig
    };

    return await this.post('/api/task', taskData);
  }

  async getTaskResult(taskId) {
    await this.ensureAuth();

    const task = await this.getTask(taskId);
    return {
      taskId: task.id,
      status: task.状态 || task.status,
      result: task.结果 || task.result,
      executor: task.执行者 || null,
      completedAt: task.completedAt
    };
  }

  async getTask(taskId) {
    await this.ensureAuth();
    return await this.get(`/api/task/${taskId}`);
  }

  async listTasks(query = {}) {
    await this.ensureAuth();
    return await this.get('/api/task/list', query);
  }

  async watchTask(taskId, callback, signal) {
    await this.ensureAuth();

    const POLL_INTERVAL = 1000;
    const TERMINAL_STATES = ['已完成', '已完成(部分失败)', '失败', '已取消', 'completed', 'failed', 'cancelled'];
    let lastStatus = null;
    let lastUpdatedAt = null;

    while (!signal?.aborted) {
      try {
        const task = await this.get(`/api/task/${taskId}`);
        const status = task.状态 || task.status;
        const updatedAt = task.更新时间 || task.updatedAt;

        if (status !== lastStatus || updatedAt !== lastUpdatedAt) {
          lastStatus = status;
          lastUpdatedAt = updatedAt;
          callback(task);
        }

        if (TERMINAL_STATES.includes(status)) {
          return;
        }
      } catch (err) {
        if (signal?.aborted) return;
        throw err;
      }

      await new Promise((resolve) => {
        const timer = setTimeout(resolve, POLL_INTERVAL);
        if (signal) {
          const onAbort = () => {
            clearTimeout(timer);
            resolve();
          };
          signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    }
  }

  async cancelTask(taskId) {
    await this.ensureAuth();
    return await this.post(`/api/task/${taskId}/cancel`);
  }

  async getSubTasks(taskId) {
    await this.ensureAuth();
    return await this.get(`/api/task/${taskId}/children`);
  }

  async submitAnswer(taskId, questionId, answer) {
    await this.ensureAuth();
    return await this.post(`/api/task/${taskId}/answer`, { questionId, answer });
  }

  async watchUserEvents(callback, signal) {
    await this.ensureAuth();

    const POLL_INTERVAL = 1500;
    const processedIds = new Set();

    while (!signal?.aborted) {
      try {
        const events = await this.dbOperation('事件', 'find', {
          query: {
            事件类型: { $in: ['user_interaction', 'cli_action'] },
            状态: '等待中'
          },
          options: { sort: { 创建时间戳: 1 }, limit: 20 }
        });

        const list = Array.isArray(events) ? events : [];
        for (const evt of list) {
          const eventId = evt.事件ID || evt.id;
          if (eventId && processedIds.has(eventId)) continue;
          if (eventId) processedIds.add(eventId);
          callback(evt);
        }
      } catch (err) {
        if (signal?.aborted) return;
        throw err;
      }

      await new Promise((resolve) => {
        const timer = setTimeout(resolve, POLL_INTERVAL);
        if (signal) {
          const onAbort = () => {
            clearTimeout(timer);
            resolve();
          };
          signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    }
  }

  async submitEventAnswer(eventId, answer) {
    await this.ensureAuth();
    return await this.post(`/api/event/${encodeURIComponent(eventId)}/answer`, { answer });
  }

  async submitEventAnswerByQuestionId(questionId, answer) {
    await this.ensureAuth();
    try {
      const data = await this.post('/api/event/answer-by-question', { questionId, answer });
      return { success: true, data };
    } catch (err) {
      return { success: false };
    }
  }

  async getTaskTrace(taskId) {
    await this.ensureAuth();
    return await this.get(`/api/task/${taskId}/trace`);
  }

  async replyTask(taskId, message) {
    await this.ensureAuth();
    return await this.post(`/api/task/${taskId}/reply`, { message });
  }
}
