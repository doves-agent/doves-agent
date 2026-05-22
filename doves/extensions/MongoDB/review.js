/**
 * MongoDB代理审核规则
 * 安全第一：防止数据损坏
 */
export default {
  customChecks: [
    {
      name: 'mongo_agent_safety',
      check: (规划结果, 原始任务) => {
        const 子任务列表 = 规划结果.subTasks || [];
        const warnings = [];
        const errors = [];

        for (const 子任务 of 子任务列表) {
          const 工具名 = 子任务.toolName || 子任务.工具名 || '';
          const desc = 子任务.description || '';

          // 禁止 dropDatabase
          if (desc.includes('dropDatabase') || desc.includes('drop database') || 工具名 === 'mongo_drop_database') {
            errors.push(`禁止操作: 子任务 "${子任务.id || 'unknown'}" 试图删除整个数据库，此操作被严格禁止`);
          }

          // 批量删除/更新 - 必须有条件
          if (工具名 === 'mongo_delete_many' || 工具名 === 'mongo_update_many') {
            const query = 子任务.arguments?.query || 子任务.arguments?.filter;
            if (!query || Object.keys(query).length === 0) {
              errors.push(
                `无条件批量操作: 子任务 "${子任务.id || 'unknown'}" 使用了 ${工具名} 但没有查询条件，将影响全部文档。请添加条件限制`
              );
            } else {
              warnings.push(
                `批量操作提醒: 子任务 "${子任务.id || 'unknown'}" 使用 ${工具名}，条件: ${JSON.stringify(query)}，建议先使用 countDocuments 确认影响行数`
              );
            }
          }

          // replace_one - 提醒会整体替换
          if (工具名 === 'mongo_replace_one') {
            warnings.push(
              `文档替换提醒: 子任务 "${子任务.id || 'unknown'}" 使用 mongo_replace_one，会整体替换匹配的文档（保留_id），请确认替换内容完整`
            );
          }

          // $where 禁用
          if (desc.includes('$where') || JSON.stringify(子任务).includes('$where')) {
            errors.push(
              `安全违规: 子任务 "${子任务.id || 'unknown'}" 使用了 $where 操作符，$where 可执行任意JavaScript代码，已被禁用`
            );
          }

          // 大量导出提醒
          if (工具名 === 'mongo_export' || 工具名 === 'mongo_import') {
            warnings.push(
              `数据导入导出: 子任务 "${子任务.id || 'unknown'}" 涉及数据导入/导出，注意数据格式和编码`
            );
          }

          // 无limit查询提醒
          if (工具名 === 'mongo_find' && !子任务.arguments?.options?.limit && !子任务.arguments?.limit) {
            warnings.push(
              `无限制查询: 子任务 "${子任务.id || 'unknown'}" 的查询未设置 limit，大数据量时可能导致性能问题。默认限制为100条`
            );
          }

          // 创建索引提醒
          if (工具名 === 'mongo_create_index') {
            warnings.push(
              `创建索引: 子任务 "${子任务.id || 'unknown'}" 正在创建索引，大集合上创建索引可能耗时较长`
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
