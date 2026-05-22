import { api调用, 是否可用, logger } from './核心.js';

export { 是否可用 };

// ==================== 文件操作 ====================

export async function 列出文件(参数) {
  const qs = 参数.路径 ? `?path=${encodeURIComponent(参数.路径)}` : '';
  return api调用('GET', `/api/git-storage/files${qs}`);
}

export async function 读取文件(参数) {
  const qs = new URLSearchParams({ path: 参数.路径 });
  if (参数.二进制) qs.append('binary', 'true');
  return api调用('GET', `/api/git-storage/files/read?${qs.toString()}`);
}

export async function 写入文件(参数) {
  return api调用('POST', '/api/git-storage/files/write', {
    path: 参数.路径,
    content: 参数.内容,
    message: 参数.提交消息
  });
}

export async function 删除文件(参数) {
  return api调用('DELETE', '/api/git-storage/files', {
    path: 参数.路径,
    message: 参数.提交消息
  });
}

export async function 获取文件历史(参数) {
  const qs = new URLSearchParams({ path: 参数.路径 });
  if (参数.数量) qs.append('limit', 参数.数量);
  return api调用('GET', `/api/git-storage/files/history?${qs.toString()}`);
}

// ==================== 快照操作 ====================

export async function 创建快照(参数) {
  return api调用('POST', '/api/git-storage/snapshots', {
    name: 参数.名称,
    description: 参数.描述 || ''
  });
}

export async function 列出快照() {
  return api调用('GET', '/api/git-storage/snapshots');
}

export async function 恢复快照(参数) {
  return api调用('POST', '/api/git-storage/snapshots/restore', {
    tag: 参数.标签名
  });
}

export async function 删除快照(参数) {
  return api调用('DELETE', `/api/git-storage/snapshots/${encodeURIComponent(参数.标签名)}`);
}

export default {
  是否可用,
  列出文件,
  读取文件,
  写入文件,
  删除文件,
  获取文件历史,
  创建快照,
  列出快照,
  恢复快照,
  删除快照
};
