(function() {
  'use strict';

  const NAV_TREE = [
    { title: '首页', path: '/index.html' },
    {
      title: '快速入门', children: [
        { title: '快速开始', path: '/guide/quick-start.html' },
        { title: '安装部署', path: '/guide/installation.html' },
        { title: '配置指南', path: '/guide/configuration.html' },
      ]
    },
    {
      title: 'CLI 命令参考', children: [
        { title: '概览', path: '/cli/index.html' },
        { title: '对话 (chat/conv/session)', path: '/cli/chat.html' },
        { title: '任务 (task)', path: '/cli/task.html' },
        { title: '鸽子管理 (dove/cap/skill)', path: '/cli/dove.html' },
        { title: '配置 (config/model/profile)', path: '/cli/config.html' },
        { title: '存储 (file/storage/memory)', path: '/cli/storage.html' },
        { title: '服务 (service/web/log)', path: '/cli/service.html' },
        { title: '认证 (login/setup/status)', path: '/cli/auth.html' },
        { title: '集成 (wechat/event/notify/app)', path: '/cli/integrations.html' },
      ]
    },
    {
      title: '扩展开发', children: [
        { title: '概述', path: '/extensions/index.html' },
        { title: '快速上手', path: '/extensions/getting-started.html' },
        { title: 'manifest.js 规范', path: '/extensions/manifest.html' },
        { title: '权限体系', path: '/extensions/permissions.html' },
        { title: '工具开发', path: '/extensions/tools.html' },
        { title: '技能开发', path: '/extensions/skills.html' },
        { title: '生命周期', path: '/extensions/lifecycle.html' },
        { title: '发布与安装', path: '/extensions/publishing.html' },
      ]
    },
    {
      title: '架构设计', children: [
        { title: '总览', path: '/architecture/index.html' },
        { title: 'Server 数据网关', path: '/architecture/server.html' },
        { title: 'Doves 执行引擎', path: '/architecture/doves-engine.html' },
        { title: '任务队列', path: '/architecture/task-queue.html' },
        { title: '安全体系', path: '/architecture/security.html' },
        { title: 'LLM 提供商', path: '/architecture/llm-providers.html' },
      ]
    },
    {
      title: 'API 参考', children: [
        { title: 'Server 路由速查', path: '/api/index.html' },
      ]
    }
  ];

  function getBasePath() {
    var script = document.querySelector('script[src*="components.js"]');
    if (script) {
      return script.getAttribute('src').replace(/\/js\/components\.js$/, '') || '.';
    }
    return '.';
  }

  function getCurrentPath() {
    var script = document.querySelector('script[src*="components.js"]');
    if (!script) return '/' + window.location.pathname.split('/').pop();
    var base = getBasePath();
    var depth = (base.match(/\.\./g) || []).length;
    var parts = window.location.pathname.split('/').filter(function(p) { return p; });
    if (depth === 0) return '/' + parts[parts.length - 1];
    var relevant = parts.slice(parts.length - depth - 1);
    return '/' + relevant.join('/');
  }

  function isActivePath(navPath) {
    const current = getCurrentPath();
    if (navPath === current) return true;
    const normNav = navPath.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
    const normCur = current.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
    return normNav === normCur;
  }

  function renderHeader(base) {
    const header = document.getElementById('site-header');
    if (!header) return;
    header.innerHTML = `
      <div class="header-inner">
        <button class="hamburger" onclick="toggleSidebar()" aria-label="Toggle menu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 12h18M3 6h18M3 18h18"/>
          </svg>
        </button>
        <a href="${base}/index.html" class="header-logo">
          <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="#3b82f6"/><path d="M10 18c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="#fff" stroke-width="2" fill="none"/><circle cx="13" cy="14" r="1.5" fill="#fff"/><circle cx="19" cy="14" r="1.5" fill="#fff"/><path d="M16 8c-1.5-2-4-2-5-1s0 3 1 3.5" stroke="#fff" stroke-width="1.5" fill="none"/><path d="M16 8c1.5-2 4-2 5-1s0 3-1 3.5" stroke="#fff" stroke-width="1.5" fill="none"/></svg>
          白鸽文档
        </a>
        <div class="header-search">
          <span class="search-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span>
          <input type="text" id="search-input" placeholder="搜索文档... (Ctrl+K)" autocomplete="off">
          <div class="search-results" id="search-results"></div>
        </div>
      </div>
    `;
  }

  function renderSidebar(base) {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    let html = '';
    for (const section of NAV_TREE) {
      if (!section.children) {
        const active = isActivePath(section.path) ? ' active' : '';
        html += `<div class="nav-section"><ul class="nav-links"><li><a class="nav-link${active}" href="${base}${section.path}">${section.title}</a></li></ul></div>`;
      } else {
        const hasActive = section.children.some(c => isActivePath(c.path));
        const collapsed = hasActive ? '' : ' collapsed';
        html += `<div class="nav-section${collapsed}">`;
        html += `<div class="nav-section-title" onclick="this.parentElement.classList.toggle('collapsed')">
          <span>${section.title}</span>
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
        </div>`;
        html += '<ul class="nav-links">';
        for (const child of section.children) {
          const active = isActivePath(child.path) ? ' active' : '';
          html += `<li><a class="nav-link${active}" href="${base}${child.path}">${child.title}</a></li>`;
        }
        html += '</ul></div>';
      }
    }

    sidebar.innerHTML = html;
  }

  function init() {
    const base = getBasePath();
    renderHeader(base);
    renderSidebar(base);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.toggleSidebar = function() {
    const sidebar = document.getElementById('sidebar');
    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'sidebar-overlay';
      overlay.onclick = function() { window.toggleSidebar(); };
      document.body.appendChild(overlay);
    }
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
  };

  window.DOC_NAV_TREE = NAV_TREE;
})();
