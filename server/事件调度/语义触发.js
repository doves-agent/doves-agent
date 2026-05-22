/**
 * 语义触发模块
 * 职责：语义事件的注册、向量匹配、LLM精判触发
 * 
 * LLM 调用通过 LLM任务代理 创建异步任务，由 Doves 执行
 * Server 不直接 import 任何 Doves 代码
 */

import { getUserDb } from '../db.js';
import { createTimestampFields, toLocalISOString, getTimestamp } from '@dove/common/时间工具.js';
import { ObjectId } from 'mongodb';
import * as 向量记忆 from '../向量服务/记忆服务.js';
import { logger } from '../core.js';
import { 请求LLM判断 } from './LLM任务代理.js';

/**
 * 注册语义事件
 * 将自然语言触发条件存入Git记忆
 */
async function 注册语义事件(条件描述, 任务模板, userId, 配置 = {}) {
  const userDb = getUserDb();
  const ts = createTimestampFields();
  const 事件ID = new ObjectId().toString();
  
  // 1. 将触发条件存入向量记忆
  let 记忆ID = null;
  try {
    const 记忆结果 = await 向量记忆.添加记忆({
      用户ID: userId,
      类别: '事件触发',
      内容: `语义事件触发条件: ${条件描述}`,
      元数据: {
        type: 'event_trigger',
        事件ID: 事件ID,
        事件名称: 配置.名称 || '语义事件'
      }
    });
    记忆ID = 记忆结果?.data?.id || null;
    logger.info(`[事件调度器] 语义事件条件已存入向量记忆: ${记忆ID}`);
  } catch (e) {
    logger.warn(`[事件调度器] 向量记忆存储失败，仍创建事件但语义匹配精度降低: ${e.message}`);
  }
  
  // 2. 创建事件文档
  const 事件 = {
    事件ID,
    事件类型: 'semantic',
    事件名称: 配置.名称 || '语义事件',
    触发条件: 条件描述,
    触发阈值: 配置.触发阈值 || 0.7,
    LLM确认: 配置.LLM确认 !== undefined ? 配置.LLM确认 : true,
    冷却时间: 配置.冷却时间 || 300000,
    最近触发时间: null,
    触发次数: 0,
    记忆ID,
    触发源: { 类型: 'semantic', 条件: 条件描述 },
    任务模板,
    状态: '活跃',
    userId,
    用户ID: userId,
    创建时间: ts.localTime,
    创建时间戳: ts.timestamp,
    更新时间: ts.localTime,
    更新时间戳: ts.timestamp
  };
  
  await userDb.collection('事件').insertOne(事件);
  logger.info(`[事件调度器] 注册语义事件: ${事件.事件名称} (${事件ID})`);
  
  return 事件;
}

/**
 * 检查语义触发
 * 对用户消息进行向量匹配 + 可选LLM精判
 */
async function 检查语义触发(self, 用户消息, userId, 配置 = {}) {
  const 结果 = { 匹配事件: [], 触发结果: [] };
  
  // 1. 从事件集合获取该用户的 semantic 事件
  const userDb = getUserDb();
  const 语义事件列表 = await userDb.collection('事件').find({
    事件类型: 'semantic',
    状态: '活跃',
    userId
  }).toArray();
  
  if (语义事件列表.length === 0) return 结果;

  // 2. 向量语义匹配（通过向量记忆搜索事件触发类别）
  let 候选事件 = [];
  try {
    const 搜索结果 = await 向量记忆.搜索记忆({
      用户ID: userId,
      查询: 用户消息,
      类别: '事件触发',
      topK: 10,
      阈值: 0.5
    });

    const 记忆映射 = new Map();
    if (搜索结果?.成功 && 搜索结果.data) {
      for (const r of 搜索结果.data) {
        const 关联事件ID = r.元数据?.事件ID;
        if (关联事件ID) {
          记忆映射.set(关联事件ID, r);
        }
      }
    }

    for (const 事件 of 语义事件列表) {
      const 匹配记忆 = 记忆映射.get(事件.事件ID);
      if (匹配记忆 && (匹配记忆.相似度 || 0) >= (事件.触发阈值 || 0.7)) {
        候选事件.push({ 事件, 相似度: 匹配记忆.相似度 });
      }
    }
  } catch (e) {
    logger.warn(`[事件调度器] 向量搜索失败，降级为关键词匹配: ${e.message}`);
    for (const 事件 of 语义事件列表) {
      const 事件关键词 = 事件.触发条件.split(/[，,、\s]+/).filter(w => w.length > 1);
      let 匹配数 = 事件关键词.filter(k => 用户消息.includes(k)).length;
      if (匹配数 > 0) {
        候选事件.push({ 事件, 相似度: 匹配数 / Math.max(事件关键词.length, 1) });
      }
    }
  }
  
  // 3. LLM 精判
  const 需精判事件 = 候选事件.filter(c => c.事件.LLM确认);
  const 不需精判事件 = 候选事件.filter(c => !c.事件.LLM确认);
  
  for (const { 事件, 相似度 } of 不需精判事件) {
    结果.匹配事件.push({ 事件, 相似度, LLM判断: 'skipped' });
  }
  
  if (需精判事件.length > 0) {
    try {
      const LLM结果 = await LLM精判语义触发(用户消息, 需精判事件);
      for (const { 事件, 相似度 } of 需精判事件) {
        const 判断 = LLM结果.find(r => r.事件ID === 事件.事件ID);
        if (判断?.满足) {
          结果.匹配事件.push({ 事件, 相似度, LLM判断: 判断.满足, 置信度: 判断.置信度, 理由: 判断.理由 });
        }
      }
    } catch (e) {
      logger.warn(`[事件调度器] LLM精判失败，降级为向量相似度匹配: ${e.message}`);
      for (const { 事件, 相似度 } of 需精判事件) {
        结果.匹配事件.push({ 事件, 相似度, LLM判断: 'fallback_pass' });
      }
    }
  }
  
  // 4. 冷却时间检查 + 触发任务
  if (配置.是否触发任务 !== false) {
    for (const 匹配 of 结果.匹配事件) {
      const 事件 = 匹配.事件;
      
      if (事件.最近触发时间 && 事件.冷却时间) {
        const 距上次 = Date.now() - new Date(事件.最近触发时间).getTime();
        if (距上次 < 事件.冷却时间) {
          logger.debug(`[事件调度器] 语义事件 ${事件.事件名称} 冷却中，跳过`);
          continue;
        }
      }
      
      try {
        const 任务 = self._创建任务文档(事件.任务模板, 事件.userId, 事件.事件ID);
        任务.routing.触发类型 = 'semantic';
        任务.routing.触发条件 = 事件.触发条件;
        
        await userDb.collection('任务').insertOne(任务);
        
        await userDb.collection('事件').updateOne(
          { 事件ID: 事件.事件ID },
          {
            $set: {
              最近触发时间: toLocalISOString(new Date()),
              更新时间: toLocalISOString(new Date()),
              更新时间戳: getTimestamp()
            },
            $inc: { 触发次数: 1 }
          }
        );
        
        结果.触发结果.push({ 事件ID: 事件.事件ID, 事件名称: 事件.事件名称, 任务ID: 任务.任务ID });
        logger.info(`[事件调度器] 语义事件 ${事件.事件名称} 触发 → 创建任务 ${任务.任务ID}`);

        import('../通知服务.js').then(({ 投递通知 }) => {
          投递通知({
            userId: 事件.userId,
            来源类型: 'event',
            来源ID: 事件.事件ID,
            来源名称: 事件.事件名称,
            标题: `事件触发: ${事件.事件名称}`,
            摘要: `语义事件「${事件.事件名称}」已触发，创建了 1 个任务`,
          }).catch(() => {});
        }).catch(() => {});
      } catch (e) {
        logger.error(`[事件调度器] 语义事件触发失败: ${e.message}`);
      }
    }
  }
  
  return 结果;
}

/**
 * LLM精判语义触发
 */
async function LLM精判语义触发(用户消息, 候选事件) {
  const 条件列表 = 候选事件.map((c, i) => `${i + 1}. [${c.事件.事件名称}]: "${c.事件.触发条件}"`).join('\n');

  const 提示词 = `判断以下事件条件是否被用户消息触发。

用户消息: "${用户消息}"

事件条件:
${条件列表}

严格返回JSON:
{"results": [${候选事件.map((c, i) => `{"事件名称": "${c.事件.事件名称}", "满足": true/false, "置信度": 0.0-1.0, "理由": "简短说明"}`).join(', ')}]}

只返回JSON。`;

  const LLM结果 = await 请求LLM判断({
    提示词,
    temperature: 0.1,
    max_tokens: 500,
    label: '语义事件精判',
    userId: 候选事件[0]?.事件?.userId,
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
  注册语义事件,
  检查语义触发,
  LLM精判语义触发,
};
