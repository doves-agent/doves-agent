/**
 * 模态框组件
 */
(function() {
  const overlay = document.getElementById('modal-overlay');

  window.ModalComponent = {
    confirm(title, message, callback) {
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-title">${title}</div>
          <div class="modal-body">${message}</div>
          <div class="modal-actions">
            <button class="btn btn-outline" id="modal-cancel">取消</button>
            <button class="btn" id="modal-ok">确认</button>
          </div>
        </div>`;
      overlay.classList.remove('hidden');

      document.getElementById('modal-ok').onclick = () => {
        overlay.classList.add('hidden');
        callback(true);
      };
      document.getElementById('modal-cancel').onclick = () => {
        overlay.classList.add('hidden');
        callback(false);
      };
    },

    prompt(title, options, callback) {
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-title">${title}</div>
          <div class="modal-body">
            <input class="input" id="modal-input" value="${options.default || ''}" placeholder="${options.placeholder || ''}">
          </div>
          <div class="modal-actions">
            <button class="btn btn-outline" id="modal-cancel">取消</button>
            <button class="btn" id="modal-ok">确认</button>
          </div>
        </div>`;
      overlay.classList.remove('hidden');

      const input = document.getElementById('modal-input');
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('modal-ok').click();
      });

      document.getElementById('modal-ok').onclick = () => {
        overlay.classList.add('hidden');
        callback(input.value);
      };
      document.getElementById('modal-cancel').onclick = () => {
        overlay.classList.add('hidden');
        callback(null);
      };
    },

    close() {
      overlay.classList.add('hidden');
    }
  };
})();
