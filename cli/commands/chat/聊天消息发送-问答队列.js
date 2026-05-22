/**
 * 聊天消息发送-问答队列
 * @description 串行化用户交互问题队列，防止多子任务并发提问竞争 stdin
 */

import chalk from 'chalk';
import { display } from '../../display.js';
import { handleUserQuestion } from './对话管理.js';
import { handleCliAction } from '../../lib/cli-action-handler.js';

/**
 * 创建问答队列
 * @param {Object} 共享状态 - { settled: boolean, streamingStarted: boolean }
 * @param {Object} refs - { progressUI, spinner, 对话日志, convId }
 * @returns {{ enqueueQuestion, cancelAllQuestions }}
 */
export function 创建问答队列(共享状态, refs) {
  const questionQueue = [];
  let isQuestionActive = false;
  let activeQuestionCancel = null;

  function cancelAllQuestions() {
    questionQueue.length = 0;
    if (activeQuestionCancel) {
      try { activeQuestionCancel(); } catch (e) { console.warn('[Chat] 取消问题失败:', e.message); }
      activeQuestionCancel = null;
    }
  }

  async function enqueueQuestion(clientRef, taskIdRef, questionData, eventId) {
    if (共享状态.settled) return;
    const item = { clientRef, taskIdRef, questionData, eventId };
    if (isQuestionActive) {
      questionQueue.push(item);
    } else {
      await processQuestion(item);
    }
  }

  async function processQuestion(item) {
    isQuestionActive = true;
    let _origLog, _origError;
    try {
      const { clientRef, taskIdRef, questionData } = item;

      // CLI 操作请求：走专用处理流程
      if (questionData?._cliAction) {
        if (refs.progressUI) { refs.progressUI.stop(); }
        else if (refs.spinner) { refs.spinner.stop(); }

        activeQuestionCancel = () => {
          try { process.stdin.push('\n'); } catch (e) { console.warn('[Chat] CLI操作push失败:', e.message); }
        };
        try {
          await handleCliAction(clientRef, questionData.eventData);
        } catch (e) {
          console.error(`[Chat] CLI 操作请求处理异常: ${e.message}`);
        }
        activeQuestionCancel = null;

        if (!共享状态.streamingStarted) {
          if (refs.progressUI) { refs.progressUI.start(); }
          else if (refs.spinner) { await new Promise(r => setTimeout(r, 500)); refs.spinner.spinner = display.spinners.thinking; refs.spinner.start(); }
        }
        return;
      }

      // 普通用户交互问题
      if (refs.progressUI) {
        refs.progressUI.showQuestion(questionData);
      } else if (refs.spinner) {
        refs.spinner.stop();
      }

      _origLog = console.log;
      _origError = console.error;
      const _deferredLogs = [];
      console.log = (...args) => _deferredLogs.push({ level: 'log', args });
      console.error = (...args) => _deferredLogs.push({ level: 'error', args });

      activeQuestionCancel = () => {
        try { process.stdin.push('\n'); } catch (e) { console.warn('[Chat] 问题push失败:', e.message); }
      };
      try {
        await handleUserQuestion(clientRef, taskIdRef, questionData, item.eventId);
      } finally {
        console.log = _origLog;
        console.error = _origError;
      }
      activeQuestionCancel = null;

      if (refs.progressUI) {
        refs.progressUI.hideQuestion();
      } else if (refs.spinner) {
        await new Promise(r => setTimeout(r, 500));
        refs.spinner.spinner = display.spinners.thinking;
        refs.spinner.start();
      }

      if (_deferredLogs.length > 0) {
        if (refs.progressUI) {
          for (const { level, args } of _deferredLogs) {
            const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
            refs.progressUI._errors.push(`⏳ ${msg}`);
          }
        } else {
          _origLog(chalk.cyan('\n┌─ 延迟日志 ───────────────────────────────────'));
          for (const { level, args } of _deferredLogs) {
            const prefix = chalk.gray('│ ');
            if (level === 'error') { _origError(prefix, ...args); } else { _origLog(prefix, ...args); }
          }
          _origLog(chalk.cyan('└──────────────────────────────────────────────'));
        }
      }
    } finally {
      if (_origLog) console.log = _origLog;
      if (_origError) console.error = _origError;
      activeQuestionCancel = null;
      isQuestionActive = false;
      if (!共享状态.settled && questionQueue.length > 0) {
        const next = questionQueue.shift();
        setImmediate(() => processQuestion(next));
      }
    }
  }

  return { enqueueQuestion, cancelAllQuestions };
}
