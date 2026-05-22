/**
 * 白鸽 Web 平台 v2 - 主应用
 * SPA 路由、导航管理、iframe 生命周期、事件总线
 */
(function() {
  'use strict';

  const DoveApp = {
    state: { token: '', userId: '', username: '', role: '' },
    currentPage: null,
    extensions: [],
    _eventListeners: {},

    // ==================== 初始化 ====================

    async init() {
      await this.loadAuthState();
      await this.loadExtensions();

      NavComponent.render(this.extensions);
      LogPanelComponent.init();
      this.connectSSE();

      this.navigateTo('chat');
    },

    async loadAuthState() {
      try {
        const resp = await fetch('/api/auth/status');
        const data = await resp.json();
        if (data.success && data.data) {
          this.state = { ...this.state, ...data.data };
        }
      } catch {}
    },

    async loadExtensions() {
      try {
        const resp = await fetch('/api/extensions/list');
        const data = await resp.json();
        if (data.success) {
          this.extensions = data.data || [];
        }
      } catch {}
    },

    // ==================== 路由 ====================

    navigateTo(pageId) {
      if (this.currentPage === pageId) return;
      this.currentPage = pageId;

      NavComponent.setActive(pageId);

      const pageContainer = document.getElementById('page-container');
      const extFrame = document.getElementById('ext-frame');

      if (pageId.startsWith('ext-')) {
        const extName = pageId.replace('ext-', '');
        const ext = this.extensions.find(e => e.name === extName);
        if (ext) {
          pageContainer.classList.add('hidden');
          extFrame.classList.remove('hidden');
          const firstPage = Object.values(ext.pages || {})[0];
          const entry = firstPage?.entry?.replace(/^\.\/web\//, '') || 'index.html';
          extFrame.src = `/ext/${extName}/${entry}`;
        }
      } else {
        extFrame.classList.add('hidden');
        extFrame.src = '';
        pageContainer.classList.remove('hidden');
        this.loadPage(pageId, pageContainer);
      }
    },

    async loadPage(pageId, container) {
      try {
        const resp = await fetch(`/pages/${pageId}.html`);
        if (resp.ok) {
          container.innerHTML = await resp.text();
          this.initPageScripts(pageId, container);
        } else {
          container.innerHTML = `<div class="empty-state">页面 ${pageId} 不存在</div>`;
        }
      } catch (err) {
        container.innerHTML = `<div class="empty-state">加载失败: ${err.message}</div>`;
      }
    },

    initPageScripts(pageId, container) {
      const scripts = container.querySelectorAll('script');
      for (const old of scripts) {
        const s = document.createElement('script');
        s.textContent = old.textContent;
        old.replaceWith(s);
      }
    },

    // ==================== SSE 事件 ====================

    connectSSE() {
      const es = new EventSource('/api/events/stream');
      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleSSE(msg);
        } catch {}
      };
      es.onerror = () => {
        setTimeout(() => this.connectSSE(), 5000);
        es.close();
      };
    },

    handleSSE(msg) {
      if (msg.type === 'extension-changed') {
        this.loadExtensions().then(() => {
          NavComponent.render(this.extensions);
          ToastComponent.show(
            `扩展 "${msg.name}" 已${msg.action === 'installed' ? '安装' : msg.action === 'uninstalled' ? '卸载' : '更新'}`,
            'info'
          );
        });
      }
    },

    // ==================== 宿主接口（供 SDK 调用） ====================

    showToast(message, type) { ToastComponent.show(message, type); },
    showConfirm(title, message, cb) { ModalComponent.confirm(title, message, cb); },
    showPrompt(title, options, cb) { ModalComponent.prompt(title, options, cb); },

    emit(event, data, source) {
      const handlers = this._eventListeners[event] || [];
      for (const fn of handlers) {
        try { fn(data, source); } catch {}
      }
    },

    on(event, fn) {
      if (!this._eventListeners[event]) this._eventListeners[event] = [];
      this._eventListeners[event].push(fn);
    }
  };

  window.DoveApp = DoveApp;
  document.addEventListener('DOMContentLoaded', () => DoveApp.init());
})();
