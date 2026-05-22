/**
 * IM消息格式标准模块
 * 
 * 定义白鸽系统与IM平台交互的标准消息格式
 * 支持多种输出格式：纯文本、Markdown、结构化JSON
 */

import { toLocalISOString } from './时间工具.js';

// IM消息类型枚举
export const IM消息类型 = {
  审批请求: 'approval_request',
  进度通知: 'progress_notify',
  结果确认: 'result_confirm',
  异常告警: 'alert'
};

// 风险等级枚举
export const 风险等级 = {
  低: 'low',
  中: 'medium',
  高: 'high',
  严重: 'critical'
};

// 告警级别枚举
export const 告警级别 = {
  信息: 'info',
  警告: 'warning',
  严重: 'critical'
};

/**
 * 审批请求消息
 * 用于向用户发送任务审批请求
 */
export class 审批请求消息 {
  constructor({ 任务ID, 子任务列表 = [], 预计消耗 = '', 风险等级 = 'low', 超时秒数 = 300 }) {
    this.类型 = IM消息类型.审批请求;
    this.任务ID = 任务ID;
    this.子任务列表 = 子任务列表;
    this.预计消耗 = 预计消耗;
    this.风险等级 = 风险等级;
    this.超时秒数 = 超时秒数;
    this.创建时间 = toLocalISOString();
  }

  /**
   * 生成纯文本格式
   * 适用于短信、基础IM等不支持格式的场景
   */
  toText() {
    const 子任务文本 = this.子任务列表.map((子任务, 索引) => 
      `${索引 + 1}. ${子任务.名称 || 子任务} ${子任务.描述 ? '(' + 子任务.描述 + ')' : ''}`
    ).join('\n');

    return [
      `【白鸽系统】审批请求`,
      `任务ID: ${this.任务ID}`,
      ``,
      `子任务列表:`,
      子任务文本 || '无',
      ``,
      `预计消耗: ${this.预计消耗 || '未估算'}`,
      `风险等级: ${this._风险等级文本()}`,
      `超时时间: ${this.超时秒数}秒`,
      ``,
      `回复"确认"通过，回复"拒绝"取消`
    ].join('\n');
  }

  /**
   * 生成Markdown格式
   * 适用于钉钉、飞书、企业微信等支持Markdown的IM
   */
  toMarkdown() {
    const 风险颜色 = {
      low: '🟢',
      medium: '🟡',
      high: '🔴',
      critical: '⚫'
    };

    const 子任务表格 = this.子任务列表.length > 0 
      ? this.子任务列表.map((子任务, 索引) => 
          `| ${索引 + 1} | ${子任务.名称 || 子任务} | ${子任务.描述 || '-'} |`
        ).join('\n')
      : '| - | 无 | - |';

    return [
      `## 🕊️ 白鸽系统 - 审批请求`,
      ``,
      `**任务ID:** \`${this.任务ID}\``,
      ``,
      `### 子任务列表`,
      `| 序号 | 名称 | 描述 |`,
      `|------|------|------|`,
      子任务表格,
      ``,
      `### 执行信息`,
      `- **预计消耗:** ${this.预计消耗 || '未估算'}`,
      `- **风险等级:** ${风险颜色[this.风险等级] || '⚪'} ${this._风险等级文本()}`,
      `- **超时时间:** ${this.超时秒数}秒`,
      ``,
      `---`,
      `💡 点击下方按钮或回复"确认"/"拒绝"进行审批`
    ].join('\n');
  }

  /**
   * 生成结构化JSON格式
   * 适用于程序化处理和存储
   */
  toJSON() {
    return {
      type: this.类型,
      taskId: this.任务ID,
      subtasks: this.子任务列表.map(子任务 => ({
        name: 子任务.名称 || 子任务,
        description: 子任务.描述 || null
      })),
      estimatedCost: this.预计消耗,
      riskLevel: this.风险等级,
      timeoutSeconds: this.超时秒数,
      createdAt: this.创建时间
    };
  }

  _风险等级文本() {
    const 映射 = {
      low: '低',
      medium: '中',
      high: '高',
      critical: '严重'
    };
    return 映射[this.风险等级] || this.风险等级;
  }
}

/**
 * 进度通知消息
 * 用于向用户报告任务执行进度
 */
export class 进度通知消息 {
  constructor({ 任务ID, 当前步骤 = '', 完成百分比 = 0, 预计剩余时间 = '' }) {
    this.类型 = IM消息类型.进度通知;
    this.任务ID = 任务ID;
    this.当前步骤 = 当前步骤;
    this.完成百分比 = Math.min(100, Math.max(0, 完成百分比));
    this.预计剩余时间 = 预计剩余时间;
    this.通知时间 = toLocalISOString();
  }

  /**
   * 生成纯文本格式
   */
  toText() {
    const 进度条 = this._生成进度条();
    
    return [
      `【白鸽系统】进度更新`,
      `任务ID: ${this.任务ID}`,
      ``,
      `当前步骤: ${this.当前步骤 || '执行中'}`,
      `完成进度: ${进度条} ${this.完成百分比}%`,
      this.预计剩余时间 ? `预计剩余: ${this.预计剩余时间}` : ''
    ].filter(Boolean).join('\n');
  }

  /**
   * 生成Markdown格式
   */
  toMarkdown() {
    const 进度条 = this._生成进度条();
    const 进度表情 = this._进度表情();

    return [
      `## ${进度表情} 白鸽系统 - 进度更新`,
      ``,
      `**任务ID:** \`${this.任务ID}\``,
      ``,
      `### 当前状态`,
      `- **当前步骤:** ${this.当前步骤 || '执行中'}`,
      `- **完成进度:** ${进度条} **${this.完成百分比}%**`,
      this.预计剩余时间 ? `- **预计剩余:** ${this.预计剩余时间}` : '',
      ``,
      `---`,
      `⏱️ 更新时间: ${new Date().toLocaleString('zh-CN')}`
    ].filter(Boolean).join('\n');
  }

  /**
   * 生成结构化JSON格式
   */
  toJSON() {
    return {
      type: this.类型,
      taskId: this.任务ID,
      currentStep: this.当前步骤,
      progressPercent: this.完成百分比,
      estimatedRemaining: this.预计剩余时间,
      notifiedAt: this.通知时间
    };
  }

  _生成进度条(长度 = 20) {
    const 填充数 = Math.round((this.完成百分比 / 100) * 长度);
    const 填充 = '█'.repeat(填充数);
    const 空白 = '░'.repeat(长度 - 填充数);
    return `${填充}${空白}`;
  }

  _进度表情() {
    if (this.完成百分比 >= 100) return '✅';
    if (this.完成百分比 >= 75) return '🚀';
    if (this.完成百分比 >= 50) return '⚡';
    if (this.完成百分比 >= 25) return '⏳';
    return '📋';
  }
}

/**
 * 结果确认消息
 * 用于向用户报告任务执行结果
 */
export class 结果确认消息 {
  constructor({ 
    任务ID, 
    执行摘要 = '', 
    关键输出 = [], 
    执行时长 = '', 
    子任务统计 = { 总数: 0, 成功: 0, 失败: 0 }
  }) {
    this.类型 = IM消息类型.结果确认;
    this.任务ID = 任务ID;
    this.执行摘要 = 执行摘要;
    this.关键输出 = 关键输出;
    this.执行时长 = 执行时长;
    this.子任务统计 = 子任务统计;
    this.完成时间 = toLocalISOString();
  }

  /**
   * 生成纯文本格式
   */
  toText() {
    const 输出列表 = this.关键输出.map(输出 => 
      `- ${输出.标签 || '输出'}: ${输出.内容 || 输出}`
    ).join('\n');

    const 是否成功 = (this.子任务统计.失败 || 0) === 0;
    const 状态文本 = 是否成功 ? '✅ 执行成功' : '⚠️ 部分失败';

    return [
      `【白鸽系统】任务完成`,
      `任务ID: ${this.任务ID}`,
      ``,
      `执行状态: ${状态文本}`,
      ``,
      `执行摘要:`,
      this.执行摘要 || '任务已执行完毕',
      ``,
      `关键输出:`,
      输出列表 || '无',
      ``,
      `执行时长: ${this.执行时长 || '未知'}`,
      `子任务统计: 共${this.子任务统计.总数 || 0}个 | 成功${this.子任务统计.成功 || 0}个 | 失败${this.子任务统计.失败 || 0}个`
    ].join('\n');
  }

  /**
   * 生成Markdown格式
   */
  toMarkdown() {
    const 是否成功 = (this.子任务统计.失败 || 0) === 0;
    const 状态表情 = 是否成功 ? '✅' : '⚠️';
    const 状态颜色 = 是否成功 ? '🟢' : '🟡';

    const 输出列表 = this.关键输出.length > 0
      ? this.关键输出.map(输出 => {
          const 标签 = 输出.标签 || '输出';
          const 内容 = 输出.内容 || 输出;
          const 链接 = 输出.链接 ? ` [查看](${输出.链接})` : '';
          return `- **${标签}:** ${内容}${链接}`;
        }).join('\n')
      : '- 无关键输出';

    return [
      `## ${状态表情} 白鸽系统 - 任务完成`,
      ``,
      `**任务ID:** \`${this.任务ID}\``,
      ``,
      `### 执行状态`,
      `${状态颜色} **${是否成功 ? '执行成功' : '部分失败'}**`,
      ``,
      `### 执行摘要`,
      `> ${this.执行摘要 || '任务已执行完毕'}`,
      ``,
      `### 关键输出`,
      输出列表,
      ``,
      `### 统计信息`,
      `| 指标 | 数值 |`,
      `|------|------|`,
      `| 执行时长 | ${this.执行时长 || '未知'} |`,
      `| 子任务总数 | ${this.子任务统计.总数 || 0} |`,
      `| 成功数 | ${this.子任务统计.成功 || 0} |`,
      `| 失败数 | ${this.子任务统计.失败 || 0} |`,
      ``,
      `---`,
      `🕊️ 白鸽系统 | 完成时间: ${new Date().toLocaleString('zh-CN')}`
    ].join('\n');
  }

  /**
   * 生成结构化JSON格式
   */
  toJSON() {
    return {
      type: this.类型,
      taskId: this.任务ID,
      summary: this.执行摘要,
      keyOutputs: this.关键输出.map(输出 => ({
        label: 输出.标签 || '输出',
        content: 输出.内容 || 输出,
        link: 输出.链接 || null
      })),
      executionTime: this.执行时长,
      subtaskStats: {
        total: this.子任务统计.总数 || 0,
        success: this.子任务统计.成功 || 0,
        failed: this.子任务统计.失败 || 0
      },
      completedAt: this.完成时间
    };
  }
}

/**
 * 异常告警消息
 * 用于向用户报告执行过程中的异常和错误
 */
export class 异常告警消息 {
  constructor({ 任务ID, 失败详情 = '', 自愈方案 = '', 级别 = 'warning' }) {
    this.类型 = IM消息类型.异常告警;
    this.任务ID = 任务ID;
    this.失败详情 = 失败详情;
    this.自愈方案 = 自愈方案;
    this.级别 = 级别;
    this.告警时间 = toLocalISOString();
  }

  /**
   * 生成纯文本格式
   */
  toText() {
    const 级别文本 = this._级别文本();
    
    return [
      `【白鸽系统】${级别文本}`,
      `任务ID: ${this.任务ID}`,
      `告警级别: ${this.级别.toUpperCase()}`,
      ``,
      `失败详情:`,
      this.失败详情 || '未知错误',
      ``,
      this.自愈方案 ? `建议方案:\n${this.自愈方案}` : ''
    ].filter(Boolean).join('\n');
  }

  /**
   * 生成Markdown格式
   */
  toMarkdown() {
    const 级别配置 = {
      info: { emoji: 'ℹ️', color: '🔵', title: '信息提示' },
      warning: { emoji: '⚠️', color: '🟡', title: '警告' },
      critical: { emoji: '🚨', color: '🔴', title: '严重错误' }
    };

    const 配置 = 级别配置[this.级别] || 级别配置.warning;

    return [
      `## ${配置.emoji} 白鸽系统 - ${配置.title}`,
      ``,
      `**任务ID:** \`${this.任务ID}\``,
      ``,
      `### 告警信息`,
      `${配置.color} **级别:** ${this.级别.toUpperCase()}`,
      ``,
      `### 失败详情`,
      `> ${this.失败详情 || '未知错误'}`,
      ``,
      this.自愈方案 ? [
        `### 建议方案`,
        `${this.自愈方案}`,
        ``
      ].join('\n') : '',
      `---`,
      `⏰ 告警时间: ${new Date().toLocaleString('zh-CN')}`
    ].filter(Boolean).join('\n');
  }

  /**
   * 生成结构化JSON格式
   */
  toJSON() {
    return {
      type: this.类型,
      taskId: this.任务ID,
      failureDetails: this.失败详情,
      recoveryPlan: this.自愈方案,
      level: this.级别,
      alertedAt: this.告警时间
    };
  }

  _级别文本() {
    const 映射 = {
      info: '信息提示',
      warning: '警告',
      critical: '严重错误'
    };
    return 映射[this.级别] || '警告';
  }
}

// 默认导出
export default {
  IM消息类型,
  风险等级,
  告警级别,
  审批请求消息,
  进度通知消息,
  结果确认消息,
  异常告警消息
};
