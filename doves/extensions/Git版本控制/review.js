/**
 * Git危险操作审核规则
 * 
 * 匹配危险Git工具调用，要求用户确认并建议创建快照
 * 
 * 导出格式：{ customChecks: [{ name, check }] }
 * check(规划结果, 原始任务) → { passed, warnings, errors }
 */

const DANGEROUS_GIT_TOOLS = ['git_push', 'git_merge', 'git_rebase', 'git_reset'];
const FORCE_PUSH_TOOL = 'git_push';  // force push 额外警告
const CAUTION_GIT_TOOLS = ['git_cherry_pick', 'git_revert', 'git_commit'];  // caution 级别的操作也需要关注

export default {
  customChecks: [
    {
      name: 'git_dangerous_operation',
      check: (规划结果, 原始任务) => {
        const 子任务列表 = 规划结果.subTasks || [];
        const warnings = [];
        const errors = [];

        for (const 子任务 of 子任务列表) {
          const 工具名 = 子任务.toolName || 子任务.工具名 || '';
          const 能力需求 = 子任务.abilities || 子任务.能力需求 || [];

          // 检查是否包含危险Git工具
          const isDangerous = DANGEROUS_GIT_TOOLS.some(t => 工具名 === t) ||
            (子任务.description && DANGEROUS_GIT_TOOLS.some(t => 子任务.description.includes(t)));

          if (isDangerous) {
            warnings.push(
              `Git危险操作检测: 子任务 "${子任务.id || 'unknown'}" 涉及 ${工具名 || '危险Git工具'}，` +
              `执行前建议创建Git存储磁盘快照，并需要用户确认`
            );
          }

          // 检查force push
          if (子任务.description && 子任务.description.includes('force push')) {
            errors.push(
              `极度危险操作: 子任务 "${子任务.id || 'unknown'}" 涉及 force push，` +
              `这将重写远程历史，必须获得用户明确确认后才能执行`
            );
          }

          // 检查 caution 级别操作
          const isCaution = CAUTION_GIT_TOOLS.some(t => 工具名 === t) ||
            (子任务.description && CAUTION_GIT_TOOLS.some(t => 子任务.description.includes(t)));

          if (isCaution && !isDangerous) {
            warnings.push(
              `Git注意操作: 子任务 "${子任务.id || 'unknown'}" 涉及 ${工具名 || 'caution Git工具'}，` +
              `执行后需验证结果正确性`
            );
          }

          // 检查 cherry-pick 可能产生冲突
          if (工具名 === 'git_cherry_pick' || (子任务.description && 子任务.description.includes('cherry-pick'))) {
            warnings.push(
              `Cherry-pick提示: 子任务 "${子任务.id || 'unknown'}" 涉及 cherry-pick，可能产生冲突，建议配合 conflict_resolver 使用`
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
