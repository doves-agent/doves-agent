/**
 * 自动回复技能 (auto_reply)
 * 收到消息 → 检索Git记忆中的相似对话上下文 → 按用户语气档案生成回复 → 确认/发送
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';
import { getDovesProxy } from '../../../../tools/存储接口.js';

const logger = 创建日志器('auto_reply', { 前缀: '[auto_reply]', 级别: 'debug', 显示调用位置: true });

/**
 * 检索语气档案
 */
async function 获取语气档案(context) {
  const { 工具调用, userId } = context;
  try {
    if (工具调用?.搜索记忆) {
      const results = await 工具调用.搜索记忆({ 类型: 'style_profile', 限制: 1 });
      if (results?.length > 0) {
        const profileData = results[0].内容 || results[0].content || '{}';
        return typeof profileData === 'string' ? JSON.parse(profileData) : profileData;
      }
    }
  } catch (e) {
    logger.error('获取语气档案失败:', e.message);
  }
  return null;
}

/**
 * 检索相似对话上下文
 */
async function 检索相似上下文(message, sender, limit, context) {
  const { 工具调用 } = context;
  try {
    if (工具调用?.搜索记忆) {
      const results = await 工具调用.搜索记忆({
        类型: 'chat_segment',
        关键词: message,
        限制: limit,
        ...(sender ? { 过滤: { 参与者: sender } } : {}),
      });
      return results || [];
    }
  } catch (e) {
    logger.error('检索上下文失败:', e.message);
  }
  return [];
}

/**
 * 构建回复生成 prompt
 */
function 构建回复Prompt(消息, 发送者, 上下文列表, 语气档案, 自定义指令) {
  const 档案信息 = 语气档案 ? `
【用户语气档案】
- 口头禅: ${(语气档案.口头禅 || []).slice(0, 5).join('、')}
- 句式偏好: ${(语气档案.句式偏好 || []).join('、')}
- 常用emoji: ${(语气档案.emoji偏好 || []).slice(0, 5).join(' ')}
- 语气强度: ${Math.round((语气档案.语气强度 || 0.5) * 100)}%
- 正式度: ${Math.round((语气档案.正式度 || 0.5) * 100)}%
- 回复速度: ${语气档案.回复速度 || '中等'}
` : '';

  const 上下文信息 = 上下文列表.length > 0 ? `
【相似对话上下文】（用户在这些类似场景中的回复参考）
${上下文列表.map((ctx, i) => {
    const content = ctx.内容 || ctx.content || '';
    return `--- 上下文 ${i + 1} ---
${content.substring(0, 500)}`;
  }).join('\n')}
` : '';

  return `模仿以下语气风格回复消息，只输出回复内容。

${档案信息}
${上下文信息}

【当前消息】
发送者: ${发送者 || '未知'}
消息内容: ${消息}

【回复规则】
1. 严格模仿用户的口头禅和句式偏好
2. 保持与语气档案一致的正式度和语气强度
3. 使用用户常用的emoji风格
4. 回复长度与回复速度偏好匹配（${(语气档案?.回复速度 || '中等')}偏好长度）
5. ${自定义指令 || '自然流畅地回复'}
6. 禁止加解释或前缀

按语气风格回复：`;
}

/**
 * 模拟 LLM 调用生成回复（实际由 dove 运行时 LLM 层处理）
 */
async function 生成LLM回复(prompt, context) {
  const { 工具调用 } = context;
  
  try {
    if (工具调用?.LLM调用) {
      const result = await 工具调用.LLM调用({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        maxTokens: 500,
      });
      return result?.content || result?.回复 || '';
    }
  } catch (e) {
    logger.error('LLM调用失败:', e.message);
  }
  
  // fallback: 返回提示
  return `[需要LLM生成回复: ${prompt.substring(0, 100)}...]`;
}

/**
 * 发送回复
 */
async function 发送回复(内容, platform, target, context) {
  const { 工具调用 } = context;
  
  try {
    if (工具调用?.发送消息) {
      return await 工具调用.发送消息({ 内容, 平台: platform, 目标: target });
    }
    // fallback: 通过加密通道调用 IM API
    const proxy = await getDovesProxy();
    return await proxy.fetch(`/api/im/${platform}/send`, { method: 'POST', body: { content: 内容, target } });
  } catch (e) {
    logger.error('发送回复失败:', e.message);
  }
  return null;
}

/**
 * 执行自动回复
 */
async function execute(args, context) {
  const {
    message,
    sender,
    contextCount = 5,
    styleIntensity,
    tone = 'auto',
    customInstruction,
    platform = 'auto',
    target,
    autoConfirm = false,
  } = args;

  try {
    if (!message) {
      return { 成功: false, 错误: '缺少消息内容' };
    }

    // 1. 获取语气档案
    logger.info(`生成分身回复: "${message.substring(0, 50)}..."`);
    const 语气档案 = await 获取语气档案(context);
    
    if (!语气档案) {
      return {
        成功: false,
        错误: '未找到语气档案。请先使用 chat_import 导入聊天记录，再用 style_learning 学习语气',
        建议: '按以下顺序操作：1) 导入聊天记录  2) 学习语气  3) 生成回复',
      };
    }

    // 2. 调整语气强度
    if (styleIntensity !== undefined) {
      语气档案.语气强度 = styleIntensity;
    }
    if (tone !== 'auto') {
      const toneMap = { casual: 0.3, formal: 0.8, humorous: 0.5, concise: 0.4 };
      语气档案.正式度 = toneMap[tone] ?? 语气档案.正式度;
    }

    // 3. 检索相似上下文
    const 上下文列表 = await 检索相似上下文(message, sender, contextCount, context);

    // 4. 构建 prompt 并生成回复
    const prompt = 构建回复Prompt(message, sender, 上下文列表, 语气档案, customInstruction);
    const 回复内容 = await 生成LLM回复(prompt, context);

    // 5. 构建结果
    const 结果 = {
      成功: true,
      数据: {
        回复内容,
        语气档案摘要: {
          口头禅: (语气档案.口头禅 || []).slice(0, 3),
          语气强度: 语气档案.语气强度,
          正式度: 语气档案.正式度,
        },
        上下文匹配数: 上下文列表.length,
        需要确认: !autoConfirm,
        发送状态: 'pending_confirmation',
      },
    };

    // 6. 如果自动确认，直接发送
    if (autoConfirm && platform !== 'auto') {
      const 发送结果 = await 发送回复(回复内容, platform, target, context);
      结果.数据.发送状态 = 发送结果 ? 'sent' : 'send_failed';
      结果.数据.发送结果 = 发送结果;
    }

    return 结果;
  } catch (e) {
    logger.error('生成回复失败:', e.message);
    return {
      成功: false,
      错误: `生成回复失败: ${e.message}`,
    };
  }
}

export default {
  name: 'auto_reply',
  description: '自动回复技能 — 根据收到的消息检索相似上下文，按用户语气档案生成分身回复，支持用户确认后发送或自动发送',
  abilities: ['分身', '自动回复', '人格模拟'],
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: '收到的消息内容' },
      sender: { type: 'string', description: '消息发送者（用于检索历史对话）' },
      contextCount: { type: 'number', description: '检索上下文条数（默认5）' },
      styleIntensity: { type: 'number', description: '语气强度 0~1' },
      tone: { type: 'string', enum: ['auto', 'casual', 'formal', 'humorous', 'concise'], description: '语气风格' },
      customInstruction: { type: 'string', description: '额外的回复指令' },
      platform: { type: 'string', enum: ['wechat', 'dingtalk', 'feishu', 'auto'], description: '发送平台' },
      target: { type: 'string', description: '发送目标' },
      autoConfirm: { type: 'boolean', description: '是否自动发送（需用户已启用）' },
    },
    required: ['message'],
  },
  execute,
};
