/**
 * 分身对话技能 (persona_chat)
 * 用户与自己的AI分身进行对话 — 分身按照用户的真实语气风格回答问题
 * 可用于：测试语气档案效果、娱乐互动、自我反思
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('persona_chat', { 前缀: '[persona_chat]', 级别: 'debug', 显示调用位置: true });

/**
 * 获取语气档案
 */
async function 获取语气档案(context) {
  const { 工具调用 } = context;
  try {
    if (工具调用?.搜索记忆) {
      const results = await 工具调用.搜索记忆({ 类型: 'style_profile', 限制: 1 });
      if (results?.length > 0) {
        const data = results[0].内容 || results[0].content || '{}';
        return typeof data === 'string' ? JSON.parse(data) : data;
      }
    }
  } catch (e) {
    logger.error('获取语气档案失败:', e.message);
  }
  return null;
}

/**
 * 检索相关记忆
 */
async function 检索相关记忆(query, limit, context) {
  const { 工具调用 } = context;
  try {
    if (工具调用?.搜索记忆) {
      return await 工具调用.搜索记忆({
        类型: 'chat_segment',
        关键词: query,
        限制: limit,
      });
    }
  } catch (e) {
    logger.error('检索记忆失败:', e.message);
  }
  return [];
}

/**
 * 构建分身对话系统提示词
 */
function 构建系统提示词(语气档案) {
  if (!语气档案) return null;

  return `模仿以下语气风格回复，用第一人称"我"。

语气特征:
- 口头禅: ${(语气档案.口头禅 || []).slice(0, 5).join('、') || '无明显口头禅'}
- 句式偏好: ${(语气档案.句式偏好 || []).join('、') || '自然'}
- 常用emoji: ${(语气档案.emoji偏好 || []).slice(0, 5).join(' ') || '无'}
- 语气强度: ${Math.round((语气档案.语气强度 || 0.5) * 100)}%（${语气档案.语气强度 > 0.7 ? '语气鲜明' : 语气档案.语气强度 > 0.3 ? '适中' : '偏平淡'}）
- 正式度: ${Math.round((语气档案.正式度 || 0.5) * 100)}%（${语气档案.正式度 > 0.7 ? '较正式' : 语气档案.正式度 > 0.3 ? '日常口语' : '非常随意'}）
- 回复风格: ${语气档案.回复速度 || '中等'}偏好的长度

背景:
- 常用话题: ${(语气档案.常用话题 || []).join('、') || '日常对话'}
- 基于 ${语气档案.训练数据量 || 0} 条消息训练

规则:
- 严格使用以上语气特征（含口头禅和emoji）
- 回复长度与回复风格匹配
- 熟悉话题放松，不熟悉话题保持分寸
- 不透露是AI或正在模拟`;
}

/**
 * 构建单轮回复 prompt
 */
function 构建回复Prompt(用户消息, 语气档案, 相关记忆) {
  const 记忆上下文 = 相关记忆.length > 0 ? `
【相关历史对话参考】
${相关记忆.map((m, i) => {
    const content = m.内容 || m.content || '';
    return `--- ${i + 1} ---
${content.substring(0, 300)}`;
  }).join('\n')}
` : '';

  return `${记忆上下文}
【当前对话】
对方说: ${用户消息}

按语气风格回复（只输出回复内容）：`;
}

/**
 * 调用LLM生成回复
 */
async function 生成LLM回复(系统提示词, 用户提示词, context) {
  const { 工具调用 } = context;
  
  try {
    if (工具调用?.LLM调用) {
      const result = await 工具调用.LLM调用({
        messages: [
          { role: 'system', content: 系统提示词 },
          { role: 'user', content: 用户提示词 },
        ],
        temperature: 0.85,
        maxTokens: 500,
      });
      return result?.content || result?.回复 || '';
    }
  } catch (e) {
    logger.error('LLM调用失败:', e.message);
  }
  
  return `[分身回复: ${用户提示词.substring(0, 50)}...]`;
}

/**
 * 保存对话历史
 */
async function 保存对话历史(消息列表, context) {
  const { 工具调用, userId } = context;
  try {
    const 对话记录 = {
      类型: 'persona_chat_log',
      内容: JSON.stringify(消息列表),
      元数据: {
        时间: new Date().toISOString(),
        轮次数: 消息列表.length,
      },
    };
    
    if (工具调用?.创建记忆) {
      await 工具调用.创建记忆(对话记录);
    }
  } catch (e) {
    logger.error('保存对话历史失败:', e.message);
  }
}

/**
 * 执行分身对话
 */
async function execute(args, context) {
  const {
    message,
    history = [],
    maxHistory = 5,
    searchMemory = true,
  } = args;

  try {
    if (!message) {
      return { 成功: false, 错误: '缺少消息内容' };
    }

    // 1. 获取语气档案
    const 语气档案 = await 获取语气档案(context);
    
    if (!语气档案) {
      return {
        成功: false,
        错误: '未找到语气档案。请先使用 chat_import 导入聊天记录，再用 style_learning 学习语气',
        建议: '按顺序操作：1) 导入聊天记录 → 2) 学习语气 → 3) 开始分身对话',
      };
    }

    // 2. 构建系统提示词
    const 系统提示词 = 构建系统提示词(语气档案);

    // 3. 检索相关记忆
    let 相关记忆 = [];
    if (searchMemory) {
      相关记忆 = await 检索相关记忆(message, 3, context);
    }

    // 4. 构建用户提示词（含历史对话）
    const 历史上下文 = history.slice(-maxHistory * 2)
      .map(h => `${h.role === 'user' ? '对方' : '我（分身）'}: ${h.content}`)
      .join('\n');
    
    const 完整用户提示词 = (历史上下文 ? `【最近对话】\n${历史上下文}\n\n` : '') 
      + 构建回复Prompt(message, 语气档案, 相关记忆);

    // 5. 生成回复
    logger.info(`分身对话: "${message.substring(0, 50)}..."`);
    const 回复内容 = await 生成LLM回复(系统提示词, 完整用户提示词, context);

    // 6. 保存对话（异步）
    const 新历史 = [
      ...history,
      { role: 'user', content: message },
      { role: 'avatar', content: 回复内容 },
    ];
    保存对话历史(新历史.slice(-10), context).catch(e => logger.error('保存历史失败:', e));

    return {
      成功: true,
      数据: {
        回复内容,
        语气档案版本: 语气档案.版本 || 1,
        训练数据量: 语气档案.训练数据量 || 0,
        记忆匹配数: 相关记忆.length,
        对话轮次: Math.floor(新历史.length / 2),
      },
    };
  } catch (e) {
    logger.error('分身对话失败:', e.message);
    return {
      成功: false,
      错误: `分身对话失败: ${e.message}`,
    };
  }
}

export default {
  name: 'persona_chat',
  description: '分身对话技能 — 用户与自己的AI分身进行对话，分身严格按照用户真实语气风格回答问题。可用于测试语气档案效果或娱乐互动',
  abilities: ['分身', '人格模拟', '对话'],
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: '用户发送给分身的消息' },
      history: {
        type: 'array',
        description: '对话历史（每项含 role/content）',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['user', 'avatar'] },
            content: { type: 'string' },
          },
        },
      },
      maxHistory: { type: 'number', description: '保留的最近对话轮数（默认5）' },
      searchMemory: { type: 'boolean', description: '是否检索Git记忆中的相关对话作为参考', default: true },
    },
    required: ['message'],
  },
  execute,
};
