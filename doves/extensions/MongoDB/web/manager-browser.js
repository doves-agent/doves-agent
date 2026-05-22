/**
 * MongoDB 管理器 - 文档浏览器
 * 表格视图 / JSON 视图 / 分页 / 排序 / 过滤
 */
import { state, callMongoTool, parseResult, emit, on, notify, escapeHtml, truncate, bsonType, displayValue, formatDate } from './manager-core.js';

let viewMode = 'table'; // table | json

// ==================== 初始化 ====================
export function initBrowser() {
  on('collectionChanged', () => loadDocuments());
}

// ==================== 加载文档 ====================
export async function loadDocuments() {
  if (!state.currentCollection) return;
  const wrap = document.getElementById('docTableWrap');
  const jsonView = document.getElementById('docJsonView');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading-center"><span class="loading loading-lg"></span>加载文档...</div>';
  if (jsonView) jsonView.innerHTML = '';
  const { page, pageSize, filter, sort, projection } = state.documents;
  const skip = (page - 1) * pageSize;
  // 先获取总数
  const countResult = await callMongoTool('mongo_count_documents', { collection: state.currentCollection, query: filter });
  let total = 0;
  if (countResult.success) {
    const cd = parseResult(countResult.data);
    total = cd.count ?? 0;
  }
  state.documents.total = total;
  // 获取数据
  const findResult = await callMongoTool('mongo_find', {
    collection: state.currentCollection, query: filter,
    options: { limit: pageSize, skip, sort, projection },
  });
  if (!findResult.success) {
    wrap.innerHTML = `<div class="empty"><div class="icon">❌</div><p>加载失败: ${findResult.error}</p></div>`;
    return;
  }
  const d = parseResult(findResult.data);
  const docs = d.data || d.documents || (Array.isArray(d) ? d : []);
  state.documents.data = docs;
  renderDocuments(docs);
  renderPagination();
  // 更新集合统计
  emit('docCountUpdated', { collection: state.currentCollection, total });
}

// ==================== 渲染文档 ====================
function renderDocuments(docs) {
  if (viewMode === 'table') {
    renderTableView(docs);
    document.getElementById('docTableWrap').style.display = '';
    document.getElementById('docJsonView').style.display = 'none';
  } else {
    renderJsonView(docs);
    document.getElementById('docTableWrap').style.display = 'none';
    document.getElementById('docJsonView').style.display = '';
  }
}

function renderTableView(docs) {
  const wrap = document.getElementById('docTableWrap');
  if (!docs.length) {
    wrap.innerHTML = '<div class="empty"><div class="icon">📭</div><p>该集合无文档</p></div>';
    return;
  }
  // 提取列（前 20 个文档的字段合集，_id 放最前）
  const keySet = new Set();
  for (const doc of docs.slice(0, 20)) {
    if (doc && typeof doc === 'object') Object.keys(doc).forEach(k => keySet.add(k));
  }
  const keys = ['_id', ...[...keySet].filter(k => k !== '_id')].slice(0, 15); // 最多 15 列

  let html = '<table class="doc-table"><thead><tr>';
  for (const k of keys) {
    const sortDir = state.documents.sort?.[k];
    const sortIcon = sortDir === 1 ? ' ▲' : sortDir === -1 ? ' ▼' : '';
    html += `<th onclick="window._mongoBrowser.sortBy('${k}')">${k}<span class="sort-icon">${sortIcon}</span></th>`;
  }
  html += '<th style="width:60px"></th></tr></thead><tbody>';
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const docId = doc._id ? String(doc._id?.$oid || doc._id) : `idx_${i}`;
    html += `<tr ondblclick="window._mongoEditor.open('${i}')">`;
    for (const k of keys) {
      const v = doc[k];
      html += `<td class="${cellClass(v)}" title="${escapeHtml(displayValue(v, 200))}">${cellDisplay(v)}</td>`;
    }
    html += `<td><button class="btn-icon" onclick="event.stopPropagation();window._mongoEditor.open('${i}')" title="编辑">✏️</button></td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function renderJsonView(docs) {
  const el = document.getElementById('docJsonView');
  if (!docs.length) {
    el.innerHTML = '<div class="empty"><div class="icon">📭</div><p>该集合无文档</p></div>';
    return;
  }
  let html = '';
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const json = JSON.stringify(doc, null, 2);
    html += `<div class="doc-json-item" ondblclick="window._mongoEditor.open('${i}')"><pre>${escapeHtml(json)}</pre></div>`;
  }
  el.innerHTML = html;
}

function cellClass(v) {
  const t = bsonType(v);
  if (t === 'null' || t === 'undefined') return 'col-null';
  if (t === 'objectId') return 'col-id';
  if (t === 'object') return 'col-obj';
  if (t === 'array') return 'col-arr';
  if (t === 'date') return 'col-date';
  return '';
}

function cellDisplay(v) {
  const t = bsonType(v);
  if (v === null) return 'null';
  if (v === undefined) return '—';
  if (t === 'objectId') return String(v.$oid || v);
  if (t === 'date') return formatDate(v instanceof Date ? v : (v?.$date ? new Date(v.$date) : v));
  if (t === 'array') return `[${v.length}]`;
  if (t === 'object') return truncate(JSON.stringify(v), 60);
  return escapeHtml(truncate(String(v), 60));
}

// ==================== 分页 ====================
function renderPagination() {
  const el = document.getElementById('pagination');
  if (!el) return;
  const { total, page, pageSize } = state.documents;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  let html = `<span>${total} 条文档，${start}-${end} / ${total}</span>`;
  html += '<div class="page-btns">';
  html += `<button class="page-btn" onclick="window._mongoBrowser.goPage(1)" ${page <= 1 ? 'disabled' : ''}>⏮</button>`;
  html += `<button class="page-btn" onclick="window._mongoBrowser.goPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>◀</button>`;
  // 页码
  const startPage = Math.max(1, page - 2);
  const endPage = Math.min(totalPages, page + 2);
  for (let p = startPage; p <= endPage; p++) {
    html += `<button class="page-btn ${p === page ? 'active' : ''}" onclick="window._mongoBrowser.goPage(${p})">${p}</button>`;
  }
  html += `<button class="page-btn" onclick="window._mongoBrowser.goPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>▶</button>`;
  html += `<button class="page-btn" onclick="window._mongoBrowser.goPage(${totalPages})" ${page >= totalPages ? 'disabled' : ''}>⏭</button>`;
  html += '</div>';
  html += `<select onchange="window._mongoBrowser.setPageSize(this.value)" style="padding:4px 8px;border:1px solid #ddd;border-radius:4px;font-size:12px">
    <option value="10" ${pageSize === 10 ? 'selected' : ''}>10条/页</option>
    <option value="20" ${pageSize === 20 ? 'selected' : ''}>20条/页</option>
    <option value="50" ${pageSize === 50 ? 'selected' : ''}>50条/页</option>
    <option value="100" ${pageSize === 100 ? 'selected' : ''}>100条/页</option>
  </select>`;
  el.innerHTML = html;
}

// ==================== 交互 ====================
export function sortBy(key) {
  const current = state.documents.sort?.[key];
  state.documents.sort = { [key]: current === 1 ? -1 : 1 };
  state.documents.page = 1;
  loadDocuments();
}

export function goPage(p) {
  const totalPages = Math.max(1, Math.ceil(state.documents.total / state.documents.pageSize));
  if (p < 1 || p > totalPages) return;
  state.documents.page = p;
  loadDocuments();
}

export function setPageSize(size) {
  state.documents.pageSize = parseInt(size) || 20;
  state.documents.page = 1;
  loadDocuments();
}

export function setFilter(filterStr) {
  try {
    state.documents.filter = filterStr.trim() ? JSON.parse(filterStr) : {};
    state.documents.page = 1;
    loadDocuments();
  } catch (e) {
    notify('error', `查询语法错误: ${e.message}`);
  }
}

export function setViewMode(mode) {
  viewMode = mode;
  if (state.documents.data.length > 0) {
    renderDocuments(state.documents.data);
  }
}

export function getViewMode() { return viewMode; }

// 暴露到 window
window._mongoBrowser = { sortBy, goPage, setPageSize, setFilter, setViewMode };
