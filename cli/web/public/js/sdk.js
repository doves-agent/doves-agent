/**
 * DoveSDK v2.0
 * 扩展页面与白鸽系统交互的唯一通道
 *
 * 使用方式（扩展 iframe 内）:
 *   <script src="/js/sdk.js"></script>
 *   const result = await DoveSDK.callTool('工具名', { 参数 });
 */

(function () {
  'use strict';

  // ==================== 内部状态 ====================

  const _listeners = {};
  let _extensionName = '';

  function _getEngine() {
    return window.parent?.DoveApp;
  }

  function _apiBase() {
    return window.location.origin;
  }

  function _token() {
    const engine = _getEngine();
    return engine?.state?.token || '';
  }

  async function _fetch(method, path, body) {
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Token': _token()
      }
    };
    if (body && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(`${_apiBase()}${path}`, opts);
    return await resp.json();
  }

  // ==================== SDK 公共 API ====================

  const DoveSDK = {
    version: '2.0.0',

    // --- 认证（只读） ---

    get token() { return _token(); },
    get userId() { return _getEngine()?.state?.userId || ''; },
    get username() { return _getEngine()?.state?.username || ''; },
    get isLoggedIn() { return !!_token(); },

    // --- 初始化（扩展页面加载时调用） ---

    init(extensionName) {
      _extensionName = extensionName || '';
    },

    // --- 核心方法 ---

    /**
     * 调用扩展工具（异步任务 → SSE 等待结果）
     */
    async callTool(toolName, args = {}, options = {}) {
      const { extension = _extensionName, timeout = 60000 } = options;

      const createResult = await _fetch('POST', '/api/extensions/tools/call', {
        tool: toolName,
        args,
        extension
      });

      if (!createResult.success) {
        return { success: false, data: null, error: createResult.error || '工具调用失败' };
      }

      const taskId = createResult.data?.taskId;
      if (!taskId) {
        return { success: true, data: createResult.data, error: null };
      }

      return await this._waitForResult(taskId, timeout);
    },

    /**
     * 执行 CLI 命令
     */
    async cmd(command, context = {}) {
      return await _fetch('POST', '/api/cmd', {
        cmd: command,
        context: { ...context, source: _extensionName || 'sdk' }
      });
    },

    /**
     * 调用技能
     */
    async callSkill(skillName, action, args = {}) {
      return await _fetch('POST', '/api/cmd', {
        cmd: `skill ${skillName} ${action}`,
        context: { args, source: _extensionName || 'sdk' }
      });
    },

    /**
     * 监控任务（SSE）
     */
    watchTask(taskId, { onUpdate, onDone, onError } = {}) {
      const es = new EventSource(`${_apiBase()}/api/task/watch?taskId=${taskId}`);

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'update' && onUpdate) onUpdate(msg.task);
          if (msg.type === 'done' && onDone) {
            onDone(msg.task);
            es.close();
          }
        } catch {}
      };

      es.onerror = () => {
        if (onError) onError(new Error('SSE 连接断开'));
        es.close();
      };

      return () => es.close();
    },

    /**
     * 取消任务
     */
    async cancelTask(taskId) {
      return await _fetch('POST', '/api/task/cancel', { taskId });
    },

    // --- 流式 ---

    /**
     * 流式命令执行
     * 返回 AsyncIterator
     */
    async *stream(command, context = {}) {
      const result = await this.cmd(command, context);
      if (!result.success) {
        yield { type: 'error', data: result.error };
        return;
      }

      const taskId = result.data?.taskId;
      if (!taskId) {
        yield { type: 'done', data: result.data };
        return;
      }

      const es = new EventSource(`${_apiBase()}/api/task/watch?taskId=${taskId}`);
      const queue = [];
      let resolve = null;
      let done = false;

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const item = { type: msg.type === 'done' ? 'done' : 'chunk', data: msg.task || msg };
          if (msg.type === 'done') { done = true; es.close(); }
          if (resolve) { const r = resolve; resolve = null; r(item); }
          else queue.push(item);
        } catch {}
      };

      es.onerror = () => { done = true; es.close(); };

      while (!done || queue.length) {
        if (queue.length) {
          yield queue.shift();
        } else if (!done) {
          yield await new Promise(r => { resolve = r; });
        }
      }
    },

    // --- 导航 ---

    navigateTo(pageId) {
      const engine = _getEngine();
      if (engine?.navigateTo) {
        engine.navigateTo(pageId);
      }
    },

    // --- 存储（扩展隔离） ---

    storage: {
      async get(key) {
        const r = await _fetch('POST', '/api/cmd', {
          cmd: 'storage get',
          context: { key, extension: _extensionName, source: 'sdk-storage' }
        });
        return r.success ? r.data : undefined;
      },

      async set(key, value) {
        await _fetch('POST', '/api/cmd', {
          cmd: 'storage set',
          context: { key, value, extension: _extensionName, source: 'sdk-storage' }
        });
      },

      async delete(key) {
        await _fetch('POST', '/api/cmd', {
          cmd: 'storage delete',
          context: { key, extension: _extensionName, source: 'sdk-storage' }
        });
      },

      async list() {
        const r = await _fetch('POST', '/api/cmd', {
          cmd: 'storage list',
          context: { extension: _extensionName, source: 'sdk-storage' }
        });
        return r.success ? r.data : [];
      }
    },

    // --- 文件 ---

    file: {
      async read(filePath) {
        return await _fetch('POST', '/api/cmd', {
          cmd: `file read ${filePath}`,
          context: { path: filePath, source: 'sdk-file' }
        });
      },

      async write(filePath, content) {
        return await _fetch('POST', '/api/cmd', {
          cmd: 'file write',
          context: { path: filePath, body: { content }, source: 'sdk-file' }
        });
      },

      async list(dirPath = '/') {
        return await _fetch('POST', '/api/cmd', {
          cmd: `file ls ${dirPath}`,
          context: { path: dirPath, source: 'sdk-file' }
        });
      },

      async upload(file) {
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch(`${_apiBase()}/api/file/upload`, {
          method: 'POST',
          headers: { 'X-Token': _token() },
          body: formData
        });
        return await resp.json();
      }
    },

    // --- 事件总线 ---

    on(event, fn) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(fn);
    },

    off(event, fn) {
      if (!_listeners[event]) return;
      _listeners[event] = _listeners[event].filter(f => f !== fn);
    },

    emit(event, data) {
      const handlers = _listeners[event] || [];
      for (const fn of handlers) {
        try { fn(data); } catch {}
      }
      // 向宿主广播
      const engine = _getEngine();
      if (engine?.emit) engine.emit(event, data, _extensionName);
    },

    // --- UI 工具 ---

    notify(type, message) {
      const engine = _getEngine();
      if (engine?.showToast) {
        engine.showToast(message, type);
      }
    },

    confirm(title, message) {
      return new Promise((resolve) => {
        const engine = _getEngine();
        if (engine?.showConfirm) {
          engine.showConfirm(title, message, resolve);
        } else {
          resolve(window.confirm(`${title}\n${message}`));
        }
      });
    },

    prompt(title, options = {}) {
      return new Promise((resolve) => {
        const engine = _getEngine();
        if (engine?.showPrompt) {
          engine.showPrompt(title, options, resolve);
        } else {
          resolve(window.prompt(title, options.default || ''));
        }
      });
    },

    // --- 配置 ---

    async getConfig() {
      const r = await _fetch('GET', '/api/auth/status');
      return r.success ? r.data : {};
    },

    // --- 执行日志 ---

    async getExecutionLog(limit = 50) {
      const r = await _fetch('GET', `/api/events/log?limit=${limit}`);
      return r.success ? r.data : { total: 0, entries: [] };
    },

    // --- 内部方法 ---

    async _waitForResult(taskId, timeout) {
      return new Promise((resolve) => {
        const es = new EventSource(
          `${_apiBase()}/api/extensions/tools/call/stream/${taskId}`
        );

        const timer = setTimeout(() => {
          es.close();
          resolve({ success: false, data: null, error: '工具调用超时' });
        }, timeout);

        es.addEventListener('result', (event) => {
          clearTimeout(timer);
          es.close();
          try {
            const data = JSON.parse(event.data);
            resolve({ success: true, data, error: null });
          } catch {
            resolve({ success: true, data: event.data, error: null });
          }
        });

        es.addEventListener('error', (event) => {
          clearTimeout(timer);
          es.close();
          try {
            const err = JSON.parse(event.data);
            resolve({ success: false, data: null, error: err.error || '执行失败' });
          } catch {
            resolve({ success: false, data: null, error: '连接断开' });
          }
        });

        es.onerror = () => {
          clearTimeout(timer);
          es.close();
          // SSE 断开后尝试最终轮询
          this._finalPoll(taskId).then(resolve);
        };
      });
    },

    async _finalPoll(taskId) {
      try {
        const r = await _fetch('GET', `/api/extensions/tools/call/${taskId}`);
        if (r.success && r.data?.status === '已完成') {
          return { success: true, data: r.data.result, error: null };
        }
        return { success: false, data: null, error: '结果未知' };
      } catch {
        return { success: false, data: null, error: '轮询失败' };
      }
    }
  };

  // 挂载到全局
  window.DoveSDK = DoveSDK;
})();
