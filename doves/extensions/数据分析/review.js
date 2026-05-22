/**
 * 数据分析审核规则
 * 检查数据查询/修改/导出操作的安全性
 */
export default {
  customChecks: [
    {
      name: 'data_analytics_operation_safety',
      check: (规划结果, 原始任务) => {
        const 子任务列表 = 规划结果.subTasks || [];
        const warnings = [];
        const errors = [];

        for (const 子任务 of 子任务列表) {
          const 工具名 = 子任务.toolName || 子任务.工具名 || '';
          const desc = 子任务.description || '';

          // SQL 写操作需要确认
          if (工具名 === 'sql_execute' || 工具名 === 'query_execute') {
            const 查询 = 子任务.arguments?.query || 子任务.arguments?.sql || '';
            const 写操作关键词 = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE'];
            if (写操作关键词.some(k => 查询.toUpperCase().includes(k))) {
              errors.push(
                `数据库写操作: 子任务 "${子任务.id || 'unknown'}" 涉及数据修改/删除，必须获得用户确认后才能执行`
              );
            }
          }

          // 数据导出到外部
          if (工具名 === 'data_export' || desc.includes('导出数据') || desc.includes('export')) {
            warnings.push(
              `数据导出操作: 子任务 "${子任务.id || 'unknown'}" 涉及数据导出，建议确认数据范围和数据敏感性`
            );
          }

          // 数据删除/清空
          if (desc.includes('清空') || desc.includes('删除数据') || desc.includes('清除')) {
            errors.push(
              `数据清除操作: 子任务 "${子任务.id || 'unknown'}" 涉及数据清除，必须获得用户明确确认后才能执行`
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
