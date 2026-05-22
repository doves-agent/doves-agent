/**
 * MongoDB 管理器 - 查询面板
 * 结构化查询 / 自然语言查询 / 查询历史 / Explain
 */
import { state, callMongoTool, parseResult, emit, on, notify, addQueryHistory, escapeHtml } from './manager-core.js';

// ==================== 初始化 ====================
export function initQuery() {
  window._mongoQuery = { execute, executeCount, executeDistinct, executeExplain, useHistory, clearHistory };
}

// ==================== 渲染查询面板 ====================
export function renderQueryPanel() {
  const el = document.getElementById('tabContent');
  if (!el) return;
  const historyHtml = state.queryHistory.slice(0, 10).map((h, i) =>
    `<div class="history-item" onclick="window._mongoQuery.useHistory(${i})">
      <div class="time">${new Date(h.time).toLocaleString('zh-CN')}</div>
      ${escapeHtml(trunc(h.filter || h.query || '', 80))}
    </div>`
  ).join('');

  el.innerHTML = `
    <div style="padding:16px;display:flex;gap:16px;height:100%">
      <!-- 左侧：查询构建 -->
      <div style="flex:1;display:flex;flex-direction:column;gap:12px">
        <div class="form-group">
          <label>查询条件 (filter)</label>
          <textarea id="qFilter" rows="4" placeholder='{"status": "active", "age": {"$gt": 25}}'>{}</textarea>
        </div>
        <div class="form-row">
          <div class="form-group"><label>排序 (sort)</label><input id="qSort" placeholder='{"createdAt": -1}' value='{"_id": -1}'></div>
          <div class="form-group"><label>字段 (projection)</label><input id="qProj" placeholder='{"name": 1, "email": 1}'></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>跳过 (skip)</label><input type="number" id="qSkip" value="0" min="0"></div>
          <div class="form-group"><label>限制 (limit)</label><input type="number" id="qLimit" value="20" min="1" max="1000"></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="window._mongoQuery.execute()">🔍 查询</button>
          <button class="btn btn-outline" onclick="window._mongoQuery.executeCount()">🔢 计数</button>
          <button class="btn btn-outline" onclick="window._mongoQuery.executeDistinct()">🏷️ 去重</button>
          <button class="btn btn-outline" onclick="window._mongoQuery.executeExplain()">📊 Explain</button>
        </div>
        <div id="queryResult" class="result-json" style="flex:1;min-height:200px">执行查询后结果将显示在这里</div>
      </div>
      <!-- 右侧：历史 -->
      <div style="width:240px;border-left:1px solid #eee;padding-left:16px;display:flex;flex-direction:column">
        <div style="font-size:12px;font-weight:600;color:#888;margin-bottom:8px;text-transform:uppercase">查询历史</div>
        <div class="history-list" id="queryHistory">${historyHtml || '<div class="empty" style="padding:10px;font-size:12px">暂无历史</div>'}</div>
        <button class="btn btn-sm btn-outline" style="margin-top:8px" onclick="window._mongoQuery.clearHistory()">清空历史</button>
      </div>
    </div>`;
}

// ==================== 执行查询 ====================
export async function execute() {
  if (!state.currentCollection) { notify('warning', '请先选择集合'); return; }
  const filterStr = document.getElementById('qFilter')?.value?.trim() || '{}';
  const sortStr = document.getElementById('qSort')?.value?.trim();
  const projStr = document.getElementById('qProj')?.value?.trim();
  const skip = parseInt(document.getElementById('qSkip')?.value) || 0;
  const limit = parseInt(document.getElementById('qLimit')?.value) || 20;
  const resultEl = document.getElementById('queryResult');

  try {
    const query = JSON.parse(filterStr);
    const options = { limit, skip };
    if (sortStr) options.sort = JSON.parse(sortStr);
    if (projStr) options.projection = JSON.parse(projStr);

    addQueryHistory({ collection: state.currentCollection, filter: filterStr, type: 'find' });
    resultEl.textContent = '⏳ 执行中...';

    const result = await callMongoTool('mongo_find', { collection: state.currentCollection, query, options });
    if (result.success) {
      const d = parseResult(result.data);
      const docs = d.data || d.documents || (Array.isArray(d) ? d : []);
      resultEl.textContent = JSON.stringify(docs, null, 2);
      notify('success', `查询完成: ${docs.length} 条`);
    } else {
      resultEl.textContent = `❌ ${result.error}`;
      notify('error', '查询失败');
    }
  } catch (e) {
    resultEl.textContent = `❌ 参数错误: ${e.message}`;
    notify('error', `参数错误: ${e.message}`);
  }
}

export async function executeCount() {
  if (!state.currentCollection) { notify('warning', '请先选择集合'); return; }
  const filterStr = document.getElementById('qFilter')?.value?.trim() || '{}';
  const resultEl = document.getElementById('queryResult');
  try {
    const query = JSON.parse(filterStr);
    addQueryHistory({ collection: state.currentCollection, filter: filterStr, type: 'count' });
    const result = await callMongoTool('mongo_count_documents', { collection: state.currentCollection, query });
    if (result.success) {
      const d = parseResult(result.data);
      resultEl.textContent = JSON.stringify(d, null, 2);
      notify('success', `文档数量: ${d.count}`);
    } else {
      resultEl.textContent = `❌ ${result.error}`;
    }
  } catch (e) { resultEl.textContent = `❌ ${e.message}`; }
}

export async function executeDistinct() {
  if (!state.currentCollection) { notify('warning', '请先选择集合'); return; }
  const field = prompt('请输入要去重的字段名:');
  if (!field) return;
  const filterStr = document.getElementById('qFilter')?.value?.trim() || '{}';
  const resultEl = document.getElementById('queryResult');
  try {
    const query = JSON.parse(filterStr);
    addQueryHistory({ collection: state.currentCollection, filter: filterStr, type: 'distinct', field });
    const result = await callMongoTool('mongo_distinct', { collection: state.currentCollection, field, query });
    if (result.success) {
      const d = parseResult(result.data);
      resultEl.textContent = JSON.stringify(d, null, 2);
      notify('success', `${field} 去重值: ${(d.values || []).length} 个`);
    } else {
      resultEl.textContent = `❌ ${result.error}`;
    }
  } catch (e) { resultEl.textContent = `❌ ${e.message}`; }
}

export async function executeExplain() {
  if (!state.currentCollection) { notify('warning', '请先选择集合'); return; }
  const filterStr = document.getElementById('qFilter')?.value?.trim() || '{}';
  const resultEl = document.getElementById('queryResult');
  try {
    const query = JSON.parse(filterStr);
    const sortStr = document.getElementById('qSort')?.value?.trim();
    const options = { limit: 1 };
    if (sortStr) options.sort = JSON.parse(sortStr);
    addQueryHistory({ collection: state.currentCollection, filter: filterStr, type: 'explain' });
    const result = await callMongoTool('mongo_find', { collection: state.currentCollection, query, options, explain: true });
    if (result.success) {
      const d = parseResult(result.data);
      resultEl.textContent = JSON.stringify(d, null, 2);
      notify('success', 'Explain 完成');
    } else {
      resultEl.textContent = `❌ ${result.error}`;
    }
  } catch (e) { resultEl.textContent = `❌ ${e.message}`; }
}

// ==================== 历史 ====================
export function useHistory(idx) {
  const h = state.queryHistory[idx];
  if (!h) return;
  const filterEl = document.getElementById('qFilter');
  if (filterEl && h.filter) filterEl.value = h.filter;
  notify('info', '已加载历史查询');
}

export function clearHistory() {
  state.queryHistory = [];
  try { localStorage.removeItem('mongo_qh'); } catch { /* ignore */ }
  const el = document.getElementById('queryHistory');
  if (el) el.innerHTML = '<div class="empty" style="padding:10px;font-size:12px">暂无历史</div>';
  notify('info', '已清空查询历史');
}

function trunc(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
