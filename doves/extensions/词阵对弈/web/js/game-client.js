/**
 * 词阵对弈 - WebSocket游戏客户端
 */
class GameClient {
  constructor(serverUrl, nickname) {
    this.serverUrl = serverUrl;
    this.nickname = nickname;
    this.ws = null;
    this.reqId = 1;
    this.pendingRequests = new Map();
    this.connected = false;
    this.userId = null;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 5;
    this._reconnectTimer = null;
    this._intentionalClose = false;

    // Callbacks
    this.onOpen = null;
    this.onClose = null;
    this.onError = null;
    this.onRoomUpdate = null;
    this.onGameStart = null;
    this.onIdiomPicked = null;
    this.onBattlePreparing = null;
    this.onBattleStart = null;
    this.onBattleAction = null;
    this.onGameOver = null;
    this.onMatchFound = null;
    this.onRoundUpdate = null;
    this.onReconnected = null;
  }

  connect() {
    if (this.ws) this.close();
    this._intentionalClose = false;

    const baseUrl = this.serverUrl.replace(/\/+$/, '');
    const wsUrl = baseUrl + '?nickname=' + encodeURIComponent(this.nickname);

    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => {
      this.connected = true;
      this._reconnectAttempts = 0;
      if (this.onOpen) this.onOpen();
    };
    this.ws.onclose = () => {
      this.connected = false;
      if (!this._intentionalClose) {
        this._tryReconnect();
      }
      if (this.onClose) this.onClose();
    };
    this.ws.onerror = () => {
      if (this.onError) this.onError('WebSocket连接错误');
    };
    this.ws.onmessage = (event) => this._handleMessage(event);
  }

  close() {
    this._intentionalClose = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.connected = false;
  }

  _tryReconnect() {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) return;
    this._reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts - 1), 10000);
    this._reconnectTimer = setTimeout(() => {
      this.connect();
      if (this.onReconnected) this.onReconnected(this._reconnectAttempts);
    }, delay);
  }

  sendGameAction(action, data, callback) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (callback) callback({ success: false, error: '未连接' });
      return;
    }

    const requestId = 'req_' + (this.reqId++);
    if (callback) this.pendingRequests.set(requestId, callback);

    this.ws.send(JSON.stringify({ action, data, requestId }));
  }

  _handleMessage(event) {
    try {
      const msg = JSON.parse(event.data);
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'game_response':
          this._handleResponse(msg);
          break;
        case 'game_update':
          this._handleUpdate(msg);
          break;
        case 'connected':
          this.userId = msg.userId;
          break;
        case 'error':
          if (this.onError) this.onError(msg.message || '服务端错误');
          break;
      }
    } catch (e) {
      console.warn('[GameClient] 消息解析失败:', e);
    }
  }

  _handleResponse(msg) {
    const cb = this.pendingRequests.get(msg.requestId);
    if (cb) {
      this.pendingRequests.delete(msg.requestId);
      cb(msg);
    }
  }

  _handleUpdate(msg) {
    switch (msg.gameType) {
      case 'room_update':
        if (this.onRoomUpdate) this.onRoomUpdate(msg.data);
        break;
      case 'match_found':
        if (this.onMatchFound) this.onMatchFound(msg.data);
        break;
      case 'game_start':
        if (this.onGameStart) this.onGameStart(msg.data);
        break;
      case 'idiom_picked':
        if (this.onIdiomPicked) this.onIdiomPicked(msg.data);
        break;
      case 'battle_preparing':
        if (this.onBattlePreparing) this.onBattlePreparing(msg.data);
        break;
      case 'battle_start':
        if (this.onBattleStart) this.onBattleStart(msg.data);
        break;
      case 'battle_action':
        if (this.onBattleAction) this.onBattleAction(msg.data);
        break;
      case 'game_over':
        if (this.onGameOver) this.onGameOver(msg.data);
        break;
      case 'round_update':
        if (this.onRoundUpdate) this.onRoundUpdate(msg.data);
        break;
    }
  }
}
