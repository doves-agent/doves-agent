/**
 * 编码操作审核规则
 * 检查代码修改/文件操作的安全性
 */
export default {
  customChecks: [
    {
      name: 'coding_operation_safety',
      check: (规划结果, 原始任务) => {
        const 子任务列表 = 规划结果.subTasks || [];
        const warnings = [];
        const errors = [];

        for (const 子任务 of 子任务列表) {
          const 工具名 = 子任务.toolName || 子任务.工具名 || '';
          const desc = 子任务.description || '';

          // 代码编辑 可能覆盖大段代码
          if (工具名 === '代码编辑' || 工具名 === '代码创建') {
            warnings.push(
              `文件修改操作: 子任务 "${子任务.id || 'unknown'}" 涉及 ${工具名}，将修改文件内容，建议先读取目标文件确认后再执行`
            );
          }

          // code_delete / 文件删除 危险操作
          if (工具名 === 'code_delete_file' || 工具名 === '文件删除' || desc.includes('删除文件') || desc.includes('delete_file')) {
            errors.push(
              `文件删除操作: 子任务 "${子任务.id || 'unknown'}" 涉及文件删除，必须获得用户明确确认后才能执行`
            );
          }

          // 执行命令 涉及危险命令
          if (工具名 === '执行命令') {
            const 命令 = 子任务.arguments?.command || '';
            const dangerousCmds = ['rm -rf', 'del /f', 'format', 'mkfs', 'dd if='];
            if (dangerousCmds.some(c => 命令.includes(c))) {
              errors.push(
                `极度危险命令: 子任务 "${子任务.id || 'unknown'}" 包含高风险命令 "${命令}"，已被阻断`
              );
            }
          }

          // 批量文件修改需谨慎
          if (desc.includes('批量') || desc.includes('所有文件') || desc.includes('全部文件')) {
            warnings.push(
              `批量操作提醒: 子任务 "${子任务.id || 'unknown'}" 涉及批量文件修改，建议先在小范围内验证`
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
