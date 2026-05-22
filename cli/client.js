/**
 * 白鸽系统 CLI 客户端
 * 模块化设计的聚合导出
 * 
 * 所有功能已拆分到独立模块：
 * - lib/base-client.js: 基础HTTP客户端
 * - lib/auth.js: 认证API
 * - lib/task.js: 任务API
 * - lib/conversation.js: 对话API
 * - lib/user.js: 用户管理API（API Key、白鸽、Profile等）
 * - lib/admin.js: 管理员API（管理员登录、凭证管理）
 * - lib/storage.js: 存储API (Git存储 + OSS临时目录)
 * - lib/mcp.js: MCP管理API
 */

// 导出所有子模块，支持按需导入
export { BaseClient } from './lib/base-client.js';
export { AuthClient } from './lib/auth.js';
export { TaskClient } from './lib/task.js';
export { ConversationClient } from './lib/conversation.js';
export { UserClient } from './lib/user.js';
export { AdminClient } from './lib/admin.js';
export { StorageClient } from './lib/storage.js';
export { MCPClient } from './lib/mcp.js';

// 导出工具函数（从config.js直接导出）
export { CONFIG_DIR, CONFIG_FILE, secureFile, secureMkdir } from './lib/config.js';

// 导出微信 iLink 通道客户端
export { WeChatChannel } from './lib/wechat-channel.js';

// 导出微信绑定管理函数（按用户隔离）
export { saveWechatBinding, loadWechatBinding, deleteWechatBinding, syncWechatOnAccountSwitch } from './lib/config.js';

// 导入UserClient用于DoveClient继承
import { UserClient } from './lib/user.js';

/**
 * DoveClient - 完整功能的普通用户客户端
 * 继承 UserClient，包含所有用户级别功能
 * 不包含管理员专用功能，如需管理员功能请使用 AdminClient
 */
export class DoveClient extends UserClient {
  // DoveClient 继承 UserClient 的所有功能
  // 无需额外实现，作为完整客户端的统一入口
  // 微信通道由 WeChatChannel 独立管理，不在此继承链中
}
