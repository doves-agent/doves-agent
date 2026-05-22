/**
 * @file 精简工具执行
 * @description KISS 架构精简工具执行器 —— 替代老系统的 tools/index.js → 执行路由器 → Node执行器 管道
 *
 * 设计原则：
 * - 直接内联实现每个工具的执行逻辑，不走老系统的多层管道
 * - 参考新系统 doves/技能执行.js，保持一致的实现风格
 * - 老系统特色工具（cli_action / notify_user / discover_capability）通过 DovesProxy 实现
 * - 返回格式统一为 { success: bool, result: string, error?: string }
 *
 * 子模块拆分：
 * - 精简工具执行-文件操作.js: 文件读写、目录、搜索
 * - 精简工具执行-Shell与Git.js: Shell 执行、Git 操作
 * - 精简工具执行-网络与搜索.js: HTTP、网页搜索/抓取、语义搜索
 * - 精简工具执行-媒体生成.js: 图像生成、元素拆解、TTS、3D
 * - 精简工具执行-扩展交互.js: CLI协作、通知、能力发现、工具组、子任务、记忆、快照
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';
import { mcpConnectionManager } from './tools/mcp客户端.js';

// 文件操作
import { 读文件, 写文件, 编辑文件, 列目录, 删文件, 搜文件, 正则搜代码, 提取定义, 目录树, 批量读文件, 多文件替换 } from './精简工具执行-文件操作.js';
// Shell 与 Git
import { 执行Shell, git状态, git差异, git日志, git分支, git切换, git提交, git推送, git拉取, 执行测试 } from './精简工具执行-Shell与Git.js';
// 网络与搜索
import { http获取, http发送, 网页搜索, 网页抓取, 语义搜代码 } from './精简工具执行-网络与搜索.js';
// 媒体生成
import { 生成图片, 元素拆解, 语音合成, 生成3D } from './精简工具执行-媒体生成.js';
// 扩展交互
import { 请求上传, cli协作, 通知用户, 能力发现, 加载工具组, 委派子任务, 记住, 回忆, 记住多媒体, 快照, 获取记忆适配器, 获取存储适配器 } from './精简工具执行-扩展交互.js';

const logger = 创建日志器('精简工具执行', { 前缀: '[Skill]', 级别: 'debug' });

// ==================== 执行入口 ====================

/**
 * 执行单个工具调用
 * @param {string} name - 工具名
 * @param {object} args - 参数
 * @param {object} 上下文 - { DovesProxy, 任务ID, 根任务ID, 用户ID }
 * @returns {Promise<{success: boolean, result: string, error?: string}>}
 */
export async function executeSkill(name, args, 上下文 = {}) {
  const fn = SKILL_EXECUTORS[name];
  if (fn) {
    try {
      logger.info(`执行: ${name}(${JSON.stringify(args).substring(0, 100)})`);
      const result = await fn(args, 上下文);
      logger.info(`${name} → 成功 (${typeof result === 'string' ? result.length : 'object'} 字符)`);
      // load_tool_group 可能返回 { result, groupTools } 对象
      if (result && typeof result === 'object' && result.groupTools) {
        return { success: true, result: result.result, groupTools: result.groupTools };
      }
      return { success: true, result: typeof result === 'string' ? result : result?.result || JSON.stringify(result) };
    } catch (e) {
      logger.warn(`${name} → 失败: ${e.message}`);
      return { success: false, result: '', error: e.message };
    }
  }

  // MCP 工具路由：工具名不在本地映射时，检查是否属于已连接的 MCP 服务
  const mcpSource = findMCPToolSource(name);
  if (mcpSource) {
    try {
      logger.info(`MCP执行: ${mcpSource.connection}/${name}(${JSON.stringify(args).substring(0, 100)})`);
      const result = await mcpConnectionManager.callTool(mcpSource.connection, name, args || {});
      const text = extractMCPResultText(result);
      logger.info(`MCP ${name} → 成功`);
      return { success: true, result: text };
    } catch (e) {
      logger.warn(`MCP ${name} → 失败: ${e.message}`);
      return { success: false, result: '', error: e.message };
    }
  }

  logger.warn(`${name} → 未知工具`);
  return { success: false, result: '', error: `未知工具: ${name}，请使用已加载的工具` };
}

// ==================== 执行器映射表 ====================

const SKILL_EXECUTORS = {
  read_file: 读文件,
  write_file: 写文件,
  edit_file: 编辑文件,
  list_dir: 列目录,
  delete_file: 删文件,
  search_files: 搜文件,
  grep_code: 正则搜代码,
  list_definitions: 提取定义,
  directory_tree: 目录树,
  batch_read: 批量读文件,
  find_and_replace: 多文件替换,
  shell_exec: 执行Shell,
  run_test: 执行测试,
  git_status: git状态,
  git_diff: git差异,
  git_log: git日志,
  git_branch: git分支,
  git_checkout: git切换,
  git_commit: git提交,
  git_push: git推送,
  git_pull: git拉取,
  http_get: http获取,
  http_post: http发送,
  web_search: 网页搜索,
  web_fetch: 网页抓取,
  search_codebase: 语义搜代码,
  generate_image: 生成图片,
  element_extract: 元素拆解,
  speak_text: 语音合成,
  generate_3d: 生成3D,
  request_upload: 请求上传,
  cli_action: cli协作,
  notify_user: 通知用户,
  discover_capability: 能力发现,
  load_tool_group: 加载工具组,
  delegate_subtasks: 委派子任务,
  remember: 记住,
  recall: 回忆,
  remember_media: 记住多媒体,
  snapshot: 快照,
  // harness 级工具：think 和 summarize_progress 在 KISS 执行器中特殊处理
  think: async (args) => args.thought ? '(已思考)' : '(空)',
  summarize_progress: async (args) => `已记录摘要: ${(args.summary || '').substring(0, 100)}...`,
};

export default { executeSkill, SKILL_EXECUTORS };

// ==================== MCP 工具路由辅助 ====================

/**
 * 查找工具名所属的 MCP 连接
 * @returns {{ connection: string, tool: object } | null}
 */
function findMCPToolSource(toolName) {
  for (const [connName, conn] of mcpConnectionManager.connections.entries()) {
    if (!conn.connected) continue;
    const tool = conn.tools.find(t => t.name === toolName);
    if (tool) return { connection: connName, tool };
  }
  return null;
}

/**
 * 从 MCP 调用结果中提取文本
 */
function extractMCPResultText(result) {
  if (!result) return '';
  // MCP 标准返回格式: { content: [{type:'text', text:'...'}, ...] }
  if (result.content && Array.isArray(result.content)) {
    return result.content
      .map(item => {
        if (item.type === 'text') return item.text;
        if (item.type === 'image') return `[图片: ${item.mimeType || 'image/png'}${item.data ? `, ${item.data.length} bytes base64` : ''}]`;
        return JSON.stringify(item);
      })
      .join('\n');
  }
  if (typeof result === 'string') return result;
  return JSON.stringify(result, null, 2);
}
