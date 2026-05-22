/**
 * 导航组件
 */
(function() {
  const CORE_PAGES = [
    { id: 'chat', icon: '💬', label: '聊天' },
    { id: 'terminal', icon: '⌨️', label: '终端' },
    { id: 'tasks', icon: '📋', label: '任务' },
    { id: 'apps', icon: '🏪', label: '应用商店' },
    { id: 'status', icon: '📊', label: '状态' },
    { id: 'settings', icon: '⚙️', label: '设置' }
  ];

  window.NavComponent = {
    render(extensions = []) {
      const coreNav = document.getElementById('nav-core');
      const extNav = document.getElementById('nav-extensions');

      coreNav.innerHTML = CORE_PAGES.map(p =>
        `<div class="nav-item" data-page="${p.id}">
          <span class="icon">${p.icon}</span>
          <span class="label">${p.label}</span>
        </div>`
      ).join('');

      if (extensions.length) {
        extNav.innerHTML = '<div class="nav-section-title">扩展</div>' +
          extensions.map(ext =>
            `<div class="nav-item" data-page="ext-${ext.name}" data-ext="${ext.name}">
              <span class="icon">${ext.nav?.icon || '📦'}</span>
              <span class="label">${ext.nav?.label || ext.name}</span>
            </div>`
          ).join('');
      } else {
        extNav.innerHTML = '';
      }

      // 绑定点击事件
      document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
          const pageId = item.dataset.page;
          window.DoveApp.navigateTo(pageId);
        });
      });
    },

    setActive(pageId) {
      document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === pageId);
      });
    }
  };
})();
