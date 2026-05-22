/**
 * 微信消息处理器
 * 处理不同类型的微信消息：文本/语音/图片/文件/视频
 * 
 * 由 WeChatListenerManager._handleMessage 委托调用
 */

import { ObjectId } from 'mongodb';
import { logger } from '../../core.js';
import { getMongoClient, createTimestampFields, getUserDb } from '../../db.js';
import { 下载微信媒体, 提取媒体信息 } from '../../im/微信媒体.js';
import { 保存媒体文件, 验证文件大小, 判断媒体类型 } from '../../im/媒体服务.js';

/**
 * 处理一条微信消息（作为 WeChatListenerManager 的实例方法）
 * @this {import('./微信监听管理器.js').WeChatListenerManager}
 */
export async function handleWeChatMessage(userId, state, msg) {
  // 只处理用户消息 (message_type=1)
  if (msg.message_type !== 1 || !msg.item_list?.length) return;

  const fromUserId = msg.from_user_id;
  const contextToken = msg.context_token;

  // 提取文本内容：支持文本消息(type=1)和语音消息(type=3)
  let text = '';
  let isVoice = false;

  let mediaInfo = null; // 媒体文件接收信息

  for (const item of msg.item_list) {
    if (item.type === 1 && item.text_item?.text) {
      // 文本消息
      text = item.text_item.text.trim();
      break;
    } else if (item.type === 3 && item.voice_item) {
      // 语音消息：优先使用微信自带的语音转文字
      isVoice = true;
      const voiceText = item.voice_item.text?.trim();
      if (voiceText) {
        text = voiceText;
        logger.info(`[微信监听] 语音消息转文字: "${text.slice(0, 50)}"`);
      } else {
        // 微信未提供转文字，尝试百炼 ASR
        text = await this._transcribeVoice(item.voice_item, state);
        if (!text) {
          await this._sendWeChatMessage(state, fromUserId, '收到语音消息，但无法识别内容，请用文字发送', contextToken);
          return;
        }
        logger.info(`[微信监听] 百炼ASR语音识别: "${text.slice(0, 50)}"`);
      }
      break;
    } else if (item.type === 2) {
      // 图片消息
      const info = 提取媒体信息(item);
      if (!info.hasMedia) {
        await this._sendWeChatMessage(state, fromUserId, '收到图片，但无法获取图片数据', contextToken);
        return;
      }
      try {
        const result = await 下载微信媒体(item);
        if (!result || !result.data) {
          await this._sendWeChatMessage(state, fromUserId, '收到图片，但下载失败', contextToken);
          return;
        }
        const sizeCheck = 验证文件大小(result.data.length, 'image');
        if (!sizeCheck.ok) {
          await this._sendWeChatMessage(state, fromUserId, `收到图片，但文件过大(${(result.data.length / 1024 / 1024).toFixed(1)}MB)，限制${sizeCheck.limit / 1024 / 1024}MB`, contextToken);
          return;
        }
        const saved = 保存媒体文件(userId, info.fileName, result.data, { subDir: 'wechat' });
        mediaInfo = { type: 'image', fileName: saved.fileName, savePath: saved.path, size: saved.size, mime: saved.mime };
        logger.info(`[微信监听] 图片已保存: ${saved.path} (${saved.size} bytes)`);
      } catch (err) {
        logger.error(`[微信监听] 图片下载失败: ${err.message}`);
        await this._sendWeChatMessage(state, fromUserId, `收到图片，但处理失败: ${err.message}`, contextToken);
        return;
      }
      break;
    } else if (item.type === 4) {
      // 文件消息
      const info = 提取媒体信息(item);
      if (!info.hasMedia) {
        await this._sendWeChatMessage(state, fromUserId, '收到文件，但无法获取文件数据', contextToken);
        return;
      }
      try {
        const result = await 下载微信媒体(item);
        if (!result || !result.data) {
          await this._sendWeChatMessage(state, fromUserId, '收到文件，但下载失败', contextToken);
          return;
        }
        const mediaType = 判断媒体类型(result.kind === 'file' && info.fileName ? 'application/octet-stream' : 'file');
        const sizeCheck = 验证文件大小(result.data.length, mediaType);
        if (!sizeCheck.ok) {
          await this._sendWeChatMessage(state, fromUserId, `收到文件，但文件过大(${(result.data.length / 1024 / 1024).toFixed(1)}MB)，限制${sizeCheck.limit / 1024 / 1024}MB`, contextToken);
          return;
        }
        const saved = 保存媒体文件(userId, info.fileName, result.data, { subDir: 'wechat' });
        mediaInfo = { type: 'file', fileName: saved.fileName, savePath: saved.path, size: saved.size, mime: saved.mime };
        logger.info(`[微信监听] 文件已保存: ${saved.path} (${saved.size} bytes)`);
      } catch (err) {
        logger.error(`[微信监听] 文件下载失败: ${err.message}`);
        await this._sendWeChatMessage(state, fromUserId, `收到文件，但处理失败: ${err.message}`, contextToken);
        return;
      }
      break;
    } else if (item.type === 5) {
      // 视频消息
      const info = 提取媒体信息(item);
      if (!info.hasMedia) {
        await this._sendWeChatMessage(state, fromUserId, '收到视频，但无法获取视频数据', contextToken);
        return;
      }
      try {
        const result = await 下载微信媒体(item);
        if (!result || !result.data) {
          await this._sendWeChatMessage(state, fromUserId, '收到视频，但下载失败', contextToken);
          return;
        }
        const sizeCheck = 验证文件大小(result.data.length, 'video');
        if (!sizeCheck.ok) {
          await this._sendWeChatMessage(state, fromUserId, `收到视频，但文件过大(${(result.data.length / 1024 / 1024).toFixed(1)}MB)，限制${sizeCheck.limit / 1024 / 1024}MB`, contextToken);
          return;
        }
        const saved = 保存媒体文件(userId, info.fileName, result.data, { subDir: 'wechat' });
        mediaInfo = { type: 'video', fileName: saved.fileName, savePath: saved.path, size: saved.size, mime: saved.mime, duration: info.duration || 0 };
        logger.info(`[微信监听] 视频已保存: ${saved.path} (${saved.size} bytes)`);
      } catch (err) {
        logger.error(`[微信监听] 视频下载失败: ${err.message}`);
        await this._sendWeChatMessage(state, fromUserId, `收到视频，但处理失败: ${err.message}`, contextToken);
        return;
      }
      break;
    }
  }

  // 构造任务描述文本
  if (mediaInfo && !text) {
    const sizeStr = mediaInfo.size > 1024 * 1024
      ? `${(mediaInfo.size / 1024 / 1024).toFixed(1)}MB`
      : `${(mediaInfo.size / 1024).toFixed(1)}KB`;
    const typeLabel = { image: '图片', file: '文件', video: '视频' }[mediaInfo.type] || '文件';
    const durationStr = mediaInfo.duration ? `，时长${mediaInfo.duration}秒` : '';
    text = `[${typeLabel}] ${mediaInfo.fileName} (${sizeStr}${durationStr})\n已保存到: ${mediaInfo.savePath}`;
    logger.info(`[微信监听] 用户 ${userId} 收到微信${typeLabel}: ${mediaInfo.fileName} (${sizeStr})`);
  } else if (mediaInfo && text) {
    const sizeStr = mediaInfo.size > 1024 * 1024
      ? `${(mediaInfo.size / 1024 / 1024).toFixed(1)}MB`
      : `${(mediaInfo.size / 1024).toFixed(1)}KB`;
    const typeLabel = { image: '图片', file: '文件', video: '视频' }[mediaInfo.type] || '文件';
    text += `\n[附件: ${typeLabel} ${mediaInfo.fileName} (${sizeStr})，已保存到: ${mediaInfo.savePath}]`;
  }

  if (!text) return;

  // 记录上下文
  state.lastFromUserId = fromUserId;
  state.lastContextToken = contextToken;

  logger.info(`[微信监听] 用户 ${userId} 收到微信消息: "${text.slice(0, 50)}" (from: ${fromUserId}${isVoice ? ', 语音' : ''})`);

  // 发送"正在输入"
  this._sendTyping(state);

  try {
    await getMongoClient();
    const db = getUserDb();

    // 查找或创建对话
    let convId = state.activeConversations.get(contextToken);
    let needNewConv = false;

    // 优先检查是否有等待中的对话选择回复
    const pendingChoice = state.pendingConvChoice?.get(fromUserId);
    if (pendingChoice && Date.now() - pendingChoice.timestamp < 120000) {
      state.pendingConvChoice.delete(fromUserId);
      const choice = text.trim();
      if (choice === '1' || choice === '一') {
        needNewConv = true;
        logger.info(`[微信监听] 用户选择新建对话`);
        convId = null;
      } else {
        convId = pendingChoice.existingConvId;
        text = pendingChoice.text;
        isVoice = pendingChoice.isVoice;
        logger.info(`[微信监听] 用户选择继续当前对话 ${convId}`);
      }
    } else if (pendingChoice) {
      state.pendingConvChoice.delete(fromUserId);
    }

    if (!convId && !needNewConv) {
      const existingConv = await db.collection('对话').findOne({
        用户ID: userId,
        来源: 'wechat',
        微信用户ID: fromUserId,
      }, { sort: { 创建时间戳: -1 } });

      if (existingConv) {
        convId = existingConv.对话ID;

        const topicCheck = await this._shouldStartNewConversation(text, existingConv, state);
        if (topicCheck.needNew) {
          const question = topicCheck.reason || '这看起来是一个新话题，是否新建对话？';
          const options = '回复【1】新建对话，回复【2】继续当前对话';
          await this._sendWeChatMessage(state, fromUserId, `${question}\n${options}`, contextToken);
          state.pendingConvChoice = state.pendingConvChoice || new Map();
          state.pendingConvChoice.set(fromUserId, {
            userId, text, isVoice,
            existingConvId: convId, contextToken, fromUserId,
            timestamp: Date.now(),
          });
          return;
        }
      } else {
        needNewConv = true;
      }
    }

    if (needNewConv || !convId) {
      const ts2 = createTimestampFields();
      convId = new ObjectId().toString();
      const conv = {
        _id: convId,
        对话ID: convId,
        标题: `[微信] ${text.slice(0, 40)}`,
        对话轮次: [],
        用户ID: userId,
        来源: 'wechat',
        微信用户ID: fromUserId,
        创建时间: ts2.localTime,
        创建时间戳: ts2.timestamp,
      };
      await db.collection('对话').insertOne(conv);
      state.activeConversations.set(contextToken, convId);
    } else if (!state.activeConversations.has(contextToken)) {
      state.activeConversations.set(contextToken, convId);
    }

    // 创建任务（与 /api/chat 逻辑一致）
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
      来源: 'wechat',
      微信媒体: mediaInfo || null,
      IM上下文: {
        platform: 'wechat',
        userId: fromUserId,
        mediaInfo: mediaInfo || null,
        contextToken: contextToken || '',
      },
      创建时间: ts.localTime,
      创建时间戳: ts.timestamp,
      更新时间: ts.localTime,
      更新时间戳: ts.timestamp
    };
    await db.collection('任务').insertOne(task);

    logger.info(`[微信监听] 用户 ${userId} 创建任务 ${task.任务ID} (对话: ${convId})`);

    // 监听任务完成，推送结果到微信
    this._watchTaskAndPush(userId, state, task.任务ID, fromUserId, contextToken).catch(err => {
      logger.warn(`[微信监听] 任务监听失败: ${err.message}`);
    });

  } catch (err) {
    logger.error(`[微信监听] 处理消息失败: ${err.message}`);
    this._sendWeChatMessage(state, fromUserId, `处理失败: ${err.message}`, contextToken);
  }
}
