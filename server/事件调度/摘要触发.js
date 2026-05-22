/**
 * 摘要触发模块
 * 职责：对话摘要触发意图驱动事件、LLM精判匹配
 * 
 * LLM 调用通过 LLM任务代理 创建异步任务，由 Doves 执行
 * Server 不直接 import 任何 Doves 代码
 */

import { getUserDb, getAdminDb } from '../db.js';
import { createTimestampFields, toLocalISOString, getTimestamp } from '@dove/common/时间工具.js';
import * as 记忆服务 from '../Git存储/记忆服务.js';
import { logger } from '../core.js';
import { 请求LLM判断 } from './LLM任务代理.js';

/**
 * 摘要触发检查（输出触发路径）
 */
async function 摘要触发检查(self, 对话摘要, 对话ID, userId, 上下文 = {}) {
  const userDb = getUserDb();
  const ts = createTimestampFields();
  const 结果 = { 匹配事件数: 0, 触发事件: [] };
  
  // 1. 获取用户的活跃意图驱动事件
  const 意图事件列表 = await userDb.collection('事件').find({
    事件类型: 'intent_driven',
    状态: '活跃',
    $or: [{ 用户ID: userId }, { userId }]
  }).toArray();
  
  if (意图事件列表.length === 0) return 结果;
  
  // 关键词降级匹配
  const 关键词匹配事件 = (匹配文本列表) => {
    const 匹配结果 = [];
    for (const 事件 of 意图事件列表) {
      const 事件关键词 = 事件.触发条件.split(/[，,、\s]+/).filter(w => w.length > 1);
      let 匹配数 = 0;
      for (const k of 事件关键词) {
        if (匹配文本列表.some(t => t.includes(k) || k.includes(t))) {
          匹配数++;
        }
      }
      if (匹配数 > 0 && (匹配数 / 事件关键词.length) >= 事件.触发阈值) {
        匹配结果.push({ 事件, 相似度: 匹配数 / 事件关键词.length });
      }
    }
    return 匹配结果;
  };
  
  const 匹配文本列表 = [对话摘要, ...(上下文.关键词列表 || [])];
  
  // 2. 关键词匹配（通过Git记忆服务）
  let 候选事件 = [];
  try {
    const 搜索结果 = await 记忆服务.搜索记忆({
      查询: 对话摘要,
      用户ID: userId,
      类别: '事件触发',
      返回数量: 10
    });

    if (搜索结果?.成功 && 搜索结果.data) {
      const 记忆映射 = new Map();
      for (const r of 搜索结果.data) {
        const 关联事件ID = r.metadata?.事件ID;
        if (关联事件ID) {
          记忆映射.set(关联事件ID, r);
        }
      }

      for (const 事件 of 意图事件列表) {
        const 匹配记忆 = 记忆映射.get(事件.事件ID);
        if (匹配记忆 && (匹配记忆.相关度 || 0) >= (事件.触发阈值 * 5)) {
          候选事件.push({ 事件, 相似度: 匹配记忆.相关度 / 5 });
        }
      }
    }
  } catch (e) {
    logger.warn(`[事件调度器] 摘要触发-记忆搜索失败，降级为关键词匹配: ${e.message}`);
    候选事件 = 关键词匹配事件(匹配文本列表);
  }

  if (候选事件.length === 0) {
    候选事件 = 关键词匹配事件(匹配文本列表);
  }
  
  if (候选事件.length === 0) return 结果;
  
  // 3. LLM 精判
  const 需精判事件 = 候选事件.filter(c => c.事件.LLM确认);
  const 不需精判事件 = 候选事件.filter(c => !c.事件.LLM确认);
  
  const 通过事件 = [...不需精判事件];
  
  if (需精判事件.length > 0) {
    try {
      const LLM结果 = await LLM精判摘要触发(对话摘要, 需精判事件);
      for (const 判断 of LLM结果) {
        if (判断.满足) {
          const 候选 = 需精判事件.find(c => c.事件.事件ID === 判断.事件ID);
          if (候选) 通过事件.push(候选);
        }
      }
    } catch (e) {
      logger.warn(`[事件调度器] 摘要触发-LLM精判失败，候选通过: ${e.message}`);
      通过事件.push(...需精判事件);
    }
  }
  
  // 4. 冷却时间 + 剩余触发次数检查 → 更新MDB
  for (const { 事件, 相似度 } of 通过事件) {
    if (事件.最近触发时间 && 事件.冷却时间) {
      const 距上次 = Date.now() - new Date(事件.最近触发时间).getTime();
      if (距上次 < 事件.冷却时间) {
        logger.debug(`[事件调度器] 摘要触发: 事件 ${事件.事件名称} 冷却中，跳过`);
        continue;
      }
    }
    
    // 剩余触发次数检查（原子操作）
    if (事件.最大触发次数 !== null && 事件.最大触发次数 !== undefined) {
      const 递减结果 = await userDb.collection('事件').findOneAndUpdate(
        {
          事件ID: 事件.事件ID,
          剩余触发次数: { $gt: 0 },
          状态: { $in: ['活跃'] }
        },
        {
          $inc: { 剩余触发次数: -1, 触发次数: 1 },
          $set: { 更新时间: ts.localTime, 更新时间戳: ts.timestamp }
        },
        { returnDocument: 'after' }
      );

      if (!递减结果) {
        await userDb.collection('事件').updateOne(
          { 事件ID: 事件.事件ID, 状态: { $ne: '已耗尽' } },
          { $set: { 状态: '已耗尽', 更新时间: ts.localTime, 更新时间戳: ts.timestamp } }
        );
        logger.info(`[事件调度器] 摘要触发: 事件 ${事件.事件名称} 触发次数耗尽，标记已耗尽`);
        continue;
      }

      if (递减结果.剩余触发次数 <= 0) {
        await userDb.collection('事件').updateOne(
          { 事件ID: 事件.事件ID },
          { $set: { 状态: '已耗尽', 更新时间: ts.localTime, 更新时间戳: ts.timestamp } }
        );
        logger.info(`[事件调度器] 摘要触发: 事件 ${事件.事件名称} 触发次数耗尽，标记已耗尽`);
      }
      continue;
    }
    
    const 更新操作 = {
      $set: {
        最近触发时间: ts.localTime,
        更新时间: ts.localTime,
        更新时间戳: ts.timestamp,
        待处理触发: true
      },
      $inc: { 触发次数: 1 },
      $push: {
        触发记录: {
          触发摘要: 对话摘要.slice(0, 200),
          触发时间: ts.localTime,
          触发时间戳: ts.timestamp,
          触发对话ID: 对话ID,
          触发任务ID: 上下文.任务ID || null,
          创建的任务ID: null
        }
      }
    };
    
    await userDb.collection('事件').updateOne(
      { 事件ID: 事件.事件ID },
      更新操作
    );
    
    结果.匹配事件数++;
    结果.触发事件.push({
      事件ID: 事件.事件ID,
      事件名称: 事件.事件名称,
      触发条件: 事件.触发条件,
      相似度,
      对话ID
    });
    
    logger.info(`[事件调度器] 摘要触发: 事件 ${事件.事件名称} (${事件.事件ID}) 被对话 ${对话ID} 触发`);
  }
  
  return 结果;
}

/**
 * LLM精判事件匹配
 */
async function LLM精判事件匹配(用户消息, 候选事件) {
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
  });

  const jsonStr = typeof LLM结果 === 'string' ? LLM结果 : JSON.stringify(LLM结果);
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('LLM返回格式异常');

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    匹配事件ID: parsed.匹配事件ID || null,
    置信度: parsed.置信度 || 0,
    理由: parsed.理由 || ''
  };
}

/**
 * LLM精判摘要触发
 */
async function LLM精判摘要触发(对话摘要, 候选事件) {
  const 条件列表 = 候选事件.map((c, i) => `${i + 1}. [${c.事件.事件名称}]: "${c.事件.触发条件}"`).join('\n');

  const 提示词 = `判断对话摘要是否触发以下事件条件。

对话摘要: "${对话摘要}"

事件条件:
${条件列表}

严格返回JSON:
{"results": [${候选事件.map((c, i) => `{"事件名称": "${c.事件.事件名称}", "满足": true/false, "置信度": 0.0-1.0, "理由": "简短说明"}`).join(', ')}]}

只返回JSON。`;

  const LLM结果 = await 请求LLM判断({
    提示词,
    temperature: 0.1,
    max_tokens: 500,
    label: '摘要触发精判',
  });

  const jsonStr = typeof LLM结果 === 'string' ? LLM结果 : JSON.stringify(LLM结果);
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('LLM返回格式异常');

  const parsed = JSON.parse(jsonMatch[0]);
  return (parsed.results || []).map(r => ({
    事件ID: 候选事件.find(c => c.事件.事件名称 === r.事件名称)?.事件.事件ID,
    满足: !!r.满足,
    置信度: r.置信度 || 0,
    理由: r.理由 || ''
  }));
}

export {
  摘要触发检查,
  LLM精判事件匹配,
  LLM精判摘要触发,
};
