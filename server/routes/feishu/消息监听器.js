/**
 * 飞书消息监听管理器
 * 从 feishu.js 提取
 * 
 * 飞书使用 Webhook 推送模式（不是长轮询）
 * 监听器主要负责消息处理和任务推送
 */

// @larksuiteoapi/node-sdk 为可选依赖，未安装时飞书消息监听不可用
let lark = null;
try {
  lark = require('@larksuiteoapi/node-sdk');
} catch {
  // 飞书 SDK 未安装
}
import { ObjectId } from 'mongodb';
import { getMongoClient, getAdminDb, getUserDb, createTimestampFields } from '../../db.js';
import { 记录审计 } from '../../审计日志.js';
import { 保存媒体文件, 验证文件大小, 判断媒体类型 } from '../../im/媒体服务.js';
import { decryptSecret } from './加密工具.js';
import { logger } from '../../core.js';
import { toLocalISOString } from '@dove/common/时间工具.js';
import { existsSync } from 'fs';

export class FeishuListenerManager {
  constructor() {
    /** @type {Map<string, {appId:string, appSecret:string, verificationToken:string, encryptKey:string, listening:boolean, activeConversations:Map<string,string>}>} */
    this.listeners = new Map();
    this._stopSignals = new Map();
  }

  /**
   * 启动某个用户的飞书消息监听
   */
  startListener(userId, appId, appSecret, verificationToken, encryptKey) {
    if (this.listeners.has(userId)) {
      const existing = this.listeners.get(userId);
      existing.appId = appId;
      existing.appSecret = appSecret;
      existing.verificationToken = verificationToken;
      existing.encryptKey = encryptKey;
      return;
    }

    logger.info(`[飞书监听] 启动用户 ${userId} 的消息监听`);

    // 创建飞书 SDK 客户端
    const larkClient = new lark.Client({
      appId,
      appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
    });

    const state = {
      appId,
      appSecret,
      verificationToken,
      encryptKey,
      listening: true,
      activeConversations: new Map(), // chatId -> conversationId
      larkClient, // SDK 客户端
    };

    this.listeners.set(userId, state);
    this._stopSignals.set(userId, false);
  }

  /**
   * 停止某个用户的飞书消息监听
   */
  stopListener(userId) {
    this._stopSignals.set(userId, true);
    const state = this.listeners.get(userId);
    if (state) {
      state.listening = false;
    }
    this.listeners.delete(userId);
    logger.info(`[飞书监听] 停止用户 ${userId} 的消息监听`);
  }

  /**
   * 启动所有已配置用户的监听
   */
  async startAll() {
    try {
      await getMongoClient();
      const adminDb = getAdminDb();
      const configs = await adminDb.collection('飞书配置')
        .find({ 启用: true })
        .toArray();

      for (const 配置 of configs) {
        const appSecret = decryptSecret(配置.encryptedAppSecret);
        const encryptKey = decryptSecret(配置.encryptedEncryptKey);
        if (appSecret && 配置.appId) {
          this.startListener(配置.用户ID, 配置.appId, appSecret, 配置.verificationToken, encryptKey);
        }
      }

      logger.info(`[飞书监听] 已启动 ${configs.length} 个用户的飞书消息监听`);
    } catch (err) {
      logger.error(`[飞书监听] 启动失败: ${err.message}`);
    }
  }

  /**
   * 处理 Webhook 回调事件
   */
  async _handleCallbackEvent(userId, event) {
    const state = this.listeners.get(userId);
    if (!state) return;

    const fromUserId = event.senderId;
    const chatId = event.chatId || fromUserId;
    let text = event.text?.trim() || '';
    let mediaInfo = null;

    // 处理媒体文件接收
    if (event.mediaInfo) {
      try {
        const adapter = await this._getAdapter(state);
        const downloadResult = await adapter.下载媒体(event.mediaInfo);
        if (downloadResult && downloadResult.data) {
          const kind = downloadResult.kind || 'file';
          const mediaType = kind === 'image' ? 'image' : kind === 'video' ? 'video' : kind === 'voice' ? 'voice' : 'file';
          const sizeCheck = 验证文件大小(downloadResult.data.length, mediaType);
          if (!sizeCheck.ok) {
            await this._sendFeishuMessage(state, fromUserId, `收到${mediaType}，但文件过大(${(downloadResult.data.length / 1024 / 1024).toFixed(1)}MB)，限制${sizeCheck.limit / 1024 / 1024}MB`);
            return;
          }
          const fileName = downloadResult.fileName || `${mediaType}_${Date.now()}`;
          const saved = 保存媒体文件(userId, fileName, downloadResult.data, { subDir: 'feishu' });
          mediaInfo = { type: mediaType, fileName: saved.fileName, savePath: saved.path, size: saved.size, mime: saved.mime };
          logger.info(`[飞书监听] ${mediaType}已保存: ${saved.path} (${saved.size} bytes)`);
        } else {
          await this._sendFeishuMessage(state, fromUserId, `收到${event.mediaInfo.msg_type}消息，但下载失败`);
          return;
        }
      } catch (err) {
        logger.error(`[飞书监听] 媒体下载失败: ${err.message}`);
        await this._sendFeishuMessage(state, fromUserId, `收到媒体文件，但处理失败: ${err.message}`);
        return;
      }
    }

    // 构造任务描述文本
    if (mediaInfo && !text) {
      const sizeStr = mediaInfo.size > 1024 * 1024
        ? `${(mediaInfo.size / 1024 / 1024).toFixed(1)}MB`
        : `${(mediaInfo.size / 1024).toFixed(1)}KB`;
      const typeLabel = { image: '图片', file: '文件', video: '视频', voice: '语音' }[mediaInfo.type] || '文件';
      text = `[${typeLabel}] ${mediaInfo.fileName} (${sizeStr})\n已保存到: ${mediaInfo.savePath}`;
      logger.info(`[飞书监听] 用户 ${userId} 收到飞书${typeLabel}: ${mediaInfo.fileName} (${sizeStr})`);
    } else if (mediaInfo && text) {
      const sizeStr = mediaInfo.size > 1024 * 1024
        ? `${(mediaInfo.size / 1024 / 1024).toFixed(1)}MB`
        : `${(mediaInfo.size / 1024).toFixed(1)}KB`;
      const typeLabel = { image: '图片', file: '文件', video: '视频', voice: '语音' }[mediaInfo.type] || '文件';
      text += `\n[附件: ${typeLabel} ${mediaInfo.fileName} (${sizeStr})，已保存到: ${mediaInfo.savePath}]`;
    }

    if (!text) return;

    logger.info(`[飞书监听] 用户 ${userId} 收到飞书消息: "${text.slice(0, 50)}" (from: ${fromUserId})`);

    try {
      await getMongoClient();
      const db = getUserDb();

      // 查找或创建对话
      let convId = state.activeConversations.get(chatId);

      if (!convId) {
        const existingConv = await db.collection('对话').findOne({
          用户ID: userId,
          来源: 'feishu',
          飞书聊天ID: chatId,
        }, { sort: { 创建时间戳: -1 } });

        if (existingConv) {
          convId = existingConv.对话ID;
        } else {
          const ts2 = createTimestampFields();
          convId = new ObjectId().toString();
          const conv = {
            _id: convId,
            对话ID: convId,
            标题: `[飞书] ${text.slice(0, 40)}`,
            对话轮次: [],
            用户ID: userId,
            来源: 'feishu',
            飞书聊天ID: chatId,
            飞书发送者ID: fromUserId,
            创建时间: ts2.localTime,
            创建时间戳: ts2.timestamp,
          };
          await db.collection('对话').insertOne(conv);
        }
        state.activeConversations.set(chatId, convId);
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
        来源: 'feishu',
        IM媒体: mediaInfo || null,
        IM上下文: {
          platform: 'feishu',
          userId: fromUserId,
          mediaInfo: mediaInfo || null,
        },
        创建时间: ts.localTime,
        创建时间戳: ts.timestamp,
        更新时间: ts.localTime,
        更新时间戳: ts.timestamp
      };
      await db.collection('任务').insertOne(task);

      logger.info(`[飞书监听] 用户 ${userId} 创建任务 ${task.任务ID}`);

      // 监听任务完成，推送结果到飞书
      this._watchTaskAndPush(userId, state, task.任务ID, fromUserId).catch(err => {
        logger.warn(`[飞书监听] 任务监听失败: ${err.message}`);
      });

    } catch (err) {
      logger.error(`[飞书监听] 处理消息失败: ${err.message}`);
    }
  }

  /**
   * 获取飞书适配器实例
   * @private
   */
  async _getAdapter(state) {
    const { 飞书适配器 } = await import('../../im/飞书适配器.js');
    const adapter = new 飞书适配器({
      appId: state.appId,
      appSecret: state.appSecret,
    });
    adapter.已初始化 = true;
    // 复用 SDK 客户端，避免重复创建
    if (state.larkClient) {
      adapter._larkClient = state.larkClient;
    }
    return adapter;
  }

  /**
   * 监听任务完成并推送结果到飞书
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

        if (status === '已完成' && task.类型 === 'routing' && task.结果?.branchTaskId) {
          taskId = task.结果.branchTaskId;
          await new Promise(r => setTimeout(r, pollInterval));
          continue;
        }

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
          if (pushText.length > 4000) {
            pushText = pushText.slice(0, 3997) + '...';
          }

          await this._sendFeishuMessage(state, toUserId, pushText);
          logger.info(`[飞书监听] 任务 ${taskId} 完成，结果已推送到飞书`);

          // 检查任务结果中是否有文件需要推送
          await this._pushTaskFiles(userId, state, task, toUserId);

          return;
        }

        if (status === '失败' || status === '已终止') {
          const errorMsg = task.错误 || '任务执行失败';
          await this._sendFeishuMessage(state, toUserId, `任务失败: ${errorMsg}`);
          return;
        }
      } catch (err) {
        logger.warn(`[飞书监听] 轮询任务状态失败: ${err.message}`);
      }

      await new Promise(r => setTimeout(r, pollInterval));
    }

    await this._sendFeishuMessage(state, toUserId, '任务超时，请稍后在 CLI 中查看结果');
  }

  /**
   * 发送飞书消息（使用 SDK）
   * @private
   */
  async _sendFeishuMessage(state, toUserId, text) {
    try {
      if (!state.larkClient) {
        logger.error('[飞书监听] SDK 客户端未初始化，无法发送消息');
        return;
      }

      try {
        await state.larkClient.im.message.create({
          params: { receive_id_type: 'open_id' },
          data: {
            receive_id: toUserId,
            msg_type: 'interactive',
            content: JSON.stringify({
              config: { wide_screen_mode: true },
              header: {
                title: { tag: 'plain_text', content: '白鸽系统通知' },
                template: 'blue',
              },
              elements: [
                { tag: 'markdown', content: text.slice(0, 4000) },
              ],
            }),
          },
        });
      } catch (sdkErr) {
        logger.warn(`[飞书监听] 卡片消息发送失败，降级为纯文本: ${sdkErr.message}`);
        await state.larkClient.im.message.create({
          params: { receive_id_type: 'open_id' },
          data: {
            receive_id: toUserId,
            msg_type: 'text',
            content: JSON.stringify({ text: text.slice(0, 2000) }),
          },
        });
      }

      logger.info(`[飞书监听] 消息已发送到 ${toUserId}: "${text.slice(0, 50)}"`);
    } catch (err) {
      logger.error(`[飞书监听] 发送飞书消息失败: ${err.message}`);
    }
  }

  /**
   * 发送富媒体消息到飞书（图片/文件/视频）
   */
  async _sendFeishuMediaMessage(state, toUserId, filePath, caption) {
    try {
      const adapter = await this._getAdapter(state);
      const uploaded = await adapter.上传媒体(filePath, toUserId);
      const result = await adapter.发送富媒体消息(toUserId, uploaded, filePath.split(/[/\\]/).pop(), caption || '');
      logger.info(`[飞书监听] 富媒体消息已发送: ${filePath} -> ${toUserId}`);
      return result;
    } catch (err) {
      logger.error(`[飞书监听] 发送富媒体消息失败: ${err.message}`);
      throw err;
    }
  }

  /**
   * 推送任务结果中的文件到飞书
   * @private
   */
  async _pushTaskFiles(userId, state, task, toUserId) {
    const 文件列表 = task.结果?.文件列表 || task.结果?.files || task.结果?.附件 || [];

    if (!Array.isArray(文件列表) || 文件列表.length === 0) {
      return;
    }

    logger.info(`[飞书监听] 任务 ${task.任务ID} 有 ${文件列表.length} 个文件需要推送到飞书`);

    for (const file of 文件列表) {
      try {
        const filePath = typeof file === 'string' ? file : file.path || file.filePath || file.路径;
        const caption = typeof file === 'object' ? (file.caption || file.description || file.描述 || '') : '';

        if (!filePath) {
          logger.warn(`[飞书监听] 跳过无路径的文件: ${JSON.stringify(file)}`);
          continue;
        }

        if (!existsSync(filePath)) {
          logger.warn(`[飞书监听] 文件不存在，跳过: ${filePath}`);
          continue;
        }

        await this._sendFeishuMediaMessage(state, toUserId, filePath, caption);
        logger.info(`[飞书监听] 文件已推送到飞书: ${filePath}`);
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        logger.error(`[飞书监听] 推送文件失败: ${err.message}`);
      }
    }
  }
}
