/**
 * 飞书企业应用通道管理 - 聚合器
 *
 * 子路由:
 *   feishu/feishu-配置.js  - 配置CRUD / 启用禁用 / 连接测试 / 文件发送
 *   feishu/feishu-webhook.js - 事件回调 / 签名验证 / 消息处理 / 诊断
 *   feishu/shared.js        - 全局监听器单例 + 启动/停止函数
 *   feishu/加密工具.js       - 加解密 + 会话缓存
 *   feishu/消息监听器.js     - 长连接监听管理
 */
import { Router } from 'express';
import 配置Router from './feishu/feishu-配置.js';
import WebhookRouter from './feishu/feishu-webhook.js';
const router = Router();
router.use(配置Router);
router.use(WebhookRouter);

export {
  startFeishuListeners,
  startFeishuListenerForUser,
  stopFeishuListenerForUser,
  feishuListenerManager
} from './feishu/shared.js';

// 导出 Webhook 处理函数（供路由配置免认证挂载）
export { handleFeishuWebhook } from './feishu/feishu-webhook.js';

export default router;
