/**
 * API 任务分发（通过服务端代理）
 * 从 任务队列.js 提取的 API 代理方法
 */

import { 任务状态 } from '../常量.js';
import { createTimestampFields } from '@dove/common/时间工具.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('API任务分发', { 前缀: '[API任务分发]', 级别: 'debug', 显示调用位置: true });

/**
 * 为 任务队列 实例混入 API 任务分发方法
 * @param {Object} taskQueue - 任务队列实例
 */
export function mixinAPITaskDistribution(taskQueue) {

  taskQueue.抢任务 = async function(鸽子ID, 能力列表 = []) {
    if (!this.代理) {
      logger.warn('未配置鸽子代理，无法使用抢任务API');
      return null;
    }

    try {
      const body = { capabilities: 能力列表 };
      if (鸽子ID) body.doveId = 鸽子ID;
      const data = await this.代理.fetch('/api/dove/claim-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!data) return null;

      if (data.success && data.data) {
        const 任务 = data.data;
        logger.info(`鸽子 ${鸽子ID} 成功抢到任务 ${任务.任务ID}`);
        return 任务;
      }

      return null;
    } catch (error) {
      const msg = error.message || '';
      const isNormalError = msg.includes('暂无可领取');
      if (!isNormalError) {
        logger.warn(`抢任务失败: ${msg}`);
      }
      return null;
    }
  };

  taskQueue.提交结果 = async function(任务ID, 结果, 成功 = true, 错误信息 = '', 选项 = {}) {
    const targetStatus = 选项.targetStatus || null;
    logger.info(`提交任务 ${任务ID} 结果: ${成功 ? '成功' : '失败'}${targetStatus ? ` → ${targetStatus}` : ''}`);
    
    if (!this.代理) {
      if (成功) {
        await this.写入结果(任务ID, 结果);
        const 最终状态 = targetStatus || 任务状态.COMPLETED;
        await this.更新状态(任务ID, 最终状态);
      } else {
        await this.更新状态(任务ID, 任务状态.FAILED, { 错误: 错误信息 });
      }
      return { 成功: true };
    }
    
    const body = { taskId: 任务ID, result: 结果, success: 成功, error: 错误信息 };
    if (targetStatus) body.targetStatus = targetStatus;
    const data = await this.代理.fetch('/api/dove/submit-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    if (data.success) {
      return { 成功: true, data: data.data };
    }

    logger.error(`Server submit-result 返回失败: ${data.error || '未知'}`);
    throw new Error(`提交任务结果失败: ${data.error || 'Server error'}`);
  };

  taskQueue.发送心跳 = async function(鸽子ID, 当前任务列表 = []) {
    if (!this.代理) {
      return { 成功: false, 原因: '未配置鸽子代理' };
    }
    
    try {
      const data = await this.代理.fetch('/api/dove/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentTasks: 当前任务列表 })
      });
      
      return { 成功: data.success, data: data.data };
    } catch (error) {
      logger.error(`发送心跳失败: ${error.message}`);
      return { 成功: false, 错误: error.message };
    }
  };

  taskQueue.放弃任务 = async function(任务ID, 原因 = '') {
    if (!this.代理) {
      await this.标记已取消(任务ID, 原因);
      return { 成功: true };
    }
    
    try {
      const data = await this.代理.fetch('/api/dove/abandon-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: 任务ID, reason: 原因 })
      });
      
      return { 成功: data.success, data: data.data };
    } catch (error) {
      logger.error(`放弃任务失败: ${error.message}`);
      return { 成功: false, 错误: error.message };
    }
  };
}
