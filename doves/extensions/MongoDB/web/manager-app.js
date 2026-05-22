/**
 * MongoDB 管理器 - 应用入口
 * 初始化所有模块 + 标签页切换 + 全局事件协调
 */
import { state, emit, on, notify, escapeHtml } from './manager-core.js';
import { initNav } from './manager-nav.js';
import { initBrowser, loadDocuments, setFilter, setViewMode, getViewMode } from './manager-browser.js';
import { initEditor } from './manager-editor.js';
import { initQuery, renderQueryPanel } from './manager-query.js';
import { initIndexes, renderIndexPanel } from './manager-indexes.js';
import { initAgg, renderAggPanel } from './manager-agg.js';
import { initSchema, renderSchemaPanel } from './manager-schema.js';
import { initIO, renderIOPanel } from './manager-io.js';

const TABS = [
  { id: 'documents', label: '📄 文档', render: renderDocumentsTab },
  { id: 'query',     label: '🔍 查询', render: renderQueryTab },
  { id: 'aggregate', label: '📊 聚合', render: renderAggTab },
  { id: 'indexes',   label: '📑 索引', render: renderIndexTab },
  { id: 'schema',    label: '🔬 Schema', render: renderSchemaTab },
  { id: 'io',        label: '📦 导入导出', render: renderIOTab },
];

// ==================== 初始化 ====================
export function initApp() {
  initNav();
  initBrowser();
  initEditor();
  initQuery();
  initIndexes();
  initAgg();
  initSchema();
  initIO();
  bindGlobalEvents();
  window._mongoApp = { switchTab, applyFilter };
}

function bindGlobalEvents() {
  on('collectionChanged', colName => {
    document.getElementById('welcome').style.display = 'none';
    document.getElementById('collectionView').style.display = 'flex';
    // 更新面包屑
    const bc = document.getElementById('breadcrumb');
    if (bc) bc.innerHTML = `<span>${state.currentDb}</span><span class="sep">›</span><span class="current">${colName}</span>`;
    // 重置到文档标签
    state.activeTab = 'documents';
    renderTabBar();
    renderDocumentsTab();
  });

  on('dbChanged', () => {
    document.getElementById('welcome').style.display = '';
    document.getElementById('collectionView').style.display = 'none';
  });
}

// ==================== 标签页 ====================
function renderTabBar() {
  const bar = document.getElementById('tabBar');
  if (!bar) return;
  bar.innerHTML = TABS.map(t =>
    `<div class="tab ${state.activeTab === t.id ? 'active' : ''}" onclick="window._mongoApp.switchTab('${t.id}')">${t.label}</div>`
  ).join('');
}

export function switchTab(tabId) {
  state.activeTab = tabId;
  renderTabBar();
  const tab = TABS.find(t => t.id === tabId);
  if (tab) tab.render();
}

function renderDocumentsTab() {
  const content = document.getElementById('tabContent');
  if (!content) return;
  content.innerHTML = `
    <div class="filter-bar" id="filterBar">
      <span style="font-size:12px;color:#888">过滤:</span>
      <input type="text" id="docFilterInput" placeholder='{"status": "active"} (JSON)' value="${filterToStr(state.documents.filter)}" 
        onkeydown="if(event.key==='Enter')window._mongoApp.applyFilter()">
      <button class="btn btn-sm btn-primary" onclick="window._mongoApp.applyFilter()">查询</button>
      <button class="btn btn-sm btn-outline" onclick="document.getElementById('docFilterInput').value='{}';window._mongoApp.applyFilter()">重置</button>
      <div class="toolbar-right">
        <button class="btn-icon" onclick="window._mongoBrowser.setViewMode('table')" title="表格视图" style="${getViewMode() === 'table' ? 'border-color:#00684A;color:#00684A' : ''}">▦</button>
        <button class="btn-icon" onclick="window._mongoBrowser.setViewMode('json')" title="JSON视图" style="${getViewMode() === 'json' ? 'border-color:#00684A;color:#00684A' : ''}">{ }</button>
        <button class="btn btn-sm btn-outline" onclick="window._mongoEditor.createNew()">➕ 新建</button>
        <button class="btn btn-sm btn-outline" onclick="window._mongoBrowser.loadDocuments()">🔄</button>
      </div>
    </div>
    <div class="doc-table-wrap" id="docTableWrap"></div>
    <div class="doc-json-view" id="docJsonView" style="display:none"></div>
    <div class="pagination" id="pagination"></div>`;
  loadDocuments();
}

function renderQueryTab() { renderQueryPanel(); }
function renderAggTab() { renderAggPanel(); }
function renderIndexTab() { renderIndexPanel(); }
function renderSchemaTab() { renderSchemaPanel(); }
function renderIOTab() { renderIOPanel(); }

function applyFilter() {
  const input = document.getElementById('docFilterInput');
  if (input) setFilter(input.value);
}

function filterToStr(filter) {
  if (!filter || Object.keys(filter).length === 0) return '{}';
  return JSON.stringify(filter);
}
