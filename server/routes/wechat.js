/**
 * 微信 iLink 通道管理 - 聚合器
 *
 * 子路由:
 *   wechat/wechat-绑定.js      - 绑定/解绑 / 状态查询 / 启用禁用
 *   wechat/wechat-会话-文件.js  - 会话令牌管理 / 诊断 / 文件发送
 *   wechat/shared.js           - 全局监听器单例 + 会话缓存 + 启动停止函数
 *   wechat/加密工具.js          - botToken 加解密
 *   wechat/iLink工具.js         - iLink API 请求封装
 *   wechat/微信监听管理器.js     - 长连接监听管理
 *   wechat/消息处理器.js        - 消息接收处理
 *   wechat/话题检测器.js        - 话题检测
 *   wechat/语音识别器.js        - 语音识别
 */
import { Router } from 'express';
import 绑定Router from './wechat/wechat-绑定.js';
import 会话文件Router from './wechat/wechat-会话-文件.js';

const router = Router();
router.use(绑定Router);
router.use(会话文件Router);

export {
  startWeChatListeners,
  startWeChatListenerForUser,
  stopWeChatListenerForUser,
  wechatListenerManager
} from './wechat/shared.js';

export default router;
