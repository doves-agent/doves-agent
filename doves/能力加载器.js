/**
 * @file 能力加载器
 * @description 能力发现的底层加载逻辑：模型能力、技能能力、工具能力、平台能力、MCP能力
 * 
 * 所有函数接收 能力管理器 实例作为第一个参数，从 能力管理器.js 调用
 */

import { 提供商列表 } from './providers/index.js';
import { 扫描技能目录 } from './skills/index.js';
import { createTimestampFields } from '@dove/common/时间工具.js';
import { ObjectId } from '@dove/common/对象标识.js';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { 默认检测器 } from './能力检测器.js';
import { MCP配置管理器 } from './MCP配置管理器.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('能力加载器', { 前缀: '[能力加载器]', 级别: 'debug', 显示调用位置: true });

// ==================== 工具能力推断 ====================

const 工具能力映射表 = {
  'index': ['文件操作', 'HTTP请求', '网络请求'],
  'mcp客户端': ['MCP连接', '插件扩展'],
  'oss存储': ['文件存储', '对象存储'],
  'web工具': ['网络请求', '网页抓取'],
  '分支工具': ['对话分支', '任务拆解'],
  '图片生成': ['图片生成', '图片编辑'],
  '存储接口': ['文件存储', '数据存储'],
  '存储索引': ['文件检索', '数据检索'],
  '实用工具': ['文件操作', '编码转换'],
  '对话工具': ['对话管理', '消息处理'],
  '文档管理': ['文档生成', '文件操作'],
  '文档转图片': ['文档转换', '图片生成'],
  'Git数据': ['文件存储', '知识存储'],
  'Git记忆': ['记忆管理', '知识检索'],
  '用户交互': ['用户交互', '消息提示'],
  '系统工具': ['系统管理', '进程管理', '环境信息'],
  '视频工具': ['视频处理', '媒体处理'],
  '语音工具': ['语音合成', '语音识别', '音频处理']
};

function 推断工具能力(工具名, 工具信息) {
  if (工具能力映射表[工具名]) return 工具能力映射表[工具名];

  const 能力列表 = [];
  for (const key of Object.keys(工具信息)) {
    if (key.endsWith('Tools') && Array.isArray(工具信息[key])) {
      const 前缀 = key.replace('Tools', '');
      const 映射 = {
        'system': '系统管理', 'video': '视频处理', 'audio': '音频处理',
        'image': '图片生成', 'mcp': 'MCP连接',
        'document': '文档生成', 'utils': '文件操作', 'interaction': '用户交互'
      };
      if (映射[前缀]) 能力列表.push(映射[前缀]);
    }
  }
  return 能力列表;
}

// ==================== 能力加载方法 ====================

/**
 * 从提供商配置加载模型能力
 */
export async function 加载模型能力(manager, skipCheck = false) {
  const 发现的能力 = [];
  const 不可用列表 = manager._不可用列表 || [];

  for (const [提供商名, 配置] of Object.entries(提供商列表)) {
    if (!skipCheck) {
      const 检测结果 = await 默认检测器.检测('model', 提供商名, 配置);
      manager.检测结果.model[提供商名] = 检测结果;
      if (!检测结果.available) {
        if (检测结果.reason?.includes('未配置')) {
          logger.debug(`提供商 ${提供商名} 未配置，跳过`);
        } else {
          不可用列表.push(`提供商:${提供商名}`);
        }
        continue;
      }
    }

    const 能力列表 = 配置.能力 || [];
    for (const 能力名 of 能力列表) {
      const 模型映射 = 配置.按能力选模型?.[能力名];
      manager.注册(能力名, {
        来源: '模型',
        提供商: 提供商名,
        模型映射: 模型映射 ? { primary: 模型映射.model, alternatives: 模型映射.alternatives || [] } : null
      });
      发现的能力.push(能力名);
    }
  }

  return [...new Set(发现的能力)];
}

/**
 * 从 skills 目录加载技能能力
 */
export async function 加载技能能力(manager, skipCheck = false) {
  const 发现的能力 = [];
  const 不可用列表 = manager._不可用列表 || [];
  const 技能目录 = manager.技能目录;

  try {
    const 技能列表 = 扫描技能目录(技能目录);

    for (const 技能 of 技能列表) {
      try {
        const 模块路径 = join(技能.目录, 技能.名称, 'index.js');
        if (existsSync(模块路径)) {
          const 技能模块 = await import(`file://${模块路径}`);
          const 技能信息 = 技能模块.default || {};

          if (!skipCheck) {
            const 检测结果 = await 默认检测器.检测('skill', 技能.名称, 技能信息);
            manager.检测结果.skill[技能.名称] = 检测结果;
            if (!检测结果.available) { 不可用列表.push(`技能:${技能.名称}`); continue; }
          }

          const 能力列表 = 技能信息.abilities || 技能信息.能力 || [];
          for (const 能力名 of 能力列表) {
            manager.注册(能力名, { 来源: '技能', 技能: 技能.名称 });
            发现的能力.push(能力名);
          }
        }
      } catch (错误) { 不可用列表.push(`技能:${技能.名称}(${错误.message})`); }
    }
  } catch (错误) { logger.error('扫描技能目录失败:', 错误.message); }

  return [...new Set(发现的能力)];
}

/**
 * 从 tools 目录加载工具能力
 */
export async function 加载工具能力(manager, skipCheck = false) {
  const 发现的能力 = [];
  const 不可用列表 = manager._不可用列表 || [];
  const 工具目录 = manager.工具目录;

  // 框架基础设施模块（非 LLM 工具），跳过能力检测
  const 内部模块名 = ['变更联动', '存储接口', '存储索引', '工具元数据', '工具扩展注册', '分支工具-查询汇总', '智能体咨询'];

  try {
    if (!existsSync(工具目录)) return [];

    const entries = readdirSync(工具目录, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.startsWith('_')) {
        const 工具名 = entry.name.replace('.js', '');

        // 跳过基础设施模块
        if (内部模块名.includes(工具名)) continue;

        try {
          const 工具路径 = join(工具目录, entry.name);
          const 工具模块 = await import(`file://${工具路径}`);
          // 兼容 default 导出和纯命名导出：
          // - 无 default → 取整个模块对象（命名导出都在上面）
          // - default 是普通对象 → 取 default
          // - default 是 class/函数 → 取整个模块对象（class 本身 Object.keys 为空，无法检测容器格式）
          const 默认导出 = 工具模块.default;
          const 工具信息 = (默认导出 && typeof 默认导出 !== 'function') ? 默认导出 : 工具模块;

          if (!skipCheck) {
            const 检测结果 = await 默认检测器.检测('tool', 工具名, 工具信息);
            manager.检测结果.tool[工具名] = 检测结果;
            if (!检测结果.available) { 不可用列表.push(`工具:${工具名}`); continue; }
          }

          let 能力列表 = 工具信息.abilities || 工具信息.能力 || [];
          if (能力列表.length === 0) { 能力列表 = 推断工具能力(工具名, 工具信息); }

          for (const 能力名 of 能力列表) {
            manager.注册(能力名, { 来源: '工具', 工具: 工具名 });
            发现的能力.push(能力名);
          }
        } catch (错误) { logger.debug(`加载工具 ${工具名} 能力失败: ${错误.message}`); }
      }
    }
  } catch (错误) { logger.error('扫描工具目录失败:', 错误.message); }

  return [...new Set(发现的能力)];
}

/**
 * 检测平台能力（运行时检测）
 */
export async function 检测平台能力(manager, skipCheck = false) {
  const 平台 = process.platform;
  const 发现的能力 = [];
  const 不可用列表 = manager._不可用列表 || [];

  const 平台检测结果 = await 默认检测器.检测所有平台能力();

  for (const [能力名, 检测结果] of Object.entries(平台检测结果)) {
    manager.检测结果.platform[能力名] = 检测结果;
    if (检测结果.available) {
      manager.注册(能力名, { 来源: '平台', 平台, 检测详情: 检测结果.details });
      发现的能力.push(能力名);
    } else {
      const reason = 检测结果.reason || '';
      if (reason.includes('未连接') || reason.includes('未安装')) {
        logger.debug(`平台能力 ${能力名} 不可用: ${reason}`);
      } else {
        不可用列表.push(`平台:${能力名}`);
      }
    }
  }

  return 发现的能力;
}

/**
 * 加载MCP能力（从已配置的MCP Server）
 */
export async function 加载MCP能力(manager, skipCheck = false) {
  const 发现的能力 = [];
  const 不可用列表 = manager._不可用列表 || [];

  if (!manager.检测结果) manager.检测结果 = { model: {}, skill: {}, tool: {}, platform: {}, mcp: {} };
  if (!manager.检测结果.mcp) manager.检测结果.mcp = {};

  const mcp管理器 = new MCP配置管理器();
  const 连接列表 = mcp管理器.列出连接();
  if (连接列表.length === 0) return [];

  for (const 连接信息 of 连接列表) {
    const 连结名 = 连接信息.名称;
    try {
      const 能力列表 = mcp管理器.转换为能力(连结名);
      for (const 能力 of 能力列表) {
        manager.注册(能力.名称, {
          ...能力,
          描述: 能力.描述, 参数模式: 能力.参数模式
        });
        发现的能力.push(能力.名称);
      }
      manager.检测结果.mcp[连结名] = { available: true, toolCount: 能力列表.length, details: `已连接，发现 ${能力列表.length} 个工具` };
    } catch (错误) {
      不可用列表.push(`MCP:${连结名}`);
      manager.检测结果.mcp[连结名] = { available: false, reason: 错误.message };
    }
  }

  return [...new Set(发现的能力)];
}

/**
 * 从MCP配置连接并发现能力
 */
export async function 从MCP配置加载能力(manager, MCP配置) {
  if (!MCP配置?.servers?.length) return { 成功: 0, 失败: 0, 能力列表: [] };

  const mcp管理器 = new MCP配置管理器();
  const 连接结果 = await mcp管理器.从配置连接(MCP配置);
  const 能力列表 = await 加载MCP能力(manager, false);

  return { 成功: 连接结果.成功, 失败: 连接结果.失败, 能力列表 };
}
