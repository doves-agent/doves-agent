/**
 * 视频处理审核规则
 */
export default {
  customChecks: [
    {
      name: 'video_processor_safety',
      check: (规划结果, 原始任务) => {
        const 子任务列表 = 规划结果.subTasks || [];
        const warnings = [];
        const errors = [];

        for (const 子任务 of 子任务列表) {
          const 工具名 = 子任务.toolName || 子任务.工具名 || '';
          const desc = 子任务.description || '';
          const args = 子任务.arguments || {};
          const id = 子任务.id || '未知';

          // 覆盖原文件
          if (args.output && args.input && args.output === args.input) {
            warnings.push(`覆盖原文件: 子任务 "${id}" 输出将覆盖输入文件，建议使用新文件名`);
          }

          // 大量文件合并
          if (工具名 === 'video_merge' && args.files?.length > 5) {
            warnings.push(`大量合并: 子任务 "${id}" 合并 ${args.files.length} 个文件，预计耗时较长`);
          }

          // 删除源文件
          if (desc.includes('删除') && desc.includes('源文件')) {
            errors.push(`删除源文件: 子任务 "${id}" 涉及删除源文件，必须获得用户确认`);
          }

          // 高分辨率处理资源提醒
          if (desc.match(/4K|2160p/) || args.resolution?.includes('3840')) {
            warnings.push(`高分辨率: 子任务 "${id}" 涉及4K处理，可能消耗大量CPU资源`);
          }

          // AI工具依赖提醒
          if (['video_analyze', 'video_qa', 'video_transcribe'].includes(工具名)) {
            warnings.push(`AI能力: 子任务 "${id}" 使用百炼API，需确保API Key已配置且有额度`);
          }

          // 大文件AI分析限制
          if (['video_analyze', 'video_qa'].includes(工具名) && desc.match(/大文件|长视频/)) {
            warnings.push(`文件限制: 子任务 "${id}" AI分析限制20MB以内，大文件请先上传OSS`);
          }
        }

        return { passed: errors.length === 0, warnings, errors };
      }
    }
  ]
};
