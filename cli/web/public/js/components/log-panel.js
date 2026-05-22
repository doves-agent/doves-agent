/**
 * 执行日志面板组件
 */
(function() {
  let logCount = 0;
  let pollInterval = null;

  window.LogPanelComponent = {
    init() {
      const toggle = document.getElementById('log-toggle');
      const panel = document.getElementById('log-panel');
      const clearBtn = document.getElementById('log-clear');
      const filter = document.getElementById('log-filter');

      toggle.addEventListener('click', () => {
        panel.classList.toggle('collapsed');
        panel.classList.toggle('expanded');
        if (panel.classList.contains('expanded')) this.refresh();
      });

      clearBtn.addEventListener('click', async () => {
        await fetch('/api/events/log', { method: 'DELETE' });
        this.refresh();
      });

      filter.addEventListener('change', () => this.refresh());

      this.startPolling();
    },

    startPolling() {
      pollInterval = setInterval(() => this.updateCount(), 3000);
    },

    async updateCount() {
      try {
        const resp = await fetch('/api/events/log?limit=1');
        const data = await resp.json();
        if (data.success) {
          const total = data.data.total;
          if (total !== logCount) {
            logCount = total;
            document.getElementById('log-count').textContent = total;
            const panel = document.getElementById('log-panel');
            if (panel.classList.contains('expanded')) this.refresh();
          }
        }
      } catch {}
    },

    async refresh() {
      const filter = document.getElementById('log-filter').value;
      let url = '/api/events/log?limit=100';
      if (filter) url += `&success=${filter}`;

      try {
        const resp = await fetch(url);
        const data = await resp.json();
        if (data.success) {
          this.render(data.data.entries);
        }
      } catch {}
    },

    render(entries) {
      const container = document.getElementById('log-entries');
      if (!entries.length) {
        container.innerHTML = '<div class="empty-state">暂无执行记录</div>';
        return;
      }

      container.innerHTML = entries.map(e => {
        const time = new Date(e.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
        const statusClass = e.success ? 'status-ok' : 'status-err';
        const statusIcon = e.success ? '✓' : '✗';
        const dur = e.duration ? `${e.duration}ms` : '-';
        return `<div class="log-entry" data-id="${e.id}">
          <span class="time">${time}</span>
          <span class="${statusClass}">${statusIcon}</span>
          <span class="cmd">${this.escape(e.command)}</span>
          <span class="duration">${dur}</span>
        </div>`;
      }).join('');
    },

    escape(str) {
      const d = document.createElement('div');
      d.textContent = str || '';
      return d.innerHTML;
    }
  };
})();
