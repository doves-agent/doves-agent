/**
 * @file 智能体-多智能体协作执行器
 * @description 多智能体协作执行核心 —— 主智能体协调 + 成员咨询 + 工具执行
 * 
 * 协作流程：
 * 1. 主智能体收到用户消息 → 意图理解
 * 2. 主智能体决定是否咨询其他成员（调用 consult_agents 工具）
 * 3. 被咨询的智能体独立分析（可调用工具），返回观点
 * 4. 主智能体汇总 → 继续讨论或输出最终结果
 * 5. 用户随时可发新指令，主智能体调整方向
 * 
 * 使用方式：
 *   import { 多智能体协作执行 } from './智能体-多智能体协作执行器.js';
 *   const result = await 多智能体协作执行(任务, 上下文);
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';
import { 获取或生成机器标识 } from '@dove/common/机器标识.js';
import { 获取保底工具定义, 获取分组工具定义 } from './精简工具定义.js';
import { executeSkill } from './精简工具执行.js';
import { 生成系统提示词 } from './系统提示词生成器.js';
import { consultAgentsToolDef, 执行智能体咨询 } from './tools/智能体咨询.js';
import { 提供商客户端 } from './providers/index.js';
import { ObjectId } from '@dove/common/对象标识.js';

const logger = 创建日志器('多智能体协作', { 前缀: '[协作]', 级别: 'debug' });

/** 主智能体最大工具调用轮数 */
const MAX_ROUNDS = parseInt(process.env.DOVE_MAX_TOOL_ROUNDS) || 20;

// ==================== 主入口 ====================

/**
 * 多智能体协作执行
 * 
 * @param {Object} 任务 - { 任务ID, 消息, 描述, 上下文, 用户ID, 对话ID... }
 * @param {Object} 上下文 - {
 *   多智能体配置: { 主智能体角色名, 智能体列表 },
 *   任务队列: 任务队列实例（用于提交结果）,
 *   DovesProxy: 代理实例,
 *   keyManager: KeyManager 实例,
 *   能力管理器: 能力管理器实例,
 *   conversationTools: 对话工具实例,
 * }
 * @returns {Promise<{success: boolean, result: string, error?: string}>}
 */
export async function 多智能体协作执行(任务, 上下文 = {}) {
  const 任务ID = 任务.任务ID;
  const 对话ID = 任务.对话ID || null;
  const 用户消息 = 任务.消息 || '';
  const 多智能体配置 = 上下文.多智能体配置;
  const 任务队列 = 上下文.任务队列;
  const DovesProxy = 上下文.DovesProxy;
  const keyManager = 上下文.keyManager;
  const 能力管理器 = 上下文.能力管理器;
  const conversationTools = 上下文.conversationTools;
  const userId = 任务.用户ID;

  if (!任务队列) {
    return { success: false, result: '', error: '多智能体协作: 缺少 任务队列' };
  }
  if (!多智能体配置?.智能体列表) {
    return { success: false, result: '', error: '多智能体协作: 缺少 多智能体配置' };
  }

  // 提取主智能体和其他成员
  const 主智能体 = 多智能体配置.智能体列表.find(a => a.是否主智能体);
  if (!主智能体) {
    return { success: false, result: '', error: '多智能体协作: 配置中缺少主智能体' };
  }
  const 其他智能体 = 多智能体配置.智能体列表.filter(a => !a.是否主智能体);

  logger.info(`协作开始: ${任务ID} | 主智能体=${主智能体.角色名}(${主智能体.模型名}) | 成员=${其他智能体.map(a => a.角色名).join('、') || '无'}`);
  logger.info(`  用户消息: ${用户消息.substring(0, 120)}`);

  // 创建主智能体的 LLM 客户端
  const 主APIKey = await _获取APIKey(keyManager, userId, 主智能体.模型提供商);
  const 主客户端 = new 提供商客户端(主智能体.模型提供商, { API密钥: 主APIKey });

  // 构建主智能体系统提示词
  const 系统提示 = await _构建主系统提示词(主智能体, 其他智能体, { 能力管理器, DovesProxy });

  // ★ 注入历史对话
  const historyMessages = await _加载历史对话(conversationTools, 对话ID);

  // 初始工具列表：保底工具 + consult_agents
  let allTools = [...获取保底工具定义(), consultAgentsToolDef];
  let loadedGroups = new Set();
  let finalResult = '';
  let toolRounds = 0;

  const messages = [
    { role: 'system', content: 系统提示 },
    ...historyMessages,
    { role: 'user', content: 用户消息 },
  ];

  logger.info(`  初始工具: ${allTools.length} 个（保底 + consult_agents）`);

  try {
    // ==================== 主智能体 KISS 循环 ====================
    while (toolRounds < MAX_ROUNDS) {
      toolRounds++;

      const resp = await 主客户端.工具调用({
        model: 主智能体.模型名,
        messages,
        tools: allTools,
        temperature: 0.7,
      });

      if (!resp.成功) {
        logger.error(`主智能体 LLM 调用失败: ${resp.错误}`);
        await _提交失败(任务队列, 任务ID, resp.错误);
        return { success: false, result: '', error: resp.错误 };
      }

      // 有工具调用
      if (resp.工具调用列表 && resp.工具调用列表.length > 0) {
        messages.push({
          role: 'assistant',
          content: resp.内容 || null,
          tool_calls: resp.工具调用列表,
        });

        let needPause = false;
        let pauseResponse = null;

        for (const tc of resp.工具调用列表) {
          const 工具名 = tc.function.name;
          let 参数;
          try { 参数 = JSON.parse(tc.function.arguments); } catch { 参数 = {}; }

          // === consult_agents：咨询其他智能体 ===
          if (工具名 === 'consult_agents') {
            logger.info(`  🗣️ consult_agents(${参数.agents?.join('、')})`);
            const consultResult = await 执行智能体咨询(参数, {
              多智能体配置,
              keyManager,
              DovesProxy,
              任务ID,
              用户ID: userId,
            });
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: consultResult.success ? consultResult.result : `咨询失败: ${consultResult.error}`,
            });
          }
          // === load_tool_group：按需加载工具组 ===
          else if (工具名 === 'load_tool_group') {
            logger.info(`  📦 ${工具名}(${JSON.stringify(参数).substring(0, 80)})`);
            const execResult = await executeSkill(工具名, 参数, { DovesProxy, 任务ID, 根任务ID: 任务.根任务ID || 任务ID, 用户ID: userId });
            if (execResult.groupTools) {
              let 新增数 = 0;
              for (const tool of execResult.groupTools) {
                const name = tool.function?.name || tool.name;
                if (!allTools.find(t => (t.function?.name || t.name) === name)) {
                  allTools.push(tool);
                  新增数++;
                }
              }
              loadedGroups.add(参数.group);
              logger.info(`  已加载工具组: ${参数.group} (+${新增数}个)，累计 ${allTools.length} 个工具`);
            }
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: execResult.success ? execResult.result : `错误: ${execResult.error}`,
            });
          }
          // === __RESPOND__ 标记（需 CLI 协助） ===
          else if (工具名 !== 'delegate_subtasks') {
            logger.info(`  🔧 ${工具名}(${JSON.stringify(参数).substring(0, 80)})`);
            const execResult = await executeSkill(工具名, 参数, {
              DovesProxy,
              任务ID,
              根任务ID: 任务.根任务ID || 任务ID,
              用户ID: userId,
            });

            if (execResult.success && execResult.result?.startsWith('__RESPOND__')) {
              needPause = true;
              pauseResponse = JSON.parse(execResult.result.substring(11));
              messages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: '已发送请求给 CLI，等待回复...',
              });
            } else {
              messages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: execResult.success ? execResult.result : `错误: ${execResult.error}`,
              });
            }
          }
        }

        // CLI 协助暂停
        if (needPause && DovesProxy) {
          await _保存对话状态(DovesProxy, 任务ID, messages, toolRounds, 用户消息, loadedGroups);
          await DovesProxy.respond(任务ID, pauseResponse);
          logger.info(`  ⏫ 已请求 CLI，任务暂停: ${任务ID}`);
          return { success: true, result: '已请求 CLI 协助，等待回复后继续处理。', awaiting_cli: true };
        }

        continue;
      }

      // 无工具调用 → 最终回复
      if (resp.内容) {
        finalResult = resp.内容;
      }
      break;
    }

    if (toolRounds >= MAX_ROUNDS && !finalResult) {
      finalResult = '达到最大工具调用轮数，任务终止。';
    }

    // 写入对话轮次
    await _写入对话轮次(conversationTools, 对话ID, 任务ID, 用户消息, finalResult);

    // 提交结果
    await _提交成功(任务队列, 任务ID, finalResult);

    logger.info(`协作完成: ${任务ID} (${toolRounds} 轮)`);
    return { success: true, result: finalResult };

  } catch (e) {
    logger.error(`协作异常: ${任务ID} | ${e.message}`);
    await _提交失败(任务队列, 任务ID, e.message);
    return { success: false, result: '', error: e.message };
  }
}

// ==================== 系统提示词构建 ====================

/**
 * 构建主智能体的完整系统提示词
 * = 主智能体角色提示词 + 团队成员列表 + KISS 标准提示词 + consult_agents 说明
 */
async function _构建主系统提示词(主智能体, 其他智能体, { 能力管理器, DovesProxy }) {
  // KISS 标准系统提示词（工具组、工作方式、安全习惯等）
  const 同机 = await _检测同机(DovesProxy);
  const kiss提示词 = await 生成系统提示词({ 能力管理器实例: 能力管理器, 同机 });

  // 团队成员列表
  const 团队介绍 = _生成团队介绍(主智能体, 其他智能体);

  // consult_agents 使用说明
  const 咨询说明 = _生成咨询说明();

  // 拼接
  return `${主智能体.系统提示词 || ''}

---

${团队介绍}

---

${咨询说明}

---

${kiss提示词}`;
}

/**
 * 生成团队成员介绍段落
 */
function _生成团队介绍(主智能体, 其他智能体) {
  const 行 = ['## 你的团队'];

  行.push(`你是团队的协调者"**${主智能体.角色名}**"，当前团队成员如下：`);
  行.push('');

  for (const agent of 其他智能体) {
    const 摘要 = agent.系统提示词
      ? agent.系统提示词.substring(0, 100).replace(/\n/g, ' ')
      : '专业智能体';
    行.push(`- **${agent.角色名}** (${agent.模型提供商}/${agent.模型名})：${摘要}...`);
  }

  if (其他智能体.length === 0) {
    行.push('当前没有其他团队成员，你独自完成所有工作。');
  }

  return 行.join('\n');
}

/**
 * 生成 consult_agents 使用说明
 */
function _生成咨询说明() {
  return `## consult_agents 工具使用指南

你可以使用 consult_agents 工具咨询团队中的其他智能体。被咨询的智能体会用独立的 LLM 实例、独立的系统提示词、独立分析你提出的问题。他们也可以调用工具（如搜索、读文件等）来辅助分析。

### 何时使用
- 遇到需要多角度分析的问题
- 需要特定专业领域的深度建议
- 需要他人审查你的方案或代码
- 对某个决策不确定，需要多方意见

### 何时不使用
- 简单问题：直接处理，不必兴师动众
- 纯执行操作：读文件、写代码等直接做
- 用户明确要求快速回复时

### 使用方式
调用 consult_agents，指定 agents（角色名列表）和 question（你要咨询的问题）。可选附带 context（附加上下文）。被咨询的智能体会独立分析并返回他们的观点。你消化后做出综合输出。

### 注意事项
- 你可以同时咨询多个智能体，也可以分批咨询
- 如果某个智能体的观点需要进一步追问，可以在下一轮再次咨询
- 最终决策权在你，你有责任综合各方意见后做出最佳判断`;
}

// ==================== 同机检测 ====================

async function _检测同机(DovesProxy) {
  if (!DovesProxy) return false;
  try {
    const cliInfo = await DovesProxy.getCliCapabilities();
    if (cliInfo) {
      const myMachineId = 获取或生成机器标识();
      const cliMachineIds = cliInfo.cliMachineIds || [];
      return cliMachineIds.includes(myMachineId);
    }
  } catch (e) {
    logger.warn(`同机检测失败: ${e.message}`);
  }
  return false;
}

// ==================== API Key 获取 ====================

async function _获取APIKey(keyManager, userId, 提供商名) {
  if (keyManager && userId) {
    const keyConfig = await keyManager.获取用户APIKey(userId, 提供商名);
    if (keyConfig?.apiKey) return keyConfig.apiKey;
  }
  if (keyManager) {
    const keyConfig = keyManager.获取官方Key(提供商名);
    if (keyConfig?.apiKey) return keyConfig.apiKey;
  }
  throw new Error(`未找到 ${提供商名} 的 API Key`);
}

// ==================== 对话状态持久化 ====================

async function _保存对话状态(DovesProxy, 任务ID, messages, toolRounds, 原始消息 = '', loadedGroups = new Set()) {
  try {
    await DovesProxy.dbOperation('任务', 'updateOne', {
      query: { 任务ID },
      update: { $set: { 对话状态: { messages, toolRounds, loadedGroups: [...loadedGroups], 原始消息, 保存时间: new Date().toISOString() } } },
    });
    logger.info(`  💾 对话状态已保存: ${messages.length} 条消息, ${toolRounds} 轮`);
  } catch (e) {
    logger.warn(`  保存对话状态失败: ${e.message}`);
  }
}

// ==================== 对话轮次读写 ====================

async function _加载历史对话(conversationTools, 对话ID) {
  if (!conversationTools || !对话ID) return [];

  try {
    const history = await conversationTools.getHistory(对话ID, 10);
    if (!history || history.length === 0) return [];

    const messages = [];
    for (const turn of history) {
      if (turn.用户消息) messages.push({ role: 'user', content: turn.用户消息 });
      if (turn.分支摘要) messages.push({ role: 'assistant', content: turn.分支摘要 });
    }

    logger.info(`  📜 加载历史对话: ${history.length} 轮`);
    return messages;
  } catch (e) {
    logger.warn(`  加载历史对话失败: ${e.message}`);
    return [];
  }
}

async function _写入对话轮次(conversationTools, 对话ID, 任务ID, 用户消息, 助手回复) {
  if (!conversationTools || !对话ID) return;

  try {
    const turn = {
      轮次ID: new ObjectId().toString(),
      turnId: new ObjectId().toString(),
      用户消息,
      分支摘要: 助手回复,
      任务ID,
      routing: { 分类: 'routing' },
      创建时间: new Date().toISOString(),
    };
    const result = await conversationTools.addTurn(对话ID, turn);
    if (result.成功) {
      logger.info(`  📝 对话轮次已写入`);
    } else {
      logger.warn(`  对话轮次写入未匹配`);
    }
  } catch (e) {
    logger.warn(`  写入对话轮次失败: ${e.message}`);
  }
}

// ==================== 结果提交 ====================

async function _提交成功(任务队列, 任务ID, result) {
  try {
    const 结果对象 = {
      回复: result,
      数据: { 内容: result },
      content: result,
    };
    await 任务队列.写入结果(任务ID, 结果对象);
    const { 任务状态 } = await import('./常量.js');
    await 任务队列.更新状态(任务ID, 任务状态.COMPLETED, { 结果: 结果对象 });
  } catch (e) {
    logger.error(`提交结果失败: ${任务ID} | ${e.message}`);
  }
}

async function _提交失败(任务队列, 任务ID, error) {
  try {
    const { 任务状态 } = await import('./常量.js');
    await 任务队列.更新状态(任务ID, 任务状态.FAILED, { error });
  } catch (e) {
    logger.error(`提交失败状态异常: ${任务ID} | ${e.message}`);
  }
}

export default { 多智能体协作执行 };
