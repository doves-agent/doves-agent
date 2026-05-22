/**
 * @file tools/页面托管
 * @description LLM生成HTML存到OSS并返回可访问URL
 * 
 * 被以下扩展包使用：demo_showcase, data_analytics, document, code_review
 * 
 * 导出格式（扩展包工具接口）：
 * - extTools: 工具定义数组
 * - handleExtTool: 工具调用处理器
 * - extToolCategories: 工具分类
 * - extToolAbilityMap: 工具能力映射
 * - extToolSafetyLevels: 工具安全分级
 */

import { randomBytes } from 'crypto';
import OSS存储 from './oss存储.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('页面托管', { 前缀: '[页面托管]', 级别: 'debug', 显示调用位置: true });

// ==================== 工具定义 ====================

export const extTools = [
  {
    name: '页面托管',
    description: '生成HTML页面并托管到OSS，返回访问链接。支持附加CSS/JS资源和可见性设置。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '页面标题（必填）' },
        html: { type: 'string', description: '完整HTML内容（必填）' },
        resources: {
          type: 'array',
          description: '附加资源文件（可选）',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '文件名（如 style.css）' },
              content: { type: 'string', description: '文件内容' }
            },
            required: ['name', 'content']
          }
        },
        visibility: { type: 'string', enum: ['private', 'public'], description: '可见性（默认private）' },
        expiresIn: { type: 'number', description: '过期时间秒数（0=永久，默认0）' }
      },
      required: ['title', 'html']
    }
  },
  {
    name: '页面更新',
    description: '更新已托管的页面内容',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: '页面ID（必填）' },
        title: { type: 'string', description: '新标题（可选）' },
        html: { type: 'string', description: '新HTML内容（可选）' },
        resources: {
          type: 'array',
          description: '新附加资源（可选，覆盖原有）',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '文件名' },
              content: { type: 'string', description: '文件内容' }
            },
            required: ['name', 'content']
          }
        }
      },
      required: ['pageId']
    }
  },
  {
    name: '页面列表',
    description: '列出已托管的页面',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '最大返回数（默认20）' },
        offset: { type: 'number', description: '偏移量（默认0）' }
      }
    }
  },
  {
    name: '页面删除',
    description: '删除已托管的页面',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: '页面ID（必填）' }
      },
      required: ['pageId']
    }
  }
];

// ==================== 工具分类 ====================

export const extToolCategories = {
  '页面工具': ['页面托管', '页面更新', '页面列表', '页面删除'],
};

// ==================== 工具能力映射 ====================

export const extToolAbilityMap = {
  页面托管: ['文档', '页面托管', 'OSS'],
  页面更新: ['文档', '页面托管'],
  页面列表: ['文档', '页面托管'],
  页面删除: ['文档', '页面托管'],
};

// ==================== 工具安全分级 ====================

export const extToolSafetyLevels = {
  页面托管: '谨慎',
  页面更新: '谨慎',
  页面列表: '安全',
  页面删除: '谨慎',
};

// ==================== 辅助函数 ====================

function 生成页面ID() {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(4).toString('hex');
  return `pg_${timestamp}_${random}`;
}

const text = (content) => ({
  content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }]
});

/**
 * 上传HTML到OSS
 * @param {string} pageId - 页面ID
 * @param {string} html - HTML内容
 * @param {Array} resources - 附加资源
 * @returns {Promise<{url: string, resourceUrls: string[]}>}
 */
async function 上传到OSS(pageId, html, resources = []) {
  const resourceUrls = [];

  // 上传主HTML文件
  const htmlBuffer = Buffer.from(html, 'utf-8');
  const htmlResult = await OSS存储.上传(htmlBuffer, 'index.html', {
    路径: `pages/${pageId}/index.html`
  });

  if (!htmlResult.成功) {
    throw new Error(`OSS 上传失败: ${htmlResult.错误 || '未知错误'}`);
  }

  // 上传附加资源
  for (const res of resources) {
    const resBuffer = Buffer.from(res.content, 'utf-8');
    const resResult = await OSS存储.上传(resBuffer, res.name, {
      路径: `pages/${pageId}/${res.name}`
    });
    if (resResult.成功) {
      resourceUrls.push({ name: res.name, url: resResult.网址 });
    }
  }

  return {
    url: htmlResult.网址,
    resourceUrls
  };
}

// ==================== 工具处理函数 ====================

export async function handleExtTool(name, args) {
  switch (name) {

    // ===== 页面托管: 生成页面并托管 =====
    case '页面托管': {
      const { title, html, resources = [], visibility = 'private', expiresIn = 0 } = args;

      if (!title || !html) {
        return text({ error: '缺少必填参数: title 和 html' });
      }

      const pageId = 生成页面ID();
      const createdAt = new Date().toISOString();

      // 上传到OSS
      let ossUrl = null;
      let resourceUrls = [];
      if (!OSS存储.是否可用()) {
        return text({ error: 'OSS 存储未启用，无法托管页面' });
      }
      const ossResult = await 上传到OSS(pageId, html, resources);
      ossUrl = ossResult.url;
      resourceUrls = ossResult.resourceUrls;

      logger.info(`页面已托管: ${pageId} "${title}" (OSS)`);

      return text({
        pageId,
        url: ossUrl,
        resourceUrls,
        title,
        createdAt
      });
    }

    // ===== 页面更新: 更新已托管页面 =====
    case '页面更新': {
      const { pageId, title, html, resources } = args;

      if (!pageId) {
        return text({ error: '缺少必填参数: pageId' });
      }

      return text({ error: '页面更新功能需要 OSS 列表查询支持，当前暂不可用' });
    }

    // ===== 页面列表: 列出已托管页面 =====
    case '页面列表': {
      return text({ error: '页面列表查询需要 OSS 列表接口支持，当前暂不可用' });
    }

    // ===== 页面删除: 删除已托管页面 =====
    case '页面删除': {
      const { pageId } = args;

      if (!pageId) {
        return text({ error: '缺少必填参数: pageId' });
      }

      if (!OSS存储.是否可用()) {
        return text({ error: 'OSS 存储未启用，无法删除页面' });
      }
      try {
        await OSS存储.批量删除([`pages/${pageId}/index.html`]);
        logger.info(`页面已删除: ${pageId}`);
        return text({ success: true, pageId, ossDeleted: true });
      } catch (e) {
        return text({ error: `OSS 删除失败: ${e.message}` });
      }
    }

    default:
      return { content: [{ type: 'text', text: `Unknown page tool: ${name}` }], isError: true };
  }
}

