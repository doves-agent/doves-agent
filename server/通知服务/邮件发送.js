import nodemailer from 'nodemailer';
import { getSystemConfig } from '../db.js';
import { logger } from '../core.js';

let _transporter = null;

function 获取邮件传输器() {
  if (_transporter) return _transporter;

  const config = getSystemConfig();
  const smtp = config.smtp || {};

  const host = smtp.host || process.env.SMTP_HOST;
  const port = smtp.port || process.env.SMTP_PORT || 465;
  const user = smtp.user || process.env.SMTP_USER;
  const pass = smtp.pass || process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP 配置不完整，需要 host/user/pass');
  }

  _transporter = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: Number(port) === 465,
    auth: { user, pass },
  });

  return _transporter;
}

export async function 发送邮件通知(收件地址, 标题, 内容) {
  const transporter = 获取邮件传输器();
  const config = getSystemConfig();
  const from = config.smtp?.from || process.env.SMTP_FROM || 'noreply@dove.ai';

  await transporter.sendMail({
    from: `白鸽系统 <${from}>`,
    to: 收件地址,
    subject: `[白鸽] ${标题}`,
    text: 内容,
  });

  logger.info(`[通知服务] 邮件已发送: ${收件地址} - ${标题}`);
}

export function 重置传输器() {
  _transporter = null;
}
