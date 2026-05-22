/**
 * 页面生成技能
 * LLM驱动的HTML页面生成 — 基于需求和模板生成完整Demo页面
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('页面生成', { 前缀: '[page_builder]', 级别: 'debug', 显示调用位置: true });

async function execute(args, context) {
  const { action = 'generate', template, content = {}, requirements = '', techStack = 'html' } = args;

  logger.info(`执行: ${action}`);

  try {
    switch (action) {

      case 'generate': {
        // 返回页面生成指导信息
        return {
          成功: true,
          数据: {
            action: 'generate',
            template: template || 'custom',
            techStack,
            requirements,
            content,
            hint: '请基于以上需求和模板信息，生成完整的HTML页面内容，然后通过 demo_create 工具创建Demo'
          }
        };
      }

      case 'validate': {
        // 验证HTML内容
        const { html } = args;
        if (!html) return { 成功: false, 错误: '缺少必填参数: html' };

        const issues = [];

        // 基本HTML结构检查
        if (!html.includes('<!DOCTYPE') && !html.includes('<html')) {
          issues.push('缺少HTML文档声明或html标签');
        }
        if (!html.includes('<head>')) {
          issues.push('缺少head标签');
        }
        if (!html.includes('<body>')) {
          issues.push('缺少body标签');
        }
        if (!html.includes('charset')) {
          issues.push('建议添加charset声明（如meta charset="UTF-8"）');
        }
        if (!html.includes('viewport')) {
          issues.push('建议添加viewport声明以支持响应式');
        }

        // 自包含检查
        const externalScripts = (html.match(/<script\s+src=["']http/g) || []).length;
        const externalStyles = (html.match(/<link\s+.*href=["']http.*css/g) || []).length;

        return {
          成功: true,
          数据: {
            valid: issues.length === 0,
            issues,
            stats: {
              size: html.length,
              hasInlineCSS: html.includes('<style>'),
              hasInlineJS: html.includes('<script>') && !html.includes('<script src='),
              externalScripts,
              externalStyles,
              isSelfContained: externalScripts === 0 && externalStyles === 0
            },
            suggestion: issues.length > 0
              ? `发现 ${issues.length} 个问题，建议修复后使用 demo_create 创建`
              : 'HTML内容验证通过，可以使用 demo_create 创建'
          }
        };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}，支持: generate / validate` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'page_builder',
  description: '页面生成技能 — LLM驱动的HTML页面生成，基于需求和模板生成完整Demo页面',
  abilities: ['Demo展示', '页面生成'],

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['generate', 'validate'],
        description: '操作类型：generate=生成页面 / validate=验证HTML'
      },
      template: { type: 'string', description: '模板ID' },
      content: { type: 'object', description: '模板内容变量' },
      requirements: { type: 'string', description: '页面需求描述' },
      techStack: { type: 'string', enum: ['html', 'react', 'vue'], description: '技术栈（默认html）' },
      html: { type: 'string', description: 'HTML内容（validate使用）' }
    },
    required: ['action']
  },

  execute
};
