/**
 * 微信消息监听管理器
 * 
 * 服务端常驻进程，不依赖 CLI：
 * 1. 每个已绑定+启用的用户启动一个 iLink 长轮询循环
 * 2. 收到微信消息 → 自动创建对话+任务（走 /api/chat 逻辑）
 * 3. 任务完成 → 推送结果到微信
 * 4. 绑定/解绑时自动启停
 */

import { ObjectId } from 'mongodb';
import { logger } from '../../core.js';
import { getAdminDb, getMongoClient, createTimestampFields, getUserDb } from '../../db.js';
import { 下载微信媒体, 提取媒体信息, 上传并发送微信媒体 } from '../../im/微信媒体.js';
import { 保存媒体文件, 验证文件大小, 判断媒体类型 } from '../../im/媒体服务.js';
import { decryptToken } from './加密工具.js';
import { generateUin } from './iLink工具.js';

const ILINK_BASE = 'https://ilinkai.weixin.qq.com';

export class WeChatListenerManager {
  constructor() {
    /** @type {Map<string, {botToken:string, botBaseUrl:string, botUserId:string, updatesBuf:string, listening:boolean, lastFromUserId:string, lastContextToken:string, activeConversations:Map<string,string>}>} */
    this.listeners = new Map();
    this._stopSignals = new Map(); // userId -> boolean
  }

  /**
   * 启动某个用户的微信消息监听
   */
  startListener(userId, botToken, botBaseUrl, botUserId) {
    if (this.listeners.has(userId)) {
      // 已在监听，更新凭证
      const existing = this.listeners.get(userId);
      existing.botToken = botToken;
      existing.botBaseUrl = botBaseUrl;
      existing.botUserId = botUserId;
      return;
    }

    logger.info(`[微信监听] 启动用户 ${userId} 的消息监听`);
    
    const state = {
      botToken,
      botBaseUrl: botBaseUrl || ILINK_BASE,
      botUserId,
      updatesBuf: '',
      listening: true,
      lastFromUserId: '',
      lastContextToken: '',
      activeConversations: new Map(), // contextToken -> conversationId
    };
    this.listeners.set(userId, state);
    this._stopSignals.set(userId, false);

    // 启动后台长轮询循环
    this._pollLoop(userId).catch(err => {
      logger.error(`[微信监听] 用户 ${userId} 的轮询循环异常退出: ${err.message}`);
    });
  }

  /**
   * 停止某个用户的微信消息监听
   */
  stopListener(userId) {
    this._stopSignals.set(userId, true);
    const state = this.listeners.get(userId);
    if (state) {
      state.listening = false;
    }
    this.listeners.delete(userId);
    logger.info(`[微信监听] 停止用户 ${userId} 的消息监听`);
  }

  /**
   * 启动所有已绑定用户的监听（服务端启动时调用）
   */
  async startAll() {
    try {
      await getMongoClient();
      const adminDb = getAdminDb();
      const bindings = await adminDb.collection('微信绑定')
        .find({ status: 'bound', enabled: true })
        .toArray();
      
      for (const binding of bindings) {
        const botToken = decryptToken(binding.encryptedBotToken);
        if (botToken) {
          this.startListener(binding.userId, botToken, binding.botBaseUrl, binding.botUserId);
        }
      }
      
      logger.info(`[微信监听] 已启动 ${bindings.length} 个用户的微信消息监听`);
    } catch (err) {
      logger.error(`[微信监听] 启动失败: ${err.message}`);
    }
  }

  /**
   * 长轮询主循环
   */
  async _pollLoop(userId) {
    const state = this.listeners.get(userId);
    if (!state) return;

    logger.info(`[微信监听] 用户 ${userId} 开始长轮询 (botBaseUrl: ${state.botBaseUrl})`);

    while (state.listening && !this._stopSignals.get(userId)) {
      try {
        const result = await this._ilinkGetUpdates(state);

        if (result.get_updates_buf) {
          state.updatesBuf = result.get_updates_buf;
        }

        const msgs = result.msgs || [];
        if (msgs.length > 0) {
          logger.info(`[微信监听] 用户 ${userId} 收到 ${msgs.length} 条消息`);
        }
        for (const msg of msgs) {
          await this._handleMessage(userId, state, msg);
        }
      } catch (err) {
        if (!state.listening) break;
        logger.warn(`[微信监听] 用户 ${userId} 轮询异常: ${err.message}`);
        // 如果是 401/403 错误，说明 botToken 无效，停止监听
        if (err.message.includes('401') || err.message.includes('403')) {
          logger.error(`[微信监听] 用户 ${userId} botToken 无效，停止监听`);
          this.stopListener(userId);
          break;
        }
        await new Promise(r => setTimeout(r, 5000)); // 出错等5秒再重试
      }
    }
    logger.info(`[微信监听] 用户 ${userId} 轮询循环结束`);
  }

  // ==================== 消息处理（委托到消息处理器） ====================

  async _handleMessage(userId, state, msg) {
    const { handleWeChatMessage } = await import('./消息处理器.js');
    return handleWeChatMessage.call(this, userId, state, msg);
  }

  // ==================== 任务完成监听与推送 ====================

  /**
   * 监听任务完成并推送结果到微信
   */
  async _watchTaskAndPush(userId, state, taskId, toUserId, contextToken) {
    const maxWait = 10 * 60 * 1000; // 最多等10分钟
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < maxWait) {
      if (!state.listening) return; // 监听已停止

      try {
        await getMongoClient();
        const db = getUserDb();
        const task = await db.collection('任务').findOne({ 任务ID: taskId });

        if (!task) {
          await new Promise(r => setTimeout(r, pollInterval));
          continue;
        }

        const status = task.状态;

        // 分支任务：routing 完成且有 branchTaskId，切换到监听分支任务
        if (status === '已完成' && task.类型 === 'routing' && task.结果?.branchTaskId) {
          const branchTaskId = task.结果.branchTaskId;
          logger.info(`[微信监听] 任务 ${taskId} 路由完成，切换到分支任务 ${branchTaskId}`);
          taskId = branchTaskId;
          await new Promise(r => setTimeout(r, pollInterval));
          continue;
        }

        // 任务完成
        if (status === '已完成' || status === '已完成(部分失败)') {
          // 提取回复内容
          const content =
            task.摘要 ||
            task.结果?.summary ||
            task.结果?.flashResponse?.content ||
            task.结果?.routing?.flashResponse?.content ||
            task.结果?.回复 ||
            task.结果?.数据?.内容 ||
            task.结果?.content ||
            (task.流缓冲?.length > 0
              ? task.流缓冲.filter(c => c.类型 === 'text').map(c => c.内容).join('')
              : '任务完成');

          // 微信消息长度限制（约2048字节），过长则截断
          let pushText = String(content);
          if (pushText.length > 2000) {
            pushText = pushText.slice(0, 1997) + '...';
          }

          await this._sendWeChatMessage(state, toUserId, pushText, contextToken);
          logger.info(`[微信监听] 任务 ${taskId} 完成，文本结果已推送到微信`);

          // 检查任务结果中是否有文件需要推送
          await this._pushTaskFiles(userId, state, task, toUserId, contextToken);
          
          return;
        }

        // 任务失败
        if (status === '失败' || status === '已终止') {
          const errorMsg = task.错误 || '任务执行失败';
          await this._sendWeChatMessage(state, toUserId, `任务失败: ${errorMsg}`, contextToken);
          logger.info(`[微信监听] 任务 ${taskId} 失败: ${errorMsg}`);
          return;
        }
      } catch (err) {
        logger.warn(`[微信监听] 轮询任务状态失败: ${err.message}`);
      }

      await new Promise(r => setTimeout(r, pollInterval));
    }

    // 超时
    await this._sendWeChatMessage(state, toUserId, '任务超时，请稍后在 CLI 中查看结果', contextToken);
  }

  // ==================== 话题切换检测（委托到话题检测器） ====================

  async _shouldStartNewConversation(userMessage, existingConv, state) {
    const { detectTopicSwitch } = await import('./话题检测器.js');
    return detectTopicSwitch(userMessage, existingConv, state);
  }

  // ==================== 语音识别（委托到语音识别器） ====================

  async _transcribeVoice(voiceItem, state) {
    const { transcribeVoiceASR } = await import('./语音识别器.js');
    return transcribeVoiceASR(voiceItem, state);
  }

  // ==================== iLink API 调用 ====================

  async _ilinkGetUpdates(state) {
    const baseUrl = state.botBaseUrl || ILINK_BASE;
    const url = `${baseUrl}/ilink/bot/getupdates`;
    
    const body = {
      get_updates_buf: state.updatesBuf || '',
      base_info: { channel_version: '1.0.0' },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'AuthorizationType': 'ilink_bot_token',
        'X-WECHAT-UIN': generateUin(),
        'Authorization': `Bearer ${state.botToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`iLink getupdates 错误 (${response.status}): ${text.slice(0, 200)}`);
    }

    return response.json();
  }

  async _sendWeChatMessage(state, toUserId, text, contextToken) {
    const baseUrl = state.botBaseUrl || ILINK_BASE;
    const url = `${baseUrl}/ilink/bot/sendmessage`;

    const token = contextToken || state.lastContextToken || '';

    // 构造请求体：有 context_token 时作为回复消息，否则作为新消息
    const buildBody = (ctxToken) => ({
      msg: {
        to_user_id: toUserId,
        message_type: 2,
        message_state: ctxToken ? 2 : 1,
        context_token: ctxToken || '',
        item_list: [{ type: 1, text_item: { text } }],
      },
    });

    const headers = {
      'Content-Type': 'application/json',
      'AuthorizationType': 'ilink_bot_token',
      'X-WECHAT-UIN': generateUin(),
      'Authorization': `Bearer ${state.botToken}`,
    };

    try {
      // 第一次尝试：用 context_token 作为回复发送
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildBody(token)),
      });

      const result = await response.json();

      // 检查 HTTP 状态码
      if (!response.ok) {
        logger.error(`[微信监听] 发送微信消息失败: HTTP ${response.status}, 响应: ${JSON.stringify(result).slice(0, 200)}`);
      }

      // 检查 iLink API 返回的错误码
      const errcode = result?.errcode ?? result?.error_code ?? result?.code;
      if (errcode && errcode !== 0) {
        const errmsg = result?.errmsg || result?.error_msg || result?.msg || '';
        logger.warn(`[微信监听] iLink sendmessage 返回错误: errcode=${errcode}, errmsg=${errmsg}`);

        // context_token 可能已过期，尝试不带 token 重新发送
        if (token) {
          logger.info(`[微信监听] context_token 可能过期，尝试作为新消息重发`);
          try {
            const retryResp = await fetch(url, {
              method: 'POST',
              headers,
              body: JSON.stringify(buildBody('')),
            });
            const retryResult = await retryResp.json();
            if (retryResp.ok && !(retryResult?.errcode ?? retryResult?.error_code ?? retryResult?.code)) {
              logger.info(`[微信监听] 重发成功: 消息已发送到 ${toUserId}: "${text.slice(0, 50)}"`);
              return retryResult;
            } else {
              logger.error(`[微信监听] 重发也失败: HTTP ${retryResp.status}, 响应: ${JSON.stringify(retryResult).slice(0, 200)}`);
            }
          } catch (retryErr) {
            logger.error(`[微信监听] 重发异常: ${retryErr.message}`);
          }
        }
        return result;
      }

      logger.info(`[微信监听] 消息已发送到 ${toUserId}: "${text.slice(0, 50)}"`);
      return result;
    } catch (err) {
      logger.error(`[微信监听] 发送微信消息失败: ${err.message}`);
      throw err;
    }
  }

  /**
   * 发送富媒体消息到微信（图片/文件/视频）
   */
  async _sendWeChatMediaMessage(state, toUserId, filePath, contextToken, caption) {
    try {
      const result = await 上传并发送微信媒体(
        state.botToken,
        state.botBaseUrl || ILINK_BASE,
        toUserId,
        contextToken || state.lastContextToken || '',
        filePath,
        caption || ''
      );
      logger.info(`[微信监听] 富媒体消息已发送: ${result.fileName} (${result.mediaType}) 到 ${toUserId}`);
      return result;
    } catch (err) {
      logger.error(`[微信监听] 发送富媒体消息失败: ${err.message}`);
      throw err;
    }
  }

  /**
   * 推送任务结果中的文件到微信
   */
  async _pushTaskFiles(userId, state, task, toUserId, contextToken) {
    // 从任务结果中提取文件列表
    const 文件列表 = task.结果?.文件列表 || task.结果?.files || task.结果?.附件 || [];
    
    if (!Array.isArray(文件列表) || 文件列表.length === 0) {
      return; // 无文件
    }
    
    logger.info(`[微信监听] 任务 ${task.任务ID} 有 ${文件列表.length} 个文件需要推送到微信`);
    
    for (const file of 文件列表) {
      try {
        const filePath = typeof file === 'string' ? file : file.path || file.filePath || file.路径;
        const caption = typeof file === 'object' ? (file.caption || file.description || file.描述 || '') : '';
        
        if (!filePath) {
          logger.warn(`[微信监听] 跳过无路径的文件: ${JSON.stringify(file)}`);
          continue;
        }
        
        // 检查文件是否存在
        const fs = await import('fs');
        if (!fs.existsSync(filePath)) {
          logger.warn(`[微信监听] 文件不存在，跳过: ${filePath}`);
          continue;
        }
        
        // 发送文件
        await this._sendWeChatMediaMessage(state, toUserId, filePath, contextToken, caption);
        logger.info(`[微信监听] 文件已推送到微信: ${filePath}`);
        
        // 发送间隔，避免过快
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        logger.error(`[微信监听] 推送文件失败: ${err.message}`);
        // 继续推送下一个文件
      }
    }
  }

  async _sendTyping(state) {
    try {
      const baseUrl = state.botBaseUrl || ILINK_BASE;
      // 先获取 typing_ticket
      const configResp = await fetch(`${baseUrl}/ilink/bot/getconfig`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'AuthorizationType': 'ilink_bot_token',
          'X-WECHAT-UIN': generateUin(),
          'Authorization': `Bearer ${state.botToken}`,
        },
        body: JSON.stringify({}),
      });
      const configResult = await configResp.json();
      const typingTicket = configResult.typing_ticket;
      if (!typingTicket) return;

      await fetch(`${baseUrl}/ilink/bot/sendtyping`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'AuthorizationType': 'ilink_bot_token',
          'X-WECHAT-UIN': generateUin(),
          'Authorization': `Bearer ${state.botToken}`,
        },
        body: JSON.stringify({
          to_user_id: state.lastFromUserId,
          typing_ticket: typingTicket,
        }),
      });
    } catch (err) {
      logger.warn('微信typing发送失败:', err.message);
    }
  }
}
