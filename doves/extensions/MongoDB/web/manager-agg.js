/**
 * MongoDB 管理器 - 聚合管道
 * 阶段构建器 / 预览 / 常用模板
 */
import { state, callMongoTool, parseResult, notify, addQueryHistory, escapeHtml } from './manager-core.js';

let stages = [{ operator: '$match', body: '{}' }];

// ==================== 初始化 ====================
export function initAgg() {
  window._mongoAgg = { execute, addStage, removeStage, updateStage, applyTemplate, resetPipeline };
}

// ==================== 渲染聚合面板 ====================
export function renderAggPanel() {
  const el = document.getElementById('tabContent');
  if (!el) return;
  el.innerHTML = `
    <div style="padding:16px;display:flex;flex-direction:column;height:100%">
      <div class="toolbar" style="padding:0 0 12px 0;border:none">
        <span style="font-size:14px;font-weight:600">${state.currentCollection} — 聚合管道</span>
        <div class="toolbar-right">
          <select id="aggTemplate" onchange="window._mongoAgg.applyTemplate(this.value)" style="padding:4px 8px;border:1px solid #ddd;border-radius:4px;font-size:12px">
            <option value="">常用模板...</option>
            <option value="groupBy">分组统计</option>
            <option value="topN">Top N</option>
            <option value="dateGroup">按日期分组</option>
            <option value="lookup">关联查询</option>
            <option value="unwind">数组展开</option>
            <option value="facet">多面聚合</option>
          </select>
          <button class="btn btn-sm btn-outline" onclick="window._mongoAgg.addStage()">➕ 添加阶段</button>
          <button class="btn btn-sm btn-primary" onclick="window._mongoAgg.execute()">▶️ 执行</button>
        </div>
      </div>
      <div id="aggStages" style="flex:1;overflow-y:auto"></div>
      <div style="margin-top:12px">
        <div style="font-size:12px;color:#888;margin-bottom:4px">执行结果</div>
        <div id="aggResult" class="result-json" style="max-height:250px">执行聚合后结果将显示在这里</div>
      </div>
    </div>`;
  renderStages();
}

function renderStages() {
  const container = document.getElementById('aggStages');
  if (!container) return;
  if (!stages.length) {
    container.innerHTML = '<div class="empty">暂无阶段，点击"添加阶段"开始</div>';
    return;
  }
  let html = '<div class="agg-stages">';
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    html += `<div class="agg-stage">
      <div class="agg-stage-header">
        <span style="color:#888">#${i + 1}</span>
        <select onchange="window._mongoAgg.updateStage(${i},'operator',this.value)" style="padding:3px 6px;border:1px solid #ddd;border-radius:4px;font-size:12px">
          ${['$match','$group','$sort','$limit','$skip','$project','$unwind','$lookup','$addFields','$count','$bucket','$facet','$out','$merge'].map(op =>
            `<option value="${op}" ${s.operator === op ? 'selected' : ''}>${op}</option>`
          ).join('')}
        </select>
        <span class="stage-name">${s.operator}</span>
        <div style="margin-left:auto;display:flex;gap:4px">
          ${i > 0 ? `<button class="btn-icon" onclick="window._mongoAgg.removeStage(${i})" title="删除">✕</button>` : ''}
        </div>
      </div>
      <div class="agg-stage-body">
        <textarea id="aggBody${i}" onchange="window._mongoAgg.updateStage(${i},'body',this.value)" placeholder='{}'>${escapeHtml(s.body)}</textarea>
      </div>
    </div>`;
  }
  html += '</div>';
  container.innerHTML = html;
}

// ==================== 阶段操作 ====================
export function addStage() {
  stages.push({ operator: '$match', body: '{}' });
  renderStages();
}

export function removeStage(idx) {
  stages.splice(idx, 1);
  renderStages();
}

export function updateStage(idx, field, value) {
  if (stages[idx]) {
    stages[idx][field] = value;
  }
}

export function resetPipeline() {
  stages = [{ operator: '$match', body: '{}' }];
  renderStages();
}

// ==================== 执行聚合 ====================
export async function execute() {
  if (!state.currentCollection) { notify('warning', '请先选择集合'); return; }
  const resultEl = document.getElementById('aggResult');
  // 构建 pipeline
  const pipeline = [];
  for (let i = 0; i < stages.length; i++) {
    // 从 DOM 获取最新值（onchange 可能还没触发）
    const bodyEl = document.getElementById(`aggBody${i}`);
    const body = bodyEl?.value ?? stages[i].body;
    try {
      const parsed = JSON.parse(body);
      pipeline.push({ [stages[i].operator]: parsed });
    } catch (e) {
      notify('error', `阶段 #${i + 1} JSON 解析失败: ${e.message}`);
      return;
    }
  }
  if (!pipeline.length) { notify('warning', '请添加至少一个阶段'); return; }
  resultEl.textContent = '⏳ 执行中...';
  addQueryHistory({ collection: state.currentCollection, filter: JSON.stringify(pipeline), type: 'aggregate' });
  const result = await callMongoTool('mongo_aggregate', { collection: state.currentCollection, pipeline });
  if (result.success) {
    const d = parseResult(result.data);
    const results = d.results || d.data || (Array.isArray(d) ? d : []);
    resultEl.textContent = JSON.stringify(results, null, 2);
    notify('success', `聚合完成: ${results.length} 条结果`);
  } else {
    resultEl.textContent = `❌ ${result.error}`;
    notify('error', '聚合执行失败');
  }
}

// ==================== 模板 ====================
export function applyTemplate(name) {
  const templates = {
    groupBy: [
      { operator: '$group', body: '{"_id": "$FIELD", "count": {"$sum": 1}}' },
    ],
    topN: [
      { operator: '$sort', body: '{"FIELD": -1}' },
      { operator: '$limit', body: '10' },
    ],
    dateGroup: [
      { operator: '$match', body: '{}' },
      { operator: '$group', body: '{"_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$createdAt"}}, "count": {"$sum": 1}}' },
    ],
    lookup: [
      { operator: '$lookup', body: '{"from": "OTHER_COLLECTION", "localField": "field", "foreignField": "_id", "as": "joined"}' },
      { operator: '$unwind', body: '"$joined"' },
    ],
    unwind: [
      { operator: '$unwind', body: '"$ARRAY_FIELD"' },
    ],
    facet: [
      { operator: '$facet', body: '{"byStatus": [{"$group": {"_id": "$status", "count": {"$sum": 1}}}], "total": [{"$count": "total"}]}' },
    ],
  };
  const tpl = templates[name];
  if (!tpl) return;
  stages = tpl.map(s => ({ ...s }));
  renderStages();
  notify('info', `已应用模板: ${name}`);
  // 重置 select
  const sel = document.getElementById('aggTemplate');
  if (sel) sel.value = '';
}
