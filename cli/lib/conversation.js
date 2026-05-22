/**
 * 对话 API 模块
 * 提供消息发送、对话管理等功能
 * 
 * 消息通过 Server 加密通道发送
 */

import { existsSync, readFileSync } from 'fs';
import { extname, basename } from 'path';
import { createHash } from 'crypto';
import { TaskClient } from './task.js';
import { 获取或生成机器标识 } from './machine-id.js';
import { DirectConnection } from './direct-connection.js';

/**
 * 对话模块
 * 继承任务客户端，添加对话相关方法
 */
export class ConversationClient extends TaskClient {
  constructor() {
    super();
    /** @type {DirectConnection|null} */
    this._directConnection = null;
  }

  /**
   * 获取或创建直连连接
   * @param {string} [doveId] - 指定鸽子ID
   * @returns {Promise<DirectConnection>}
   */
  async _getDirectConnection(doveId = null) {
    if (this._directConnection && this._directConnection.isConnected()) {
      return this._directConnection;
    }

    // 需要登录状态
    await this.ensureAuth();

    const direct = new DirectConnection({
      serverUrl: this.baseUrl,
      token: this.token,
      userId: this.userId,
      cryptoClient: this.cryptoClient
    });

    try {
      const connected = await direct.connect(doveId);
      if (connected) {
        this._directConnection = direct;
        return direct;
      }
    } catch (e) {
      // 直连失败，暴露错误后跳过，走 Server 通道
      console.warn(`[对话] 直连建立失败: ${e.message}`);
    }

    // 直连不可用，返回 null，走 Server 通道（仍然是加密通道）
    return null;
  }

  /**
   * 是否已建立直连
   */
  isDirectConnected() {
    return this._directConnection?.isConnected() || false;
  }

  /**
   * 获取直连的鸽子信息
   */
  getDirectDove() {
    return this._directConnection?.getConnectedDove() || null;
  }

  /**
   * 断开直连
   */
  async disconnectDirect() {
    if (this._directConnection) {
      await this._directConnection.disconnect();
      this._directConnection = null;
    }
  }

  // ==================== 直连实时查询 ====================
  // 以下方法通过直连 WS 从鸽子内存直接读取，不经 Server/DB
  // 直连不可用时跳过该查询，返回 null（不降级走 Server）

  /**
   * 获取鸽子实况状态（直连优先，不可达时走 Server 加密通道）
   * @param {string} action - 查询类型: doves/tasks/stats/capabilities/skills/models/health
   * @returns {Promise<Object|null>} 查询结果，null 表示鸽子不可达
   */
  async queryDoveLive(action) {
    try {
      const direct = await this._getDirectConnection();
      if (direct && direct.isConnected()) {
        return await direct.sendControl(action);
      }
    } catch (e) {
      // 直连不可用，暴露错误后跳过
      console.warn(`[对话] 直连查询失败 (${action}): ${e.message}`);
    }
    return null;
  }

  /**
   * 获取鸽子执行中任务（直连实时，不可达时走 Server 加密通道 listTasks）
   */
  async getLiveTasks() {
    const live = await this.queryDoveLive('tasks');
    if (live) return live;
    // 不可达：走 Server 加密通道
    return this.listTasks({ status: '执行中' });
  }

  /**
   * 获取鸽子 Token 统计（直连实时）
   */
  async getLiveStats() {
    return this.queryDoveLive('stats');
  }

  /**
   * 获取鸽子健康检查（直连实时）
   */
  async getLiveHealth() {
    return this.queryDoveLive('health');
  }
  // ==================== 对话 API ====================

  /**
   * 发送消息（创建对话+任务），通过 Server 加密通道
   * 
   * @param {string} message - 消息内容
   * @param {string} conversationId - 对话ID（可选）
   * @param {string} profile - 执行配置标识（可选）
   * @param {Object} constraints - 内联执行约束（可选）
   * @param {string} requestId - 请求唯一标识（可选，多Server幂等去重）
   * @returns {Object} { taskId, conversationId, idempotent? }
   */
  async sendMessage(message, conversationId = null, profile = null, constraints = null, requestId = null) {
    await this.ensureAuth();
    
    // ========== 检测本地文件路径并上传为附件 ==========
    const attachments = await this._uploadLocalFilesAsAttachments(message);
    
    // 通过 Server 加密通道发送
    const body = { message, conversationId };
    if (profile) body.profile = profile;
    if (constraints && Object.keys(constraints).length > 0) body.constraints = constraints;
    if (requestId) body.requestId = requestId;
    if (attachments.length > 0) body.attachments = attachments;
    
    // 携带机器标识（用于本地亲和调度）
    body.machineId = 获取或生成机器标识();
    
    // 来源渠道：CLI 在用户本机运行，默认 local
    // channel/machineId 在加密通道中通过 body 传递，HTTP 中通过 header/body 传递
    body.channel = 'local';
    
    // 通过加密通道发送（_apiRequest 已解包 Express 信封，直接返回业务数据）
    return await this.post('/api/chat', body);
  }

  /**
   * 检测消息中的本地图片路径并上传到 Server，返回附件 URL 列表
   * 
   * 支持的路径格式：
   * - Windows: C:\path\to\image.png
   * - Unix: /path/to/image.png
   * - 带引号: "C:\path\image.png"
   * 
   * @param {string} message - 用户消息
   * @returns {Promise<string[]>} 上传后的 OSS URL 列表
   */
  async _uploadLocalFilesAsAttachments(message) {
    if (!message || typeof message !== 'string') return [];
    
    const IMAGE_EXT = /\.(?:png|jpg|jpeg|gif|bmp|webp)$/i;
    const localPaths = [];
    
    // 1. 带引号的路径
    const quotedPaths = [...message.matchAll(/["']([A-Za-z]:[\\\/][^"']+?\.(?:png|jpg|jpeg|gif|bmp|webp))["']/gi)];
    for (const m of quotedPaths) localPaths.push(m[1]);
    
    // 2. 裸 Windows 路径
    const winPaths = [...message.matchAll(/([A-Za-z]:[\\\/][^\s"'<>]+?\.(?:png|jpg|jpeg|gif|bmp|webp))/gi)];
    for (const m of winPaths) {
      if (!localPaths.includes(m[1])) localPaths.push(m[1]);
    }
    
    // 3. 裸 Unix 路径
    const unixPaths = [...message.matchAll(/(\/[^\s"'<>]+?\.(?:png|jpg|jpeg|gif|bmp|webp))/gi)];
    for (const m of unixPaths) {
      if (!localPaths.includes(m[1])) localPaths.push(m[1]);
    }
    
    if (localPaths.length === 0) return [];
    
    const attachments = [];
    for (const localPath of localPaths) {
      if (!existsSync(localPath)) continue;
      if (!IMAGE_EXT.test(localPath)) continue;
      
      try {
        const url = await this._uploadFileToServer(localPath);
        if (url) {
          attachments.push(url);
        }
      } catch (e) {
        if (process.env.DEBUG_CHAT) {
          console.log(`[Chat] 本地文件上传失败: ${localPath} - ${e.message}`);
        }
      }
    }
    
    return attachments;
  }

  /**
   * 上传本地文件到 Server（流式上传到 OSS）
   * @param {string} filePath - 本地文件路径
   * @returns {Promise<string|null>} 上传后的文件 URL
   */
  async _uploadFileToServer(filePath) {
    const stat = await import('fs').then(fs => fs.statSync(filePath));
    const buffer = readFileSync(filePath);
    const fileName = basename(filePath);
    const fileHash = createHash('sha256').update(buffer).digest('hex').substring(0, 16);

    // Step 1: 创建上传会话
    const session = await this.post('/api/file/upload/start', {
      fileName,
      fileSize: stat.size,
      targetDir: 'chat-attachments',
      fileHash,
    });
    const { uploadId, chunkSize } = session;

    // Step 2: 分片上传（base64 编码通过加密通道）
    for (let offset = 0; offset < buffer.length; offset += chunkSize) {
      const chunk = buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
      const partNumber = Math.floor(offset / chunkSize) + 1;
      await this.post(`/api/file/upload/${uploadId}/chunk?index=${partNumber}`, {
        chunkData: chunk.toString('base64'),
      });
    }

    // Step 3: 完成上传
    const result = await this.post(`/api/file/upload/${uploadId}/complete`, { fileHash });
    return result?.url || result?.ossPath || null;
  }

  /**
   * 获取对话列表
   * @returns {Array} 对话列表
   */
  async listConversations() {
    await this.ensureAuth();
    return await this.get('/api/conversations');
  }

  /**
   * 获取对话详情
   * @param {string} conversationId - 对话ID
   * @returns {Object} 对话详情
   */
  async getConversation(conversationId) {
    await this.ensureAuth();
    
    // get() 内部自动优先加密通道（_apiRequest 已解包 Express 信封）
    return await this.get(`/api/conversations/${conversationId}`);
  }
}
