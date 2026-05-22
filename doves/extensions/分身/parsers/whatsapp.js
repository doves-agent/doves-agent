/**
 * WhatsApp聊天记录解析器
 * 解析WhatsApp导出的聊天记录格式（.txt）
 *
 * 支持的格式：
 * - WhatsApp导出： "01/15/2024, 2:30 PM - 张三: 消息内容"
 * - 多行消息（续行无时间戳前缀）
 */
export const parserInfo = {
  name: 'whatsapp',
  version: '1.0.0',
  description: 'WhatsApp聊天记录解析器',
  supportedFormats: ['txt'],
};

/**
 * 解析WhatsApp TXT格式聊天记录
 * 格式: "1/15/24, 2:30 PM - 张三: 消息内容"
 * 或:   "01/15/2024, 14:30 - 张三: 消息内容"
 * @param {string} content - 文件内容
 * @returns {Array<{date: string, time: string, sender: string, content: string}>}
 */
export function parseTxt(content) {
  const lines = content.split('\n');
  const messages = [];
  
  // WhatsApp 消息行正则：支持多种日期格式
  const msgRegex = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}(?:\s*[APap][Mm])?)\s*[-–]\s*(.*?)[:：]\s*(.*)$/;
  
  let currentMessage = null;

  for (const line of lines) {
    const match = line.match(msgRegex);
    
    if (match) {
      // 保存上一条多行消息
      if (currentMessage) {
        messages.push(currentMessage);
      }
      
      // 新消息
      currentMessage = {
        date: match[1],
        time: match[2].trim(),
        sender: match[3].trim(),
        content: match[4].trim(),
        platform: 'whatsapp',
      };
    } else if (currentMessage && line.trim()) {
      // 续行：多行消息的后续行
      currentMessage.content += '\n' + line.trim();
    }
  }
  
  // 保存最后一条
  if (currentMessage) {
    messages.push(currentMessage);
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

  switch (format) {
    case 'txt':
    case 'auto':
    default:
      messages = parseTxt(content);
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
    platform: 'whatsapp',
  };

  return { messages, stats };
}

export default { parserInfo, parseTxt, parse };
