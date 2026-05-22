/**
 * 人类分身审核规则
 * 隐私保护是最高优先级
 */
export default {
  customChecks: [
    {
      name: 'human_avatar_privacy',
      check: (规划结果, 原始任务) => {
        const 子任务列表 = 规划结果.subTasks || [];
        const warnings = [];
        const errors = [];

        for (const 子任务 of 子任务列表) {
          const 工具名 = 子任务.toolName || 子任务.工具名 || '';
          const desc = 子任务.description || '';

          // 自动发送回复 - 确保用户知情
          if (工具名 === 'avatar_send_reply' || desc.includes('自动回复') || desc.includes('autoSend')) {
            const autoSend = 子任务.arguments?.autoSend;
            if (autoSend === true) {
              errors.push(
                `自动发送检测: 子任务 "${子任务.id || 'unknown'}" 启用了自动发送。自动发送功能必须用户显式启用，且每次发送前应通知用户。请改为用户确认后发送。`
              );
            } else {
              warnings.push(
                `分身回复发送: 子任务 "${子任务.id || 'unknown'}" 涉及发送分身回复，建议用户检查AI生成的回复内容是否准确反映个人语气`
              );
            }
          }

          // 模拟他人 - 严格禁止
          if (desc.includes('模拟') && (desc.includes('别人') || desc.includes('他人') || desc.includes('朋友') || desc.includes('同事'))) {
            errors.push(
              `模拟他人检测: 子任务 "${子任务.id || 'unknown'}" 涉及模拟他人语气，分身只能模拟用户自己的语气，严格禁止模拟他人`
            );
          }

          // 敏感话题提醒
          if (desc.includes('政治') || desc.includes('隐私') || desc.includes('密码') || desc.includes('账号')) {
            warnings.push(
              `敏感话题提醒: 子任务 "${子任务.id || 'unknown'}" 涉及敏感话题，建议谨慎处理`
            );
          }

          // 批量发送提醒
          if (desc.includes('批量') && desc.includes('发送')) {
            warnings.push(
              `批量发送检测: 子任务 "${子任务.id || 'unknown'}" 涉及批量发送消息，建议确认发送对象和内容`
            );
          }

          // 数据导出提醒
          if (工具名 === 'avatar_chat_history' && desc.includes('导出')) {
            warnings.push(
              `聊天记录导出: 子任务 "${子任务.id || 'unknown'}" 涉及导出聊天记录，导出的数据可能包含敏感信息`
            );
          }
        }

        return {
          passed: errors.length === 0,
          warnings,
          errors
        };
      }
    }
  ]
};
