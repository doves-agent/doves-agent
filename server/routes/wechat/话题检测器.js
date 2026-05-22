/**
 * 话题切换检测器
 * 使用 Flash 模型判断用户消息是否属于新话题
 *
 * 架构约束：Server 不调用 LLM，话题检测通过 LLM任务代理 交由 Doves 执行
 */

import { logger } from '../../core.js';
import { 请求LLM判断 } from '../../事件调度/LLM任务代理.js';

/**
 * 检测用户消息是否属于新话题，需要新建对话
 * @param {string} userMessage - 用户新消息
 * @param {Object} existingConv - 已有对话对象
 * @param {Object} state - 监听器状态
 * @returns {Promise<{needNew: boolean, reason?: string}>}
 */
export async function detectTopicSwitch(userMessage, existingConv, state) {
  try {
    const turns = existingConv.对话轮次 || [];
    if (turns.length === 0) {
      return { needNew: false };
    }

    // 构建对话历史摘要（最近3轮）
    const recentTurns = turns.slice(-3);
    let conversationSummary = '';
    for (const turn of recentTurns) {
      const userMsg = turn.用户消息 || turn.userMessage || '';
      const aiMsg = turn.分支摘要 || turn.assistantMessage || turn.ai回复 || '';
      if (userMsg) conversationSummary += `用户: ${userMsg.slice(0, 100)}\n`;
      if (aiMsg) conversationSummary += `助手: ${aiMsg.slice(0, 100)}\n`;
    }

    if (!conversationSummary.trim()) {
      return { needNew: false };
    }

    // 如果距离上次对话时间太久（超过1小时），也触发询问
    const lastTurn = turns[turns.length - 1];
    const lastTimestamp = lastTurn.创建时间戳 || lastTurn.timestamp || 0;
    if (lastTimestamp && Date.now() / 1000 - lastTimestamp > 3600) {
      logger.info('[微信监听] 距上次对话超过1小时，建议新建对话');
      return { needNew: true, reason: '距上次对话已超过1小时，这看起来是一个新话题' };
    }

    // 通过 LLM任务代理 调用 Flash 模型判断话题是否切换
    const prompt = `判断新消息是否与原对话话题相关。

原对话:
${conversationSummary}
新消息: ${userMessage.slice(0, 200)}

只返回JSON: {"needNew": true/false, "reason": "简短原因"}
- 话题明显不同（技术→点外卖）→ needNew=true
- 话题延续/追问 → needNew=false
- 简单问候不算新话题`;

    try {
      const parsed = await 请求LLM判断({
        提示词: prompt,
        temperature: 0,
        max_tokens: 100,
        label: '微信话题检测',
        timeout: 8000,
      });

      if (!parsed || parsed.needNew === undefined) {
        logger.warn(`[微信监听] 话题检测结果格式异常: ${JSON.stringify(parsed).slice(0, 100)}`);
        return { needNew: false };
      }

      logger.info(`[微信监听] 话题检测结果: needNew=${parsed.needNew}, reason=${parsed.reason}`);
      return { needNew: !!parsed.needNew, reason: parsed.reason };
    } catch (err) {
      logger.warn(`[微信监听] 话题检测 LLM 调用失败: ${err.message}`);
      return { needNew: false };
    }

  } catch (err) {
    logger.warn(`[微信监听] 话题检测异常: ${err.message}`);
    return { needNew: false };
  }
}
