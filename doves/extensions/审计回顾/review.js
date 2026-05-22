/**
 * 审计回顾审核规则
 * 确保审计查询只读、只能查自己的数据
 */
export default {
  customChecks: [
    {
      name: 'audit_read_only_safety',
      check: (规划结果, 原始任务) => {
        const 子任务列表 = 规划结果.subTasks || [];
        const warnings = [];
        const errors = [];

        for (const 子任务 of 子任务列表) {
          const 工具名 = 子任务.toolName || 子任务.工具名 || '';
          const desc = 子任务.description || '';

          // 审计工具不应该用于写入
          if (工具名.startsWith('audit_') && (desc.includes('修改') || desc.includes('删除') || desc.includes('写入'))) {
            errors.push(
              `审计工具只读违规: 子任务 "${子任务.id || 'unknown'}" 试图通过审计工具执行写操作`
            );
          }
        }

        return {
          passed: errors.length === 0,
          warnings,
          errors,
        };
      },
    },
  ],
};
