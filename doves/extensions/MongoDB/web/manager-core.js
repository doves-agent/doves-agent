/**
 * MongoDB 管理器 - 核心模块
 * 状态管理 + API 调用 + 事件总线 + 工具函数
 *
 * 所有 API 调用统一通过 DoveSDK，不再手动管理 token 和轮询
 */

// ==================== 事件总线 ====================
const _listeners = {};
export function on(event, fn) {
  if (!_listeners[event]) _listeners[event] = [];
  _listeners[event].push(fn);
}
export function off(event, fn) {
  if (!_listeners[event]) return;
  _listeners[event] = _listeners[event].filter(f => f !== fn);
}
export function emit(event, data) {
  (_listeners[event] || []).forEach(fn => fn(data));
}

// ==================== 全局状态 ====================
export const state = {
  connection: { status: 'disconnected', uri: 'mongodb://localhost:27017', dbName: '' },
  databases: [],        // [{name, sizeOnDisk, empty}]
  currentDb: '',
  collections: [],      // [{name, documentCount, size, avgObjSize, indexes}]
  currentCollection: '',
  documents: { data: [], total: 0, page: 1, pageSize: 20, filter: {}, sort: { _id: -1 }, projection: {} },
  indexes: [],
  activeTab: 'documents',
  queryHistory: [],
};

// 查询历史持久化
try {
  const saved = localStorage.getItem('mongo_qh');
  if (saved) state.queryHistory = JSON.parse(saved);
} catch { /* ignore */ }

function saveHistory() {
  try { localStorage.setItem('mongo_qh', JSON.stringify(state.queryHistory.slice(0, 50))); } catch { /* ignore */ }
}

export function addQueryHistory(entry) {
  state.queryHistory.unshift({ ...entry, time: Date.now() });
  if (state.queryHistory.length > 50) state.queryHistory.length = 50;
  saveHistory();
  emit('historyChanged');
}

// ==================== API 调用（通过 DoveSDK） ====================

/**
 * 调用 MongoDB 扩展工具（通过 DoveSDK，零轮询）
 *
 * DoveSDK.callTool() 自动处理：
 * - 认证（token 自动管理）
 * - 优先同步执行（/exec 毫秒级返回）
 * - 异步回退时走 SSE 推送（零轮询）
 * - 结果解包
 */
export async function callMongoTool(toolName, args = {}) {
  try {
    const result = await DoveSDK.callTool(toolName, args, { extension: 'MongoDB' });
    if (!result.success) return { success: false, error: result.error || '工具调用失败' };
    return { success: true, data: result.data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 通过 AI 对话执行（dangerous 级别工具）
 */
export async function chatWithAI(message) {
  try {
    await DoveSDK.cmd('chat send', { message });
  } catch { /* ignore */ }
}

// ==================== 解析工具 ====================
export function parseResult(data) {
  if (data?.content?.[0]?.text) {
    try { return JSON.parse(data.content[0].text); } catch { return data.content[0].text; }
  }
  return data;
}

export function formatSize(bytes) {
  if (bytes == null) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

export function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function truncate(s, n = 80) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('zh-CN');
}

export function bsonType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (v instanceof Date || (v && v.$date)) return 'date';
  if (v && v.$oid) return 'objectId';
  if (v && v.$numberLong) return 'long';
  if (v && v.$binary) return 'binary';
  return typeof v;
}

export function displayValue(v, maxLen = 80) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'object') {
    try { return truncate(JSON.stringify(v), maxLen); } catch { return String(v); }
  }
  return truncate(String(v), maxLen);
}

// ==================== 确认对话框 ====================
export function confirmAction(title, message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <h3>${title}</h3>
        <p>${message}</p>
        <div class="confirm-actions">
          <button class="btn btn-outline" data-action="cancel">取消</button>
          <button class="btn btn-danger" data-action="confirm">确认执行</button>
        </div>
      </div>`;
    overlay.addEventListener('click', e => {
      const action = e.target.dataset.action;
      if (action) { document.body.removeChild(overlay); resolve(action === 'confirm'); }
    });
    document.body.appendChild(overlay);
  });
}

// ==================== 通知 ====================
export function notify(type, message) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  const container = document.getElementById('toasts');
  if (container) container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}
