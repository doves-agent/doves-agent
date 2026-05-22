(function() {
  'use strict';

  let searchIndex = null;
  let activeIdx = -1;

  function getBasePath() {
    var script = document.querySelector('script[src*="components.js"]');
    if (script) {
      return script.getAttribute('src').replace(/\/js\/components\.js$/, '') || '.';
    }
    return '.';
  }

  async function loadIndex() {
    if (searchIndex) return;
    try {
      const base = getBasePath();
      const resp = await fetch(base + '/search-index.json');
      searchIndex = await resp.json();
    } catch(e) {
      searchIndex = [];
    }
  }

  function search(query) {
    if (!searchIndex || !query.trim()) return [];
    const q = query.toLowerCase();
    const results = [];

    for (const item of searchIndex) {
      let score = 0;
      const title = (item.title || '').toLowerCase();
      const section = (item.section || '').toLowerCase();
      const keywords = (item.keywords || []).map(k => k.toLowerCase());
      const headings = (item.headings || []).map(h => h.toLowerCase());

      if (title.includes(q)) score += 10;
      for (const h of headings) { if (h.includes(q)) score += 5; }
      for (const k of keywords) { if (k.includes(q)) score += 3; }
      if (section.includes(q)) score += 1;

      if (score > 0) results.push({ ...item, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 10);
  }

  function renderResults(results) {
    const container = document.getElementById('search-results');
    if (!container) return;
    const base = getBasePath();

    if (results.length === 0) {
      container.innerHTML = '<div style="padding:1rem;color:#64748b;font-size:0.85rem;">未找到结果</div>';
      container.classList.add('active');
      return;
    }

    container.innerHTML = results.map((r, i) =>
      `<a class="search-result-item${i === activeIdx ? ' active' : ''}" href="${base}${r.url}">
        <div class="result-title">${r.title}</div>
        <div class="result-section">${r.section}</div>
      </a>`
    ).join('');
    container.classList.add('active');
  }

  function handleNav(e, results) {
    const container = document.getElementById('search-results');
    if (!container || !container.classList.contains('active')) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, results.length - 1);
      renderResults(results);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      renderResults(results);
    } else if (e.key === 'Enter' && activeIdx >= 0 && results[activeIdx]) {
      e.preventDefault();
      const base = getBasePath();
      window.location.href = base + results[activeIdx].url;
    }
  }

  document.addEventListener('DOMContentLoaded', function() {
    const input = document.getElementById('search-input');
    const container = document.getElementById('search-results');
    if (!input || !container) return;

    let debounce = null;
    let currentResults = [];

    input.addEventListener('focus', loadIndex);

    input.addEventListener('input', function() {
      clearTimeout(debounce);
      debounce = setTimeout(function() {
        activeIdx = -1;
        currentResults = search(input.value);
        if (!input.value.trim()) {
          container.classList.remove('active');
          return;
        }
        renderResults(currentResults);
      }, 150);
    });

    input.addEventListener('keydown', function(e) {
      handleNav(e, currentResults);
    });

    document.addEventListener('click', function(e) {
      if (!e.target.closest('.header-search')) {
        container.classList.remove('active');
      }
    });
  });
})();
