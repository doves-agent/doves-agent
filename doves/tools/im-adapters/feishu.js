/**
 * @file im-adapters/feishu
 * @description 飞书(Lark) IM适配器，支持审批卡片/进度推送/告警通知
 */

import { IMAdapter, registerAdapter } from './base.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('飞书适配器', { 前缀: '[飞书适配器]', 级别: 'debug', 显示调用位置: true });

class FeishuAdapter extends IMAdapter {
  constructor(config = {}) {
    super('feishu', config);
    this.appId = config.appId || '';
    this.appSecret = config.appSecret || '';
    this.chatId = config.chatId || '';       // 群聊ID
    this.userId = config.userId || '';       // 审批人ID
    this.token = null;
    this.tokenExpireAt = 0;
  }

  async init() {
    if (!this.appId || !this.appSecret) {
      logger.warn('飞书适配器缺少appId/appSecret配置，初始化跳过');
      return false;
    }
    try {
      await this.refreshToken();
      logger.info('飞书适配器初始化成功');
      return true;
    } catch (e) {
      logger.error(`飞书适配器初始化失败: ${e.message}`);
      return false;
    }
  }

  /**
   * 刷新访问令牌
   */
  async refreshToken() {
    const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    });
    const data = await resp.json();
    if (data.code !== 0) {
      throw new Error(`获取飞书token失败: ${data.msg}`);
    }
    this.token = data.tenant_access_token;
    this.tokenExpireAt = Date.now() + (data.expire - 60) * 1000; // 提前60秒刷新
  }

  /**
   * 确保token有效
   */
  async ensureToken() {
    if (!this.token || Date.now() >= this.tokenExpireAt) {
      await this.refreshToken();
    }
  }

  /**
   * 飞书API请求
   */
  async apiRequest(method, path, body = null) {
    await this.ensureToken();
    const headers = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
    const resp = await fetch(`https://open.feishu.cn${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await resp.json();
    if (data.code !== 0) {
      throw new Error(`飞书API错误: ${data.msg}`);
    }
    return data;
  }

  /**
   * 构建审批消息卡片
   */
  buildApprovalCard(approval) {
    const riskColors = {
      low: 'blue',
      medium: 'orange',
      high: 'red',
      dangerous: 'red',
    };
    const color = riskColors[approval.riskLevel] || 'blue';

    const buttons = (approval.options || [
      { label: '批准', value: 'approve' },
      { label: '拒绝', value: 'reject' },
    ]).map(opt => ({
      tag: 'button',
      text: { tag: 'plain_text', content: opt.label },
      type: opt.value === 'approve' ? 'primary' : 'danger',
      value: { approvalId: approval.id, action: opt.value },
    }));

    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `⚠️ 审批请求: ${approval.title}` },
        template: color,
      },
      elements: [
        {
          tag: 'div',
          text: { tag: 'lark_md', content: approval.description },
        },
        {
          tag: 'div',
          fields: [
            { is_short: true, text: { tag: 'lark_md', content: `**风险级别:** ${approval.riskLevel}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**操作类型:** ${approval.operationType || '-'}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**审批ID:** ${approval.id}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**超时:** ${approval.timeout || 300}秒` } },
          ],
        },
        { tag: 'hr' },
        { tag: 'action', actions: buttons },
        {
          tag: 'note',
          elements: [{ tag: 'plain_text', content: '来自白鸽系统自动审批请求' }],
        },
      ],
    };
  }

  /**
   * 构建进度消息卡片
   */
  buildProgressCard(progress) {
    const statusEmoji = {
      running: '🔄',
      completed: '✅',
      failed: '❌',
      blocked: '🚫',
    };
    const emoji = statusEmoji[progress.status] || '📋';

    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `${emoji} 任务进度: ${progress.taskName}` },
        template: progress.status === '失败' ? 'red' : progress.status === '已完成' ? 'green' : 'blue',
      },
      elements: [
        {
          tag: 'div',
          fields: [
            { is_short: true, text: { tag: 'lark_md', content: `**状态:** ${progress.status}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**进度:** ${progress.percent || 0}%` } },
            { is_short: true, text: { tag: 'lark_md', content: `**步骤:** ${progress.currentStep || '-'}/${progress.totalSteps || '-'}` } },
          ],
        },
        {
          tag: 'div',
          text: { tag: 'lark_md', content: progress.message || '' },
        },
      ],
    };
  }

  /**
   * 构建告警消息卡片
   */
  buildAlertCard(alert) {
    const levelColors = { info: 'blue', warning: 'orange', critical: 'red' };
    const levelEmoji = { info: 'ℹ️', warning: '⚠️', critical: '🚨' };

    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `${levelEmoji[alert.level] || '📢'} ${alert.title}` },
        template: levelColors[alert.level] || 'blue',
      },
      elements: [
        {
          tag: 'div',
          text: { tag: 'lark_md', content: alert.message },
        },
        {
          tag: 'div',
          fields: [
            { is_short: true, text: { tag: 'lark_md', content: `**级别:** ${alert.level}` } },
            { is_short: true, text: { tag: 'lark_md', content: `**来源:** ${alert.source || '-'}` } },
          ],
        },
      ],
    };
  }

  /**
   * 发送消息到飞书
   */
  async sendMessage(card) {
    const targetId = this.chatId || this.userId;
    const receiveType = this.chatId ? 'chat_id' : 'open_id';

    return await this.apiRequest('POST', '/open-apis/im/v1/messages', {
      receive_id: targetId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    });
  }

  async sendApproval(approval) {
    const card = this.buildApprovalCard(approval);
    const result = await this.sendMessage(card);
    return result?.data?.message_id || approval.id;
  }

  async sendProgress(progress) {
    const card = this.buildProgressCard(progress);
    await this.sendMessage(card);
  }

  async sendAlert(alert) {
    const card = this.buildAlertCard(alert);
    await this.sendMessage(card);
  }

  async getApprovalResult(approvalId) {
    // 飞书审批结果需要通过回调获取，此处返回待定状态
    return { approved: false, answer: '等待中', responder: 'feishu' };
  }
}

// 自动注册
registerAdapter('feishu', new FeishuAdapter());

export default FeishuAdapter;
