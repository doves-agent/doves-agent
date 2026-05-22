/**
 * Demo模板管理技能
 * 预定义模板的CRUD + 自定义模板管理
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('Demo模板', { 前缀: '[demo_template]', 级别: 'debug', 显示调用位置: true });

// 预定义模板
const BUILTIN_TEMPLATES = {
  product_showcase: {
    id: 'product_showcase',
    name: '产品展示',
    description: 'Hero区 + 功能列表 + 截图 + 定价',
    sections: ['hero', 'features', 'screenshots', 'pricing', 'cta'],
    techStack: 'html',
    thumbnail: '📦',
    fields: [
      { key: 'heroTitle', label: '产品名称', type: 'string', required: true },
      { key: 'heroSubtitle', label: '产品副标题', type: 'string' },
      { key: 'features', label: '功能列表', type: 'array', itemFields: ['title', 'description', 'icon'] },
    ]
  },
  data_dashboard: {
    id: 'data_dashboard',
    name: '数据看板',
    description: 'ECharts图表 + 筛选器 + 实时数据',
    sections: ['header', 'filters', 'charts', 'tables', 'summary'],
    techStack: 'html+echarts',
    thumbnail: '📊',
    fields: [
      { key: 'heroTitle', label: '看板标题', type: 'string', required: true },
      { key: 'charts', label: '图表配置', type: 'array', itemFields: ['type', 'title', 'data'] },
    ]
  },
  api_debug: {
    id: 'api_debug',
    name: 'API调试',
    description: '接口列表 + 参数表 + Try it out',
    sections: ['sidebar', 'endpoint_list', 'request_form', 'response_viewer'],
    techStack: 'html',
    thumbnail: '🔌',
    fields: [
      { key: 'heroTitle', label: 'API标题', type: 'string' },
      { key: 'endpoints', label: '接口列表', type: 'array', itemFields: ['method', 'path', 'description'] },
    ]
  },
  form_demo: {
    id: 'form_demo',
    name: '表单Demo',
    description: '表单 + 校验 + 提交反馈',
    sections: ['form_fields', 'validation', 'submit_feedback', 'results'],
    techStack: 'html',
    thumbnail: '📝',
    fields: [
      { key: 'heroTitle', label: '表单标题', type: 'string' },
      { key: 'fields', label: '表单字段', type: 'array', itemFields: ['name', 'type', 'label', 'required'] },
    ]
  },
  mobile_preview: {
    id: 'mobile_preview',
    name: '移动端预览',
    description: '手机壳包裹 + 交互区域',
    sections: ['phone_frame', 'app_content', 'navigation', 'interactions'],
    techStack: 'html',
    thumbnail: '📱',
    fields: [
      { key: 'heroTitle', label: '应用名称', type: 'string' },
      { key: 'heroSubtitle', label: '应用描述', type: 'string' },
    ]
  },
};

// 用户自定义模板（内存缓存）
const _自定义模板 = new Map();

async function execute(args, context) {
  const { action = 'list', templateId, template: templateData } = args;

  logger.info(`执行: ${action}`);

  try {
    switch (action) {

      case 'list': {
        const builtin = Object.values(BUILTIN_TEMPLATES).map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          sections: t.sections,
          techStack: t.techStack,
          thumbnail: t.thumbnail,
          type: 'builtin'
        }));

        const custom = Array.from(_自定义模板.values()).map(t => ({
          ...t,
          type: 'custom'
        }));

        return {
          成功: true,
          数据: {
            total: builtin.length + custom.length,
            builtin: builtin.length,
            custom: custom.length,
            templates: [...builtin, ...custom]
          }
        };
      }

      case 'get': {
        if (!templateId) return { 成功: false, 错误: '缺少必填参数: templateId' };

        const tpl = BUILTIN_TEMPLATES[templateId] || _自定义模板.get(templateId);
        if (!tpl) return { 成功: false, 错误: `模板不存在: ${templateId}` };

        return {
          成功: true,
          数据: tpl
        };
      }

      case 'create': {
        if (!templateData?.id || !templateData?.name) {
          return { 成功: false, 错误: '模板必须包含 id 和 name' };
        }

        const newTemplate = {
          ...templateData,
          type: 'custom',
          createdAt: new Date().toISOString()
        };

        _自定义模板.set(templateData.id, newTemplate);

        return {
          成功: true,
          数据: newTemplate
        };
      }

      case 'delete': {
        if (!templateId) return { 成功: false, 错误: '缺少必填参数: templateId' };

        if (BUILTIN_TEMPLATES[templateId]) {
          return { 成功: false, 错误: '不能删除内置模板' };
        }

        if (!_自定义模板.has(templateId)) {
          return { 成功: false, 错误: `自定义模板不存在: ${templateId}` };
        }

        _自定义模板.delete(templateId);

        return { 成功: true, 数据: { deleted: templateId } };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}，支持: list / get / create / delete` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'demo_template',
  description: 'Demo模板管理技能 — 预定义模板查询 + 自定义模板CRUD',
  abilities: ['Demo展示', 'Demo模板'],

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'get', 'create', 'delete'],
        description: '操作类型'
      },
      templateId: { type: 'string', description: '模板ID（get/delete使用）' },
      template: { type: 'object', description: '模板数据（create使用）' }
    },
    required: ['action']
  },

  execute
};
