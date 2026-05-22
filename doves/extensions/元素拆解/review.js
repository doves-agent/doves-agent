/**
 * 元素拆解审核规则
 * 检查图片处理操作的安全性和合理性
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('元素拆解-审核', { 前缀: '[元素拆解/审核]', 级别: 'debug', 显示调用位置: true });

export default {
  customChecks: [
    {
      name: 'element_extract_safety',
      check: (规划结果, 原始任务) => {
        const 子任务列表 = 规划结果.subTasks || [];
        const warnings = [];
        const errors = [];

        logger.debug(`--- element_extract_safety 审核入口 ---`);
        logger.debug(`子任务数: ${子任务列表.length}`);

        for (const 子任务 of 子任务列表) {
          const 工具名 = 子任务.toolName || 子任务.工具名 || '';
          const args = 子任务.toolArgs || 子任务.参数 || {};
          logger.debug(`子任务[${子任务.id || 'unknown'}]: 工具名=${工具名}, skill=${子任务.skill || '(无)'}`);

          // 单次拆解元素数量过多
          if (工具名 === 'element_extract') {
            const elements = args.elements || [];
            logger.debug(`element_extract 元素数: ${elements.length}`);
            if (elements.length > 4) {
              errors.push(
                `元素数量超限: 子任务 "${子任务.id || 'unknown'}" 一次拆解 ${elements.length} 个元素，最多4个`
              );
            }
          }

          // 大量元素可能耗时较长
          const desc = 子任务.description || '';
          if (desc.includes('元素') && (desc.includes('所有') || desc.includes('全部'))) {
            warnings.push(
              `耗时提醒: 子任务 "${子任务.id || 'unknown'}" 可能涉及大量元素拆解，预计耗时较长`
            );
          }
        }

        // 未先分析就拆解 - 建议但不强制
        // 工具可自由组合，直接 extract 携带已知元素信息时也是合理的
        const hasExtract = 子任务列表.some(t => (t.toolName || t.工具名) === 'element_extract');
        const hasAnalyze = 子任务列表.some(t => (t.toolName || t.工具名) === 'element_analyze');
        logger.debug(`hasExtract=${hasExtract}, hasAnalyze=${hasAnalyze}`);
        if (hasExtract && !hasAnalyze) {
          warnings.push('建议先分析: 存在直接拆解元素的子任务，建议先用 element_analyze 识别（非强制，若元素已知可直接拆解）');
        }

        const result = {
          passed: errors.length === 0,
          warnings,
          errors
        };
        logger.debug(`审核结果: passed=${result.passed}, warnings=${warnings.length}, errors=${errors.length}`);
        return result;
      }
    }
  ]
};
