/**
 * 聊天记录解析器索引
 * 各平台聊天记录解析器统一出口
 */
import * as wechat from './wechat.js';
import * as whatsapp from './whatsapp.js';
import * as telegram from './telegram.js';

export const parsers = {
  wechat,
  whatsapp,
  telegram,
};

/**
 * 自动检测格式并解析聊天记录
 * @param {string} content - 文件内容
 * @param {string} format - 格式（auto=自动检测平台和格式）
 * @returns {{ messages: Array, stats: Object }}
 */
export function parse(content, format = 'auto') {
  // 自动检测平台
  let platform = 'wechat'; // 默认使用微信解析器
  
  if (format !== 'auto') {
    if (format.startsWith('whatsapp')) platform = 'whatsapp';
    else if (format.startsWith('telegram')) platform = 'telegram';
    else if (format.startsWith('wechat')) platform = 'wechat';
  } else {
    // 自动检测：通过内容特征判断平台
    if (content.includes('end-to-end encrypted') || /\d{1,2}\/\d{1,2}\/\d{2,4},/.test(content.substring(0, 500))) {
      platform = 'whatsapp';
    } else if (content.trim().startsWith('{') && content.includes('"messages"')) {
      platform = 'telegram';
    }
    // 默认微信
  }

  const parser = parsers[platform];
  if (!parser) {
    throw new Error(`不支持的聊天记录格式: ${format} (平台: ${platform})`);
  }

  return parser.parse(content, format);
}

export default { parsers, parse };
