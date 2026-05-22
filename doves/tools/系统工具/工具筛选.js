/**
 * @file tools/系统工具/工具筛选
 * @description 工具筛选工具：从全量工具目录中为子任务精选最趁手的工具
 * 
 * === 设计意图 ===
 * 干活鸽子不应看到全部工具（浪费token），而应由工具筛选鸽子预先精选。
 * 使用 工具筛选模型 从全量目录中选择。
 * LLM调用失败直接报错，不做降级。
 */

import { 默认工具筛选模型 } from '../../常量.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('工具筛选', { 前缀: '[工具筛选]', 级别: 'debug', 显示调用位置: true });

/**
 * 精选工具执行入口
 * @param {Object} args - { taskDescription, abilities }
 * @returns {Object} 精选结果
 */
export async function handleCurateTools(args) {
  const { taskDescription = '', abilities = [] } = args;

  logger.info(`→ 精选工具: 能力=[${abilities.join(', ')}], 描述=${taskDescription.slice(0, 80)}...`);

  try {
    // 1. 构建全量工具目录
    const { 获取所有工具定义, 工具能力映射, 工具安全分级 } = await import('../index.js');
    const 全量工具 = 获取所有工具定义();

    // 构建工具目录文本（给LLM看）
    const 工具目录行 = 全量工具.map(t => {
      const 能力标签 = (工具能力映射[t.name] || []).join(', ');
      const 安全级别 = 工具安全分级[t.name] || '谨慎';
      return `- ${t.name} [${安全级别}]: ${(t.description || '').slice(0, 120)} | 能力: ${能力标签 || '无'}`;
    }).join('\n');

    // 2. 调用 工具筛选模型 精选
    const 精选工具名列表 = await 调用LLM精选(任务描述, abilities, 工具目录行, 全量工具);

    // 3. 校验：确保返回的工具名都真实存在
    const 有效工具名集合 = new Set(全量工具.map(t => t.name));
    const 有效精选 = 精选工具名列表.filter(name => 有效工具名集合.has(name));

    if (有效精选.length < 精选工具名列表.length) {
      logger.warn(`精选结果校验: ${精选工具名列表.length - 有效精选.length} 个工具名无效，已过滤`);
    }

    logger.info(`← 精选完成: ${有效精选.length} 个工具${精选工具名列表.length !== 有效精选.length ? ` (原始${精选工具名列表.length}个)` : ''}`);

    return {
      success: true,
      tools: 有效精选,
      toolCount: 有效精选.length,
    };

  } catch (error) {
    logger.error(`精选工具失败: ${error.message}`);
    return { success: false, error: error.message, tools: [] };
  }
}

/**
 * 调用LLM精选工具
 */
async function 调用LLM精选(任务描述, abilities, 工具目录行, 全量工具) {
  const { 调用LLM } = await import('../../providers/index.js');

  const prompt = `你是一个工具筛选专家。请从以下全量工具目录中，为子任务精选最趁手的工具。

## 子任务信息
描述: ${任务描述.slice(0, 500)}
需要的能力: [${abilities.join(', ')}]

## 全量工具目录
${工具目录行}

## 精选规则
1. 保底工具始终需要（日期时间、通知用户、询问用户、发现能力、关联任务、查询任务、网络信息）—— 这些不用列在精选结果中，系统会自动添加
2. 根据子任务的实际需求，选出最相关的工具
3. 宁多勿少：不确定是否需要时，宁可保留
4. 工具名必须与目录中的完全一致

只返回严格JSON（不要markdown标记）:
{"tools": ["工具名1", "工具名2", ...]}`;

  const result = await 调用LLM({
    messages: [{ role: 'user', content: prompt }],
    model: 默认工具筛选模型,
    temperature: 0.1,
    maxTokens: 2000,
  });

  if (!result?.success && !result?.content) {
    throw new Error(result?.error || 'LLM调用无返回');
  }

  const content = result.content || result;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('LLM返回中未找到JSON');
  }

  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed.tools)) {
    throw new Error('LLM返回的tools字段不是数组');
  }

  return parsed.tools;
}

export default { handleCurateTools };