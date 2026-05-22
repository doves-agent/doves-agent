/**
 * Demo展示审核规则
 * 检查页面生成/Demo发布操作的安全性
 */
export default {
  customChecks: [
    {
      name: 'demo_showcase_operation_safety',
      check: (规划结果, 原始任务) => {
        const 子任务列表 = 规划结果.subTasks || [];
        const warnings = [];
        const errors = [];

        for (const 子任务 of 子任务列表) {
          const 工具名 = 子任务.toolName || 子任务.工具名 || '';
          const desc = 子任务.description || '';

          // Demo 发布到公网需要确认
          if (desc.includes('发布') || desc.includes('部署') || desc.includes('上线') || desc.includes('publish')) {
            warnings.push(
              `Demo发布操作: 子任务 "${子任务.id || 'unknown'}" 涉及发布到公网，建议确认内容后再执行`
            );
          }

          // Demo 页面可能包含敏感信息
          if (desc.includes('数据') && (desc.includes('真实') || desc.includes('实际') || desc.includes('线上'))) {
            warnings.push(
              `数据安全提醒: 子任务 "${子任务.id || 'unknown'}" 可能包含真实数据，建议使用模拟数据或脱敏处理`
            );
          }

          // 覆盖已有 Demo
          if (工具名 === 'demo_publish' || 工具名 === 'demo_update') {
            warnings.push(
              `Demo更新操作: 子任务 "${子任务.id || 'unknown'}" 将覆盖已有Demo，建议确认后再执行`
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
