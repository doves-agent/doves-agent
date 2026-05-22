/**
 * 聊天消息发送-结果展示
 * @description 非流式输出时的结果提取与展示逻辑
 */

import { display } from '../../display.js';

/**
 * 折叠连续空行：将连续空行压缩为单个换行
 * 避免 LLM 流式输出中大量换行导致终端刷屏
 */
export function collapseBlankLines(text, state) {
  if (!text) return text;
  let result = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      state._consecutiveNewlines++;
      if (state._consecutiveNewlines <= 2) {
        result += '\n';
      }
    } else {
      state._consecutiveNewlines = 0;
      result += text[i];
    }
  }
  return result;
}

/**
 * 展示非流式结果（任务完成后如果没有流式输出，从结果中提取内容展示）
 * @param {Object} taskResult - 任务结果
 * @param {string} convId - 对话ID
 * @param {Object} 对话日志 - 日志记录器
 */
export function 展示结果(taskResult, convId, 对话日志) {
  const result = taskResult.result || {};
  const subResults = taskResult.subResults || taskResult.子任务结果 || [];

  // 优先提取 提示/摘要/zipUrl 等结构化信息
  let content =
    result.flashResponse?.content ||
    result.routing?.flashResponse?.content ||
    result.回复 ||
    result.数据?.提示 ||
    result.提示 ||
    result.数据?.内容 ||
    result.synthesis?.currentConclusion ||
    result.摘要 ||
    result.content ||
    null;

  // 如果还是没有，尝试从子任务结果中提取
  if (!content && subResults.length > 0) {
    const parts = [];
    for (const sub of subResults) {
      const subData = sub.result || sub.结果 || {};
      const subHint = subData.提示 || subData.数据?.提示 || '';
      const subZip = subData.zipUrl || subData.数据?.zipUrl || '';
      if (subHint) parts.push(subHint);
      if (subZip) parts.push(`下载: ${subZip}`);
    }
    if (parts.length > 0) content = parts.join('\n');
  }

  // 如果仍然没有，根据状态生成默认提示
  if (!content) {
    const status = taskResult.status || '';
    const childrenStatus = result.childrenStatus || taskResult.childrenStatus || {};
    const completed = childrenStatus.completed || childrenStatus.已完成 || 0;
    const total = childrenStatus.total || childrenStatus.总数 || 0;
    const failed = childrenStatus.failed || childrenStatus.失败 || 0;

    if (status === '已完成(部分失败)' || status === 'completed_with_errors') {
      content = `任务已完成，${completed}/${total} 个子任务成功` + (failed > 0 ? `，${failed} 个失败` : '');
    } else if (status === '已完成' || status === 'completed') {
      content = '任务已完成';
    } else {
      content = '完成';
    }
  }

  display.message('assistant', content);
  对话日志.白鸽完成(convId, content);
}

/**
 * 记录模型和提供商信息
 * @param {Object} taskResult - 任务结果
 * @param {string} convId - 对话ID
 * @param {string} taskId - 任务ID
 * @param {Object} 对话日志 - 日志记录器
 */
export function 记录模型信息(taskResult, convId, taskId, 对话日志) {
  const model = taskResult.result?.flashResponse?.model || taskResult.result?.routing?.flashResponse?.model || taskResult.result?.模型;
  const provider = taskResult.result?.flashResponse?.provider || taskResult.result?.routing?.flashResponse?.provider || taskResult.result?.提供商;
  if (model && provider) {
    对话日志.任务状态(convId, taskId, `完成 [${provider}/${model}]`);
  }
}
