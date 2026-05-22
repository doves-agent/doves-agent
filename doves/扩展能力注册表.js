/**
 * @file 扩展能力注册表
 * @description 从已加载扩展的 manifest + intent.js 自动汇总扩展能力信息，
 *              为 Flash 聊天、意图识别、能力发现工具提供统一的能力描述。
 *
 * === 设计原则 ===
 * 1. 零冗余：所有数据从现有 manifest.name/abilities/description + intentKeywords 自动生成
 * 2. 单一数据源：Registry 是扩展能力的唯一汇总入口
 * 3. 动态更新：扩展加载/卸载时自动增删
 *
 * === 三个输出 ===
 * - generateFlashSummary()  → Flash 聊天系统提示词（约 50 tokens）
 * - generateIntentSummary() → 意图识别提示词补充（替代 intentPromptAddon）
 * - generateFullCatalog()   → 能力发现工具的完整目录
 *
 * === 术语说明 ===
 * "白鸽扩展"是技术实体（能力插件），"白鸽应用"仅作 CLI-Web UI 聚类展示概念。
 * 鸽子是唯一的智能体身份，扩展只是给它装能力的插件。
 */

import { 是否静默 } from './utils/启动汇总.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('扩展注册表', { 前缀: '[扩展注册表]', 级别: 'debug', 显示调用位置: true });

// ==================== 注册表存储 ====================

/**
 * 扩展条目结构:
 * {
 *   name: string,           // manifest.name
 *   description: string,    // manifest.description
 *   abilities: string[],    // manifest.abilities
 *   intents: {              // intent.js 的结构化数据（可选）
 *     [intentName]: {
 *       keywords: string[], // intentKeywords
 *       executionMode: string,
 *     }
 *   },
 *   workflow: {             // workflow.js 的结构化数据（可选）
 *     场景: string[],       // 触发场景
 *     能力组: [{             // 工具能力分组
 *       名称: string,
 *       触发关键词: string[],
 *       说明: string,
 *       工具: string[],
 *     }],
 *     流程案例: [{            // 常见组合模式参考
 *       名称: string,
 *       适用场景: string,
 *       流程: string,
 *       快捷技能: string|null,
 *       跨扩展: boolean,
 *     }],
 *     关键规则: string[],   // 注意事项
 *   }
 * }
 */
const _registry = new Map();

// ==================== 注册 / 注销 ====================

/**
 * 注册扩展能力（供扩展加载器调用）
 * @param {Object} manifest - 扩展 manifest
 * @param {Object} [intentModule] - 扩展 intent.js 模块（可选）
 */
export function 注册扩展能力(manifest, intentModule = null, workflowModule = null) {
  const name = manifest.name;
  if (!name) return;

  const entry = {
    name,
    description: manifest.description || '',
    abilities: manifest.abilities || [],
    intents: {},
    workflow: null,
  };

  // 从 intent.js 提取结构化数据
  if (intentModule) {
    // intents: { KEY: 'intent_name', ... }
    const intentNames = intentModule.intents
      ? Object.values(intentModule.intents)
      : [];

    // intentKeywords: { intentName: ['关键词', ...], ... }
    const keywords = intentModule.intentKeywords || {};

    // executionModeMap: { intentName: '执行模式', ... }
    const modeMap = intentModule.executionModeMap || {};

    for (const intentName of intentNames) {
      entry.intents[intentName] = {
        keywords: keywords[intentName] || [],
        executionMode: modeMap[intentName] || '先规划后执行',
      };
    }
  }

  // 从 workflow.js 提取结构化数据
  if (workflowModule) {
    entry.workflow = {
      场景: workflowModule.场景 || [],
      能力组: (workflowModule.能力组 || workflowModule.阶段 || []).map(p => ({
        名称: p.名称 || '',
        触发关键词: p.触发关键词 || [],
        说明: p.说明 || '',
        工具: p.工具 || [],
      })),
      流程案例: (workflowModule.流程案例 || []).map(c => ({
        名称: c.名称 || '',
        适用场景: c.适用场景 || '',
        流程: c.流程 || '',
        快捷技能: c.快捷技能 || null,
        跨扩展: c.跨扩展 || false,
      })),
      关键规则: workflowModule.关键规则 || [],
    };
  }

  _registry.set(name, entry);
  logger.info(`注册: ${name} (能力: [${entry.abilities.join(', ')}], 意图: [${Object.keys(entry.intents).join(', ')}], 能力组: ${entry.workflow ? entry.workflow.能力组.length : 0})`);
}

/**
 * 注销扩展能力（供扩展加载器卸载时调用）
 * @param {string} name - 扩展包名
 */
export function 注销扩展能力(name) {
  if (_registry.delete(name)) {
    logger.info(`注销: ${name}`);
  }
}

/**
 * 获取所有已注册扩展
 * @returns {Map}
 */
export function 获取注册表() {
  return _registry;
}

// ==================== 输出生成器 ====================

/**
 * 生成 Flash 聊天用的能力摘要（约 50 tokens）
 *
 * 【重要】不再列出具体应用名，防止应用名污染 LLM 上下文导致规划偏离。
 * 应用间不再通过提示词"发现"彼此，应用开发者自行处理工具生态链。
 *
 * @returns {string}
 */
export function generateFlashSummary() {
  return '你是白鸽，一个智能助手。根据工具列表执行任务，直接回答用户问题，简洁友好。如遇规划后无法完成的请求，如实告知并建议替代方案。';
}

/**
 * 生成按扩展分组的能力地图，供系统提示词注入
 * 替代 generateFlashSummary() 在 SubTask/LLM主调用 中的使用
 * 让 LLM 了解自己的扩展能力全景，通过 发现能力 按需发现具体工具
 *
 * 扩展 = 能力组 + 流程案例
 * 能力组：一组原子工具，可独立调用、自由组合
 * 流程案例：常见组合模式参考，非强制约束
 *
 * @returns {string} 结构化扩展能力概览
 */
export function generateExtensionOverview() {
  if (_registry.size === 0) {
    return '你是白鸽，一个智能助手。根据工具列表执行任务，直接回答用户问题，简洁友好。如需更多能力，调用 发现能力 按需发现。';
  }

  const lines = ['你是白鸽，拥有以下扩展能力：'];
  for (const ext of _registry.values()) {
    const 能力描述 = ext.abilities.length > 0 ? ext.abilities.join('/') : ext.description;
    let line = `- ${ext.name}: ${能力描述}`;
    // 注入能力组（工具列表）
    if (ext.workflow && ext.workflow.能力组.length > 0) {
      const 工具列表 = ext.workflow.能力组.map(p => p.工具.join(',')).filter(t => t).join(', ');
      if (工具列表) {
        line += `\n  工具: ${工具列表}`;
      }
    }
    // 注入流程案例摘要
    if (ext.workflow && ext.workflow.流程案例.length > 0) {
      const 案例摘要 = ext.workflow.流程案例
        .filter(c => !c.跨扩展)
        .map(c => c.流程)
        .join(' | ');
      if (案例摘要) {
        line += `\n  参考流程: ${案例摘要}`;
      }
    }
    if (ext.workflow && ext.workflow.关键规则.length > 0) {
      line += `\n  注意: ${ext.workflow.关键规则.join(' / ')}`;
    }
    lines.push(line);
  }
  lines.push('以上流程为参考案例，根据用户实际需求灵活组合工具。需要更多工具时调用 发现能力 按需发现。');

  return lines.join('\n');
}

/**
 * 生成意图识别用的扩展级意图摘要
 *
 * 使用 workflow 阶段级关键词（更精确），或 intent 关键词。
 * 仅注入意图类型和关键词线索，不注入应用名，防止应用名污染 LLM 上下文。
 *
 * @returns {string}
 */
export function generateIntentSummary() {
  const 意图列表 = [];

  for (const ext of _registry.values()) {
    // 优先从 workflow 能力组提取关键词（更细粒度）
    if (ext.workflow && ext.workflow.能力组.length > 0) {
      for (const group of ext.workflow.能力组) {
        if (!group.触发关键词?.length) continue;
        意图列表.push({
          intent: `${ext.name}.${group.名称}`,
          keywords: group.触发关键词.slice(0, 15),
          executionMode: '',
          阶段说明: group.说明,
        });
      }
    }

    // 从 intent.js 提取关键词
    for (const [intentName, data] of Object.entries(ext.intents)) {
      if (!data.keywords?.length) continue;
      意图列表.push({
        intent: intentName,
        keywords: data.keywords.slice(0, 15),
        executionMode: data.executionMode,
        阶段说明: '',
      });
    }
  }

  if (!意图列表.length) return '';

  const lines = ['\n\n扩展意图（匹配到关键词时优先使用，strategy 填意图名）：'];
  for (const item of 意图列表) {
    let line = `- ${item.intent}: 关键词[${item.keywords.join('/')}]`;
    if (item.executionMode) line += ` 执行模式=${item.executionMode}`;
    if (item.阶段说明) line += ` → ${item.阶段说明}`;
    lines.push(line);
  }
  lines.push('匹配到扩展意图时，intent 和 strategy 都填意图名（如"元素拆解.识图分析"或"元素拆解"），suggestedDirection 填对应的方向描述。');

  return lines.join('\n');
}

/**
 * 生成能力发现工具用的完整目录
 *
 * @returns {Object}
 */
export function generateFullCatalog() {
  const catalog = [];

  for (const ext of _registry.values()) {
    const entry = {
      name: ext.name,
      description: ext.description,
      abilities: ext.abilities,
      intents: Object.entries(ext.intents).map(([name, data]) => ({
        name,
        keywords: data.keywords,
        executionMode: data.executionMode,
      })),
    };

    // 包含工作流信息
    if (ext.workflow) {
      entry.workflow = ext.workflow;
    }

    catalog.push(entry);
  }

  return catalog;
}

/**
 * 根据意图名匹配扩展名和能力组
 * 支持两种格式："扩展名.能力组名" 或 "意图名"
 *
 * @param {string} intentName - 意图名（如 "背单词.复习检测" 或 "元素拆解"）
 * @returns {{ extension: string|null, phase: string|null, workflow: Object|null }}
 */
export function 匹配能力组(intentName) {
  if (!intentName) return { extension: null, phase: null, workflow: null, phaseData: null };

  // 尝试解析 "扩展名.能力组名" 格式
  const dotIndex = intentName.indexOf('.');
  if (dotIndex > 0) {
    const extName = intentName.substring(0, dotIndex);
    const phaseName = intentName.substring(dotIndex + 1);
    const entry = _registry.get(extName);
    if (entry?.workflow) {
      const group = entry.workflow.能力组.find(p => p.名称 === phaseName);
      return {
        extension: extName,
        phase: phaseName,
        workflow: entry.workflow,
        phaseData: group || null,
      };
    }
  }

  // 遍历所有扩展查找匹配
  for (const [extName, entry] of _registry) {
    // 先匹配 intent 名
    if (entry.intents[intentName] && entry.workflow) {
      return {
        extension: extName,
        phase: null,
        workflow: entry.workflow,
        phaseData: null,
      };
    }
    // 再匹配 workflow 阶段
    if (entry.workflow) {
      const group = entry.workflow.能力组.find(p => p.名称 === intentName);
      if (group) {
        return {
          extension: extName,
          phase: intentName,
          workflow: entry.workflow,
          phaseData: group,
        };
      }
    }
  }

  return { extension: null, phase: null, workflow: null, phaseData: null };
}
