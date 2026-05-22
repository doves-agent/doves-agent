/**
 * 邮箱代理审核规则
 * 检查邮件操作的安全性
 */
export default {
  customChecks: [
    {
      name: 'email_agent_safety',
      check: (规划结果, 原始任务) => {
        const 子任务列表 = 规划结果.subTasks || [];
        const warnings = [];
        const errors = [];

        for (const 子任务 of 子任务列表) {
          const 工具名 = 子任务.toolName || 子任务.工具名 || '';
          const desc = 子任务.description || '';

          // 发送邮件 - 高风险
          if (工具名 === 'email_send' || desc.includes('发送邮件')) {
            const 收件人 = 子任务.arguments?.to || '';
            if (收件人和数量 > 10) {
              errors.push(
                `批量发送检测: 子任务 "${子任务.id || 'unknown'}" 涉及向 ${收件人和数量} 个收件人发送邮件，必须获得用户明确确认`
              );
            } else {
              warnings.push(
                `邮件发送操作: 子任务 "${子任务.id || 'unknown'}" 涉及发送邮件到 ${收件人 || '未指定收件人'}，需要用户确认内容后执行`
              );
            }
          }

          // 回复邮件 - 注意引用原文和语气
          if (工具名 === 'email_reply' || desc.includes('回复邮件')) {
            warnings.push(
              `邮件回复操作: 子任务 "${子任务.id || 'unknown'}" 涉及回复邮件，建议用户检查AI生成的回复内容后再发送`
            );
          }

          // 删除邮件 - 高风险
          if (工具名 === 'email_delete' || desc.includes('删除邮件')) {
            errors.push(
              `邮件删除操作: 子任务 "${子任务.id || 'unknown'}" 涉及删除邮件，必须获得用户明确确认后才能执行`
            );
          }

          // 批量操作提醒
          if (desc.includes('批量') || desc.includes('所有邮件') || desc.includes('全部')) {
            warnings.push(
              `批量操作提醒: 子任务 "${子任务.id || 'unknown'}" 涉及批量邮件操作，建议先在小范围验证`
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
