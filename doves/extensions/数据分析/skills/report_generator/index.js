/**
 * 报表生成技能
 * 数据 → 图表 → 洞察 → HTML报告 → OSS托管
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('report_generator', { 前缀: '[report_generator]', 级别: 'debug', 显示调用位置: true });

async function execute(args, context) {
  const { action = 'create', title, data, insights = [], suggestions = [], chartType = 'bar', template = 'standard' } = args;

  logger.info(`执行: ${action}`);

  try {
    switch (action) {

      case 'create': {
        if (!title) return { 成功: false, 错误: '缺少必填参数: title' };

        const sections = [];

        // 概述
        if (insights.length > 0) {
          sections.push({
            heading: '概述',
            content: insights.map(i => `<p>${i}</p>`).join('\n')
          });
        }

        // 数据图表
        if (data) {
          sections.push({
            heading: '数据可视化',
            content: '<p>数据图表区域</p>',
            chart: data
          });
        }

        return {
          成功: true,
          数据: {
            title,
            sections,
            suggestions,
            chartType,
            template,
            hint: '请使用 data_report 工具将以上内容生成为HTML报告并托管'
          }
        };
      }

      case 'templates': {
        return {
          成功: true,
          数据: {
            templates: [
              { id: 'standard', name: '标准报告', sections: ['概述', '数据', '图表', '建议'] },
              { id: 'weekly', name: '周报', sections: ['本周概述', '关键指标', '趋势图表', '下周计划'] },
              { id: 'incident', name: '事故报告', sections: ['事故概述', '时间线', '影响范围', '根因分析', '修复方案'] },
              { id: 'performance', name: '性能报告', sections: ['性能概况', '关键指标', '对比图表', '优化建议'] },
            ]
          }
        };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}，支持: create / templates` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'report_generator',
  description: '报表生成技能 — 数据→图表→洞察→HTML报告→OSS托管',
  abilities: ['数据分析', '报表生成'],

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'templates'],
        description: '操作类型：create=创建报告 / templates=列出模板'
      },
      title: { type: 'string', description: '报告标题' },
      data: { type: 'object', description: '图表数据（ECharts配置）' },
      insights: { type: 'array', items: { type: 'string' }, description: '洞察列表' },
      suggestions: { type: 'array', items: { type: 'string' }, description: '建议列表' },
      chartType: { type: 'string', description: '图表类型' },
      template: { type: 'string', description: '报告模板（standard/weekly/incident/performance）' }
    },
    required: ['action']
  },

  execute
};
