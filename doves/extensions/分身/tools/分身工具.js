/**
 * 人类分身工具集
 * 9个分身工具：导入聊天记录 → 语气学习 → 回复生成 → 配置管理
 *
 * 依赖已有能力：Git记忆（向量化存储+语义检索）、Git数据、IM适配器
 */

import { extTools } from './_分身工具-定义.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';
import { getDovesProxy } from '../../../tools/存储接口.js';

const logger = 创建日志器('分身工具', { 前缀: '[分身工具]', 级别: 'debug', 显示调用位置: true });

// ==================== 工具处理器 ====================

async function handleExtTool(toolName, args) {

  try {
    switch (toolName) {
      // ===== 数据导入 =====
      case 'avatar_import_chat':
        return await handleImportChat(args, logger);

      // ===== 语气学习 =====
      case 'avatar_analyze_style':
        return await handleAnalyzeStyle(args, logger);
      case 'avatar_style_profile':
        return await handleStyleProfile(args, logger);

      // ===== 回复生成 =====
      case 'avatar_generate_reply':
        return await handleGenerateReply(args, logger);
      case 'avatar_send_reply':
        return await handleSendReply(args, logger);
      case 'avatar_search_context':
        return await handleSearchContext(args, logger);

      // ===== 查询与管理 =====
      case 'avatar_chat_history':
        return await handleChatHistory(args, logger);
      case 'avatar_config':
        return await handleConfig(args, logger);
      case 'avatar_train':
        return await handleTrain(args, logger);

      default:
        return { content: [{ type: 'text', text: `未知分身工具: ${toolName}` }], isError: true };
    }
  } catch (e) {
    logger.error('工具执行异常:', e.message);
    return { content: [{ type: 'text', text: `分身工具执行异常: ${e.message}` }], isError: true };
  }
}

// ==================== 工具实现 ====================

/** 通过加密通道调用 Server API */
async function callServerAPI(method, path, body, logger) {
  try {
    const proxy = await getDovesProxy();
    return await proxy.fetch(`/api/${path}`, { method, body });
  } catch (e) {
    logger.error(`Server API ${method} ${path} 调用失败:`, e.message);
    return null;
  }
}

async function 搜索记忆(类型, 关键词, 限制 = 10, logger) {
  return callServerAPI('POST', 'memory/search', { 类型, 关键词, limit: 限制 }, logger);
}

async function 创建记忆(条目, logger) {
  return callServerAPI('POST', 'memory', 条目, logger);
}

async function 更新记忆(条目, logger) {
  return callServerAPI('PUT', 'memory', 条目, logger);
}

async function 删除记忆(记忆ID, logger) {
  return callServerAPI('DELETE', `memory/${记忆ID}`, null, logger);
}

/** 结果构建 */
function text(content) {
  return { content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }] };
}

// ---- avatar_import_chat ----
async function handleImportChat(args, logger) {
  const { format = 'auto', filePath, content, ownerName, contactName, timeRange } = args;
  if (!ownerName) return text({ 错误: '缺少 ownerName 参数' });

  // 尝试动态加载 parsers
  let 聊天内容 = content;
  if (!聊天内容 && filePath) {
    try {
      const proxy = await getDovesProxy();
      const result = await proxy.fetch(`/api/git-storage/files/${encodeURIComponent(filePath)}`, { method: 'GET' });
      if (result) 聊天内容 = typeof result === 'string' ? result : result.内容 || result.content || JSON.stringify(result);
    } catch (e) { logger.error('读取文件失败:', e.message); }
  }
  if (!聊天内容) return text({ 错误: '未提供聊天记录内容' });

  // 简易解析（完整解析交给 chat_import skill）
  let messages = [];
  try {
    const { parsers } = await import('../parsers/index.js');
    let platform = 'wechat';
    if (format !== 'auto') {
      if (format.startsWith('whatsapp')) platform = 'whatsapp';
      else if (format.startsWith('telegram')) platform = 'telegram';
    } else {
      if (聊天内容.includes('end-to-end encrypted')) platform = 'whatsapp';
      else if (聊天内容.trim().startsWith('{')) platform = 'telegram';
    }
    if (parsers[platform]) {
      const result = parsers[platform].parse(聊天内容, format);
      messages = result.messages || [];
    }
  } catch (e) {
    logger.error('解析器加载失败:', e.message);
    return text({ 错误: `解析器加载失败: ${e.message}` });
  }

  if (messages.length === 0) return text({ 错误: '未能解析到聊天消息' });

  // 筛选
  let 目标 = messages;
  if (contactName) 目标 = 目标.filter(m => m.sender === ownerName || m.sender === contactName);
  if (timeRange?.start) 目标 = 目标.filter(m => m.date >= timeRange.start);
  if (timeRange?.end) 目标 = 目标.filter(m => m.date <= timeRange.end);

  // 分段存入记忆
  const 段落大小 = 20;
  const 段落列表 = [];
  for (let i = 0; i < 目标.length; i += 段落大小) {
    const 段 = 目标.slice(i, i + 段落大小);
    段落列表.push({
      messages: 段,
      文本: 段.map(m => `${m.sender}: ${m.content}`).join('\n'),
      参与者: [...new Set(段.map(m => m.sender))],
    });
  }

  let storedCount = 0;
  for (const 段 of 段落列表) {
    await 创建记忆({ 类型: 'chat_segment', 内容: 段.文本, 元数据: { 参与者: 段.参与者, 消息数: 段.messages.length, 平台: format, 导入时间: new Date().toISOString() } }, logger);
    storedCount++;
  }

  const 用户消息数 = 目标.filter(m => m.sender === ownerName).length;
  return text({ 成功: true, 总消息数: messages.length, 筛选后: 目标.length, 用户消息数, 存储段落数: storedCount, 提示: '导入完成。接下来可用 avatar_analyze_style 分析语气特征' });
}

// ---- avatar_analyze_style ----
async function handleAnalyzeStyle(args, logger) {
  const { ownerName, sampleSize = 500, focusAreas = ['all'] } = args;
  if (!ownerName) return text({ 错误: '缺少 ownerName 参数' });

  // 搜索该用户的 chat_segment
  const results = (await 搜索记忆('chat_segment', ownerName, Math.ceil(sampleSize / 10), logger)) || [];
  if (!results.length) return text({ 错误: `未找到 ${ownerName} 的聊天记录，请先导入` });

  // 提取用户消息
  let 用户消息 = [];
  for (const r of results) {
    const content = r.内容 || r.content || '';
    const lines = content.split('\n').filter(l => l.startsWith(`${ownerName}:`));
    用户消息.push(...lines.map(l => ({ content: l.replace(`${ownerName}:`, '').trim() })));
  }
  if (用户消息.length > sampleSize) 用户消息 = 用户消息.slice(0, sampleSize);
  if (!用户消息.length) return text({ 错误: `未在聊天记录中找到 ${ownerName} 发送的消息` });

  // 简易语气分析
  const 全部分析 = focusAreas.includes('all');
  const 口头禅 = [], emoji偏好 = [];
  let 语气强度 = 0.5, 正式度 = 0.5, 回复速度 = '中等';

  const 语气词 = ['吧', '呢', '啊', '呀', '嘛', '哦', '哈', '啦', '呗', '咯'];
  let 语气词总数 = 0, 正式词分 = 0;
  for (const m of 用户消息) {
    for (const w of 语气词) if (m.content.includes(w)) 语气词总数++;
    if (m.content.includes('您') || m.content.includes('请') || m.content.includes('谢谢')) 正式词分++;
    if (m.content.includes('哈哈') || m.content.includes('嗯嗯') || m.content.includes('好嘞')) 正式词分--;
  }
  语气强度 = Math.min(1, Math.max(0.1, 语气词总数 / Math.max(1, 用户消息.length) * 3));
  正式度 = Math.min(1, Math.max(0, 0.5 + 正式词分 / Math.max(1, 用户消息.length * 0.3)));
  const 平均长度 = 用户消息.reduce((s, m) => s + m.content.length, 0) / Math.max(1, 用户消息.length);
  if (平均长度 < 15) 回复速度 = '快速';
  else if (平均长度 > 60) 回复速度 = '慢速';

  // 提取 emoji
  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]|\p{Extended_Pictographic}/gu;
  const emojiCount = new Map();
  for (const m of 用户消息) {
    const emojis = m.content.match(emojiRegex) || [];
    for (const e of emojis) emojiCount.set(e, (emojiCount.get(e) || 0) + 1);
  }
  emoji偏好.push(...[...emojiCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([e]) => e));

  const 档案 = { 用户名: ownerName, 口头禅, 句式偏好: [], emoji偏好, 回复速度, 语气强度: Math.round(语气强度 * 100) / 100, 正式度: Math.round(正式度 * 100) / 100, 训练数据量: 用户消息.length, 版本: 1, 最后训练时间: new Date().toISOString() };

  // 保存到记忆
  await 更新记忆({ 类型: 'style_profile', 内容: JSON.stringify(档案), 元数据: { 更新时间: new Date().toISOString() } }, logger);

  return text({ 成功: true, 语气档案: 档案, 分析消息数: 用户消息.length });
}

// ---- avatar_style_profile ----
async function handleStyleProfile(args, logger) {
  const { action, updates } = args;
  const results = (await 搜索记忆('style_profile', '', 1, logger)) || [];

  if (action === 'view' || action === 'export') {
    if (!results.length) return text({ 存在: false, 提示: '未找到语气档案，请先用 avatar_analyze_style 分析' });
    const data = results[0].内容 || results[0].content || '{}';
    const profile = typeof data === 'string' ? JSON.parse(data) : data;
    return text({ 存在: true, 语气档案: profile });
  }

  if (action === 'update') {
    if (!results.length) return text({ 错误: '未找到语气档案，请先分析' });
    const data = results[0].内容 || results[0].content || '{}';
    const profile = typeof data === 'string' ? JSON.parse(data) : data;
    if (updates) Object.assign(profile, updates);
    await 更新记忆({ 类型: 'style_profile', 内容: JSON.stringify(profile), 元数据: { 更新时间: new Date().toISOString() }, id: results[0].id || results[0]._id }, logger);
    return text({ 成功: true, 语气档案: profile });
  }

  if (action === 'reset') {
    if (results.length && (results[0].id || results[0]._id)) {
      await 删除记忆(results[0].id || results[0]._id, logger);
    }
    return text({ 成功: true, 提示: '语气档案已重置' });
  }

  return text({ 错误: `未知操作: ${action}` });
}

// ---- avatar_generate_reply ----
async function handleGenerateReply(args, logger) {
  const { message, sender, contextCount = 5, styleIntensity, tone = 'auto', customInstruction } = args;
  if (!message) return text({ 错误: '缺少 message 参数' });

  // 获取语气档案
  const results = (await 搜索记忆('style_profile', '', 1, logger)) || [];
  if (!results.length) return text({ 错误: '未找到语气档案，请先导入聊天记录并用 avatar_analyze_style 学习语气' });
  const data = results[0].内容 || results[0].content || '{}';
  const 档案 = typeof data === 'string' ? JSON.parse(data) : data;

  if (styleIntensity !== undefined) 档案.语气强度 = styleIntensity;
  if (tone !== 'auto') {
    const toneMap = { casual: 0.3, formal: 0.8, humorous: 0.5, concise: 0.4 };
    档案.正式度 = toneMap[tone] ?? 档案.正式度;
  }

  // 搜索相似上下文
  const 上下文 = (await 搜索记忆('chat_segment', message, contextCount, logger)) || [];
  const 上下文文本 = 上下文.map((c, i) => `--- ${i + 1} ---\n${(c.内容 || c.content || '').substring(0, 500)}`).join('\n');

  // 构建 prompt — 由 LLM 层处理生成
  const prompt = `你是用户"${档案.用户名 || '用户'}"的AI分身，需要模仿其语气回复。

【语气档案】
- 口头禅: ${(档案.口头禅 || []).slice(0,5).join('、')}
- 语气强度: ${Math.round((档案.语气强度||0.5)*100)}%
- 正式度: ${Math.round((档案.正式度||0.5)*100)}%
- 回复速度偏好: ${档案.回复速度||'中等'}

【相似对话参考】${上下文文本 ? '\n' + 上下文文本 : '（无）'}

【当前消息】
发送者: ${sender||'未知'}
内容: ${message}

请按用户语气回复（只输出回复内容，不加解释）：`;

  return text({
    成功: true,
    生成提示: prompt,
    语气档案摘要: { 口头禅: (档案.口头禅||[]).slice(0,3), 语气强度: 档案.语气强度, 正式度: 档案.正式度 },
    上下文匹配数: 上下文.length,
    需要确认: true,
    说明: '此工具生成回复提示词，由白鸽LLM层执行实际回复生成。也可使用 auto_reply 技能获取完整流程',
  });
}

// ---- avatar_send_reply ----
async function handleSendReply(args, logger) {
  const { content, platform = 'auto', target, autoConfirm = false } = args;
  if (!content) return text({ 错误: '缺少 content 参数' });
  if (!autoConfirm) return text({ 状态: '等待中', 提示: '回复需要用户确认后才能发送', 内容: content, 平台: platform, 目标: target });

  // 尝试通过 IM API 发送
  try {
    const proxy = await getDovesProxy();
    const result = await proxy.fetch(`/api/im/${platform}/send`, { method: 'POST', body: { content, target } });
    return text({ 成功: true, 发送结果: result });
  } catch (e) {
    return text({ 成功: false, 错误: `发送失败: ${e.message}` });
  }
}

// ---- avatar_search_context ----
async function handleSearchContext(args, logger) {
  const { query, sender, limit = 5, timeRange } = args;
  if (!query) return text({ 错误: '缺少 query 参数' });

  const results = (await 搜索记忆('chat_segment', query, limit, logger)) || [];
  const 过滤结果 = sender ? results.filter(r => {
    const meta = r.元数据 || r.metadata || {};
    return (meta.参与者 || []).includes(sender);
  }) : results;

  return text({
    成功: true,
    查询: query,
    结果数: 过滤结果.length,
    上下文: 过滤结果.map(r => ({
      内容摘要: (r.内容 || r.content || '').substring(0, 200),
      元数据: r.元数据 || r.metadata,
    })),
  });
}

// ---- avatar_chat_history ----
async function handleChatHistory(args, logger) {
  const { action, keyword, contactName, timeRange, limit = 20, memoryId } = args;

  if (action === 'list') {
    const results = (await 搜索记忆('chat_segment', '', limit, logger)) || [];
    return text({
      成功: true,
      导入批次: results.map(r => ({
        id: r.id || r._id,
        消息数: (r.元数据||r.metadata||{}).消息数,
        参与者: (r.元数据||r.metadata||{}).参与者,
        导入时间: (r.元数据||r.metadata||{}).导入时间,
      })),
    });
  }

  if (action === 'search') {
    const results = (await 搜索记忆('chat_segment', keyword || '', limit, logger)) || [];
    return text({ 成功: true, 关键词: keyword, 结果数: results.length, 结果: results.map(r => ({ 内容摘要: (r.内容||r.content||'').substring(0, 300) })) });
  }

  if (action === 'stats') {
    const results = (await 搜索记忆('chat_segment', '', 100, logger)) || [];
    const 总消息数 = results.reduce((s, r) => s + ((r.元数据||r.metadata||{}).消息数 || 0), 0);
    const allParticipants = new Set();
    for (const r of results) {
      for (const p of ((r.元数据||r.metadata||{}).参与者 || [])) allParticipants.add(p);
    }
    return text({ 成功: true, 总段落数: results.length, 总消息数, 参与者: [...allParticipants] });
  }

  if (action === 'delete') {
    if (!memoryId) return text({ 错误: '删除需要 memoryId' });
    await 删除记忆(memoryId, logger);
    return text({ 成功: true, 提示: `记忆 ${memoryId} 已删除` });
  }

  return text({ 错误: `未知操作: ${action}` });
}

// ---- avatar_config ----
async function handleConfig(args, logger) {
  const { action, config } = args;
  const results = (await 搜索记忆('avatar_config', '', 1, logger)) || [];

  if (action === 'view') {
    if (!results.length) return text({ 存在: false, 默认配置: { 自动回复启用: false, 默认语气强度: 0.5, 默认正式度: 0.5, 工作时间仅回复: false } });
    const data = results[0].内容 || results[0].content || '{}';
    return text({ 存在: true, 配置: typeof data === 'string' ? JSON.parse(data) : data });
  }

  if (action === 'update') {
    if (!config) return text({ 错误: 'update 操作需要 config 参数' });
    let cfg = {};
    if (results.length) {
      const data = results[0].内容 || results[0].content || '{}';
      cfg = typeof data === 'string' ? JSON.parse(data) : data;
    }
    Object.assign(cfg, config);
    await 更新记忆({ 类型: 'avatar_config', 内容: JSON.stringify(cfg), 元数据: { 更新时间: new Date().toISOString() }, id: results[0]?.id || results[0]?._id }, logger);
    return text({ 成功: true, 配置: cfg });
  }

  if (action === 'reset') {
    if (results.length && (results[0].id || results[0]._id)) {
      await 删除记忆(results[0].id || results[0]._id, logger);
    }
    return text({ 成功: true, 提示: '配置已重置为默认值' });
  }

  return text({ 错误: `未知操作: ${action}` });
}

// ---- avatar_train ----
async function handleTrain(args, logger) {
  const { content, filePath, format = 'auto', ownerName, mode = 'append' } = args;
  if (!ownerName) return text({ 错误: '缺少 ownerName 参数' });

  // 复用 import 逻辑获取消息，然后重新分析并合并档案
  const importResult = await handleImportChat({ format, filePath, content, ownerName }, logger);
  const importData = JSON.parse(importResult.content[0].text);
  if (importData.错误) return importResult;

  if (mode === 'full_retrain') {
    // 全量重训：删除旧档案后重新分析
    const oldResults = (await 搜索记忆('style_profile', '', 1, logger)) || [];
    if (oldResults.length && (oldResults[0].id || oldResults[0]._id)) {
      await 删除记忆(oldResults[0].id || oldResults[0]._id, logger);
    }
  }

  const analyzeResult = await handleAnalyzeStyle({ ownerName, sampleSize: 1000 }, logger);
  const analyzeData = JSON.parse(analyzeResult.content[0].text);

  return text({
    成功: true,
    模式: mode,
    导入消息数: importData.筛选后 || 0,
    分析消息数: analyzeData.分析消息数 || 0,
    提示: '增量训练完成，语气档案已更新',
  });
}

// ==================== 分类、能力映射、安全分级 ====================

const extToolCategories = {
  '分身数据': ['avatar_import_chat', 'avatar_chat_history', 'avatar_search_context'],
  '语气学习': ['avatar_analyze_style', 'avatar_style_profile', 'avatar_train'],
  '分身回复': ['avatar_generate_reply', 'avatar_send_reply'],
  '分身配置': ['avatar_config'],
};

const extToolAbilityMap = {
  avatar_import_chat: ['分身', '聊天记录', '导入', '数据'],
  avatar_analyze_style: ['分身', '语气学习', '分析'],
  avatar_style_profile: ['分身', '语气档案', '配置'],
  avatar_generate_reply: ['分身', '自动回复', '人格模拟', '生成'],
  avatar_send_reply: ['分身', '发送', 'IM'],
  avatar_search_context: ['分身', '搜索', '记忆', '上下文'],
  avatar_chat_history: ['分身', '聊天记录', '查询'],
  avatar_config: ['分身', '配置'],
  avatar_train: ['分身', '训练', '语气学习'],
};

const extToolSafetyLevels = {
  avatar_import_chat: '谨慎',
  avatar_analyze_style: '安全',
  avatar_style_profile: '谨慎',
  avatar_generate_reply: '安全',
  avatar_send_reply: '危险',
  avatar_search_context: '安全',
  avatar_chat_history: '安全',
  avatar_config: '谨慎',
  avatar_train: '谨慎',
};

export { extTools, handleExtTool, extToolCategories, extToolAbilityMap, extToolSafetyLevels };

export default { extTools, handleExtTool, extToolCategories, extToolAbilityMap, extToolSafetyLevels };
