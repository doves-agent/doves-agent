/**
 * MongoDB 管理器 - 文档编辑器
 * 查看 / 编辑 / 新建 / 删除 / 克隆
 */
import { state, callMongoTool, parseResult, chatWithAI, emit, notify, confirmAction, escapeHtml } from './manager-core.js';

let currentDoc = null;
let currentIdx = -1;
let editMode = false;

// ==================== 初始化 ====================
export function initEditor() {
  window._mongoEditor = { open, close, save, createNew, removeDoc, cloneDoc, toggleEdit };
}

// ==================== 打开文档 ====================
export function open(idx) {
  const doc = state.documents.data[idx];
  if (!doc) return;
  currentIdx = idx;
  currentDoc = JSON.parse(JSON.stringify(doc)); // deep clone
  editMode = false;
  renderEditor();
  document.getElementById('docModal').classList.add('active');
}

// ==================== 新建文档 ====================
export function createNew() {
  currentIdx = -1;
  currentDoc = {};
  editMode = true;
  renderEditor();
  document.getElementById('docModal').classList.add('active');
}

// ==================== 关闭 ====================
export function close() {
  document.getElementById('docModal').classList.remove('active');
  currentDoc = null;
  currentIdx = -1;
}

// ==================== 切换编辑模式 ====================
export function toggleEdit() {
  editMode = !editMode;
  renderEditor();
}

// ==================== 渲染编辑器 ====================
function renderEditor() {
  const body = document.getElementById('docModalBody');
  const header = document.getElementById('docModalHeader');
  const isNew = currentIdx === -1;
  const title = isNew ? '➕ 新建文档' : (editMode ? '✏️ 编辑文档' : '📄 查看文档');
  header.innerHTML = `<h3>${title}</h3><button class="modal-close" onclick="window._mongoEditor.close()">✕</button>`;

  if (editMode || isNew) {
    const json = JSON.stringify(currentDoc, null, 2);
    body.innerHTML = `
      <div class="form-group">
        <label>文档 JSON</label>
        <textarea id="docEditorArea" rows="18" style="min-height:300px">${escapeHtml(json)}</textarea>
      </div>
      <div style="font-size:11px;color:#888">提示：直接编辑 JSON 内容，保存时将解析并写入数据库</div>`;
  } else {
    // 查看模式：字段表格
    let html = '<table style="width:100%;border-collapse:collapse;font-size:13px">';
    html += '<tr style="background:#f8f9ff"><th style="text-align:left;padding:6px 10px;border-bottom:2px solid #e0e0e0">字段</th><th style="text-align:left;padding:6px 10px;border-bottom:2px solid #e0e0e0">类型</th><th style="text-align:left;padding:6px 10px;border-bottom:2px solid #e0e0e0">值</th></tr>';
    const entries = Object.entries(currentDoc);
    for (const [key, val] of entries) {
      const type = val === null ? 'null' : Array.isArray(val) ? 'array' : typeof val;
      const display = val === null ? 'null' : (typeof val === 'object' ? escapeHtml(JSON.stringify(val, null, 2)) : escapeHtml(String(val)));
      html += `<tr><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-family:Consolas,monospace;color:#00684A;font-weight:600">${escapeHtml(key)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0"><span class="badge badge-blue">${type}</span></td>
        <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-family:Consolas,monospace;font-size:12px;white-space:pre-wrap;max-width:400px;word-break:break-all">${display}</td></tr>`;
    }
    html += '</table>';
    body.innerHTML = html;
  }

  // 按钮区
  const footer = document.getElementById('docModalFooter');
  if (isNew) {
    footer.innerHTML = '<button class="btn btn-outline" onclick="window._mongoEditor.close()">取消</button><button class="btn btn-success" onclick="window._mongoEditor.save()">插入文档</button>';
  } else if (editMode) {
    footer.innerHTML = '<button class="btn btn-outline" onclick="window._mongoEditor.toggleEdit()">取消编辑</button><button class="btn btn-success" onclick="window._mongoEditor.save()">保存修改</button>';
  } else {
    footer.innerHTML = `
      <div style="display:flex;gap:6px">
        <button class="btn btn-outline" onclick="window._mongoEditor.toggleEdit()">✏️ 编辑</button>
        <button class="btn btn-outline" onclick="window._mongoEditor.cloneDoc()">📋 克隆</button>
        <button class="btn btn-danger btn-sm" onclick="window._mongoEditor.removeDoc()">🗑️ 删除</button>
      </div>
      <button class="btn btn-outline" onclick="window._mongoEditor.close()">关闭</button>`;
  }
}

// ==================== 保存 ====================
export async function save() {
  const area = document.getElementById('docEditorArea');
  if (!area) return;
  let doc;
  try { doc = JSON.parse(area.value); } catch (e) { notify('error', `JSON 解析失败: ${e.message}`); return; }

  if (currentIdx === -1) {
    // 新建
    const result = await callMongoTool('mongo_insert_one', { collection: state.currentCollection, document: doc });
    if (result.success) {
      const d = parseResult(result.data);
      notify('success', `文档已插入，ID: ${d.insertedId || '已生成'}`);
      close();
      emit('collectionChanged', state.currentCollection);
    } else {
      notify('error', `插入失败: ${result.error}`);
    }
  } else {
    // 更新
    const originalDoc = state.documents.data[currentIdx];
    const filter = { _id: originalDoc._id };
    // 移除 _id 从更新文档中
    const updateDoc = { ...doc };
    delete updateDoc._id;
    const result = await callMongoTool('mongo_replace_one', {
      collection: state.currentCollection,
      query: filter,
      replacement: updateDoc,
    });
    if (result.success) {
      notify('success', '文档已更新');
      close();
      emit('collectionChanged', state.currentCollection);
    } else {
      notify('error', `更新失败: ${result.error}`);
    }
  }
}

// ==================== 删除 ====================
export async function removeDoc() {
  if (currentIdx === -1 || !currentDoc) return;
  const idStr = String(currentDoc._id?.$oid || currentDoc._id || '?');
  const ok = await confirmAction('确认删除', `确定要删除文档 <b>${idStr}</b> 吗？此操作不可恢复。`);
  if (!ok) return;
  const result = await callMongoTool('mongo_delete_one', {
    collection: state.currentCollection,
    query: { _id: currentDoc._id },
  });
  if (result.success) {
    notify('success', '文档已删除');
    close();
    emit('collectionChanged', state.currentCollection);
  } else {
    notify('error', `删除失败: ${result.error}`);
  }
}

// ==================== 克隆 ====================
export async function cloneDoc() {
  if (!currentDoc) return;
  const clone = { ...currentDoc };
  delete clone._id; // 移除 _id 让 MongoDB 自动生成新的
  const result = await callMongoTool('mongo_insert_one', { collection: state.currentCollection, document: clone });
  if (result.success) {
    notify('success', '文档已克隆');
    close();
    emit('collectionChanged', state.currentCollection);
  } else {
    notify('error', `克隆失败: ${result.error}`);
  }
}
