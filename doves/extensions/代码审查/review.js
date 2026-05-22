/**
 * 代码审查审核规则
 * 质量门禁未通过时阻断 merge/push 操作
 */
export default {
  customChecks: [
    {
      name: 'code_review_quality_gate',
      check: (规划结果, 原始任务) => {
        const 子任务列表 = 规划结果.subTasks || [];
        const warnings = [];

        for (const 子任务 of 子任务列表) {
          const desc = 子任务.description || '';
          // 检查是否在未审查的情况下执行merge/push
          if ((desc.includes('git_merge') || desc.includes('git_push')) &&
              !子任务列表.some(s => s.description && (s.description.includes('review_pr') || s.description.includes('quality_gate')))) {
            warnings.push(
              `建议审查: 子任务 "${子任务.id || 'unknown'}" 涉及 merge/push，建议先进行代码审查（review_pr + quality_gate）`
            );
          }
        }

        return {
          passed: true,  // 不阻断，仅警告
          warnings,
          errors: []
        };
      }
    }
  ]
};
