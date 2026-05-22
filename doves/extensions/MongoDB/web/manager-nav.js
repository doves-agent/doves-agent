/**
 * MongoDB 管理器 - 左侧导航树
 * 连接管理 + 数据库/集合树 + 交互
 */
import { state, callMongoTool, parseResult, emit, on, formatSize, notify } from './manager-core.js';

// ==================== 初始化 ====================
export function initNav() {
  renderConnForm();
  bindEvents();
  // 监听外部连接变化
  on('connected', () => loadDatabases());
  on('disconnected', () => { state.databases = []; state.collections = []; renderTree(); });
}

// ==================== 连接表单 ====================
function renderConnForm() {
  const el = document.getElementById('connSection');
  if (!el) return;
  el.innerHTML = `
    <label>连接地址</label>
    <input type="text" id="connUri" placeholder="mongodb://localhost:27017" value="${state.connection.uri}">
    <label>数据库</label>
    <input type="text" id="connDb" placeholder="数据库名（可选）" value="${state.connection.dbName}">
    <div class="conn-btns">
      <button class="btn-conn connect" onclick="window._mongoNav.connect()">连接</button>
      <button class="btn-conn test" onclick="window._mongoNav.testConn()">测试</button>
    </div>
    <div class="conn-status" id="connStatus"><span class="dot wait"></span>未连接</div>`;
}

function bindEvents() {
  // 暴露到 window 供 onclick 调用（模块作用域限制）
  window._mongoNav = { connect, testConn, selectDb, selectCollection, refreshTree, createCollection };
}

// ==================== 连接操作 ====================
async function connect() {
  const uri = document.getElementById('connUri')?.value?.trim();
  const db = document.getElementById('connDb')?.value?.trim();
  if (!uri) { notify('error', '请输入连接地址'); return; }
  setConnStatus('wait', '连接中...');
  state.connection.uri = uri;
  state.connection.dbName = db;
  const result = await callMongoTool('mongo_connect', { action: 'config', connectionString: uri, dbName: db || 'admin' });
  if (result.success) {
    state.connection.status = 'connected';
    const d = parseResult(result.data);
    setConnStatus('ok', `已连接${db ? ' → ' + db : ''}`);
    notify('success', 'MongoDB 连接成功');
    emit('connected');
  } else {
    state.connection.status = 'disconnected';
    setConnStatus('err', '连接失败');
    notify('error', `连接失败: ${result.error}`);
  }
}

async function testConn() {
  setConnStatus('wait', '测试中...');
  const result = await callMongoTool('mongo_connect', { action: 'test' });
  if (result.success) {
    setConnStatus('ok', '测试通过');
    notify('success', '连接测试通过');
  } else {
    setConnStatus('err', '测试失败');
    notify('error', `测试失败: ${result.error}`);
  }
}

function setConnStatus(type, text) {
  const el = document.getElementById('connStatus');
  if (!el) return;
  el.innerHTML = `<span class="dot ${type}"></span>${text}`;
}

// ==================== 加载数据库 ====================
async function loadDatabases() {
  const tree = document.getElementById('dbTree');
  if (!tree) return;
  tree.innerHTML = '<div class="tree-empty"><span class="loading"></span> 加载中...</div>';
  // 用 mongo_connect status 获取当前连接信息
  const statusResult = await callMongoTool('mongo_connect', { action: 'status' });
  if (!statusResult.success) {
    tree.innerHTML = '<div class="tree-empty">获取状态失败</div>';
    return;
  }
  const statusData = parseResult(statusResult.data);
  // 如果有指定 db，只展示该 db
  if (state.connection.dbName) {
    state.currentDb = state.connection.dbName;
    await loadCollections(state.connection.dbName);
    return;
  }
  // 否则尝试列出所有数据库 (mongo_list_collections 对当前 db)
  const listResult = await callMongoTool('mongo_list_collections', { detailed: true });
  if (listResult.success) {
    const d = parseResult(listResult.data);
    const cols = d.collections || [];
    state.databases = [{ name: statusData.dbName || 'default', collections: cols }];
    state.currentDb = state.databases[0].name;
    renderTree();
  } else {
    tree.innerHTML = '<div class="tree-empty">加载失败</div>';
  }
}

async function loadCollections(dbName) {
  const tree = document.getElementById('dbTree');
  if (!tree) return;
  tree.innerHTML = '<div class="tree-empty"><span class="loading"></span> 加载集合...</div>';
  const result = await callMongoTool('mongo_list_collections', { detailed: true });
  if (result.success) {
    const d = parseResult(result.data);
    const cols = (d.collections || []).map(c => ({
      name: c.name,
      documentCount: c.documentCount || 0,
      size: c.storageSize || 0,
    }));
    state.databases = [{ name: dbName, collections: cols }];
    state.currentDb = dbName;
    renderTree();
  } else {
    tree.innerHTML = `<div class="tree-empty">加载失败: ${result.error}</div>`;
  }
}

// ==================== 渲染树 ====================
function renderTree() {
  const tree = document.getElementById('dbTree');
  if (!tree) return;
  if (state.databases.length === 0) {
    tree.innerHTML = '<div class="tree-empty">暂无数据，请连接数据库</div>';
    return;
  }
  let html = '';
  for (const db of state.databases) {
    const isOpen = state.currentDb === db.name;
    html += `<div class="tree-item tree-db ${isOpen ? 'active' : ''}" onclick="window._mongoNav.selectDb('${db.name}')">
      <span class="arrow ${isOpen ? 'open' : ''}">▶</span>
      <span class="icon">🗄️</span>
      <span class="name">${db.name}</span>
    </div>`;
    if (isOpen && db.collections) {
      for (const col of db.collections) {
        const isActive = state.currentCollection === col.name;
        html += `<div class="tree-item tree-col ${isActive ? 'active' : ''}" onclick="window._mongoNav.selectCollection('${col.name}')">
          <span class="icon">📂</span>
          <span class="name">${col.name}</span>
          <span class="badge">${col.documentCount ?? '?'}</span>
        </div>`;
      }
    }
  }
  html += `<div class="tree-actions"><button class="btn-tree-action" onclick="window._mongoNav.refreshTree()">🔄 刷新</button></div>`;
  html += `<div class="tree-actions"><button class="btn-tree-action" onclick="window._mongoNav.createCollection()">➕ 新建集合</button></div>`;
  tree.innerHTML = html;
}

// ==================== 交互 ====================
function selectDb(dbName) {
  if (state.currentDb === dbName) return; // 已选中，不重复加载
  state.currentDb = dbName;
  state.currentCollection = '';
  state.collections = [];
  emit('dbChanged', dbName);
  loadCollections(dbName);
}

async function selectCollection(colName) {
  if (state.currentCollection === colName) return;
  state.currentCollection = colName;
  state.documents = { data: [], total: 0, page: 1, pageSize: 20, filter: {}, sort: { _id: -1 }, projection: {} };
  emit('collectionChanged', colName);
  renderTree();
}

async function refreshTree() {
  await loadDatabases();
  notify('info', '已刷新');
}

async function createCollection() {
  const name = prompt('请输入新集合名称:');
  if (!name || !name.trim()) return;
  // 通过 insert_one 创建一个空文档然后删除来创建集合，或使用 AI
  // 实际上 MongoDB 会自动创建集合，我们用 insert + delete 方式
  const result = await callMongoTool('mongo_insert_one', { collection: name.trim(), document: { _created: true } });
  if (result.success) {
    // 立即删除临时文档
    await callMongoTool('mongo_delete_one', { collection: name.trim(), query: { _created: true } });
    notify('success', `集合 ${name.trim()} 已创建`);
    await loadCollections(state.currentDb);
  } else {
    notify('error', `创建失败: ${result.error}`);
  }
}
