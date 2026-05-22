/**
 * @file im-adapters/base
 * @description IM通知适配器基类，定义HITL审批/进度推送/告警通知的统一接口
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('IM适配器', { 前缀: '[IM适配器]', 级别: 'debug', 显示调用位置: true });

/**
 * IM适配器基类
 */
class IMAdapter {
  /**
   * @param {string} name - 适配器名称（如 feishu/wecom/dingtalk）
   * @param {object} config - 适配器配置
   */
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
    this.enabled = false;
  }

  /**
   * 初始化适配器
   * @returns {Promise<boolean>} 是否初始化成功
   */
  async init() {
    throw new Error(`${this.name}: init() 未实现`);
  }

  /**
   * 发送审批请求
   * @param {object} approval - 审批信息
   * @param {string} approval.id - 审批ID
   * @param {string} approval.title - 审批标题
   * @param {string} approval.description - 审批描述
   * @param {string} approval.riskLevel - 风险级别(low/medium/high/dangerous)
   * @param {string} approval.operationType - 操作类型(如 git_push, git_reset)
   * @param {Array} approval.options - 可选项
   * @param {number} approval.timeout - 超时时间(秒)
   * @returns {Promise<string>} 审批消息ID
   */
  async sendApproval(approval) {
    throw new Error(`${this.name}: sendApproval() 未实现`);
  }

  /**
   * 推送进度通知
   * @param {object} progress - 进度信息
   * @param {string} progress.taskId - 任务ID
   * @param {string} progress.taskName - 任务名称
   * @param {string} progress.status - 状态(running/completed/failed/blocked)
   * @param {number} progress.percent - 进度百分比(0-100)
   * @param {string} progress.message - 进度消息
   * @param {string} progress.currentStep - 当前步骤
   * @param {number} progress.totalSteps - 总步骤数
   * @returns {Promise<void>}
   */
  async sendProgress(progress) {
    throw new Error(`${this.name}: sendProgress() 未实现`);
  }

  /**
   * 发送告警通知
   * @param {object} alert - 告警信息
   * @param {string} alert.id - 告警ID
   * @param {string} alert.level - 告警级别(info/warning/critical)
   * @param {string} alert.title - 告警标题
   * @param {string} alert.message - 告警内容
   * @param {string} alert.source - 告警来源
   * @param {object} alert.data - 附加数据
   * @returns {Promise<void>}
   */
  async sendAlert(alert) {
    throw new Error(`${this.name}: sendAlert() 未实现`);
  }

  /**
   * 查询审批结果
   * @param {string} approvalId - 审批ID
   * @returns {Promise<{approved: boolean, answer: string, responder: string}>}
   */
  async getApprovalResult(approvalId) {
    throw new Error(`${this.name}: getApprovalResult() 未实现`);
  }

  /**
   * 销毁适配器
   */
  async destroy() {
    this.enabled = false;
  }
}

// ==================== 适配器注册表 ====================

const adapterRegistry = new Map();

/**
 * 注册IM适配器
 * @param {string} name - 适配器名称
 * @param {IMAdapter} adapter - 适配器实例
 */
export function registerAdapter(name, adapter) {
  adapterRegistry.set(name, adapter);
  logger.info(`已注册IM适配器: ${name}`);
}

/**
 * 获取IM适配器
 * @param {string} name - 适配器名称
 * @returns {IMAdapter|null}
 */
export function getAdapter(name) {
  return adapterRegistry.get(name) || null;
}

/**
 * 获取所有已注册的适配器
 * @returns {Map}
 */
export function getAllAdapters() {
  return adapterRegistry;
}

/**
 * 初始化所有适配器
 * @param {object} configs - 适配器配置 { name: config }
 */
export async function initAdapters(configs = {}) {
  for (const [name, adapter] of adapterRegistry) {
    try {
      const config = configs[name] || {};
      Object.assign(adapter.config, config);
      const success = await adapter.init();
      adapter.enabled = success;
      logger.info(`适配器 ${name} 初始化${success ? '成功' : '失败'}`);
    } catch (e) {
      adapter.enabled = false;
      logger.error(`适配器 ${name} 初始化失败: ${e.message}`);
    }
  }
}

/**
 * 向所有启用的适配器广播审批请求
 * @param {object} approval - 审批信息
 * @returns {Promise<Array>} 各适配器的发送结果
 */
export async function broadcastApproval(approval) {
  const results = [];
  for (const [name, adapter] of adapterRegistry) {
    if (!adapter.enabled) continue;
    try {
      const msgId = await adapter.sendApproval(approval);
      results.push({ adapter: name, success: true, msgId });
    } catch (e) {
      results.push({ adapter: name, success: false, error: e.message });
    }
  }
  return results;
}

/**
 * 向所有启用的适配器广播进度
 * @param {object} progress - 进度信息
 */
export async function broadcastProgress(progress) {
  for (const [name, adapter] of adapterRegistry) {
    if (!adapter.enabled) continue;
    try {
      await adapter.sendProgress(progress);
    } catch (e) {
      logger.error(`适配器 ${name} 推送进度失败: ${e.message}`);
    }
  }
}

/**
 * 向所有启用的适配器广播告警
 * @param {object} alert - 告警信息
 */
export async function broadcastAlert(alert) {
  for (const [name, adapter] of adapterRegistry) {
    if (!adapter.enabled) continue;
    try {
      await adapter.sendAlert(alert);
    } catch (e) {
      logger.error(`适配器 ${name} 发送告警失败: ${e.message}`);
    }
  }
}

export { IMAdapter };
export default IMAdapter;
