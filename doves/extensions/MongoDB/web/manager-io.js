/**
 * MongoDB 管理器 - 导入导出
 * JSON/CSV 导入 / 导出 / 集合备份
 */
import { state, callMongoTool, parseResult, notify, confirmAction, emit, escapeHtml } from './manager-core.js';

// ==================== 初始化 ====================
export function initIO() {
  window._mongoIO = { execImport, execExport, execBackup, execRestore, importFromFile };
}

// ==================== 渲染面板 ====================
export function renderIOPanel() {
  const el = document.getElementById('tabContent');
  if (!el) return;
  el.innerHTML = `
    <div style="padding:16px;max-width:800px">
      <!-- 导入 -->
      <div class="section" style="background:#fff;border-radius:10px;padding:18px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,0.06)">
        <h3 style="font-size:15px;margin-bottom:12px;color:#555">📦 数据导入</h3>
        <div class="form-group">
          <label>目标集合</label>
          <input type="text" id="ioImportCol" placeholder="集合名称" value="${state.currentCollection || ''}">
        </div>
        <div class="form-group">
          <label>JSON 数据</label>
          <textarea id="ioImportData" rows="5" placeholder='[{"name": "张三", "age": 25}, {"name": "李四", "age": 30}]'></textarea>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-success" onclick="window._mongoIO.execImport()">📥 导入</button>
          <button class="btn btn-outline" onclick="window._mongoIO.importFromFile()">📂 从文件导入</button>
        </div>
      </div>
      <!-- 导出 -->
      <div class="section" style="background:#fff;border-radius:10px;padding:18px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,0.06)">
        <h3 style="font-size:15px;margin-bottom:12px;color:#555">📤 数据导出</h3>
        <div class="form-row">
          <div class="form-group"><label>集合</label><input type="text" id="ioExportCol" placeholder="集合名称" value="${state.currentCollection || ''}"></div>
          <div class="form-group"><label>格式</label><select id="ioExportFormat"><option value="json">JSON</option><option value="csv">CSV</option></select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>查询条件</label><input type="text" id="ioExportQuery" placeholder="{} (空=全部)"></div>
          <div class="form-group"><label>条数上限</label><input type="number" id="ioExportLimit" value="1000" min="1"></div>
        </div>
        <button class="btn btn-success" onclick="window._mongoIO.execExport()">📤 导出下载</button>
      </div>
      <!-- 备份恢复 -->
      <div class="section" style="background:#fff;border-radius:10px;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,0.06)">
        <h3 style="font-size:15px;margin-bottom:12px;color:#555">💾 快速备份 / 恢复</h3>
        <div class="form-group">
          <label>集合</label>
          <input type="text" id="ioBackupCol" placeholder="集合名称" value="${state.currentCollection || ''}">
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" onclick="window._mongoIO.execBackup()">💾 备份下载</button>
          <button class="btn btn-outline" onclick="window._mongoIO.execRestore()">📥 恢复（从文件）</button>
        </div>
      </div>
    </div>`;
}

// ==================== 导入 ====================
export async function execImport() {
  const col = document.getElementById('ioImportCol')?.value?.trim();
  const dataStr = document.getElementById('ioImportData')?.value?.trim();
  if (!col || !dataStr) { notify('error', '请填写集合名和数据'); return; }
  try {
    const parsed = JSON.parse(dataStr);
    const docs = Array.isArray(parsed) ? parsed : [parsed];
    const result = await callMongoTool('mongo_import', { collection: col, data: docs });
    if (result.success) {
      const d = parseResult(result.data);
      notify('success', `导入成功！${d.importedCount || docs.length} 条文档已导入 ${col}`);
      if (col === state.currentCollection) emit('collectionChanged', col);
    } else {
      notify('error', `导入失败: ${result.error}`);
    }
  } catch (e) {
    notify('error', `数据格式错误: ${e.message}`);
  }
}

export async function importFromFile() {
  const col = document.getElementById('ioImportCol')?.value?.trim();
  const file = prompt('请输入文件路径:');
  if (!col || !file) return;
  const result = await callMongoTool('mongo_import', { collection: col, filePath: file });
  if (result.success) {
    const d = parseResult(result.data);
    notify('success', `文件导入成功！${d.importedCount || '?'} 条文档已导入 ${col}`);
    if (col === state.currentCollection) emit('collectionChanged', col);
  } else {
    notify('error', `导入失败: ${result.error}`);
  }
}

// ==================== 导出 ====================
export async function execExport() {
  const col = document.getElementById('ioExportCol')?.value?.trim();
  if (!col) { notify('error', '请输入集合名称'); return; }
  const format = document.getElementById('ioExportFormat')?.value || 'json';
  const queryStr = document.getElementById('ioExportQuery')?.value?.trim() || '{}';
  const limit = parseInt(document.getElementById('ioExportLimit')?.value) || 1000;
  try {
    const query = JSON.parse(queryStr);
    const result = await callMongoTool('mongo_export', { collection: col, format, query, limit });
    if (result.success) {
      const d = parseResult(result.data);
      const data = d.data || d;
      if (data && (Array.isArray(data) ? data.length > 0 : true)) {
        const content = format === 'csv' ? toCsv(Array.isArray(data) ? data : [data]) : JSON.stringify(data, null, 2);
        const blob = new Blob([content], { type: format === 'csv' ? 'text/csv' : 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${col}_export_${Date.now()}.${format}`;
        a.click();
        notify('success', `导出成功！${Array.isArray(data) ? data.length : '?'} 条文档已下载`);
      } else {
        notify('warning', '导出完成但无数据');
      }
    } else {
      notify('error', `导出失败: ${result.error}`);
    }
  } catch (e) {
    notify('error', `参数错误: ${e.message}`);
  }
}

// ==================== 备份 ====================
export async function execBackup() {
  const col = document.getElementById('ioBackupCol')?.value?.trim();
  if (!col) { notify('error', '请输入集合名称'); return; }
  const result = await callMongoTool('mongo_export', { collection: col, format: 'json', limit: 100000 });
  if (result.success) {
    const d = parseResult(result.data);
    const data = d.data || d;
    const backup = { _backup: { collection: col, time: new Date().toISOString(), count: Array.isArray(data) ? data.length : 0 }, data };
    const content = JSON.stringify(backup, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${col}_backup_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    a.click();
    notify('success', `备份成功！已下载 ${col} 集合数据`);
  } else {
    notify('error', `备份失败: ${result.error}`);
  }
}

// ==================== 恢复 ====================
export async function execRestore() {
  const col = document.getElementById('ioBackupCol')?.value?.trim();
  const file = prompt('请输入备份文件路径:');
  if (!col || !file) return;
  const ok = await confirmAction('确认恢复', `将文件 ${file} 的数据导入到集合 <b>${col}</b>，确认继续？`);
  if (!ok) return;
  const result = await callMongoTool('mongo_import', { collection: col, filePath: file });
  if (result.success) {
    notify('success', '恢复成功');
    if (col === state.currentCollection) emit('collectionChanged', col);
  } else {
    notify('error', `恢复失败: ${result.error}`);
  }
}

// ==================== CSV 转换 ====================
function toCsv(data) {
  if (!data || !data.length) return '';
  const allKeys = new Set();
  data.forEach(doc => Object.keys(doc).forEach(k => allKeys.add(k)));
  const headers = [...allKeys];
  const lines = [headers.join(',')];
  for (const doc of data) {
    const vals = headers.map(h => {
      const v = doc[h];
      if (v === null || v === undefined) return '';
      const s = String(typeof v === 'object' ? JSON.stringify(v) : v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    });
    lines.push(vals.join(','));
  }
  return lines.join('\n');
}
