/**
 * MongoDB 管理器 - 索引管理
 * 索引列表 / 创建索引 / 删除索引 / 统计信息
 */
import { state, callMongoTool, parseResult, chatWithAI, notify, confirmAction, escapeHtml, formatSize } from './manager-core.js';

// ==================== 初始化 ====================
export function initIndexes() {
  window._mongoIndexes = { loadIndexes, createIndex, dropIndex, showStats };
}

// ==================== 渲染索引面板 ====================
export function renderIndexPanel() {
  const el = document.getElementById('tabContent');
  if (!el) return;
  el.innerHTML = `
    <div style="padding:16px">
      <div class="toolbar" style="padding:0 0 12px 0;border:none">
        <span style="font-size:14px;font-weight:600">${state.currentCollection} — 索引管理</span>
        <div class="toolbar-right">
          <button class="btn btn-sm btn-primary" onclick="window._mongoIndexes.loadIndexes()">🔄 刷新</button>
          <button class="btn btn-sm btn-outline" onclick="window._mongoIndexes.showStats()">📊 集合统计</button>
        </div>
      </div>
      <div id="indexListArea"><div class="empty">点击"刷新"加载索引列表</div></div>
      <hr style="margin:20px 0;border:none;border-top:1px solid #eee">
      <h4 style="font-size:14px;margin-bottom:12px">➕ 创建索引</h4>
      <div class="form-group">
        <label>索引键 (keys)</label>
        <textarea id="idxKeys" rows="2" placeholder='{"fieldName": 1} 或 {"field1": 1, "field2": -1}'></textarea>
      </div>
      <div class="form-row">
        <div class="form-group"><label>索引名称</label><input id="idxName" placeholder="自动生成（可选）"></div>
      </div>
      <div style="display:flex;gap:16px;margin-bottom:12px">
        <label class="form-check"><input type="checkbox" id="idxUnique"> 唯一索引</label>
        <label class="form-check"><input type="checkbox" id="idxSparse"> 稀疏索引</label>
      </div>
      <button class="btn btn-success" onclick="window._mongoIndexes.createIndex()">➕ 创建索引</button>
    </div>`;
  // 自动加载
  loadIndexes();
}

// ==================== 加载索引 ====================
export async function loadIndexes() {
  if (!state.currentCollection) return;
  const area = document.getElementById('indexListArea');
  if (!area) return;
  area.innerHTML = '<div class="loading-center"><span class="loading"></span> 加载索引...</div>';
  const result = await callMongoTool('mongo_list_indexes', { collection: state.currentCollection });
  if (!result.success) {
    area.innerHTML = `<div class="empty">加载失败: ${result.error}</div>`;
    return;
  }
  const d = parseResult(result.data);
  const indexes = d.indexes || [];
  state.indexes = indexes;
  if (!indexes.length) {
    area.innerHTML = '<div class="empty">该集合无索引</div>';
    return;
  }
  let html = '<table class="idx-table"><thead><tr><th>名称</th><th>键</th><th>属性</th><th>大小</th><th>操作</th></tr></thead><tbody>';
  for (const ix of indexes) {
    const isDefault = ix.name === '_id_';
    const keys = JSON.stringify(ix.key || {});
    const badges = [];
    if (ix.unique) badges.push('<span class="badge badge-green">唯一</span>');
    if (ix.sparse) badges.push('<span class="badge badge-yellow">稀疏</span>');
    if (isDefault) badges.push('<span class="badge badge-blue">默认</span>');
    if (ix.background) badges.push('<span class="badge badge-blue">后台</span>');
    const dropBtn = isDefault ? '' : `<button class="btn btn-danger btn-sm" onclick="window._mongoIndexes.dropIndex('${ix.name}')">删除</button>`;
    html += `<tr>
      <td style="font-family:Consolas,monospace;font-weight:600">${escapeHtml(ix.name)}</td>
      <td style="font-family:Consolas,monospace;font-size:12px">${escapeHtml(keys)}</td>
      <td>${badges.join(' ') || '-'}</td>
      <td>${ix.size ? formatSize(ix.size) : '-'}</td>
      <td>${dropBtn}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  area.innerHTML = html;
}

// ==================== 创建索引 ====================
export async function createIndex() {
  if (!state.currentCollection) { notify('warning', '请先选择集合'); return; }
  const keysStr = document.getElementById('idxKeys')?.value?.trim();
  if (!keysStr) { notify('error', '请输入索引键'); return; }
  try {
    const keys = JSON.parse(keysStr);
    const options = {};
    const name = document.getElementById('idxName')?.value?.trim();
    if (name) options.name = name;
    if (document.getElementById('idxUnique')?.checked) options.unique = true;
    if (document.getElementById('idxSparse')?.checked) options.sparse = true;
    options.background = true;
    const result = await callMongoTool('mongo_create_index', { collection: state.currentCollection, keys, options });
    if (result.success) {
      const d = parseResult(result.data);
      notify('success', `索引创建成功: ${d.indexName || '已创建'}`);
      loadIndexes();
    } else {
      notify('error', `创建失败: ${result.error}`);
    }
  } catch (e) {
    notify('error', `参数错误: ${e.message}`);
  }
}

// ==================== 删除索引 ====================
export async function dropIndex(indexName) {
  if (!state.currentCollection) return;
  const ok = await confirmAction('确认删除索引', `确定要删除索引 <b>${indexName}</b> 吗？此操作不可恢复。`);
  if (!ok) return;
  const result = await callMongoTool('mongo_drop_index', { collection: state.currentCollection, indexName });
  if (result.success) {
    notify('success', `索引 ${indexName} 已删除`);
    loadIndexes();
  } else {
    notify('error', `删除失败: ${result.error}`);
  }
}

// ==================== 集合统计 ====================
export async function showStats() {
  if (!state.currentCollection) return;
  const result = await callMongoTool('mongo_collection_stats', { collection: state.currentCollection });
  if (result.success) {
    const d = parseResult(result.data);
    const area = document.getElementById('indexListArea');
    if (area) {
      area.innerHTML = `
        <div style="background:#f8f9ff;border-radius:8px;padding:16px;margin-bottom:12px">
          <h4 style="margin-bottom:10px">📊 ${state.currentCollection} 统计</h4>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">
            <div><div style="font-size:11px;color:#888">文档数</div><div style="font-size:20px;font-weight:700;color:#00684A">${(d.documentCount ?? d.count ?? 0).toLocaleString()}</div></div>
            <div><div style="font-size:11px;color:#888">存储大小</div><div style="font-size:20px;font-weight:700;color:#00684A">${formatSize(d.storageSize ?? d.size)}</div></div>
            <div><div style="font-size:11px;color:#888">索引数</div><div style="font-size:20px;font-weight:700;color:#00684A">${d.indexes ?? d.nindexes ?? '-'}</div></div>
            <div><div style="font-size:11px;color:#888">平均文档</div><div style="font-size:20px;font-weight:700;color:#00684A">${formatSize(d.avgObjSize ?? d.avgDocumentSize)}</div></div>
          </div>
        </div>` + area.innerHTML;
    }
    notify('success', '统计信息已更新');
  } else {
    notify('error', `获取统计失败: ${result.error}`);
  }
}
