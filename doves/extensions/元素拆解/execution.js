/**
 * 元素拆解执行器增强
 * 工具能力告知 + 背景模式指引
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('元素拆解-执行器', { 前缀: '[元素拆解/执行器]', 级别: 'debug', 显示调用位置: true });

export default {
  conditionalPrompts: [
    {
      match: (任务, tools) => {
        const 能力需求 = 任务.能力需求 || [];
        const matched = 能力需求.some(a => ['元素拆解', '图片拆元素', '元素提取', '图像分割'].includes(a));
        logger.debug(`conditionalPrompt match: 能力需求=[${能力需求.join(',')}], matched=${matched}`);
        return matched;
      },
      prompt: [
        '【元素拆解能力指引】',
        '本扩展提供 3 个原子工具，可独立调用、自由组合：',
        '- element_analyze：识图找元素（返回元素列表）',
        '- element_extract：拆解指定元素（组图模式，每批最多4个）',
        '- element_pack：打包上传 OSS（返回 zip 下载链接）',
        '',
        '【背景模式】（在任务描述中注明即可）',
        '- white：白底（默认）',
        '- black：黑底（自动将白底转黑底）',
        '- transparent：透明底（自动将白色区域设为透明，边缘柔化）',
        '',
        '【流程案例】（参考，非强制）',
        '- 全量拆解：analyze → extract(全部) → pack（可用 element_extract 技能快捷完成）',
        '- 指定拆解：analyze → extract([指定元素])',
        '- 只分析：analyze',
        '- 改后拆解：[其他工具编辑] → extract',
      ].join('\n'),
    },
  ],

  hooks: {
    afterToolCall: async (工具名, 结果, 任务) => {
      logger.debug(`afterToolCall: 工具名=${工具名}`);
      if (工具名 === 'element_extract' && 结果?.content?.[0]?.text) {
        try {
          const data = JSON.parse(结果.content[0].text);
          logger.debug(`element_extract 结果: success=${data.success}, extractedElements数=${data.extractedElements?.length || 0}, successCount=${data.successCount}`);
          if (data.extractedElements) {
            logger.info(`本批拆出 ${data.extractedElements.length} 个元素`);
          }
        } catch (e) {
          logger.debug(`element_extract 结果解析失败: ${e.message}`);
        }
      }
    }
  }
};
