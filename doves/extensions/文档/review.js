/**
 * 文档审核规则
 * 检查文档生成/同步操作的安全性
 */
export default {
  customChecks: [
    {
      name: 'document_operation_safety',
      check: (规划结果, 原始任务) => {
        const 子任务列表 = 规划结果.subTasks || [];
        const warnings = [];

        for (const 子任务 of 子任务列表) {
          const 工具名 = 子任务.toolName || 子任务.工具名 || '';
          const desc = 子任务.description || '';

          // doc_sync_fix 可能覆盖文档内容
          if (工具名 === 'doc_sync_fix' || desc.includes('doc_sync_fix')) {
            warnings.push(
              `文档同步操作: 子任务 "${子任务.id || 'unknown'}" 涉及 doc_sync_fix，` +
              `将修改文档文件，建议先检查同步建议后再执行`
            );
          }

          // doc_generate 可能覆盖现有文档
          if (工具名 === 'doc_generate' && desc.includes('output')) {
            warnings.push(
              `文档生成操作: 子任务 "${子任务.id || 'unknown'}" 涉及 doc_generate 且指定了输出路径，` +
              `可能覆盖现有文档，建议确认后再执行`
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
