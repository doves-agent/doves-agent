/**
 * 意图驱动事件处理
 * 包含：意图事件变更监听、触发处理、事件注册、处理动作追加、摘要触发检查
 */

import { getUserDb, getAdminDb } from '../db.js';
import { createTimestampFields, toLocalISOString, getTimestamp } from '@dove/common/时间工具.js';
import { logger } from '../core.js';
import * as 记忆服务 from '../Git存储/记忆服务.js';
import { ObjectId } from 'mongodb';
import { 请求LLM判断 } from './LLM任务代理.js';

// 由主文件设置，避免循环依赖
let SERVER_INSTANCE_ID;
let _创建任务文档;

export function initIntentDriven(config) {
  SERVER_INSTANCE_ID = config.serverInstanceId;
  _创建任务文档 = config.createTaskDoc;
}

/**
 * 检查用户事件限额
 */
export async function 检查事件限额(userId) {
  const userDb = getUserDb();
  
  let 会员 = false;
  try {
    const adminDb = getAdminDb();
    const 用户配置 = await adminDb.collection('用户配置').findOne({ userId });
    会员 = 用户配置?.member || 用户配置?.会员 || false;
  } catch (e) {
    logger.warn(`[事件调度器] 查询会员状态失败，按非会员处理: ${e.message}`);
  }
  
  const 上限 = 会员 ? 50 : 10;
  
  const 当前数量 = await userDb.collection('事件').countDocuments({
    事件类型: 'intent_driven',
    状态: { $in: ['活跃', '已耗尽'] },
    $or: [{ 用户ID: userId }, { userId }]
  });
  
  return { 当前数量, 上限, 是否超限: 当前数量 >= 上限, 会员 };
}

/**
 * 注册意图驱动事件
 */
export async function 注册意图驱动事件(条件描述, 动作描述, userId, 配置 = {}, self) {
  const userDb = getUserDb();
  const ts = createTimestampFields();
  const 事件ID = new ObjectId().toString();
  
  // 1. 检查限额
  const 限额 = await 检查事件限额(userId);
  if (限额.是否超限) {
    throw new Error(`事件数量已达上限（${限额.上限}个），${限额.会员 ? '' : '升级会员可拥有50个事件配额。'}`);
  }
  
  // 2. 将触发条件存入Git记忆
  let 记忆ID = null;
  try {
    const 记忆结果 = await 记忆服务.添加记忆({
      用户ID: userId,
      类别: '事件触发',
      内容: `意图驱动事件触发条件: ${条件描述}`,
      元数据: {
        type: 'event_trigger',
        事件类型: 'intent_driven',
        事件ID: 事件ID,
        事件名称: 配置.名称 || '意图驱动事件'
      }
    });
    记忆ID = 记忆结果?.data?.id || null;
    logger.info(`[事件调度器] 意图驱动事件条件已存入Git记忆: ${记忆ID}`);
  } catch (e) {
    logger.warn(`[事件调度器] 记忆存储失败，仍创建事件但匹配不可用: ${e.message}`);
  }
  
  // 3. 创建事件文档
  const 事件 = {
    事件ID,
    事件类型: 'intent_driven',
    事件名称: 配置.名称 || '意图驱动事件',
    触发条件: 条件描述,
    触发阈值: 配置.触发阈值 || 0.7,
    LLM确认: 配置.LLM确认 !== undefined ? 配置.LLM确认 : true,
    冷却时间: 配置.冷却时间 || 300000,
    最近触发时间: null,
    触发次数: 0,
    最大触发次数: 配置.最大触发次数 !== undefined ? 配置.最大触发次数 : null,
    剩余触发次数: 配置.最大触发次数 !== undefined ? 配置.最大触发次数 : null,
    记忆ID,
    触发源: { 类型: 'intent_driven', 条件: 条件描述 },
    事件处理列表: [
      {
        处理ID: 'h-' + Math.random().toString(16).substr(2, 6),
        处理描述: 动作描述,
        任务模板: { 用户消息: 动作描述 },
        启用: true,
        创建时间: ts.localTime,
        创建时间戳: ts.timestamp
      }
    ],
    触发记录: [],
    触发中: false,
    状态: '活跃',
    userId,
    用户ID: userId,
    创建时间: ts.localTime,
    创建时间戳: ts.timestamp,
    更新时间: ts.localTime,
    更新时间戳: ts.timestamp
  };
  
  await userDb.collection('事件').insertOne(事件);
  logger.info(`[事件调度器] 注册意图驱动事件: ${事件.事件名称} (${事件ID}), 处理动作: "${动作描述}"`);
  
  return 事件;
}

/**
 * 追加事件处理动作
 */
export async function 追加事件处理动作(用户消息, 动作描述, userId, self) {
  const userDb = getUserDb();
  const ts = createTimestampFields();
  
  const 意图事件列表 = await userDb.collection('事件').find({
    事件类型: 'intent_driven',
    状态: { $in: ['活跃', '已耗尽'] },
    $or: [{ 用户ID: userId }, { userId }]
  }).toArray();
  
  if (意图事件列表.length === 0) {
    throw new Error('没有找到可追加处理的意图驱动事件');
  }
  
  // 向量匹配找到最相关的事件
  let 候选事件 = [];
  
  try {
    const 搜索结果 = await 记忆服务.搜索记忆({
      查询: 用户消息,
      用户ID: userId,
      类别: '事件触发',
      返回数量: 5
    });

    if (搜索结果?.成功 && 搜索结果.data?.length > 0) {
      for (const r of 搜索结果.data) {
        const 关联事件ID = r.metadata?.事件ID;
        if (!关联事件ID) continue;
        const 事件 = 意图事件列表.find(e => e.事件ID === 关联事件ID);
        if (事件) {
          候选事件.push({ 事件, 相似度: r.相关度 / 5 || 0 });
        }
      }
    }
  } catch (e) {
    logger.warn(`[事件调度器] 记忆搜索失败，降级为关键词匹配: ${e.message}`);
  }
  
  // 降级：关键词匹配
  if (候选事件.length === 0) {
    for (const 事件 of 意图事件列表) {
      const 事件关键词 = 事件.触发条件.split(/[，,、\s]+/).filter(w => w.length > 1);
      let 匹配数 = 事件关键词.filter(k => 用户消息.includes(k)).length;
      if (匹配数 === 0 && 事件关键词.some(k => k.length > 4)) {
        for (let i = 0; i < 用户消息.length - 1; i++) {
          const 片段 = 用户消息.substring(i, i + 2);
          if (事件.触发条件.includes(片段)) 匹配数++;
        }
      }
      if (匹配数 > 0) {
        候选事件.push({ 事件, 相似度: 匹配数 / Math.max(事件关键词.length, 1) });
      }
    }
  }
  
  if (候选事件.length === 0) {
    throw new Error('未能匹配到相关的事件');
  }
  
  候选事件.sort((a, b) => b.相似度 - a.相似度);
  候选事件 = 候选事件.slice(0, 3);
  
  let 匹配事件 = null;
  let 匹配相似度 = 0;
  
  if (候选事件.length === 1) {
    匹配事件 = 候选事件[0].事件;
    匹配相似度 = 候选事件[0].相似度;
  } else {
    try {
      const LLM结果 = await _LLM精判事件匹配(用户消息, 候选事件);
      if (LLM结果.匹配事件ID) {
        const 命中 = 候选事件.find(c => c.事件.事件ID === LLM结果.匹配事件ID);
        if (命中) {
          匹配事件 = 命中.事件;
          匹配相似度 = 命中.相似度;
        }
      }
      if (!匹配事件) {
        匹配事件 = 候选事件[0].事件;
        匹配相似度 = 候选事件[0].相似度;
      }
    } catch (e) {
      logger.warn(`[事件调度器] LLM精判事件匹配失败，降级取最高分候选: ${e.message}`);
      匹配事件 = 候选事件[0].事件;
      匹配相似度 = 候选事件[0].相似度;
    }
  }
  
  const 当前处理数 = (匹配事件.事件处理列表 || []).length;
  const 每事件处理动作上限 = 5;
  if (当前处理数 >= 每事件处理动作上限) {
    throw new Error(`该事件的处理动作已达上限（${每事件处理动作上限}个）`);
  }
  
  const 新处理 = {
    处理ID: 'h-' + Math.random().toString(16).substr(2, 6),
    处理描述: 动作描述,
    任务模板: { 用户消息: 动作描述 },
    启用: true,
    创建时间: ts.localTime,
    创建时间戳: ts.timestamp
  };
  
  await userDb.collection('事件').updateOne(
    { 事件ID: 匹配事件.事件ID },
    {
      $push: { 事件处理列表: 新处理 },
      $set: {
        更新时间: ts.localTime,
        更新时间戳: ts.timestamp
      }
    }
  );
  
  logger.info(`[事件调度器] 追加事件处理动作: 事件=${匹配事件.事件ID}, 处理ID=${新处理.处理ID}, 动作="${动作描述}"`);
  
  return {
    匹配事件: {
      事件ID: 匹配事件.事件ID,
      事件名称: 匹配事件.事件名称,
      触发条件: 匹配事件.触发条件,
      相似度: 匹配相似度
    },
    处理ID: 新处理.处理ID
  };
}

// ==================== LLM 精判方法 ====================

async function _LLM精判事件匹配(用户消息, 候选事件) {
  const 事件列表 = 候选事件.map((c, i) =>
    `${i + 1}. [${c.事件.事件名称}] 触发条件: "${c.事件.触发条件}" (相似度: ${c.相似度.toFixed(3)})`
  ).join('\n');

  const 提示词 = `用户想在已有事件上追加处理动作，判断最匹配哪个事件。

用户消息: "${用户消息}"

候选事件:
${事件列表}

严格返回JSON:
{"匹配事件名称": "最匹配的事件名称", "匹配事件ID": "最匹配的事件ID", "置信度": 0.0-1.0, "理由": "简述匹配原因"}

无匹配返回:
{"匹配事件名称": null, "匹配事件ID": null, "置信度": 0, "理由": "不匹配任何事件"}

只返回JSON。`;

  const LLM结果 = await 请求LLM判断({
    提示词,
    temperature: 0.1,
    max_tokens: 300,
    label: '事件匹配精判',
    userId: 候选事件[0]?.事件?.userId,
  });

  return {
    匹配事件ID: LLM结果.匹配事件ID || null,
    置信度: LLM结果.置信度 || 0,
    理由: LLM结果.理由 || '',
  };
}
