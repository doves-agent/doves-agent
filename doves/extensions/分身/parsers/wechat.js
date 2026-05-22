/**
 * 微信聊天记录解析器
 * 解析微信导出的聊天记录格式（.txt/.html/.db）
 *
 * 支持的格式：
 * - TXT导出： "2024-01-15 14:30 张三: 消息内容"
 * - HTML导出：从微信PC版导出的HTML聊天记录
 * - 数据库：微信SQLite数据库（需解密）
 */
export const parserInfo = {
  name: 'wechat',
  version: '1.0.0',
  description: '微信聊天记录解析器',
  supportedFormats: ['txt', 'html', 'db'],
};

/**
 * 解析微信TXT格式聊天记录
 * @param {string} content - 文件内容
 * @returns {Array<{date: string, time: string, sender: string, content: string}>}
 */
export function parseTxt(content) {
  const lines = content.split('\n').filter(Boolean);
  const messages = [];
  // 微信TXT格式: "2024-01-15 14:30:00 张三(微信号): 消息内容"
  const msgRegex = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*?)(?:\s*\(.*?\))?[:：]\s*(.*)$/;

  for (const line of lines) {
    const match = line.match(msgRegex);
    if (match) {
      messages.push({
        date: match[1],
        time: match[2],
        sender: match[3].trim(),
        content: match[4].trim(),
        platform: 'wechat',
      });
    }
  }

  return messages;
}

/**
 * 解析微信HTML格式聊天记录
 * @param {string} html - HTML内容
 * @returns {Array<{date: string, time: string, sender: string, content: string}>}
 */
export function parseHtml(html) {
  const messages = [];
  // 从HTML中提取聊天消息
  const msgBlocks = html.match(/<div class="message"[^>]*>[\s\S]*?<\/div>\s*<\/div>/g) || [];

  for (const block of msgBlocks) {
    const senderMatch = block.match(/<span class="sender"[^>]*>(.*?)<\/span>/);
    const contentMatch = block.match(/<p class="content"[^>]*>(.*?)<\/p>/);
    const timeMatch = block.match(/<span class="time"[^>]*>(.*?)<\/span>/);

    if (senderMatch && contentMatch) {
      messages.push({
        date: '',
        time: timeMatch ? timeMatch[1].trim() : '',
        sender: senderMatch[1].trim(),
        content: contentMatch[1].trim(),
        platform: 'wechat',
      });
    }
  }

  return messages;
}

/**
 * 自动检测并解析
 * @param {string} content - 文件内容
 * @param {string} format - 指定格式（auto=自动检测）
 * @returns {{ messages: Array, stats: Object }}
 */
export function parse(content, format = 'auto') {
  let messages = [];

  if (format === 'auto') {
    // 自动检测格式
    if (content.trim().startsWith('<') || content.includes('<div class="message"')) {
      format = 'html';
    } else if (content.includes('\n') && /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(content)) {
      format = 'txt';
    } else {
      format = 'txt';
    }
  }

  switch (format) {
    case 'html':
      messages = parseHtml(content);
      break;
    case 'txt':
    default:
      messages = parseTxt(content);
      break;
  }

  // 统计信息
  const senders = [...new Set(messages.map(m => m.sender))];
  const stats = {
    totalMessages: messages.length,
    uniqueSenders: senders.length,
    senders,
    dateRange: messages.length > 0
      ? { start: messages[0].date || messages[0].time, end: messages[messages.length - 1].date || messages[messages.length - 1].time }
      : null,
    platform: 'wechat',
  };

  return { messages, stats };
}

export default { parserInfo, parseTxt, parseHtml, parse };
