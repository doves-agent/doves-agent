/**
 * 钉钉消息监听管理器
 * 从 dingtalk.js 提取
 */

import { ObjectId } from 'mongodb';
import { getMongoClient, getAdminDb, getUserDb, createTimestampFields } from '../../db.js';
import { 记录审计 } from '../../审计日志.js';
import { 保存媒体文件, 验证文件大小, 判断媒体类型 } from '../../im/媒体服务.js';
// dingtalk-stream 为可选依赖，未安装时钉钉消息监听不可用
let DWClient, TOPIC_ROBOT, EventAck;
try {
  ({ DWClient, TOPIC_ROBOT, EventAck } = require('dingtalk-stream'));
} catch {
  // 钉钉 SDK 未安装
}
import { toLocalISOString } from '@dove/common/时间工具.js';
import { logger } from '../../core.js';
import { decryptSecret } from './加密工具.js';
import { existsSync, statSync } from 'fs';

class DingTalkListenerManager {
  constructor() {
    /** @type {Map<string, {appKey:string, appSecret:string, agentId:string, listening:boolean, activeConversations:Map<string,string>}>} */
    this.listeners = new Map();
    this._stopSignals = new Map();
    this._dwClients = new Map(); // userId -> DWClient 实例
  }

  /**
   * 启动某个用户的钉钉消息监听
   */
  startListener(userId, appKey, appSecret, agentId) {
    if (this.listeners.has(userId)) {
      const existing = this.listeners.get(userId);
      existing.appKey = appKey;
      existing.appSecret = appSecret;
      existing.agentId = agentId;
      return;
    }

    logger.info(`[钉钉监听] 启动用户 ${userId} 的消息监听（dingtalk-stream SDK）`);

    const state = {
      appKey,
      appSecret,
      agentId,
      listening: true,
      activeConversations: new Map(), // conversationId -> conversationId
    };
    this.listeners.set(userId, state);
    this._stopSignals.set(userId, false);

    // 创建 dingtalk-stream DWClient 并注册机器人消息回调
    const dwClient = new DWClient({
      clientId: appKey,
      clientSecret: appSecret,
    });

    // 注册机器人消息回调
    dwClient.registerCallbackListener(TOPIC_ROBOT, async (msg) => {
      try {
        const data = JSON.parse(msg.data || '{}');
        const senderId = data.senderStaffId || data.senderId || '';
        const conversationId = data.conversationId || '';
        const content = data.text?.content || data.content || '';
        const msgtype = data.msgtype || 'text';

        logger.info(`[钉钉 Stream] 收到消息: senderId=${senderId}, msgtype=${msgtype}`);

        if (content && senderId) {
          await this._handleCallbackEvent(userId, {
            senderId,
            conversationId,
            content: typeof content === 'string' ? content : JSON.stringify(content),
            msgtype,
            原始消息: data,
            // 媒体消息字段
            mediaId: data.mediaId || data.downloadCode,
            fileName: data.fileName || data.filename,
          });
        }

        // 响应钉钉，避免重试
        dwClient.socketCallBackResponse(msg.headers.messageId, JSON.stringify({ result: 'SUCCESS' }));
      } catch (err) {
        logger.error(`[钉钉 Stream] 处理消息回调失败: ${err.message}`);
        dwClient.socketCallBackResponse(msg.headers.messageId, JSON.stringify({ result: 'LATER' }));
      }
    });

    // 启动 WebSocket 连接
    dwClient.connect().then(() => {
      logger.info(`[钉钉监听] 用户 ${userId} Stream 连接成功`);
    }).catch(err => {
      logger.error(`[钉钉监听] 用户 ${userId} Stream 连接失败: ${err.message}`);
    });

    this._dwClients.set(userId, dwClient);
  }

  /**
   * 停止某个用户的钉钉消息监听
   */
  stopListener(userId) {
    this._stopSignals.set(userId, true);
    const state = this.listeners.get(userId);
    if (state) {
      state.listening = false;
    }
    // 断开 SDK Stream 连接
    const dwClient = this._dwClients.get(userId);
    if (dwClient) {
      try { dwClient.disconnect(); } catch (e) { logger.warn('钉钉SDK断开连接异常:', e.message); }
      this._dwClients.delete(userId);
    }
    this.listeners.delete(userId);
    logger.info(`[钉钉监听] 停止用户 ${userId} 的消息监听`);
  }

  /**
   * 启动所有已配置用户的监听（服务端启动时调用）
   */
  async startAll() {
    try {
      await getMongoClient();
      const adminDb = getAdminDb();
      const configs = await adminDb.collection('钉钉配置')
        .find({ 启用: true, 模式: 'enterprise' })
        .toArray();

      for (const 配置 of configs) {
        const appSecret = decryptSecret(配置.encryptedAppSecret);
        if (appSecret && 配置.appKey) {
          this.startListener(配置.用户ID, 配置.appKey, appSecret, 配置.agentId);
        }
      }

      logger.info(`[钉钉监听] 已启动 ${configs.length} 个用户的钉钉消息监听`);
    } catch (err) {
      logger.error(`[钉钉监听] 启动失败: ${err.message}`);
    }
  }

  /**
   * 处理 Webhook 回调事件
   */
  async _handleCallbackEvent(userId, event) {
    const state = this.listeners.get(userId);
    if (!state) return;

    const fromUserId = event.senderId;
    const conversationId = event.conversationId || fromUserId;
    const msgtype = event.msgtype || 'text';

    let text = '';
    let mediaInfo = null; // 媒体文件接收信息

    // 根据消息类型处理
    if (msgtype === 'text' || msgtype === 'sampleText') {
      // 文本消息
      text = event.content?.trim() || '';
    } else if (msgtype === 'picture' || msgtype === 'image' || msgtype === 'sampleImage') {
      // 图片消息
      try {
        const 钉钉适配器 = await this._getAdapter(state);
        const downloadResult = await 钉钉适配器.下载媒体({
          mediaId: event.mediaId || event.downloadCode,
          msgtype: 'image',
        });
        if (downloadResult && downloadResult.data) {
          const sizeCheck = 验证文件大小(downloadResult.data.length, 'image');
          if (!sizeCheck.ok) {
            await this._sendDingTalkMessage(state, fromUserId, `收到图片，但文件过大(${(downloadResult.data.length / 1024 / 1024).toFixed(1)}MB)，限制${sizeCheck.limit / 1024 / 1024}MB`);
            return;
          }
          const fileName = `image_${Date.now()}.jpg`;
          const saved = 保存媒体文件(userId, fileName, downloadResult.data, { subDir: 'dingtalk' });
          mediaInfo = { type: 'image', fileName: saved.fileName, savePath: saved.path, size: saved.size, mime: saved.mime };
          logger.info(`[钉钉监听] 图片已保存: ${saved.path} (${saved.size} bytes)`);
        } else {
          await this._sendDingTalkMessage(state, fromUserId, '收到图片，但下载失败');
          return;
        }
      } catch (err) {
        logger.error(`[钉钉监听] 图片下载失败: ${err.message}`);
        await this._sendDingTalkMessage(state, fromUserId, `收到图片，但处理失败: ${err.message}`);
        return;
      }
    } else if (msgtype === 'file' || msgtype === 'sampleFile') {
      // 文件消息
      try {
        const 钉钉适配器 = await this._getAdapter(state);
        const downloadResult = await 钉钉适配器.下载媒体({
          mediaId: event.mediaId || event.downloadCode,
          msgtype: 'file',
          fileName: event.fileName || event.filename,
        });
        if (downloadResult && downloadResult.data) {
          const mediaType = 判断媒体类型(downloadResult.kind === 'file' ? 'application/octet-stream' : downloadResult.kind);
          const sizeCheck = 验证文件大小(downloadResult.data.length, mediaType);
          if (!sizeCheck.ok) {
            await this._sendDingTalkMessage(state, fromUserId, `收到文件，但文件过大(${(downloadResult.data.length / 1024 / 1024).toFixed(1)}MB)，限制${sizeCheck.limit / 1024 / 1024}MB`);
            return;
          }
          const fileName = event.fileName || event.filename || downloadResult.fileName || `file_${Date.now()}.bin`;
          const saved = 保存媒体文件(userId, fileName, downloadResult.data, { subDir: 'dingtalk' });
          mediaInfo = { type: 'file', fileName: saved.fileName, savePath: saved.path, size: saved.size, mime: saved.mime };
          logger.info(`[钉钉监听] 文件已保存: ${saved.path} (${saved.size} bytes)`);
        } else {
          await this._sendDingTalkMessage(state, fromUserId, '收到文件，但下载失败');
          return;
        }
      } catch (err) {
        logger.error(`[钉钉监听] 文件下载失败: ${err.message}`);
        await this._sendDingTalkMessage(state, fromUserId, `收到文件，但处理失败: ${err.message}`);
        return;
      }
    } else if (msgtype === 'video' || msgtype === 'sampleVideo') {
      // 视频消息
      try {
        const 钉钉适配器 = await this._getAdapter(state);
        const downloadResult = await 钉钉适配器.下载媒体({
          mediaId: event.mediaId || event.downloadCode,
          msgtype: 'video',
        });
        if (downloadResult && downloadResult.data) {
          const sizeCheck = 验证文件大小(downloadResult.data.length, 'video');
          if (!sizeCheck.ok) {
            await this._sendDingTalkMessage(state, fromUserId, `收到视频，但文件过大(${(downloadResult.data.length / 1024 / 1024).toFixed(1)}MB)，限制${sizeCheck.limit / 1024 / 1024}MB`);
            return;
          }
          const fileName = `video_${Date.now()}.mp4`;
          const saved = 保存媒体文件(userId, fileName, downloadResult.data, { subDir: 'dingtalk' });
          mediaInfo = { type: 'video', fileName: saved.fileName, savePath: saved.path, size: saved.size, mime: saved.mime };
          logger.info(`[钉钉监听] 视频已保存: ${saved.path} (${saved.size} bytes)`);
        } else {
          await this._sendDingTalkMessage(state, fromUserId, '收到视频，但下载失败');
          return;
        }
      } catch (err) {
        logger.error(`[钉钉监听] 视频下载失败: ${err.message}`);
        await this._sendDingTalkMessage(state, fromUserId, `收到视频，但处理失败: ${err.message}`);
        return;
      }
    } else {
      // 其他类型消息
      text = event.content?.trim() || `[${msgtype}类型消息]`;
    }

    // 构造任务描述文本
    if (mediaInfo && !text) {
      const sizeStr = mediaInfo.size > 1024 * 1024
        ? `${(mediaInfo.size / 1024 / 1024).toFixed(1)}MB`
        : `${(mediaInfo.size / 1024).toFixed(1)}KB`;
      const typeLabel = { image: '图片', file: '文件', video: '视频' }[mediaInfo.type] || '文件';
      text = `[${typeLabel}] ${mediaInfo.fileName} (${sizeStr})\n已保存到: ${mediaInfo.savePath}`;
      logger.info(`[钉钉监听] 用户 ${userId} 收到钉钉${typeLabel}: ${mediaInfo.fileName} (${sizeStr})`);
    } else if (mediaInfo && text) {
      const sizeStr = mediaInfo.size > 1024 * 1024
        ? `${(mediaInfo.size / 1024 / 1024).toFixed(1)}MB`
        : `${(mediaInfo.size / 1024).toFixed(1)}KB`;
      const typeLabel = { image: '图片', file: '文件', video: '视频' }[mediaInfo.type] || '文件';
      text += `\n[附件: ${typeLabel} ${mediaInfo.fileName} (${sizeStr})，已保存到: ${mediaInfo.savePath}]`;
    }

    if (!text) return;

    logger.info(`[钉钉监听] 用户 ${userId} 收到钉钉消息: "${text.slice(0, 50)}" (from: ${fromUserId})`);

    try {
      await getMongoClient();
      const db = getUserDb();

      // 查找或创建对话
      let convId = state.activeConversations.get(conversationId);

      if (!convId) {
        const existingConv = await db.collection('对话').findOne({
          用户ID: userId,
          来源: 'dingtalk',
          钉钉会话ID: conversationId,
        }, { sort: { 创建时间戳: -1 } });

        if (existingConv) {
          convId = existingConv.对话ID;
        } else {
          const ts2 = createTimestampFields();
          convId = new ObjectId().toString();
          const conv = {
            _id: convId,
            对话ID: convId,
            标题: `[钉钉] ${text.slice(0, 40)}`,
            对话轮次: [],
            用户ID: userId,
            来源: 'dingtalk',
            钉钉会话ID: conversationId,
            钉钉发送者ID: fromUserId,
            创建时间: ts2.localTime,
            创建时间戳: ts2.timestamp,
          };
          await db.collection('对话').insertOne(conv);
        }
        state.activeConversations.set(conversationId, convId);
      }

      // 创建任务
      const ts = createTimestampFields();
      const task = {
        任务ID: new ObjectId().toString(),
        描述: text,
        类型: 'routing',
        状态: '已就绪',
        阶段: '等待中',
        对话ID: convId,
        根任务ID: null,
        父任务ID: null,
        子任务列表: [],
        子任务状态: { 总数: 0, 已完成: 0, 已失败: 0 },
        执行者: null,
        执行提供商: null,
        心跳时间: null,
        流缓冲: [],
        结果: null,
        错误: null,
        用户ID: userId,
        来源: 'dingtalk',
        IM媒体: mediaInfo || null,
        IM上下文: {
          platform: 'dingtalk',
          userId: fromUserId,   // 钉钉用户 ID
          mediaInfo: mediaInfo || null,
        },
        创建时间: ts.localTime,
        创建时间戳: ts.timestamp,
        更新时间: ts.localTime,
        更新时间戳: ts.timestamp
      };
      await db.collection('任务').insertOne(task);

      logger.info(`[钉钉监听] 用户 ${userId} 创建任务 ${task.任务ID}`);

      // 监听任务完成，推送结果到钉钉
      this._watchTaskAndPush(userId, state, task.任务ID, fromUserId).catch(err => {
        logger.warn(`[钉钉监听] 任务监听失败: ${err.message}`);
      });

    } catch (err) {
      logger.error(`[钉钉监听] 处理消息失败: ${err.message}`);
    }
  }

  /**
   * 获取钉钉适配器实例
   * @private
   */
  async _getAdapter(state) {
    const { 钉钉适配器 } = await import('../../im/钉钉适配器.js');
    const adapter = new 钉钉适配器({
      appKey: state.appKey,
      appSecret: state.appSecret,
      agentId: state.agentId,
    });
    adapter.已初始化 = true; // 已有有效凭证，跳过初始化
    // 复用 SDK 客户端，避免重复创建
    const dwClient = this._dwClients.get(state.appKey);
    if (dwClient) {
      adapter._dwClient = dwClient;
    }
    return adapter;
  }

  /**
   * 监听任务完成并推送结果到钉钉
   */
  async _watchTaskAndPush(userId, state, taskId, toUserId) {
    const maxWait = 10 * 60 * 1000;
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < maxWait) {
      if (!state.listening) return;

      try {
        await getMongoClient();
        const db = getUserDb();
        const task = await db.collection('任务').findOne({ 任务ID: taskId });

        if (!task) {
          await new Promise(r => setTimeout(r, pollInterval));
          continue;
        }

        const status = task.状态;

        // 路由完成后切换到分支任务
        if (status === '已完成' && task.类型 === 'routing' && task.结果?.branchTaskId) {
          taskId = task.结果.branchTaskId;
          await new Promise(r => setTimeout(r, pollInterval));
          continue;
        }

        // 任务完成
        if (status === '已完成' || status === '已完成(部分失败)') {
          const content =
            task.摘要 ||
            task.结果?.summary ||
            task.结果?.flashResponse?.content ||
            task.结果?.回复 ||
            task.结果?.content ||
            (task.流缓冲?.length > 0
              ? task.流缓冲.filter(c => c.类型 === 'text').map(c => c.内容).join('')
              : '任务完成');

          let pushText = String(content);
          if (pushText.length > 2000) {
            pushText = pushText.slice(0, 1997) + '...';
          }

          await this._sendDingTalkMessage(state, toUserId, pushText);
          logger.info(`[钉钉监听] 任务 ${taskId} 完成，文本结果已推送到钉钉`);

          // 检查任务结果中是否有文件需要推送
          await this._pushTaskFiles(userId, state, task, toUserId);
          
          return;
        }

        // 任务失败
        if (status === '失败' || status === '已终止') {
          const errorMsg = task.错误 || '任务执行失败';
          await this._sendDingTalkMessage(state, toUserId, `任务失败: ${errorMsg}`);
          return;
        }
      } catch (err) {
        logger.warn(`[钉钉监听] 轮询任务状态失败: ${err.message}`);
      }

      await new Promise(r => setTimeout(r, pollInterval));
    }

    // 超时
    await this._sendDingTalkMessage(state, toUserId, '任务超时，请稍后在 CLI 中查看结果');
  }

  /**
   * 发送富媒体消息到钉钉（图片/文件/视频）
   * 
   * @param {Object} state - 监听器状态
   * @param {string} toUserId - 目标用户钉钉ID
   * @param {string} filePath - 本地文件路径
   * @param {string} [caption] - 附加文字说明
   * @returns {Promise<Object>}
   */
  async _sendDingTalkMediaMessage(state, toUserId, filePath, caption) {
    try {
      const adapter = await this._getAdapter(state);
      // 上传
      const uploaded = await adapter.上传媒体(filePath, toUserId);
      // 发送
      const result = await adapter.发送富媒体消息(toUserId, uploaded, filePath.split(/[/\\]/).pop(), caption || '');
      logger.info(`[钉钉监听] 富媒体消息已发送: ${filePath} -> ${toUserId}`);
      return result;
    } catch (err) {
      logger.error(`[钉钉监听] 发送富媒体消息失败: ${err.message}`);
      throw err;
    }
  }

  /**
   * 推送任务结果中的文件到钉钉
   * 检查任务结果中是否有文件列表，逐个上传并发送
   * @private
   */
  async _pushTaskFiles(userId, state, task, toUserId) {
    const 文件列表 = task.结果?.文件列表 || task.结果?.files || task.结果?.附件 || [];

    if (!Array.isArray(文件列表) || 文件列表.length === 0) {
      return; // 无文件
    }

    logger.info(`[钉钉监听] 任务 ${task.任务ID} 有 ${文件列表.length} 个文件需要推送到钉钉`);

    for (const file of 文件列表) {
      try {
        const filePath = typeof file === 'string' ? file : file.path || file.filePath || file.路径;
        const caption = typeof file === 'object' ? (file.caption || file.description || file.描述 || '') : '';

        if (!filePath) {
          logger.warn(`[钉钉监听] 跳过无路径的文件: ${JSON.stringify(file)}`);
          continue;
        }

        if (!existsSync(filePath)) {
          logger.warn(`[钉钉监听] 文件不存在，跳过: ${filePath}`);
          continue;
        }

        await this._sendDingTalkMediaMessage(state, toUserId, filePath, caption);
        logger.info(`[钉钉监听] 文件已推送到钉钉: ${filePath}`);

        // 发送间隔，避免过快
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        logger.error(`[钉钉监听] 推送文件失败: ${err.message}`);
      }
    }
  }

  /**
   * 发送钉钉消息（使用 SDK token）
   * @private
   */
  async _sendDingTalkMessage(state, toUserId, text) {
    try {
      const dwClient = this._dwClients.get(Array.from(this._dwClients.keys()).find(uid => this.listeners.get(uid)?.appKey === state.appKey));
      const accessToken = dwClient ? await dwClient.getAccessToken() : await this._getAccessTokenByFetch(state);

      // 使用机器人单聊消息 API
      const response = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': accessToken,
        },
        body: JSON.stringify({
          robotCode: state.appKey,
          userIds: [toUserId],
          msgKey: 'sampleMarkdown',
          msgParam: JSON.stringify({
            title: '白鸽系统通知',
            text: text,
          }),
        }),
      });

      if (!response.ok) {
        logger.warn(`[钉钉监听] 单聊消息发送失败: HTTP ${response.status}`);
      }

      logger.info(`[钉钉监听] 消息已发送到 ${toUserId}: "${text.slice(0, 50)}"`);
    } catch (err) {
      logger.error(`[钉钉监听] 发送钉钉消息失败: ${err.message}`);
    }
  }

  /**
   * 通过 fetch 获取 access_token（备用方案，当 SDK 客户端不可用时）
   * @private
   */
  async _getAccessTokenByFetch(state) {
    const response = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appKey: state.appKey,
        appSecret: state.appSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`获取钉钉 access_token 失败: HTTP ${response.status}`);
    }

    const result = await response.json();
    if (result.errcode !== 0) {
      throw new Error(`获取钉钉 access_token 失败: ${result.errmsg}`);
    }

    return result.accessToken;
  }
}

// 全局单例
const dingTalkListenerManager = new DingTalkListenerManager();

/**
 * 导出：供 Server/index.js 启动时调用
 */
// 导出监听器管理器（供统一 IM sendfile 入口使用）
export { dingTalkListenerManager };

export function startDingTalkListeners() {
  return dingTalkListenerManager.startAll();
}

export function startDingTalkListenerForUser(userId, appKey, appSecret, agentId) {
  dingTalkListenerManager.startListener(userId, appKey, appSecret, agentId);
}

export function stopDingTalkListenerForUser(userId) {
  dingTalkListenerManager.stopListener(userId);
}
