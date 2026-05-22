/**
 * 聊天记录导入技能 (chat_import)
 * 解析聊天记录 → 结构化 → 存入Git记忆
 */

import { parse } from '../../parsers/index.js';

import { 创建日志器 } from '@dove/common/日志管理器.js';
import { getDovesProxy } from '../../../../tools/存储接口.js';

const logger = 创建日志器('chat_import', { 前缀: '[chat_import]', 级别: 'debug', 显示调用位置: true });

/**
 * 从Git存储读取文件内容
 */
async function 读取存储文件(filePath, context) {
  const { 工具调用 } = context;
  if (工具调用?.读取文件) {
    return await 工具调用.读取文件(filePath);
  }
  try {
    const proxy = await getDovesProxy();
    const result = await proxy.fetch(`/api/git-storage/files/read?path=${encodeURIComponent(filePath)}`, { method: 'GET' });
    return result?.内容 || null;
  } catch (e) {
    logger.error('读取存储文件失败:', e.message);
  }
  return null;
}

/**
 * 将聊天记录存入Git记忆
 */
async function 存入Git记忆(消息列表, ownerName, context) {
  const { 工具调用, userId } = context;
  
  // 将消息组织成对话段落
  const 对话段落 = [];
  let 当前段落 = { messages: [], 参与者: new Set(), 时间范围: { start: null, end: null } };
  
  for (const msg of 消息列表) {
    // 按时间间隙分组（超过30分钟未说话算新段落）
    if (当前段落.messages.length > 0) {
      const lastTime = 当前段落.messages[当前段落.messages.length - 1].time;
      if (msg.time && lastTime) {
        const gap = Math.abs(new Date(`2000-01-01 ${msg.time}`) - new Date(`2000-01-01 ${lastTime}`));
        if (gap > 30 * 60 * 1000) {
          对话段落.push({ ...当前段落, 参与者: [...当前段落.参与者] });
          当前段落 = { messages: [], 参与者: new Set(), 时间范围: { start: null, end: null } };
        }
      }
    }
    
    当前段落.messages.push(msg);
    当前段落.参与者.add(msg.sender);
    if (!当前段落.时间范围.start || msg.time < 当前段落.时间范围.start) {
      当前段落.时间范围.start = msg.time;
    }
    if (!当前段落.时间范围.end || msg.time > 当前段落.时间范围.end) {
      当前段落.时间范围.end = msg.time;
    }
  }
  if (当前段落.messages.length > 0) {
    对话段落.push({ ...当前段落, 参与者: [...当前段落.参与者] });
  }

  // 通过 server memory API 存储
  const 存储结果 = [];
  for (const 段落 of 对话段落) {
    const 对话文本 = 段落.messages
      .map(m => `${m.sender}: ${m.content}`)
      .join('\n');
    
    const 记忆条目 = {
      类型: 'chat_segment',
      内容: 对话文本,
      元数据: {
        参与者: 段落.参与者,
        消息数: 段落.messages.length,
        时间范围: 段落.时间范围,
        平台: 段落.messages[0]?.platform || 'unknown',
        导入时间: new Date().toISOString(),
      },
    };

    try {
      if (工具调用?.创建记忆) {
        const result = await 工具调用.创建记忆(记忆条目);
        存储结果.push(result);
      } else {
        // fallback: 通过加密通道调用 memory API
        const proxy = await getDovesProxy();
        const result = await proxy.fetch('/api/memory', { method: 'POST', body: 记忆条目 });
        存储结果.push(result);
      }
    } catch (e) {
      logger.error(`存储记忆失败: ${e.message}`);
    }
  }

  return 存储结果;
}

/**
 * 执行聊天记录导入
 */
async function execute(args, context) {
  const { format = 'auto', filePath, content, ownerName, contactName, timeRange } = args;
  const { userId } = context;

  try {
    // 1. 获取聊天记录内容
    let 聊天内容 = content;
    if (!聊天内容 && filePath) {
      聊天内容 = await 读取存储文件(filePath, context);
    }
    
    if (!聊天内容) {
      return {
        成功: false,
        错误: '未提供聊天记录内容。请通过 content 参数传入文本，或通过 filePath 指定Git存储中的文件路径',
      };
    }

    // 2. 解析聊天记录
    logger.info(`开始解析聊天记录 (format=${format}, owner=${ownerName})`);
    const { messages, stats } = parse(聊天内容, format);
    
    if (messages.length === 0) {
      return {
        成功: false,
        错误: '未能从内容中解析到任何聊天消息。请检查格式或内容是否正确',
        解析统计: stats,
      };
    }

    // 3. 筛选用户自己的消息（用于语气学习）、筛选对话对象
    let 目标消息 = messages;
    if (contactName) {
      目标消息 = messages.filter(m => m.sender === ownerName || m.sender === contactName);
    }

    // 4. 时间范围筛选
    if (timeRange?.start || timeRange?.end) {
      目标消息 = 目标消息.filter(m => {
        if (timeRange.start && m.date < timeRange.start) return false;
        if (timeRange.end && m.date > timeRange.end) return false;
        return true;
      });
    }

    // 5. 统计信息
    const 用户消息 = 目标消息.filter(m => m.sender === ownerName);
    const 对方消息 = 目标消息.filter(m => m.sender !== ownerName);
    
    // 6. 存入Git记忆
    logger.info(`存储 ${目标消息.length} 条消息到Git记忆...`);
    const 存储结果 = await 存入Git记忆(目标消息, ownerName, context);

    return {
      成功: true,
      数据: {
        总消息数: messages.length,
        筛选后消息数: 目标消息.length,
        用户消息数: 用户消息.length,
        对方消息数: 对方消息.length,
        参与者列表: stats.senders,
        时间范围: stats.dateRange,
        平台: stats.platform,
        存储段落数: 存储结果.length,
        摘要: `成功导入 ${目标消息.length} 条聊天消息（用户 ${ownerName} 发送了 ${用户消息.length} 条），已分为 ${存储结果.length} 个对话段落存入Git记忆`,
      },
    };
  } catch (e) {
    logger.error('聊天记录导入失败:', e.message);
    return {
      成功: false,
      错误: `聊天记录导入失败: ${e.message}`,
    };
  }
}

export default {
  name: 'chat_import',
  description: '聊天记录导入技能 — 解析微信/WhatsApp/Telegram导出格式的聊天记录，清洗并存入Git记忆，为语气学习准备数据源',
  abilities: ['分身', '聊天记录'],
  parameters: {
    type: 'object',
    properties: {
      format: { type: 'string', enum: ['wechat', 'whatsapp', 'telegram', 'auto'], description: '聊天记录来源平台，auto=自动检测' },
      filePath: { type: 'string', description: 'Git存储中聊天记录文件路径' },
      content: { type: 'string', description: '聊天记录文本（直接传入，与filePath二选一）' },
      ownerName: { type: 'string', description: '用户自己的名字（用于识别自己的消息）' },
      contactName: { type: 'string', description: '限定对话对象的名字（可选）' },
      timeRange: {
        type: 'object',
        properties: {
          start: { type: 'string' },
          end: { type: 'string' },
        },
      },
    },
    required: ['ownerName'],
  },
  execute,
};
