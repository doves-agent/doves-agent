(function() {
  'use strict';

  document.addEventListener('DOMContentLoaded', function() {
    const active = document.querySelector('.nav-link.active');
    if (active) {
      active.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  });

  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      const input = document.getElementById('search-input');
      if (input) input.focus();
    }
    if (e.key === 'Escape') {
      const results = document.getElementById('search-results');
      if (results) results.classList.remove('active');
      const input = document.getElementById('search-input');
      if (input) input.blur();
    }
  });
})();
