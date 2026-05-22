/**
 * @file skills/index
 * @description 技能模块索引，包含文档处理/代码计算/网络搜索/多媒体等技能
 * 
 * 【KISS原则文档的一部分】
 * 
 * === 技能分类 ===
 * ├── 文档处理: pdf, docx, xlsx, pptx, txt
 * ├── 代码计算: code, calculator, math
 * ├── 网络搜索: web_search, http_request, browser_agent
 * ├── 多媒体: image, vision, audio, video
 * ├── 记忆系统: memory, git_memory
 * ├── 外部服务: mcp_client, docker_agent, ssh_agent
 * └── 解析器: archive, code, config, data, ebook
 * 
 * === 技能接口规范 (StandardSkill) ===
 * {
 *   id: "skill_xxx",            // 技能唯一标识
 *   name: "技能名称",            // 显示名称
 *   version: "1.0.0",           // 版本号
 *   description: "技能描述",     // 描述
 *   requiredRole: "admin",      // 可选：权限要求
 *   
 *   // 能力声明
 *   abilities: ["文档", "PDF"],
 *   
 *   // 参数 Schema (OpenAI function calling 格式)
 *   parameters: {
 *     type: 'object',
 *     properties: {
 *       action: { type: 'string', description: '操作类型' }
 *     },
 *     required: ['action']
 *   },
 *   
 *   // 执行入口
 *   async execute(params, context) {
 *     // context.userRole 包含当前用户角色
 *     // 返回标准格式
 *     return { 成功: true, data: {...} };
 *     // 或
 *     return { 成功: false, 错误: '错误原因', 错误码: 'PERMISSION_DENIED' };
 *   }
 * }
 * 
 * === 技能设计原则 ===
 * 1. 参数自包含 - 技能调用时参数必须完全自包含，不依赖外部上下文
 * 2. 无状态执行 - 技能不依赖进程内存状态，所有状态存储在 MongoDB
 * 3. KISS 原则 - 不做复杂抽象，直接操作底层 API
 * 
 * === 技能数据库架构 ===
 * MongoDB 用户库 '技能' 集合:
 * {
 *   id: "skill_xxx",           // 技能ID
 *   标题: "技能标题",
 *   描述: "技能描述",
 *   代码: "async function execute...",  // JavaScript代码
 *   参数: { type: 'object', properties: {...} },
 *   仅限管理员: false,
 *   黑名单: [],
 *   价格: 100,
 *   状态: "active"
 * }
 * 
 * === 权限验证 ===
 * 技能可声明 requiredRole 字段指定需要的用户角色
 * 技能管理器在执行前自动检查权限，权限不足返回 PERMISSION_DENIED 错误
 * 
 * === 已迁移技能 ===
 * ├── browser_agent: 浏览器控制（Puppeteer/Playwright）
 * ├── ssh_agent: SSH远程控制（命令执行/SFTP/Docker）
 * ├── txt: 文件操作（读写/复制/移动/删除）
 * └── resource_allocation: 用户资源分配
 */

// 从子模块导入并重新导出
import { 技能分类, 已实现技能, 扫描技能目录, 扫描多个技能目录 } from './技能常量.js';
import { 验证技能参数 } from './技能验证器.js';
import { 技能管理器 } from './技能管理器.js';

export { 技能分类, 已实现技能, 扫描技能目录, 扫描多个技能目录, 验证技能参数, 技能管理器 };

/**
 * 创建技能模块（标准格式）
 * @param {Object} 配置 - 技能配置
 * @returns {Object} 技能模块
 */
export function 创建技能(配置) {
  return {
    name: 配置.名称,
    description: 配置.描述,
    parameters: 配置.参数 || { type: 'object', properties: {}, required: [] },
    async execute(params, context) {
      // 参数必须自包含，不依赖外部上下文
      // 无状态执行，支持并发调用
      return { success: true, data: {} };
    }
  };
}

// 默认技能管理器实例
const 默认管理器 = new 技能管理器();

/**
 * 加载技能（快捷函数）
 */
export async function 加载技能(技能名) {
  return 默认管理器.加载技能(技能名);
}

/**
 * 加载所有技能（快捷函数）
 */
export async function 加载所有技能() {
  return 默认管理器.加载所有技能();
}

/**
 * 执行技能（快捷函数）
 */
export async function 执行技能(技能名, 参数, 上下文 = {}) {
  return 默认管理器.执行技能(技能名, 参数, 上下文);
}

/**
 * 获取技能列表（快捷函数）
 */
export function 获取技能列表() {
  return 默认管理器.获取技能列表();
}

/**
 * 获取技能描述（快捷函数）
 */
export function 获取技能描述(技能名) {
  return 默认管理器.获取技能描述(技能名);
}

/**
 * 设置禁用配置（快捷函数）
 */
export function 设置技能禁用配置(配置) {
  return 默认管理器.设置禁用配置(配置);
}

/**
 * 禁用技能（快捷函数）
 */
export function 禁用技能(技能名) {
  return 默认管理器.禁用技能(技能名);
}

/**
 * 启用技能（快捷函数）
 */
export function 启用技能(技能名) {
  return 默认管理器.启用技能(技能名);
}

/**
 * 禁用分类（快捷函数）
 */
export function 禁用技能分类(分类名) {
  return 默认管理器.禁用分类(分类名);
}

/**
 * 启用分类（快捷函数）
 */
export function 启用技能分类(分类名) {
  return 默认管理器.启用分类(分类名);
}

/**
 * 获取禁用列表（快捷函数）
 */
export function 获取技能禁用列表() {
  return 默认管理器.获取禁用列表();
}

/**
 * 获取可用技能列表（快捷函数）
 */
export function 获取可用技能列表() {
  return 默认管理器.获取可用技能列表();
}

/**
 * 获取所有技能详情（快捷函数）
 */
export function 获取所有技能详情() {
  return 默认管理器.获取所有技能详情();
}

export default {
  技能分类,
  已实现技能,
  技能管理器,
  创建技能,
  加载技能,
  加载所有技能,
  执行技能,
  获取技能列表,
  获取技能描述,
  扫描技能目录,
  扫描多个技能目录,
  // 禁用管理功能
  设置技能禁用配置,
  禁用技能,
  启用技能,
  禁用技能分类,
  启用技能分类,
  获取技能禁用列表,
  获取可用技能列表,
  获取所有技能详情
};
