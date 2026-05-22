/**
 * @file tools/项目配置
 * @description 每个项目的偏好配置（编码规范、审查规则、文档模板等）
 * 
 * 存储底座：内存缓存 + MongoDB（通过DovesProxy）
 * 被全部6个扩展包使用
 * 
 * 导出格式（扩展包工具接口）：
 * - extTools / handleExtTool / extToolCategories / extToolAbilityMap / extToolSafetyLevels
 */

import { randomBytes } from 'crypto';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('项目配置', { 前缀: '[项目配置]', 级别: 'debug', 显示调用位置: true });

// ==================== 内存缓存 ====================

// Map<项目ID, 配置对象>
const _配置缓存 = new Map();

// ==================== 默认配置模板 ====================

function 生成默认配置(项目名, 仓库路径) {
  return {
    项目ID: 生成项目ID(),
    项目名: 项目名 || '未命名项目',
    仓库路径: 仓库路径 || '',
    编码规范: {
      语言: 'javascript',
      风格: 'eslint',
      缩进: 2,
      命名: 'camelCase'
    },
    审查规则: {
      严重级别阈值: 'medium',
      安全扫描: true,
      性能检查: true
    },
    文档模板: {
      API文档: 'openapi',
      变更日志: 'conventional'
    },
    禅道配置: {
      地址: '',
      Token: '',
      项目ID: null
    },
    Demo配置: {
      默认技术栈: 'react',
      主题: 'light'
    },
    数据源: [],
    createdAt: new Date().toISOString()
  };
}

function 生成项目ID() {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(3).toString('hex');
  return `proj_${timestamp}_${random}`;
}

// ==================== 工具定义 ====================

export const extTools = [
  {
    name: '项目配置获取',
    description: '获取项目配置。如果项目不存在可自动创建默认配置。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '项目ID（可选，不填则返回当前工作目录的项目配置）' },
        repoPath: { type: 'string', description: '仓库路径（用于查找关联项目）' }
      }
    }
  },
  {
    name: '项目配置设置',
    description: '设置/更新项目配置。支持部分更新（只传需要修改的字段）。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '项目ID（必填）' },
        config: {
          type: 'object',
          description: '配置内容（部分更新，只传需要修改的字段）',
          properties: {
            项目名: { type: 'string' },
            仓库路径: { type: 'string' },
            编码规范: { type: 'object' },
            审查规则: { type: 'object' },
            文档模板: { type: 'object' },
            禅道配置: { type: 'object' },
            Demo配置: { type: 'object' },
            数据源: { type: 'array' }
          }
        }
      },
      required: ['projectId', 'config']
    }
  },
  {
    name: '项目配置列表',
    description: '列出所有项目配置',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '最大返回数（默认20）' }
      }
    }
  },
  {
    name: '项目配置创建',
    description: '创建新项目配置',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '项目名称（必填）' },
        repoPath: { type: 'string', description: '仓库路径（可选）' },
        config: { type: 'object', description: '初始配置覆盖（可选）' }
      },
      required: ['name']
    }
  }
];

// ==================== 工具分类/映射/安全分级 ====================

export const extToolCategories = {
  '配置工具': ['项目配置获取', '项目配置设置', '项目配置列表', '项目配置创建'],
};

export const extToolAbilityMap = {
  '项目配置获取': ['配置', '项目管理'],
  '项目配置设置': ['配置', '项目管理'],
  '项目配置列表': ['配置', '项目管理'],
  '项目配置创建': ['配置', '项目管理'],
};

export const extToolSafetyLevels = {
  '项目配置获取': '安全',
  '项目配置设置': '谨慎',
  '项目配置列表': '安全',
  '项目配置创建': '谨慎',
};

// ==================== 辅助函数 ====================

const text = (content) => ({
  content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }]
});

/**
 * 深度合并配置
 */
function 深度合并(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = 深度合并(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * 按仓库路径查找项目
 */
function 按仓库路径查找(repoPath) {
  if (!repoPath) return null;
  for (const [, 配置] of _配置缓存) {
    if (配置.仓库路径 === repoPath) return 配置;
  }
  return null;
}

// ==================== 工具处理函数 ====================

export async function handleExtTool(name, args) {
  switch (name) {

    // ===== project_config_get =====
    case '项目配置获取': {
      const { projectId, repoPath } = args;

      // 按ID查找
      if (projectId && _配置缓存.has(projectId)) {
        return text(_配置缓存.get(projectId));
      }

      // 按仓库路径查找
      if (repoPath) {
        const found = 按仓库路径查找(repoPath);
        if (found) return text(found);
      }

      // 尝试按当前工作目录查找
      const cwd = repoPath || process.cwd();
      const found = 按仓库路径查找(cwd);
      if (found) return text(found);

      // 未找到，返回默认配置提示
      return text({
        message: '未找到项目配置，可使用 project_config_create 创建',
        repoPath: cwd
      });
    }

    // ===== project_config_set =====
    case '项目配置设置': {
      const { projectId, config } = args;

      if (!projectId || !config) {
        return text({ error: '缺少必填参数: projectId 和 config' });
      }

      const 现有 = _配置缓存.get(projectId);
      if (!现有) {
        return text({ error: `项目配置不存在: ${projectId}，请先使用 project_config_create 创建` });
      }

      // 部分更新
      const 更新后 = 深度合并(现有, config);
      更新后.updatedAt = new Date().toISOString();
      _配置缓存.set(projectId, 更新后);

      logger.info(`项目配置已更新: ${projectId}`);

      return text({
        success: true,
        projectId,
        updatedFields: Object.keys(config),
        updatedAt: 更新后.updatedAt
      });
    }

    // ===== project_config_list =====
    case '项目配置列表': {
      const limit = args.limit || 20;

      const 列表 = Array.from(_配置缓存.values())
        .map(({ 项目ID, 项目名, 仓库路径, createdAt }) => ({
          项目ID, 项目名, 仓库路径, createdAt
        }))
        .slice(0, limit);

      return text({
        total: _配置缓存.size,
        projects: 列表
      });
    }

    // ===== project_config_create =====
    case '项目配置创建': {
      const { name, repoPath, config: 自定义配置 } = args;

      if (!name) {
        return text({ error: '缺少必填参数: name' });
      }

      // 检查是否已存在同名项目
      for (const [, 已有] of _配置缓存) {
        if (已有.项目名 === name) {
          return text({ error: `项目 "${name}" 已存在`, projectId: 已有.项目ID });
        }
      }

      let 配置 = 生成默认配置(name, repoPath);
      if (自定义配置) {
        配置 = 深度合并(配置, 自定义配置);
      }

      _配置缓存.set(配置.项目ID, 配置);

      logger.info(`项目配置已创建: ${配置.项目ID} "${name}"`);

      return text({
        success: true,
        projectId: 配置.项目ID,
        项目名: 配置.项目名,
        仓库路径: 配置.仓库路径
      });
    }

    default:
      return { content: [{ type: 'text', text: `Unknown project config tool: ${name}` }], isError: true };
  }
}
