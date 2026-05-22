/**
 * @file 智能体咨询
 * @description consult_agents 工具 —— 主智能体咨询其他智能体的工具实现
 * 
 * 被咨询的智能体可以独立调用工具（mini KISS 循环，最多 3 轮），
 * 最终返回分析结论给主智能体。
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';
import { 获取保底工具定义, 获取精简工具定义, 获取分组工具定义 } from '../精简工具定义.js';
import { executeSkill } from '../精简工具执行.js';

const logger = 创建日志器('智能体咨询', { 前缀: '[Consult]', 级别: 'debug' });

/** 被咨询智能体的最大工具调用轮数 */
const MAX_CONSULT_ROUNDS = 3;

/**
 * consult_agents 工具的 OpenAI function-calling 定义
 */
export const consultAgentsToolDef = {
  type: 'function',
  function: {
    name: 'consult_agents',
    description: '咨询团队中的其他智能体。将问题发送给指定的智能体，获取他们的独立分析和建议。被咨询的智能体会用自己的专业视角独立分析，并可以调用工具来辅助分析。',
    parameters: {
      type: 'object',
      properties: {
        agents: {
          type: 'array',
          items: { type: 'string' },
          description: '要咨询的智能体角色名列表，如 ["程序大师", "分析大师"]。不包含主智能体自身。',
        },
        question: {
          type: 'string',
          description: '发送给各智能体的问题。应清晰描述当前任务背景和你需要他们分析的具体方面。',
        },
        context: {
          type: 'string',
          description: '附加上下文信息（可选），如用户原始消息、已有分析结果等。',
        },
      },
      required: ['agents', 'question'],
    },
  },
};

/**
 * 执行智能体咨询
 * 
 * @param {Object} args - 工具参数 { agents, question, context }
 * @param {Object} 上下文 - { 多智能体配置, keyManager, DovesProxy, 任务ID, 用户ID }
 * @returns {Promise<{success: boolean, result: string, error?: string}>}
 */
export async function 执行智能体咨询(args, 上下文 = {}) {
  const { agents: agentNames, question, context: extraContext } = args;
  const { 多智能体配置, keyManager, DovesProxy, 任务ID, 用户ID } = 上下文;

  if (!agentNames || agentNames.length === 0) {
    return { success: false, result: '', error: '未指定要咨询的智能体' };
  }
  if (!question) {
    return { success: false, result: '', error: '未提供咨询问题' };
  }
  if (!多智能体配置?.智能体列表) {
    return { success: false, result: '', error: '多智能体配置不可用' };
  }

  const 智能体列表 = 多智能体配置.智能体列表;
  const results = [];

  for (const name of agentNames) {
    const agent = 智能体列表.find(a => a.角色名 === name);
    if (!agent) {
      results.push({ agent: name, error: `未找到智能体"${name}"` });
      continue;
    }

    logger.info(`咨询 ${agent.角色名} (${agent.模型提供商}/${agent.模型名})...`);

    try {
      const response = await _咨询单个智能体(agent, question, extraContext, { keyManager, DovesProxy, 任务ID, 用户ID });
      results.push({ agent: name, response });
      logger.info(`${agent.角色名} 回复: ${response.substring(0, 100)}...`);
    } catch (e) {
      logger.warn(`咨询 ${agent.角色名} 失败: ${e.message}`);
      results.push({ agent: name, error: e.message });
    }
  }

  // 汇总结果
  const formattedResults = results.map(r => {
    if (r.error) {
      return `## ${r.agent}\n**错误**: ${r.error}`;
    }
    return `## ${r.agent}\n${r.response}`;
  }).join('\n\n---\n\n');

  return {
    success: true,
    result: formattedResults,
  };
}

/**
 * 咨询单个智能体：mini KISS 循环
 * @private
 */
async function _咨询单个智能体(agent, question, extraContext, { keyManager, DovesProxy, 任务ID, 用户ID }) {
  // 创建该智能体的 LLM 客户端
  const { 提供商客户端 } = await import('../providers/index.js');
  
  let apiKey = '';
  if (keyManager && 用户ID) {
    const keyConfig = await keyManager.获取用户APIKey(用户ID, agent.模型提供商);
    apiKey = keyConfig?.apiKey || '';
  }
  if (!apiKey && keyManager) {
    const keyConfig = keyManager.获取官方Key(agent.模型提供商);
    apiKey = keyConfig?.apiKey || '';
  }
  if (!apiKey) {
    throw new Error(`未找到 ${agent.模型提供商} 的 API Key`);
  }

  const client = new 提供商客户端(agent.模型提供商, { API密钥: apiKey });

  // 构建咨询消息
  const systemMsg = `${agent.系统提示词 || '你是团队中的一名专业智能体。'}

## 当前场景
你被主智能体咨询，请根据你的专业视角独立分析以下问题。你可以调用工具来辅助分析（如搜索信息、读取文件等）。

## 输出要求
- 给出你的专业分析和建议
- 观点要明确，不要模棱两可
- 如果你需要更多信息，说明需要什么
- 如果问题超出你的专业范围，诚实说明`;

  const userMsg = extraContext
    ? `## 问题背景\n${extraContext}\n\n## 咨询问题\n${question}`
    : question;

  const messages = [
    { role: 'system', content: systemMsg },
    { role: 'user', content: userMsg },
  ];

  // Mini KISS 循环
  let allTools = 获取保底工具定义();
  let loadedGroups = new Set();
  let finalResponse = '';

  for (let round = 0; round < MAX_CONSULT_ROUNDS; round++) {
    const resp = await client.工具调用({
      model: agent.模型名,
      messages,
      tools: allTools,
      temperature: 0.7,
    });

    if (!resp.成功) {
      logger.warn(`${agent.角色名} LLM 调用失败: ${resp.错误}`);
      return `[调用失败: ${resp.错误}]`;
    }

    // 有工具调用
    if (resp.工具调用列表 && resp.工具调用列表.length > 0) {
      messages.push({
        role: 'assistant',
        content: resp.内容 || null,
        tool_calls: resp.工具调用列表,
      });

      for (const tc of resp.工具调用列表) {
        const 工具名 = tc.function.name;
        let 参数;
        try { 参数 = JSON.parse(tc.function.arguments); } catch { 参数 = {}; }

        // consult_agents 在被咨询智能体中不可用（防止递归咨询）
        if (工具名 === 'consult_agents' || 工具名 === 'delegate_subtasks') {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: '此工具在被咨询模式下不可用，请直接给出你的分析。',
          });
          continue;
        }

        const execResult = await executeSkill(工具名, 参数, { DovesProxy, 任务ID, 用户ID });

        // 工具组加载
        if (工具名 === 'load_tool_group' && execResult.groupTools) {
          for (const tool of execResult.groupTools) {
            const name = tool.function?.name || tool.name;
            if (!allTools.find(t => (t.function?.name || t.name) === name)) {
              allTools.push(tool);
            }
          }
          loadedGroups.add(参数.group);
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: execResult.success ? execResult.result : `错误: ${execResult.error}`,
        });
      }
      continue;
    }

    // 无工具调用，这是最终回复
    if (resp.内容) {
      finalResponse = resp.内容;
    }
    break;
  }

  if (!finalResponse) {
    finalResponse = '[未给出明确回复]';
  }

  return finalResponse;
}

export default { consultAgentsToolDef, 执行智能体咨询 };
