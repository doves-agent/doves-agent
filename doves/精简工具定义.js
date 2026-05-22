/**
 * @file 精简工具定义
 * @description KISS 架构精简工具集 —— 替代老系统 76 个工具的臃肿定义
 *
 * 设计原则：
 * - 从新系统 doves/skills.js 移植核心工具定义
 * - 移除"询问用户"（模型滥用，事件集合模式与 KISS 不兼容）
 * - 保留老系统特色工具（cli_action / notify_user / discover_capability）
 * - 每个工具描述清晰无歧义，减少模型选错工具的概率
 *
 * 工具总数：~29 个（vs 老系统 76 个）
 * 
 * KISS v4 新增：delegate_subtasks（任务拆分）、remember/recall（长期记忆）、snapshot（文件快照）
 *
 * 子模块拆分：
 * - 精简工具定义-工具列表.js: OpenAI function-calling 格式 JSON 定义
 */

// ==================== 工具分组映射 ====================
// 供 load_tool_group 按组名查找工具定义
// 工具可属于多个组（会出现在多个组的结果中）
export const 工具分组 = {
  '文件操作': ['read_file', 'write_file', 'edit_file', 'list_dir', 'delete_file', 'search_files', 'grep_code', 'search_codebase', 'list_definitions', 'directory_tree', 'batch_read', 'find_and_replace'],
  '系统命令': ['shell_exec', 'run_test'],
  'Git版本控制': ['git_status', 'git_diff', 'git_log', 'git_branch', 'git_checkout', 'git_commit', 'git_push', 'git_pull'],
  '网络请求': ['http_get', 'http_post', 'web_search', 'web_fetch'],
  '媒体生成': ['generate_image', 'element_extract', 'speak_text', 'generate_3d'],
  '扩展交互': ['cli_action', 'discover_capability'],
  '任务管理': ['delegate_subtasks'],
  '长期记忆': ['remember', 'recall'],
  '文件快照': ['snapshot'],
  '推理与规划': ['think', 'summarize_progress'],
  '保底工具': ['read_file', 'edit_file', 'list_definitions', 'directory_tree', 'think', 'shell_exec', 'notify_user', 'request_upload', 'load_tool_group'],
};

// 导入工具列表 JSON 数据
import { 精简工具列表 as _工具列表 } from './精简工具定义-工具列表.js';
export const 精简工具列表 = _工具列表;

/**
 * 获取精简工具定义列表（全量）
 * @returns {Array} OpenAI function-calling 格式工具定义
 */
export function 获取精简工具定义() {
  return 精简工具列表;
}

/**
 * 获取保底工具定义（KISS 启动时使用，始终可用的最小工具集）
 * @returns {Array} 保底工具定义数组
 */
export function 获取保底工具定义() {
  const 保底名 = new Set(工具分组['保底工具'] || ['read_file', 'shell_exec', 'notify_user', 'request_upload', 'load_tool_group']);
  return 精简工具列表.filter(t => 保底名.has(t.function.name));
}

/**
 * 获取分组摘要文本（注入系统提示词，帮助 LLM 了解可用工具组）
 * @returns {string}
 */
export function 获取分组摘要() {
  const 行 = [];
  for (const [组名, 工具名列表] of Object.entries(工具分组)) {
    if (组名 === '保底工具') continue;
    行.push(`- ${组名}（${工具名列表.length}个工具）：${工具名列表.join('、')}`);
  }
  return 行.join('\n');
}

/**
 * 获取指定分组的工具定义（OpenAI function-calling 格式）
 * @param {string} 组名 - 分组名称
 * @returns {Object|null} { group, tools } 或 null
 */
export function 获取分组工具定义(组名) {
  const 工具名列表 = 工具分组[组名];
  if (!工具名列表 || 工具名列表.length === 0) return null;
  const 名集合 = new Set(工具名列表);
  const tools = 精简工具列表.filter(t => 名集合.has(t.function.name));
  if (tools.length === 0) return null;
  return { group: 组名, tools };
}

/**
 * 获取所有分组名（不含保底工具）
 * @returns {string[]}
 */
export function 获取所有分组名() {
  return Object.keys(工具分组).filter(k => k !== '保底工具');
}

/**
 * 根据名称获取单个工具定义
 */
export function getTool(name) {
  return 精简工具列表.find(t => t.function.name === name);
}

/**
 * 获取所有工具名列表
 */
export function getToolNames() {
  return 精简工具列表.map(t => t.function.name);
}

export default { 精简工具列表, 获取精简工具定义, 获取保底工具定义, 获取分组摘要, 获取分组工具定义, 获取所有分组名, getTool, getToolNames };
