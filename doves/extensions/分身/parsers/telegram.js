/**
 * Telegram聊天记录解析器
 * 解析Telegram导出的聊天记录格式（JSON/HTML）
 *
 * 支持的格式：
 * - JSON导出：Telegram Desktop 导出的 result.json
 * - HTML导出：Telegram Web 导出的 messages.html
 */
export const parserInfo = {
  name: 'telegram',
  version: '1.0.0',
  description: 'Telegram聊天记录解析器',
  supportedFormats: ['json', 'html'],
};

/**
 * 解析Telegram JSON格式（result.json）
 * @param {string} content - JSON字符串
 * @returns {Array<{date: string, time: string, sender: string, content: string}>}
 */
export function parseJson(content) {
  const messages = [];
  
  try {
    const data = typeof content === 'string' ? JSON.parse(content) : content;
    const msgList = data.messages || [];

    for (const msg of msgList) {
      if (msg.type !== 'message') continue;
      
      // 提取发送者
      let sender = msg.from || msg.from_id || 'Unknown';
      if (typeof sender === 'object') {
        sender = sender.display_name || sender.first_name || sender.username || 'Unknown';
      }
      
      // 提取文本内容（支持多种text格式）
      let text = '';
      if (typeof msg.text === 'string') {
        text = msg.text;
      } else if (Array.isArray(msg.text_entities)) {
        text = msg.text_entities
          .filter(e => typeof e === 'string')
          .join('') || msg.text || '';
      } else if (msg.text) {
        text = String(msg.text);
      }
      
      if (!text.trim()) continue;
      
      // 解析时间戳
      const timestamp = msg.date_unixtime 
        ? new Date(msg.date_unixtime * 1000)
        : (msg.date ? new Date(msg.date) : new Date());
      
      messages.push({
        date: timestamp.toISOString().split('T')[0],
        time: timestamp.toTimeString().split(' ')[0],
        sender,
        content: text.trim(),
        platform: 'telegram',
      });
    }
  } catch (e) {
    // JSON解析失败，返回空
  }
  
  return messages;
}

/**
 * 解析Telegram HTML格式
 * @param {string} html - HTML内容
 * @returns {Array}
 */
export function parseHtml(html) {
  const messages = [];
  
  // Telegram HTML 导出通常包含 <div class="message"> 结构
  const msgRegex = /<div class="message[^"]*"[^>]*>[\s\S]*?<div class="from_name[^"]*"[^>]*>(.*?)<\/div>[\s\S]*?<div class="text[^"]*"[^>]*>(.*?)<\/div>[\s\S]*?<div class="date[^"]*"[^>]*>(.*?)<\/div>/gi;
  
  let match;
  while ((match = msgRegex.exec(html)) !== null) {
    const sender = match[1].trim();
    const content = match[2].replace(/<[^>]+>/g, '').trim();
    const dateStr = match[3].trim();
    
    if (content) {
      messages.push({
        date: dateStr,
        time: '',
        sender,
        content,
        platform: 'telegram',
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
    if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
      format = 'json';
    } else if (content.includes('<div class="message"')) {
      format = 'html';
    } else {
      format = 'json'; // 默认尝试JSON
    }
  }

  switch (format) {
    case 'json':
      messages = parseJson(content);
      break;
    case 'html':
      messages = parseHtml(content);
      break;
    default:
      messages = parseJson(content);
      break;
  }

  const senders = [...new Set(messages.map(m => m.sender))];
  const stats = {
    totalMessages: messages.length,
    uniqueSenders: senders.length,
    senders,
    dateRange: messages.length > 0
      ? { start: messages[0].date, end: messages[messages.length - 1].date }
      : null,
    platform: 'telegram',
  };

  return { messages, stats };
}

export default { parserInfo, parseJson, parseHtml, parse };
