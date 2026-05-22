/**
 * @file 直连客户端
 * @description CLI 直连鸽子的客户端，支持加密TCP和WebSocket直连
 * 
 * === 工作流程 ===
 * 1. 从 Server 获取鸽子列表 + 直连端点
 * 2. 优先尝试加密TCP直连（Noise NX）
 * 3. 加密直连失败直接报错暴露，不降级 WebSocket
 * 4. 无鸽子可用属正常排队等待，跳过不报错
 * 5. 自动重连 + 心跳保活
 */

import { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { CryptoClient } from '@dove/common/crypto/加密客户端.js';

// ==================== 常量 ====================

/** 心跳间隔（毫秒） */
const HEARTBEAT_INTERVAL = 30000;

/** 重连延迟基数（毫秒） */
const RECONNECT_BASE_DELAY = 2000;

/** 最大重连延迟（毫秒） */
const RECONNECT_MAX_DELAY = 30000;

/** 最大重连次数 */
const MAX_RECONNECT_ATTEMPTS = 5;

// ==================== 直连客户端类 ====================

export class DirectConnection extends EventEmitter {
  /**
   * @param {Object} 配置
   * @param {string} 配置.serverUrl - Server 地址（获取鸽子列表，直连不可达时通过 Server 加密通道中转）
   * @param {string} 配置.token - 用户 JWT
   * @param {string} 配置.userId - 用户ID
   * @param {Object} [配置.cryptoClient] - 共享加密客户端（用于通过加密通道访问 Server API）
   */
  constructor(配置) {
    super();
    this.serverUrl = 配置.serverUrl;
    this.token = 配置.token;
    this.userId = 配置.userId;
    this._serverCryptoClient = 配置.cryptoClient || null;

    /** @type {WebSocket|null} */
    this.ws = null;
    /** @type {CryptoClient|null} 加密直连客户端 */
    this._cryptoClient = null;
    /** 当前连接的鸽子信息 */
    this.connectedDove = null;
    /** 当前传输类型 */
    this._transport = null; // 'encrypted' | 'ws' | null
    /** 连接状态 */
    this.state = 'disconnected'; // disconnected | connecting | connected | reconnecting
    /** 重连计数 */
    this.reconnectAttempts = 0;
    /** 心跳定时器 */
    this._heartbeatTimer = null;
    /** 重连定时器 */
    this._reconnectTimer = null;
    /** 消息序号（请求-响应匹配） */
    this._msgSeq = 0;
    /** 等待响应的 Promise */
    this._pendingRequests = new Map();
    /** 鸽子列表缓存 */
    this._doveListCache = null;
  }

  /**
   * 连接到鸽子
   * @param {string} [doveId] - 指定鸽子ID（不指定则自动选择第一个在线的）
   * @returns {Promise<boolean>} 是否成功连接
   */
  async connect(doveId = null) {
    if (this.state === 'connected' && this.connectedDove) {
      // 已连接，检查是否需要切换鸽子
      if (!doveId || this.connectedDove.doveId === doveId) {
        return true;
      }
      // 切换鸽子：先断开
      await this.disconnect();
    }

    this.state = 'connecting';
    this.emit('connecting');

    try {
      // 步骤1：从 Server 获取鸽子列表
      const doves = await this._fetchDoveList();
      if (!doves || doves.length === 0) {
        this.state = 'disconnected';
        console.warn('[直连客户端] 没有可用的鸽子，排队等待中…');
        return false;
      }

      // 步骤2：选择目标鸽子
      let targetDove;
      if (doveId) {
        targetDove = doves.find(d => d.doveId === doveId || d.鸽子ID === doveId);
        if (!targetDove) {
          this.state = 'disconnected';
          throw new Error(`鸽子 ${doveId} 不存在`);
        }
      } else {
        // 自动选择：优先选有直连端点且在线的
        targetDove = doves.find(d => d.directEndpoint && d.状态 === '在线')
          || doves.find(d => d.directEndpoint)
          || doves[0];
      }

      // 步骤3：尝试直连
      if (targetDove.encryptedEndpoint) {
        const connected = await this._connectEncryptedDirect(targetDove);
        if (connected) {
          return true;
        }
        throw new Error(`鸽子 ${targetDove.doveId || targetDove.鸽子ID} 加密直连失败`);
      }

      if (targetDove.directEndpoint) {
        const connected = await this._connectDirect(targetDove);
        if (connected) {
          return true;
        }
        throw new Error(
          `鸽子 ${targetDove.doveId || targetDove.鸽子ID} 直连失败。\n` +
          `直连通道不可用，请检查：\n` +
          `  1. 鸽子是否在线且直连端口可达\n` +
          `  2. 网络防火墙是否放行\n` +
          `  3. 鸽子日志中的直连服务状态`
        );
      }

      // 没有可用的直连端点
      throw new Error(
        `鸽子 ${targetDove.doveId || targetDove.鸽子ID} 没有可用的直连端点。\n` +
        `请确认鸽子已配置加密直连 (encryptedEndpoint) 或 WebSocket 直连 (directEndpoint)。`
      );

    } catch (e) {
      this.state = 'disconnected';
      this.emit('error', e);
      throw e;
    }
  }

  /**
   * 断开连接
   */
  async disconnect() {
    this._stopHeartbeat();
    this._clearReconnect();

    // 断开加密连接
    if (this._cryptoClient) {
      try {
        this._cryptoClient.close('Client disconnect');
      } catch (e) {
        console.warn('[直连客户端] 加密连接关闭失败:', e.message);
      }
      this._cryptoClient = null;
    }

    if (this.ws) {
      try {
        this.ws.close(1000, 'Client disconnect');
      } catch (e) {
        console.warn('[直连客户端] WebSocket 关闭失败:', e.message);
      }
      this.ws = null;
    }

    this._transport = null;

    // 清理等待中的请求
    for (const [seq, pending] of this._pendingRequests) {
      pending.reject(new Error('连接已断开'));
    }
    this._pendingRequests.clear();

    this.connectedDove = null;
    this.state = 'disconnected';
    this.emit('disconnected');
  }

  /**
   * 发送对话消息（通过直连）
   * @param {Object} params
   * @param {string} params.content - 消息内容
   * @param {string|null} params.conversationId - 对话ID
   * @param {string|null} params.profile - 执行配置
   * @param {Object|null} params.constraints - 执行约束
   * @returns {Promise<Object>} 响应数据
   */
  async sendChatMessage({ content, conversationId = null, profile = null, constraints = null }) {
    if (this.state !== 'connected') {
      throw new Error('直连未建立，请先调用 connect()');
    }

    const seq = ++this._msgSeq;
    const message = {
      type: 'chat',
      seq,
      conversationId,
      content,
      profile,
      constraints,
      timestamp: Date.now()
    };

    // 加密通道
    if (this._transport === 'encrypted' && this._cryptoClient?.connected) {
      return new Promise((resolve, reject) => {
        this._pendingRequests.set(seq, { resolve, reject, timestamp: Date.now() });
        const timer = setTimeout(() => {
          if (this._pendingRequests.has(seq)) {
            this._pendingRequests.delete(seq);
            reject(new Error('加密直连消息超时'));
          }
        }, 180000);
        try {
          this._cryptoClient.request('POST', '/direct/chat', message, { timeout: 180000 })
            .then(data => {
              clearTimeout(timer);
              // 解包 CryptoClient 响应: { requestId, type, seq, data }
              resolve(data?.data !== undefined ? data.data : data);
            })
            .catch(err => {
              clearTimeout(timer);
              reject(err);
            });
        } catch (e) {
          clearTimeout(timer);
          this._pendingRequests.delete(seq);
          reject(e);
        }
      });
    }

    // WebSocket 通道
    if (!this.ws) {
      throw new Error('直连未建立，请先调用 connect()');
    }

    return new Promise((resolve, reject) => {
      this._pendingRequests.set(seq, { resolve, reject, timestamp: Date.now() });

      // 超时保护（3分钟，与交互式聊天对齐）
      setTimeout(() => {
        if (this._pendingRequests.has(seq)) {
          this._pendingRequests.delete(seq);
          reject(new Error('直连消息超时'));
        }
      }, 180000);

      try {
        this.ws.send(JSON.stringify(message));
      } catch (e) {
        this._pendingRequests.delete(seq);
        reject(e);
      }
    });
  }

  /**
   * 发送控制指令
   * @param {string} action - 控制动作
   * @param {Object} params - 参数
   * @returns {Promise<Object>} 响应
   */
  async sendControl(action, params = {}) {
    if (this.state !== 'connected') {
      throw new Error('直连未建立');
    }

    const seq = ++this._msgSeq;
    const message = {
      type: 'control',
      seq,
      action,
      params,
      timestamp: Date.now()
    };

    // 加密通道
    if (this._transport === 'encrypted' && this._cryptoClient?.connected) {
      return new Promise((resolve, reject) => {
        this._pendingRequests.set(seq, { resolve, reject, timestamp: Date.now() });
        const timer = setTimeout(() => {
          if (this._pendingRequests.has(seq)) {
            this._pendingRequests.delete(seq);
            reject(new Error('控制指令超时'));
          }
        }, 30000);
        try {
          this._cryptoClient.request('POST', '/direct/control', message, { timeout: 30000 })
            .then(data => {
              clearTimeout(timer);
              // 解包 CryptoClient 响应: { requestId, type, seq, data }
              resolve(data?.data !== undefined ? data.data : data);
            })
            .catch(err => {
              clearTimeout(timer);
              reject(err);
            });
        } catch (e) {
          clearTimeout(timer);
          this._pendingRequests.delete(seq);
          reject(e);
        }
      });
    }

    // WebSocket 通道
    if (!this.ws) {
      throw new Error('直连未建立');
    }

    return new Promise((resolve, reject) => {
      this._pendingRequests.set(seq, { resolve, reject, timestamp: Date.now() });

      setTimeout(() => {
        if (this._pendingRequests.has(seq)) {
          this._pendingRequests.delete(seq);
          reject(new Error('控制指令超时'));
        }
      }, 30000);

      try {
        this.ws.send(JSON.stringify(message));
      } catch (e) {
        this._pendingRequests.delete(seq);
        reject(e);
      }
    });
  }

  // ==================== 便捷查询方法 ====================
  // 直连通道让 CLI 能从鸽子内存直接获取实况数据
  // 不用绕 Server 查 MongoDB（数据库是快照，内存是实况）
  // Server 路径保留：直连不可达时经 Server 加密通道中转

  /**
   * 获取鸽群状态概览
   */
  async getStatus() {
    return this.sendControl('status');
  }

  /**
   * 获取各鸽子详细实况
   */
  async getDoves() {
    return this.sendControl('doves');
  }

  /**
   * 获取当前执行中的任务
   */
  async getTasks() {
    return this.sendControl('tasks');
  }

  /**
   * 获取 Token 使用统计
   */
  async getStats() {
    return this.sendControl('stats');
  }

  /**
   * 获取能力列表
   */
  async getCapabilities() {
    return this.sendControl('capabilities');
  }

  /**
   * 获取技能清单
   */
  async getSkills() {
    return this.sendControl('skills');
  }

  /**
   * 获取当前模型配置
   */
  async getModels() {
    return this.sendControl('models');
  }

  /**
   * 健康检查（含进程资源使用）
   */
  async getHealth() {
    return this.sendControl('health');
  }

  /**
   * 是否已直连
   */
  isConnected() {
    if (this._transport === 'encrypted') {
      return this.state === 'connected' && this._cryptoClient?.connected;
    }
    return this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * 获取当前连接的鸽子信息
   */
  getConnectedDove() {
    return this.connectedDove;
  }

  // ==================== 内部方法 ====================

  /**
   * 从 Server 获取鸽子列表
   */
  async _fetchDoveList() {
    // 使用缓存（60秒有效）
    if (this._doveListCache && Date.now() - this._doveListCache.timestamp < 60000) {
      return this._doveListCache.data;
    }

    if (!this._serverCryptoClient?.connected) {
      throw new Error('加密通道未连接，无法获取鸽子列表');
    }

    const result = await this._serverCryptoClient.request('GET', '/api/dove/my-doves', {
      apiKey: this.token
    });

    if (!result.success) {
      throw new Error(result.error || '获取鸽子列表失败');
    }

    // 解包 Express 响应信封（forwardToExpress 返回 { success, data: expressBody }）
    const expressResponse = result.data;
    let doveList;
    if (expressResponse && typeof expressResponse === 'object' && 'success' in expressResponse) {
      if (!expressResponse.success) {
        throw new Error(expressResponse.error || '获取鸽子列表失败');
      }
      doveList = expressResponse.data;
    } else {
      doveList = expressResponse;
    }

    this._doveListCache = {
      data: doveList,
      timestamp: Date.now()
    };

    return doveList;
  }

  /**
   * 尝试直连鸽子
   * @returns {Promise<boolean>}
   */
  _connectDirect(dove) {
    return new Promise((resolve) => {
      const { host, port, protocol } = dove.directEndpoint;
      const wsUrl = `${protocol || 'ws'}://${host}:${port}/connect?token=${this.token}`;

      let settled = false;
      const ws = new WebSocket(wsUrl, {
        handshakeTimeout: 10000
      });

      const failTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { ws.terminate(); } catch (e) { console.warn('[直连客户端] ws.terminate 失败:', e.message); }
          resolve(false);
        }
      }, 10000);

      ws.on('open', () => {
        if (settled) return;
        clearTimeout(failTimer);
      });

      ws.on('message', (data) => {
        if (settled) return;

        try {
          const msg = JSON.parse(data.toString());

          // 收到 connected 消息 = 认证通过
          if (msg.type === 'connected') {
            settled = true;
            this.ws = ws;
            this._transport = 'ws';
            this.connectedDove = dove;
            this.state = 'connected';
            this.reconnectAttempts = 0;

            // 设置消息路由
            ws.on('message', (d) => this._onMessage(d));
            ws.on('close', (code, reason) => this._onClose(code, reason));
            ws.on('error', (err) => this._onError(err));

            // 启动心跳
            this._startHeartbeat();

            this.emit('connected', {
              doveId: dove.doveId || dove.鸽子ID,
              clientId: msg.clientId
            });

            resolve(true);
            return;
          }

          // 收到错误消息（认证失败等）
          if (msg.type === 'error') {
            settled = true;
            clearTimeout(failTimer);
            try { ws.terminate(); } catch (e) { console.warn('[直连客户端] ws.terminate 失败:', e.message); }
            this.emit('auth-failed', msg.error);
            resolve(false);
            return;
          }
        } catch (e) {
          console.warn('[直连客户端] WS握手消息解析失败:', e.message);
        }
      });

      ws.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        resolve(false);
      });

      ws.on('close', () => {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        resolve(false);
      });
    });
  }

  /**
   * 尝试加密TCP直连鸽子（Noise NX）
   * @returns {Promise<boolean>}
   */
  async _connectEncryptedDirect(dove) {
    const { host, port } = dove.encryptedEndpoint;
    if (!host || !port) return false;

    try {
      const { 获取或生成机器标识 } = await import('./machine-id.js');
      const machineId = 获取或生成机器标识();
      const clientId = `cli-direct-${machineId.substring(0, 8)}`;

      const cryptoClient = new CryptoClient({
        hostname: host,
        port,
        clientId,
        keyName: 'cli',
        authData: { token: this.token }
      });

      await cryptoClient.connect();

      // 加密连接建立成功
      this._cryptoClient = cryptoClient;
      this.connectedDove = dove;
      this._transport = 'encrypted';
      this.state = 'connected';
      this.reconnectAttempts = 0;

      // 监听加密客户端断开
      cryptoClient.on('close', () => {
        this._onCryptoClose();
      });
      cryptoClient.on('error', (err) => {
        this.emit('error', err);
      });

      this.emit('connected', {
        doveId: dove.doveId || dove.鸽子ID,
        clientId,
        transport: 'encrypted'
      });

      return true;
    } catch (e) {
      this._cryptoClient = null;
      throw new Error(`加密直连失败: ${e.message}`);
    }
  }

  /**
   * 加密连接关闭处理
   */
  _onCryptoClose() {
    this._stopHeartbeat();
    this._cryptoClient = null;
    this._transport = null;
    this.state = 'disconnected';
    this.emit('disconnected', { reason: '加密连接关闭' });
    this.emit('error', new Error('加密连接意外关闭'));
  }

  /**
   * 处理消息
   */
  _onMessage(data) {
    try {
      const msg = JSON.parse(data.toString());

      // 处理响应消息（匹配等待中的请求）
      if (msg.seq && this._pendingRequests.has(msg.seq)) {
        const pending = this._pendingRequests.get(msg.seq);
        this._pendingRequests.delete(msg.seq);

        if (msg.type === 'chat_response' || msg.type === 'control_response') {
          pending.resolve(msg.data);
        } else if (msg.type === 'chat_error' || msg.type === 'control_error') {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg);
        }
        return;
      }

      // 非响应消息：转发给上层（流式推送、事件等）
      this.emit('message', msg);

    } catch (e) {
      console.warn(`[直连客户端] 消息解析失败: ${e.message}`);
    }
  }

  /**
   * 连接关闭
   */
  _onClose(code, reason) {
    this._stopHeartbeat();
    this.ws = null;
    this._transport = null;
    this.state = 'disconnected';

    this.emit('disconnected', { code, reason: reason?.toString() });

    // 尝试重连
    if (code !== 1000 && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      this._scheduleReconnect();
    } else if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.emit('error', new Error(
        `直连重连失败（已尝试 ${MAX_RECONNECT_ATTEMPTS} 次）。\n` +
        `请检查网络连通性和鸽子运行状态。`
      ));
    }
  }

  /**
   * 连接错误
   */
  _onError(err) {
    console.warn(`[直连客户端] 连接错误: ${err.message}`);
  }

  /**
   * 调度重连
   */
  _scheduleReconnect() {
    this.state = 'reconnecting';
    this.reconnectAttempts++;

    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY
    );

    console.log(`[直连客户端] ${delay}ms 后重连 (第${this.reconnectAttempts}次)`);

    this._reconnectTimer = setTimeout(async () => {
      try {
        const doveId = this.connectedDove?.doveId || this.connectedDove?.鸽子ID;
        this.connectedDove = null;
        // 清除鸽子列表缓存（端点可能变了）
        this._doveListCache = null;
        await this.connect(doveId);
      } catch (e) {
        console.warn(`[直连客户端] 重连失败: ${e.message}`);
      }
    }, delay);

    if (this._reconnectTimer.unref) this._reconnectTimer.unref();
  }

  /**
   * 启动心跳
   */
  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.ping();
        } catch (e) {
          console.warn('[直连客户端] 心跳 ping 失败:', e.message);
        }
      }
    }, HEARTBEAT_INTERVAL);

    if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();
  }

  /**
   * 停止心跳
   */
  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  /**
   * 清理重连定时器
   */
  _clearReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }
}

export default DirectConnection;
