/**
 * MongoDB 管理器 - Schema 分析
 * 自动采样分析字段类型 / 分布 / 采样值
 */
import { state, callMongoTool, parseResult, emit, on, notify, escapeHtml, bsonType, formatSize } from './manager-core.js';

// ==================== 初始化 ====================
export function initSchema() {
  window._mongoSchema = { analyze };
}

// ==================== 渲染 Schema 面板 ====================
export function renderSchemaPanel() {
  const el = document.getElementById('tabContent');
  if (!el) return;
  el.innerHTML = `
    <div style="padding:16px">
      <div class="toolbar" style="padding:0 0 12px 0;border:none">
        <span style="font-size:14px;font-weight:600">${state.currentCollection} — Schema 分析</span>
        <div class="toolbar-right">
          <span style="font-size:12px;color:#888">采样数量:</span>
          <select id="schemaSampleSize" style="padding:4px 8px;border:1px solid #ddd;border-radius:4px;font-size:12px">
            <option value="20">20</option>
            <option value="50" selected>50</option>
            <option value="100">100</option>
            <option value="200">200</option>
          </select>
          <button class="btn btn-sm btn-primary" onclick="window._mongoSchema.analyze()">🔍 分析</button>
        </div>
      </div>
      <div id="schemaResult"><div class="empty"><div class="icon">🔬</div><p>点击"分析"开始 Schema 探测</p></div></div>
    </div>`;
}

// ==================== 执行分析 ====================
export async function analyze() {
  if (!state.currentCollection) { notify('warning', '请先选择集合'); return; }
  const el = document.getElementById('schemaResult');
  const sampleSize = parseInt(document.getElementById('schemaSampleSize')?.value) || 50;
  el.innerHTML = '<div class="loading-center"><span class="loading loading-lg"></span>分析中...</div>';

  // 获取采样数据
  const result = await callMongoTool('mongo_find', {
    collection: state.currentCollection,
    query: {},
    options: { limit: sampleSize, sort: {} },
  });
  if (!result.success) {
    el.innerHTML = `<div class="empty">分析失败: ${result.error}</div>`;
    return;
  }
  const d = parseResult(result.data);
  const docs = d.data || d.documents || (Array.isArray(d) ? d : []);
  if (!docs.length) {
    el.innerHTML = '<div class="empty">该集合无文档，无法分析</div>';
    return;
  }

  // 分析 schema
  const schema = {};
  const totalDocs = docs.length;
  for (const doc of docs) {
    analyzeDoc(doc, schema, '');
  }

  // 渲染结果
  renderSchema(schema, totalDocs, el);
  notify('success', `Schema 分析完成，采样 ${docs.length} 条文档`);
}

function analyzeDoc(doc, schema, prefix) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return;
  for (const [key, val] of Object.entries(doc)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (!schema[fullPath]) {
      schema[fullPath] = { types: {}, count: 0, samples: [] };
    }
    const field = schema[fullPath];
    field.count++;
    const type = bsonType(val);
    field.types[type] = (field.types[type] || 0) + 1;
    // 采样值（最多 5 个不同值）
    const sampleStr = val === null ? 'null' : (typeof val === 'object' ? JSON.stringify(val) : String(val));
    if (field.samples.length < 5 && !field.samples.includes(sampleStr)) {
      field.samples.push(sampleStr);
    }
    // 递归分析嵌套对象
    if (type === 'object' && val !== null) {
      analyzeDoc(val, schema, fullPath);
    }
  }
}

function renderSchema(schema, totalDocs, container) {
  const fields = Object.entries(schema).sort((a, b) => b[1].count - a[1].count);
  if (!fields.length) {
    container.innerHTML = '<div class="empty">未检测到字段</div>';
    return;
  }

  let html = `<div style="margin-bottom:12px;font-size:12px;color:#888">检测到 ${fields.length} 个字段（基于 ${totalDocs} 条文档采样）</div>`;
  html += '<div class="schema-grid">';
  for (const [name, field] of fields) {
    const pct = Math.round((field.count / totalDocs) * 100);
    const mainType = Object.entries(field.types).sort((a, b) => b[1] - a[1])[0];
    const typeColor = typeColorMap(mainType?.[0]);
    const typeLabel = mainType?.[0] || 'unknown';
    const typePct = mainType ? Math.round((mainType[1] / field.count) * 100) : 0;

    html += `<div class="schema-card">
      <div class="field-name">${escapeHtml(name)}</div>
      <span class="field-type" style="background:${typeColor}">${typeLabel} (${typePct}%)</span>
      <div class="field-bar"><div class="field-bar-fill" style="width:${pct}%;background:${typeColor}"></div></div>
      <div class="field-meta">出现率 ${pct}% · ${field.count}/${totalDocs} 文档`;
    // 多类型
    if (Object.keys(field.types).length > 1) {
      html += ' · 混合类型: ' + Object.entries(field.types).map(([t, c]) => `${t}(${c})`).join(', ');
    }
    html += '</div>';
    // 采样值
    if (field.samples.length) {
      html += '<div style="margin-top:4px;font-size:11px;color:#666;font-family:Consolas,monospace">';
      html += field.samples.map(s => `<span style="background:#f0f0f0;padding:1px 4px;border-radius:3px;margin-right:4px">${escapeHtml(truncate(s, 30))}</span>`).join('');
      html += '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

function typeColorMap(type) {
  const map = {
    string: '#27ae60', number: '#3498db', boolean: '#e67e22', object: '#8e44ad',
    array: '#2980b9', null: '#95a5a6', date: '#d35400', objectId: '#00684A',
    long: '#3498db', binary: '#7f8c8d', undefined: '#bdc3c7',
  };
  return map[type] || '#667eea';
}

function truncate(s, n) { return String(s).length > n ? String(s).slice(0, n) + '…' : String(s); }
