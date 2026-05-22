/**
 * @file tools/index
 * @description 工具模块索引，包含文件操作、HTTP、MongoDB、系统/存储/多媒体工具等
 * 
 * 【KISS原则文档的一部分】
 * 
 * === 工具层架构 ===
 * 
 * ┌─────────────────────────────────────────────────────────────┐
 * │                      技能层 (Skills)                         │
 * │                    调用工具完成复杂任务                       │
 * └───────────────────────┬─────────────────────────────────────┘
 *                         │
 *                         ▼
 * ┌─────────────────────────────────────────────────────────────┐
 * │                      工具层 (Tools)                          │
 * │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐  │
 * │  │ Git数据   │ │ Git记忆   │ │ OSS存储   │ │ MongoDB   │  │
 * │  │ 存储接口  │ │ 存储接口  │ │ 存储接口  │ │ 存储接口  │  │
 * │  └───────────┘ └───────────┘ └───────────┘ └───────────┘  │
 * └───────────────────────┬─────────────────────────────────────┘
 *                         │
 *                         ▼
 *            ┌─────────────────────┐
 *            │   四大存储支柱       │
 *            │ Git数据  | Git记忆   │
 *            │ OSS      | MongoDB   │
 *            └─────────────────────┘
 * 
 * === 工具接口规范 ===
 * {
 *   name: 'tool_name',           // 工具名称
 *   description: '工具描述',      // 描述
 *   parameters: {                // 参数 Schema
 *     type: 'object',
 *     properties: {
 *       param1: { type: 'string', description: '参数说明' }
 *     },
 *     required: ['param1']
 *   },
 *   
 *   // 执行入口
 *   async execute(params, context) {
 *     return { 成功: true, data: {...} };
 *     // 或
 *     return { 成功: false, 错误: '错误原因' };
 *   }
 * }
 * 
 * === 工具与技能的关系 ===
 * 
 * Skill (技能)                 Tool (工具)
 * ─────────────────────────────────────────────
 * browser_agent         →      OSS存储 (截图上传)
 * ssh_agent             →      MongoDB (主机配置)
 * resource_allocation   →      Git数据 + Git记忆 + OSS + MongoDB
 * txt                   →      文件系统 (直接操作)
 * 
 * === 四大存储支柱 ===
 * 
 * ┌─────────────┬───────────────────────┬─────────────────────┐
 * │ 存储类型    │ 功能                  │ 适用场景            │
 * ├─────────────┼───────────────────────┼─────────────────────┤
 * │ Git数据     │ 目录挂载、快照、回滚   │ 代码快照、工作空间  │
 * │ Git记忆     │ 向量化存储、语义检索   │ 知识库、记忆存储    │
 * │ OSS         │ 大文件存储、用户目录   │ 用户上传、输出文件  │
 * │ MongoDB     │ 任务队列、对话存储     │ 配置数据            │
 * └─────────────┴───────────────────────┴─────────────────────┘
 * 
 * === 统一存储接口 ===
 * 存储接口.创建(存储类型, 数据, 选项)
 * 存储接口.读取(存储类型, 查询, 选项)
 * 存储接口.更新(存储类型, 查询, 数据, 选项)
 * 存储接口.删除(存储类型, 查询, 选项)
 * 存储接口.列表(存储类型, 查询, 选项)
 * 存储接口.搜索(存储类型, 关键词, 选项)
 * 
 * 支持的存储类型: 'Git数据' | 'Git记忆' | 'oss' | 'mongo'
 */

// 导入存储模块
import OSS存储 from './oss存储.js';
import Git记忆 from './Git存储/记忆仓库.js';
import Git数据 from './Git存储/数据仓库.js';
import 存储索引 from './存储索引.js';
import { 存储接口, MongoDB适配器, Git记忆适配器, Git数据适配器, OSS适配器 } from './存储接口.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('工具', { 前缀: '[工具]', 级别: 'debug', 显示调用位置: true });

// 导入新增工具模块
import { audioTools, handleAudioTool } from './语音工具.js';
import { videoTools, handleVideoTool } from './视频工具.js';
import { imageTools, handleImageTool } from './图片生成.js';
import { interactionTools, handleInteractionTool } from './用户交互.js';
import { utilsTools, handleUtilsTool } from './实用工具.js';
import { documentTools, handleDocumentTool } from './文档管理.js';
import { systemTools, handleSystemTool, setTaskDbConnection, setSkillIndexRef } from './系统工具.js';
import { mcpTools, handleMcpTool, mcpConnectionManager } from './mcp客户端.js';
import { webTools, handleWebTool } from './web工具.js';

// 新增：对话分支相关工具
import { ConversationTools } from './对话工具.js';
import { BranchTools } from './分支工具.js';

// 代码工具（精准编码能力：读取、搜索、编辑、Git等）
import { codeTools, handleCodeTool } from './代码工具.js';

// CLI 能力调用工具（请求用户本机 CLI 执行操作）
import { cliActionTools, handleCliActionTool } from './cli-能力调用.js';

// 工具元数据和扩展注册
import { 工具安全分级, 获取工具安全级别, 工具能力映射 } from './工具元数据.js';
import { _扩展工具, 注册扩展工具, 注销扩展工具 } from './工具扩展注册.js';

// ==================== 工具名→处理器路由表（Set 查表，从工具定义数组动态构建） ====================
const 系统工具名集合 = new Set(systemTools.map(t => t.name));
const Web工具名集合 = new Set(webTools.map(t => t.name));
const 语音工具名集合 = new Set(audioTools.map(t => t.name));
const 视频工具名集合 = new Set(videoTools.map(t => t.name));
const 图片工具名集合 = new Set(imageTools.map(t => t.name));
const 交互工具名集合 = new Set(interactionTools.map(t => t.name));
const 文档工具名集合 = new Set(documentTools.map(t => t.name));
const MCP工具名集合 = new Set(mcpTools.map(t => t.name));
const 实用工具名集合 = new Set(utilsTools.map(t => t.name));
const 代码工具名集合 = new Set(codeTools.map(t => t.name));
const CLI工具名集合 = new Set(cliActionTools.map(t => t.name));


// 导出对话分支工具
export { ConversationTools, BranchTools, setTaskDbConnection, mcpConnectionManager, setSkillIndexRef, 工具安全分级, 获取工具安全级别, 注册扩展工具, 注销扩展工具, 工具能力映射, audioTools, videoTools, imageTools, interactionTools, utilsTools, documentTools, systemTools, mcpTools, codeTools, cliActionTools, handleAudioTool, handleVideoTool, handleImageTool, handleInteractionTool, handleUtilsTool, handleDocumentTool, handleSystemTool, handleMcpTool, handleCodeTool, handleCliActionTool };







/**
 * 获取安全工具集（基础工具集 + 发现能力 + MCP）
 * 不再根据能力列表筛选工具，改为：初始只给 LLM 基础工具集 + 发现能力，
 * LLM 通过 发现能力 按需发现并加载更多工具。
 * 
 * @param {string} 安全级别 - 允许的最高安全级别: '安全'(只给安全工具) | '谨慎'(安全+可控) | '危险'(全部)，默认 '谨慎'
 * @param {boolean} MCP可用 - 是否有 MCP 连接可用
 * @returns {Array} 安全级别允许的基础工具定义数组
 */
export function 获取安全工具集(安全级别 = '谨慎', MCP可用 = false) {
  const 全部工具 = 获取所有工具定义();
  const 级别优先级 = { '安全': 1, '谨慎': 2, '危险': 3 };
  const 允许最高 = 级别优先级[安全级别] || 2;
  
  // 按安全级别过滤
  const 过滤结果 = 全部工具.filter(工具 => {
    const 工具级别 = 工具安全分级[工具.name] || '谨慎';
    return (级别优先级[工具级别] || 2) <= 允许最高;
  });

  // 保底工具：始终包含以下基础工具 + 发现能力
  // 这些工具是子任务执行的最低保障，确保 LLM 有足够的能力完成任务
  const 保底工具名 = [
    '日期时间',      // 时间获取 (safe)
    '网络信息',      // 网络信息 (safe)
    '查询任务',      // 查询依赖任务结果 (safe)
    '关联任务',      // 列出兄弟任务 (safe)
    '通知用户',      // 通知用户 (safe)
    '发现能力'       // 能力发现 (safe) - LLM 可主动查询更多能力
  ];
  // 只有安全级别允许时才加入 询问用户 (caution) 和 MCP 工具
  if (安全级别 !== '安全') {
    保底工具名.push('询问用户');   // 向用户提问 (caution)
    保底工具名.push('MCP列表');    // MCP连接列表 (safe)
    保底工具名.push('MCP工具列表'); // MCP工具列表 (safe)
    if (MCP可用) {
      保底工具名.push('MCP连接');  // MCP连接 (caution)
      保底工具名.push('MCP断开'); // MCP断开 (caution)
      保底工具名.push('MCP调用'); // MCP工具调用 (caution)
    }
  }
  if (安全级别 === '危险') {
    保底工具名.push('执行命令');   // 命令执行 (dangerous)
    保底工具名.push('电源控制');  // 电源操作 (dangerous)
  }

  // 确保保底工具始终存在
  const 已有工具名 = new Set(过滤结果.map(t => t.name));
  for (const name of 保底工具名) {
    if (!已有工具名.has(name)) {
      const tool = 全部工具.find(t => t.name === name);
      if (tool) 过滤结果.push(tool);
    }
  }
  
  logger.debug(`工具筛选: 安全级别: ${安全级别} MCP可用: ${MCP可用} → 基础工具=${过滤结果.length} 全量工具=${全部工具.length}`);
  return 过滤结果;
}

/**
 * 获取精选工具集（保底工具 + 精选工具 + 发现能力 + MCP）
 * 用于干活鸽子：从工具筛选结果中取出精选的工具，而非全量工具
 * 
 * 精选列表为空或不存在时直接抛出错误
 * 
 * @param {string[]} 精选工具名列表 - 工具筛选鸽子精选出的工具名列表
 * @param {string} 安全级别 - 允许的最高安全级别
 * @param {boolean} MCP可用 - 是否有 MCP 连接可用
 * @returns {Array} 精选工具定义数组
 */
export function 获取精选工具集(精选工具名列表, 安全级别 = '谨慎', MCP可用 = false) {
  if (!精选工具名列表 || 精选工具名列表.length === 0) {
    throw new Error('缺少精选工具列表');
  }

  const 全部工具 = 获取所有工具定义();
  const 级别优先级 = { '安全': 1, '谨慎': 2, '危险': 3 };
  const 允许最高 = 级别优先级[安全级别] || 2;

  // 从全量中按精选列表筛选
  const 精选工具名集合 = new Set(精选工具名列表);
  const 过滤结果 = 全部工具.filter(工具 => {
    if (!精选工具名集合.has(工具.name)) return false;
    const 工具级别 = 工具安全分级[工具.name] || '谨慎';
    return (级别优先级[工具级别] || 2) <= 允许最高;
  });

  // 保底工具始终包含（与 获取安全工具集 保持一致）
  const 保底工具名 = [
    '日期时间', '网络信息', '查询任务', '关联任务', '通知用户', '发现能力'
  ];
  if (安全级别 !== '安全') {
    保底工具名.push('询问用户', 'MCP列表', 'MCP工具列表');
    if (MCP可用) {
      保底工具名.push('MCP连接', 'MCP断开', 'MCP调用');
    }
  }
  if (安全级别 === '危险') {
    保底工具名.push('执行命令', '电源控制');
  }

  // 确保保底工具存在
  const 已有工具名 = new Set(过滤结果.map(t => t.name));
  for (const name of 保底工具名) {
    if (!已有工具名.has(name)) {
      const tool = 全部工具.find(t => t.name === name);
      if (tool) 过滤结果.push(tool);
    }
  }

  logger.debug(`精选工具集: ${精选工具名列表.length}个精选 + ${保底工具名.length}个保底 → ${过滤结果.length}个有效工具 (全量${全部工具.length}个)`);
  return 过滤结果;
}

/**
 * 加载工具
 * @param {string} 工具名 - 工具名称
 * @returns {Object} 工具模块
 */
export async function 加载工具(工具名) {
  logger.info(`加载工具: ${工具名}`);
  
  // 动态导入工具模块
  try {
    const 模块 = await import(`./${工具名}.js`);
    if (模块.default) {
      return 模块.default;
    }
  } catch (错误) {
    logger.error(`加载工具 ${工具名} 失败: ${错误.message}`);
  }
  
  return null;
}

/**
 * 执行工具
 * @param {string} 工具名 - 工具名称
 * @param {Object} 参数 - 执行参数
 * @param {Object} 上下文 - 执行上下文
 * @returns {Object} 执行结果
 */
export async function 执行工具(工具名, 参数, 上下文 = {}) {
  logger.info(`执行工具: ${工具名}`);
    
  const 工具 = await 加载工具(工具名);
    
  if (!工具) {
    return { 成功: false, 错误: `工具 ${工具名} 未找到` };
  }
    
  // 验证参数：检查 required 参数是否缺失
  if (工具.inputSchema && 工具.inputSchema.required) {
    const missingParams = 工具.inputSchema.required.filter(p => !(p in 参数));
    if (missingParams.length > 0) {
      return { 成功: false, 错误: `缺少必要参数: ${missingParams.join(', ')}` };
    }
  }

  // 记录执行日志
  const 开始时间 = Date.now();
  logger.debug(`${工具名} 开始执行`, { 参数键: Object.keys(参数) });
    
  try {
    const 结果 = await 工具.execute(参数, 上下文);
    const 耗时 = Date.now() - 开始时间;
    logger.info(`${工具名} 执行完成, 耗时: ${耗时}ms`);
    return 结果;
  } catch (错误) {
    const 耗时 = Date.now() - 开始时间;
    logger.error(`${工具名} 执行失败, 耗时: ${耗时}ms, 错误: ${错误.message}`);
    return { 成功: false, 错误: 错误.message };
  }
}

/**
 * 获取所有工具定义（用于LLM工具调用）
 * @returns {Array} 工具定义数组
 */
export function 获取所有工具定义() {
  // 合并扩展工具
  const 扩展工具列表 = [];
  for (const 扩展 of _扩展工具.values()) {
    扩展工具列表.push(...扩展.tools);
  }
  // 合并所有工具并按名称去重（同名工具优先保留内置版本）
  const 全部工具 = [
    ...webTools,
    ...audioTools,
    ...videoTools,
    ...imageTools,
    ...interactionTools,
    ...utilsTools,
    ...documentTools,
    ...systemTools,
    ...mcpTools,
    ...codeTools,
    ...cliActionTools,
    ...扩展工具列表
  ];
  const 已见名称 = new Set();
  const 去重结果 = [];
  for (const 工具 of 全部工具) {
    if (!已见名称.has(工具.name)) {
      已见名称.add(工具.name);
      去重结果.push(工具);
    } else {
      logger.warn(`跳过重复工具定义: ${工具.name}`);
    }
  }
  return 去重结果;
}

/**
 * 处理工具调用
 * @param {string} name - 工具名称
 * @param {Object} args - 工具参数
 * @param {Function} onProgress - 进度回调函数 (event) => void
 * @returns {Object} 执行结果
 */
export async function 处理工具调用(name, args, onProgress = null) {
  // 工具名→处理器路由（Set 查表，O(1) 查找，工具名改为中文后自动生效）
  if (系统工具名集合.has(name))   return handleSystemTool(name, args);
  if (Web工具名集合.has(name))    return handleWebTool(name, args);
  if (语音工具名集合.has(name))   return handleAudioTool(name, args);
  if (视频工具名集合.has(name))   return handleVideoTool(name, args);
  if (图片工具名集合.has(name))   return handleImageTool(name, args);
  if (交互工具名集合.has(name))   return handleInteractionTool(name, args, onProgress);
  if (文档工具名集合.has(name))   return handleDocumentTool(name, args);
  if (MCP工具名集合.has(name))    return handleMcpTool(name, args);
  if (实用工具名集合.has(name))   return handleUtilsTool(name, args);
  if (代码工具名集合.has(name))   return handleCodeTool(name, args);
  if (CLI工具名集合.has(name))    return handleCliActionTool(name, args, onProgress);

  // 扩展工具路由
  // 每个扩展 handler 只处理自己注册的工具，不认识的应返回 null
  for (const [扩展包名, 扩展] of _扩展工具) {
    if (扩展.handler) {
      try {
        // 注入 LLM 调用上下文，与 Server 端一致
        const extContext = {
          LLM调用: async (params) => {
            const { callLLM } = await import('../extensions/llm-service.js');
            const result = await callLLM(params);
            if (!result.success) throw new Error(result.error);
            return result.content;
          },
        };
        const 结果 = await 扩展.handler(name, args, extContext);
        // 返回 null/undefined 表示不处理此工具，跳过
        if (结果 === null || 结果 === undefined) continue;
        // 判断是否是"不认识此工具"的错误（应跳过，继续尝试其他扩展）
        if (结果.isError) {
          const 错误文本 = 结果.content?.[0]?.text || '';
          if (/Unknown \w+ tool|未知.{0,10}工具/.test(错误文本)) {
            continue; // 跳过，让其他扩展处理
          }
          return 结果; // 其他错误，直接返回
        }
        // 防御性检查：非 isError 但内容疑似"未知工具"错误（不规范格式，应跳过而非当作成功结果）
        const 疑似错误文本 = 结果.content?.[0]?.text || 结果.error || 结果.text || '';
        if (/未知.{0,20}工具|unknown.{0,10}tool/i.test(疑似错误文本)) {
          logger.warn(`扩展 ${扩展包名} 返回非标准错误格式（无isError标记），已跳过: ${name}`);
          continue;
        }
        return 结果;
      } catch (e) {
        logger.warn(`扩展处理器异常 (${扩展包名}:${name}): ${e.message}`);
        // 扩展处理器报错，继续尝试其他扩展
      }
    }
  }

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true
  };
}

export default {
  工具安全分级,
  获取工具安全级别,
  加载工具,
  执行工具,
  获取所有工具定义,
  获取安全工具集,
  处理工具调用,
  setTaskDbConnection,
  // 存储模块
  OSS存储,
  Git记忆,
  Git数据,
  存储索引,
  // 统一存储接口
  存储接口,
  MongoDB适配器,
  Git记忆适配器,
  Git数据适配器,
  OSS适配器,
  // 新增工具模块
  audioTools,
  videoTools,
  imageTools,
  interactionTools,
  utilsTools,
  documentTools,
  systemTools,
  mcpTools,
  handleAudioTool,
  handleVideoTool,
  handleImageTool,
  handleInteractionTool,
  handleUtilsTool,
  handleDocumentTool,
  handleSystemTool,
  handleMcpTool,
  mcpConnectionManager,
  // 代码工具
  codeTools,
  handleCodeTool,
  // 新增：对话分支相关工具
  ConversationTools,
  BranchTools
};
