/**
 * 词汇学习审核规则
 * 检查学习数据/复习计划操作的安全性
 */
export default {
  customChecks: [
    {
      name: 'vocabulary_operation_safety',
      check: (规划结果, 原始任务) => {
        const 子任务列表 = 规划结果.subTasks || [];
        const warnings = [];
        const errors = [];

        for (const 子任务 of 子任务列表) {
          const 工具名 = 子任务.toolName || 子任务.工具名 || '';
          const desc = 子任务.description || '';

          // 删除/清空操作需要确认
          if (工具名 === 'word_publish' && desc.includes('删除') || desc.includes('删除词库')) {
            errors.push(
              `词库删除操作: 子任务 "${子任务.id || '未知'}" 涉及删除词库数据，必须获得用户确认后才能执行`
            );
          }

          // 批量导入可能覆盖已有数据
          if (工具名.startsWith('word_import') || desc.includes('批量导入')) {
            warnings.push(
              `批量导入操作: 子任务 "${子任务.id || '未知'}" 涉及批量导入，建议确认导入范围和去重策略`
            );
          }

          // 学习计划调整
          if (desc.includes('修改学习计划') || desc.includes('重置进度') || desc.includes('复习')) {
            warnings.push(
              `学习计划调整: 子任务 "${子任务.id || '未知'}" 涉及学习计划修改，建议确认调整内容`
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
