/**
 * 循环塔防 - WebSocket 客户端
 */

export class 游戏客户端 {
  constructor() {
    this.ws = null;
    this.userId = null;
    this.username = null;
    this.callbacks = {};
    this.requestId = 0;
    this.pendingRequests = new Map();
  }

  连接(nickname) {
    return new Promise((resolve, reject) => {
      const port = 3101;
      const uid = Math.random().toString(36).substr(2, 8);
      const url = `ws://localhost:${port}/?nickname=${encodeURIComponent(nickname)}&uid=${uid}`;

      this.ws = new WebSocket(url);
      let resolved = false;

      this.ws.onopen = () => {};

      this.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (!resolved && msg.type === 'connected') {
          resolved = true;
          this.userId = msg.userId;
          this.username = msg.username;
          resolve(msg);
          return;
        }
        this._处理消息(msg);
      };

      this.ws.onerror = (e) => { if (!resolved) reject(e); };
      this.ws.onclose = () => {
        if (this.callbacks.onDisconnect) this.callbacks.onDisconnect();
      };
    });
  }

  _处理消息(msg) {
    if (msg.type === 'game_response') {
      const pending = this.pendingRequests.get(msg.requestId);
      if (pending) {
        this.pendingRequests.delete(msg.requestId);
        pending.resolve(msg);
      }
      return;
    }

    if (msg.type === 'game_update') {
      const handler = this.callbacks[msg.gameType];
      if (handler) handler(msg.data, msg);
    }
  }

  发送(action, data = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('未连接'));
      }
      const requestId = `req_${++this.requestId}`;
      this.pendingRequests.set(requestId, { resolve, reject });
      this.ws.send(JSON.stringify({ action, data, requestId }));

      // 超时
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('请求超时'));
        }
      }, 5000);
    });
  }

  on(event, callback) {
    this.callbacks[event] = callback;
  }

  断开() {
    if (this.ws) this.ws.close();
  }
}
