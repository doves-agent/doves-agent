/**
 * 执行日志 - 环形缓冲区
 * 记录所有通过 Web 执行的命令，供前端查询展示
 */

const MAX_ENTRIES = 500;
let idCounter = 0;
const buffer = [];

export function 记录执行(entry) {
  const record = {
    id: `exec_${++idCounter}`,
    timestamp: new Date().toISOString(),
    duration: 0,
    success: false,
    ...entry
  };

  buffer.push(record);
  if (buffer.length > MAX_ENTRIES) {
    buffer.shift();
  }

  return record;
}

export function 更新执行(id, updates) {
  const record = buffer.find(r => r.id === id);
  if (record) {
    Object.assign(record, updates);
  }
  return record;
}

export function 查询日志({ limit = 50, offset = 0, source, success } = {}) {
  let results = buffer.slice().reverse();

  if (source) {
    results = results.filter(r => r.source === source);
  }
  if (success !== undefined) {
    results = results.filter(r => r.success === success);
  }

  return {
    total: results.length,
    entries: results.slice(offset, offset + limit)
  };
}

export function 清空日志() {
  buffer.length = 0;
  idCounter = 0;
}
