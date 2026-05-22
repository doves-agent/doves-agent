/**
 * 项目管理审核规则
 * 检查任务创建/更新/删除操作的安全性
 */
export default {
  customChecks: [
    {
      name: 'project_mgmt_operation_safety',
      check: (规划结果, 原始任务) => {
        const 子任务列表 = 规划结果.subTasks || [];
        const warnings = [];
        const errors = [];

        for (const 子任务 of 子任务列表) {
          const 工具名 = 子任务.toolName || 子任务.工具名 || '';
          const desc = 子任务.description || '';

          // 任务删除/状态变更需要确认
          if (工具名 === 'task_delete' || desc.includes('删除任务')) {
            errors.push(
              `任务删除操作: 子任务 "${子任务.id || 'unknown'}" 涉及删除任务，必须获得用户明确确认后才能执行`
            );
          }

          // 任务状态批量变更
          if (desc.includes('批量') && (desc.includes('状态') || desc.includes('完成') || desc.includes('关闭'))) {
            warnings.push(
              `批量状态变更: 子任务 "${子任务.id || 'unknown'}" 涉及批量状态变更，建议先确认影响范围`
            );
          }

          // 周报/报告自动生成和发送
          if (工具名 === 'weekly_report' || 工具名 === 'report_send' || desc.includes('发送周报')) {
            warnings.push(
              `报告发送操作: 子任务 "${子任务.id || 'unknown'}" 涉及发送报告，建议确认报告内容后再执行`
            );
          }

          // 禅道/Jira 数据同步
          if (desc.includes('禅道') || desc.includes('Jira') || desc.includes('同步')) {
            warnings.push(
              `外部系统同步: 子任务 "${子任务.id || 'unknown'}" 涉及禅道/Jira数据同步，建议先确认同步方向`
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
