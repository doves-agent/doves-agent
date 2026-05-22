/**
 * 邮箱工具 - 邮箱代理扩展包
 *
 * POP3收取 + SMTP发送 + LLM分类/摘要
 *
 * 依赖: npm install nodemailer
 * POP3通过原生Socket实现（无外部依赖，KISS原则）
 */
import net from 'net';
import tls from 'tls';
import { Buffer } from 'buffer';
import nodemailer from 'nodemailer';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('邮箱工具', { 前缀: '[邮箱工具]', 级别: 'debug' });

import { extTools, extToolSafetyLevels, extToolCategories, extToolAbilityMap, text, error } from './_邮箱工具-定义.js';

// ==================== POP3客户端 ====================

class POP3Client {
  constructor(host, port = 995, useSSL = true, username, password) {
    this.host = host;
    this.port = port;
    this.useSSL = useSSL;
    this.username = username;
    this.password = password;
    this.socket = null;
    this.buffer = '';
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const connectMethod = this.useSSL ? tls.connect : net.connect;
      this.socket = connectMethod({ host: this.host, port: this.port }, async () => {
        try {
          const banner = await this._readResponse();
          if (!banner.startsWith('+OK')) throw new Error(`POP3连接失败: ${banner}`);

          await this._sendCommand(`USER ${this.username}`);
          await this._sendCommand(`PASS ${this.password}`);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      this.socket.on('data', (data) => { this.buffer += data.toString(); });
      this.socket.on('error', reject);
      setTimeout(() => reject(new Error('POP3连接超时')), 10000);
    });
  }

  async _readResponse() {
    await new Promise(resolve => setTimeout(resolve, 300));
    const resp = this.buffer;
    this.buffer = '';
    return resp.trim();
  }

  async _sendCommand(cmd) {
    return new Promise((resolve, reject) => {
      this.socket.write(cmd + '\r\n');
      setTimeout(async () => {
        try {
          const resp = await this._readResponse();
          if (!resp.startsWith('+OK')) reject(new Error(`POP3命令失败: ${cmd} → ${resp}`));
          else resolve(resp);
        } catch (e) { reject(e); }
      }, 500);
    });
  }

  async list() {
    await this._sendCommand('STAT');
    await this._sendCommand('LIST');
    const listResp = await this._readResponse();
    const messages = [];
    const lines = listResp.split('\n');
    for (const line of lines) {
      const match = line.match(/^(\d+)\s+(\d+)$/);
      if (match) messages.push({ id: parseInt(match[1]), size: parseInt(match[2]) });
    }
    return messages;
  }

  async retrieve(msgId) {
    this.socket.write(`RETR ${msgId}\r\n`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const raw = this.buffer;
    this.buffer = '';
    return raw;
  }

  async quit() {
    try { await this._sendCommand('QUIT'); } catch (e) { logger.debug(`QUIT命令发送失败: ${e.message}`); }
    this.socket?.destroy();
  }
}

// ==================== 邮件解析（简易） ====================

function parseEmail(raw) {
  const result = {
    headers: {},
    body: '',
    attachments: [],
    from: '',
    to: '',
    cc: '',
    subject: '',
    date: '',
  };

  const headerEnd = raw.indexOf('\r\n\r\n');
  if (headerEnd === -1) return result;

  const headerSection = raw.substring(0, headerEnd);
  result.body = raw.substring(headerEnd + 4).trim();

  // 解析关键头
  for (const line of headerSection.split('\r\n')) {
    if (line.startsWith('From: ')) result.from = line.replace('From: ', '').trim();
    else if (line.startsWith('To: ')) result.to = line.replace('To: ', '').trim();
    else if (line.startsWith('Cc: ')) result.cc = line.replace('Cc: ', '').trim();
    else if (line.startsWith('Subject: ')) result.subject = decodeMIME(line.replace('Subject: ', '').trim());
    else if (line.startsWith('Date: ')) result.date = line.replace('Date: ', '').trim();
    else if (line.startsWith('Content-Type:') && line.includes('multipart')) {
      result.hasAttachments = true;
    }
  }

  return result;
}

function decodeMIME(encoded) {
  // 简易 MIME 解码（支持 =?UTF-8?B?...?= 和 =?UTF-8?Q?...?=）
  return encoded.replace(/=\?([^?]+)\?([^?])\?([^?]*)\?=/g, (_, charset, encoding, text) => {
    try {
      if (encoding === 'B') return Buffer.from(text, 'base64').toString('utf-8');
      if (encoding === 'Q') return text.replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    } catch { return text; }
    return text;
  });
}

// ==================== SMTP发送 ====================

async function sendViaSMTP(config, mail) {
  try {
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort || 465,
      secure: config.useSSL !== false,
      auth: {
        user: config.username,
        pass: config.password,
      },
    });

    const info = await transporter.sendMail({
      from: `"${config.email}" <${config.email}>`,
      to: mail.to,
      cc: mail.cc,
      bcc: mail.bcc,
      subject: mail.subject,
      text: mail.isHtml ? undefined : mail.body,
      html: mail.isHtml ? mail.body : undefined,
      attachments: mail.attachments,
    });

    return { messageId: info.messageId, accepted: info.accepted, response: info.response };
  } catch (e) {
    throw new Error(`SMTP发送失败: ${e.message}`);
  }
}

// ==================== 工具调用处理器 ====================

// 内存配置缓存（生产中应使用加密持久化存储）
const configCache = new Map();

export async function handleExtTool(toolName, args) {
  switch (toolName) {
    // ===== 配置管理 =====
    case 'email_config': {
      if (args.action === 'list') {
        const configs = Array.from(configCache.entries()).map(([id, c]) => ({
          id, email: c.email, pop3Host: c.pop3Host, smtpHost: c.smtpHost
        }));
        return text({ configs: configs.length > 0 ? configs : '暂无邮箱配置，请使用 email_config { action: "save" } 添加' });
      }
      if (args.action === 'save') {
        if (!args.config?.email) return error('邮箱地址不能为空');
        const id = args.configId || `email_${Date.now()}`;
        configCache.set(id, args.config);
        return text({ success: true, configId: id, message: `邮箱配置 ${id} 已保存（密码仅存储在内存中）` });
      }
      if (args.action === 'delete') {
        if (!args.configId) return error('configId不能为空');
        configCache.delete(args.configId);
        return text({ success: true, message: `配置 ${args.configId} 已删除` });
      }
      if (args.action === 'test') {
        if (!args.configId) return error('configId不能为空');
        const config = configCache.get(args.configId);
        if (!config) return error(`配置 ${args.configId} 不存在`);
        try {
          const pop3 = new POP3Client(config.pop3Host, config.pop3Port, config.useSSL, config.username, config.password);
          await pop3.connect();
          const msgs = await pop3.list();
          await pop3.quit();
          return text({ success: true, message: `连接成功！收件箱共有 ${msgs.length} 封邮件` });
        } catch (e) {
          return error(`连接测试失败: ${e.message}`);
        }
      }
      return error(`不支持的操作: ${args.action}`);
    }

    // ===== 邮件列表 =====
    case 'email_list': {
      const config = configCache.get(args.configId);
      if (!config) return error('邮箱配置不存在，请先使用 email_config 保存配置');

      try {
        const pop3 = new POP3Client(config.pop3Host, config.pop3Port, config.useSSL, config.username, config.password);
        await pop3.connect();
        const allMsgs = await pop3.list();
        const maxCount = args.maxCount || 20;

        // 获取最近邮件的概要信息
        const emails = [];
        const recentMsgs = allMsgs.slice(-Math.min(maxCount, allMsgs.length));

        for (const msg of recentMsgs) {
          const raw = await pop3.retrieve(msg.id);
          const parsed = parseEmail(raw);
          emails.push({
            id: msg.id,
            from: parsed.from,
            subject: parsed.subject,
            date: parsed.date,
            snippet: parsed.body.substring(0, 100),
            size: msg.size,
          });
        }

        await pop3.quit();

        return text({
          total: allMsgs.length,
          returned: emails.length,
          emails,
          message: emails.length === 0 ? '收件箱为空' : `共 ${allMsgs.length} 封邮件，显示最近 ${emails.length} 封`
        });
      } catch (e) {
        return error(`获取邮件失败: ${e.message}`);
      }
    }

    // ===== 阅读邮件 =====
    case 'email_read': {
      const config = configCache.get(args.configId);
      if (!config) return error('邮箱配置不存在');
      if (!args.emailId) return error('emailId 不能为空');

      try {
        const pop3 = new POP3Client(config.pop3Host, config.pop3Port, config.useSSL, config.username, config.password);
        await pop3.connect();
        const raw = await pop3.retrieve(args.emailId);
        await pop3.quit();

        const parsed = parseEmail(raw);
        return text({
          id: args.emailId,
          from: parsed.from,
          to: parsed.to,
          cc: parsed.cc,
          subject: parsed.subject,
          date: parsed.date,
          body: args.includeBody !== false ? parsed.body : '(正文省略)',
          bodyPreview: parsed.body.substring(0, 500),
          bodyLength: parsed.body.length,
          hasAttachments: parsed.hasAttachments || false,
        });
      } catch (e) {
        return error(`阅读邮件失败: ${e.message}`);
      }
    }

    // ===== 搜索邮件 =====
    case 'email_search': {
      const config = configCache.get(args.configId);
      if (!config) return error('邮箱配置不存在');

      try {
        const pop3 = new POP3Client(config.pop3Host, config.pop3Port, config.useSSL, config.username, config.password);
        await pop3.connect();
        const allMsgs = await pop3.list();
        const maxCount = args.maxCount || 20;
        const results = [];

        for (const msg of allMsgs.slice(-50)) { // 搜索最近 50 封
          const raw = await pop3.retrieve(msg.id);
          const parsed = parseEmail(raw);

          // 筛选匹配
          if (args.keyword) {
            const kw = args.keyword.toLowerCase();
            if (!parsed.subject.toLowerCase().includes(kw) && !parsed.body.toLowerCase().includes(kw) && !parsed.from.toLowerCase().includes(kw)) continue;
          }
          if (args.from && !parsed.from.toLowerCase().includes(args.from.toLowerCase())) continue;

          results.push({
            id: msg.id,
            from: parsed.from,
            subject: parsed.subject,
            date: parsed.date,
            snippet: parsed.body.substring(0, 100),
          });

          if (results.length >= maxCount) break;
        }

        await pop3.quit();

        return text({
          total: results.length,
          emails: results,
          message: results.length === 0 ? '未找到匹配的邮件' : `找到 ${results.length} 封匹配邮件`
        });
      } catch (e) {
        return error(`搜索邮件失败: ${e.message}`);
      }
    }

    // ===== 发送邮件 =====
    case 'email_send': {
      const config = configCache.get(args.configId);
      if (!config) return error('邮箱配置不存在');
      if (!args.to || !args.subject || !args.body) return error('收件人、主题和正文不能为空');

      try {
        const result = await sendViaSMTP(config, {
          to: args.to, cc: args.cc, bcc: args.bcc,
          subject: args.subject, body: args.body,
          isHtml: args.isHtml, attachments: args.attachments,
        });
        return text({ success: true, ...result, message: `邮件已发送成功！MessageID: ${result.messageId}` });
      } catch (e) {
        return error(`发送失败: ${e.message}`);
      }
    }

    // ===== 回复邮件 =====
    case 'email_reply': {
      const config = configCache.get(args.configId);
      if (!config) return error('邮箱配置不存在');

      try {
        const pop3 = new POP3Client(config.pop3Host, config.pop3Port, config.useSSL, config.username, config.password);
        await pop3.connect();
        const raw = await pop3.retrieve(args.emailId);
        await pop3.quit();
        const original = parseEmail(raw);

        // 构造回复
        const replySubject = original.subject.startsWith('Re:') ? original.subject : `Re: ${original.subject}`;
        const replyBody = `${args.replyBody}\n\n--- 原始邮件 ---\nFrom: ${original.from}\nDate: ${original.date}\nSubject: ${original.subject}\n\n${original.body.substring(0, 1000)}`;

        const result = await sendViaSMTP(config, {
          to: original.from, subject: replySubject, body: replyBody,
        });

        return text({ success: true, subject: replySubject, ...result, message: `回复已发送！` });
      } catch (e) {
        return error(`回复失败: ${e.message}`);
      }
    }

    // ===== 转发邮件 =====
    case 'email_forward': {
      const config = configCache.get(args.configId);
      if (!config) return error('邮箱配置不存在');

      try {
        const pop3 = new POP3Client(config.pop3Host, config.pop3Port, config.useSSL, config.username, config.password);
        await pop3.connect();
        const raw = await pop3.retrieve(args.emailId);
        await pop3.quit();
        const original = parseEmail(raw);

        const forwardBody = `${args.additionalNote || ''}\n\n--- 转发邮件 ---\nFrom: ${original.from}\nDate: ${original.date}\nSubject: ${original.subject}\n\n${original.body.substring(0, 2000)}`;

        const result = await sendViaSMTP(config, {
          to: args.to, subject: `Fwd: ${original.subject}`, body: forwardBody,
        });

        return text({ success: true, ...result, message: `邮件已转发到 ${args.to}！` });
      } catch (e) {
        return error(`转发失败: ${e.message}`);
      }
    }

    // ===== 邮件分类（LLM元工具——实际分类由智能体完成） =====
    case 'email_classify': {
      const emails = args.emails || [];
      const categories = (args.customCategories || '重要,普通,垃圾,待办,通知,账单').split(',').map(c => c.trim());
      return text({
        emails: emails.map(e => ({ ...e, category: '待分类', categories })),
        hint: '请对以上邮件逐一进行分类，分类结果将用于后续处理',
        categories,
        totalCount: emails.length,
      });
    }

    // ===== 邮件摘要（LLM元工具——实际摘要由智能体生成） =====
    case 'email_summarize': {
      const emails = args.emails || [];
      const summaryType = args.summaryType || 'brief';
      return text({
        emails: emails.map(e => ({
          id: e.id, from: e.from, subject: e.subject,
          date: e.date, snippet: e.snippet || e.body?.substring(0, 200) || '',
        })),
        summaryType,
        hint: `请生成${summaryType === 'brief' ? '简短' : summaryType === 'detailed' ? '详细' : summaryType === 'action_items' ? '待办事项' : '完整'}邮件摘要`,
        totalCount: emails.length,
      });
    }

    // ===== 生成草稿 =====
    case 'email_draft': {
      const draft = {
        to: args.to,
        cc: args.cc,
        subject: args.subject,
        body: args.body,
        replyToEmailId: args.replyToEmailId,
        createdAt: new Date().toISOString(),
        status: '草稿',
      };
      // 草稿保存到内存（生产环境应持久化）
      return text({ draft, message: '草稿已生成，用户确认后即可发送。草稿内容如下：\n' + JSON.stringify(draft, null, 2) });
    }

    // ===== 保存附件 =====
    case 'email_attachment_save': {
      return text({ message: `保存附件功能需要邮件中提取附件数据。请先使用 email_read 查看附件信息，确认附件存在后执行。`, hint: '当前版本附件保存依赖第三方工具，建议结合截图分析操作' });
    }

    default:
      return error(`未知邮箱工具: ${toolName}`);
  }
}

// ==================== 工具处理器映射 ====================

const handleMap = {};
for (const tool of extTools) {
  handleMap[tool.name] = (args) => handleExtTool(tool.name, args);
}

export { extTools, extToolSafetyLevels, extToolCategories, extToolAbilityMap, handleMap };
