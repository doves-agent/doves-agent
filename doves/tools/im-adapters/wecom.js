/**
 * @file im-adapters/wecom
 * @description 企业微信(WeCom) IM适配器，支持审批消息/进度推送/告警通知
 */

import { IMAdapter, registerAdapter } from './base.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('企微适配器', { 前缀: '[企微适配器]', 级别: 'debug', 显示调用位置: true });

class WeComAdapter extends IMAdapter {
  constructor(config = {}) {
    super('wecom', config);
    this.corpId = config.corpId || '';
    this.corpSecret = config.corpSecret || '';
    this.agentId = config.agentId || '';
    this.chatId = config.chatId || '';       // 群聊ID
    this.toUser = config.toUser || '';       // 审批人(如 '@all' 或 'UserID1|UserID2')
    this.token = null;
    this.tokenExpireAt = 0;
  }

  async init() {
    if (!this.corpId || !this.corpSecret) {
      logger.warn('企微适配器缺少corpId/corpSecret配置，初始化跳过');
      return false;
    }
    try {
      await this.refreshToken();
      logger.info('企微适配器初始化成功');
      return true;
    } catch (e) {
      logger.error(`企微适配器初始化失败: ${e.message}`);
      return false;
    }
  }

  /**
   * 刷新访问令牌
   */
  async refreshToken() {
    const resp = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.corpId}&corpsecret=${this.corpSecret}`
    );
    const data = await resp.json();
    if (data.errcode !== 0) {
      throw new Error(`获取企微token失败: ${data.errmsg}`);
    }
    this.token = data.access_token;
    this.tokenExpireAt = Date.now() + (data.expires_in - 60) * 1000;
  }

  async ensureToken() {
    if (!this.token || Date.now() >= this.tokenExpireAt) {
      await this.refreshToken();
    }
  }

  /**
   * 企微API请求
   */
  async apiRequest(method, path, body = null) {
    await this.ensureToken();
    const url = `https://qyapi.weixin.qq.com${path}${path.includes('?') ? '&' : '?'}access_token=${this.token}`;
    const headers = { 'Content-Type': 'application/json' };
    const resp = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await resp.json();
    if (data.errcode !== 0 && data.errcode !== 60020) { // 60020=不存在的聊天会不报错
      throw new Error(`企微API错误: ${data.errmsg} (errcode=${data.errcode})`);
    }
    return data;
  }

  /**
   * 构建审批Markdown消息
   */
  buildApprovalMarkdown(approval) {
    const riskEmoji = {
      low: '🟢',
      medium: '🟡',
      high: '🔴',
      dangerous: '⛔',
    };
    const emoji = riskEmoji[approval.riskLevel] || '⚪';

    return `## ${emoji} 审批请求: ${approval.title}\n` +
      `> ${approval.description}\n\n` +
      `**风险级别:** ${approval.riskLevel}  \n` +
      `**操作类型:** ${approval.operationType || '-'}  \n` +
      `**审批ID:** ${approval.id}  \n` +
      `**超时:** ${approval.timeout || 300}秒  \n\n` +
      `---\n` +
      `请通过白鸽系统CLI或Web界面进行审批\n` +
      `> 来自白鸽系统自动审批请求`;
  }

  /**
   * 构建进度消息
   */
  buildProgressText(progress) {
    const statusEmoji = { running: '🔄', completed: '✅', failed: '❌', blocked: '🚫' };
    const emoji = statusEmoji[progress.status] || '📋';
    const bar = '█'.repeat(Math.floor((progress.percent || 0) / 10)) + '░'.repeat(10 - Math.floor((progress.percent || 0) / 10));

    return `${emoji} 任务进度: ${progress.taskName}\n` +
      `状态: ${progress.status} | 进度: [${bar}] ${progress.percent || 0}%\n` +
      `步骤: ${progress.currentStep || '-'}/${progress.totalSteps || '-'}\n` +
      `${progress.message || ''}`;
  }

  /**
   * 构建告警消息
   */
  buildAlertMarkdown(alert) {
    const levelEmoji = { info: 'ℹ️', warning: '⚠️', critical: '🚨' };
    const emoji = levelEmoji[alert.level] || '📢';

    return `## ${emoji} ${alert.title}\n` +
      `> ${alert.message}\n\n` +
      `**级别:** ${alert.level}  \n` +
      `**来源:** ${alert.source || '-'}  \n`;
  }

  /**
   * 发送应用消息
   */
  async sendAppMessage(msgType, content) {
    if (!this.agentId) {
      logger.warn('企微适配器缺少agentId，无法发送应用消息');
      return;
    }

    return await this.apiRequest('POST', '/cgi-bin/message/send', {
      touser: this.toUser || '@all',
      msgtype: msgType,
      agentid: parseInt(this.agentId),
      [msgType]: typeof content === 'string' ? { content } : content,
    });
  }

  /**
   * 发送群消息
   */
  async sendChatMessage(msgType, content) {
    if (!this.chatId) {
      // 无群聊ID则退回应用消息
      return await this.sendAppMessage(msgType, content);
    }

    return await this.apiRequest('POST', '/cgi-bin/appchat/send', {
      chatid: this.chatId,
      msgtype: msgType,
      [msgType]: typeof content === 'string' ? { content } : content,
    });
  }

  async sendApproval(approval) {
    const markdown = this.buildApprovalMarkdown(approval);
    await this.sendChatMessage('markdown', { content: markdown });
    return approval.id;
  }

  async sendProgress(progress) {
    const text = this.buildProgressText(progress);
    await this.sendChatMessage('text', { content: text });
  }

  async sendAlert(alert) {
    const markdown = this.buildAlertMarkdown(alert);
    await this.sendChatMessage('markdown', { content: markdown });
  }

  async getApprovalResult(approvalId) {
    // 企微审批结果需通过回调获取
    return { approved: false, answer: '等待中', responder: 'wecom' };
  }
}

// 自动注册
registerAdapter('wecom', new WeComAdapter());

export default WeComAdapter;
