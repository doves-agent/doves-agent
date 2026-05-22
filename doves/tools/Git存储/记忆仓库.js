import { api调用, 是否可用, logger } from './核心.js';

export { 是否可用 };

export async function 添加记忆(参数) {
  return api调用('POST', '/api/memory/add', {
    userId: 参数.用户ID,
    messages: 参数.消息列表,
    content: 参数.内容,
    category: 参数.类别 || '对话记忆',
    metadata: 参数.元数据 || {},
    title: 参数.标题
  });
}

export async function 添加多模态记忆(参数) {
  return api调用('POST', '/api/memory/multimodal-add', {
    userId: 参数.用户ID,
    text: 参数.文本,
    imageUrl: 参数.图片URL,
    audioUrl: 参数.音频URL,
    videoUrl: 参数.视频URL,
    category: 参数.类别 || '经验记忆',
    metadata: 参数.元数据 || {}
  });
}

export async function 搜索记忆(参数) {
  return api调用('POST', '/api/memory/search', {
    query: 参数.查询,
    userId: 参数.用户ID,
    category: 参数.类别,
    topK: 参数.返回数量 || 10,
    threshold: 参数.阈值,
    includeMultimodal: 参数.包含多模态
  });
}

export async function 获取记忆列表(参数) {
  const qs = new URLSearchParams();
  if (参数.用户ID) qs.append('user_id', 参数.用户ID);
  if (参数.类别) qs.append('category', 参数.类别);
  if (参数.页码) qs.append('page', 参数.页码);
  if (参数.每页数量) qs.append('page_size', 参数.每页数量);
  return api调用('GET', `/api/memory/list?${qs.toString()}`);
}

export async function 获取记忆(参数) {
  return api调用('GET', `/api/memory/${参数.记忆ID}`);
}

export async function 更新记忆(参数) {
  return api调用('PUT', `/api/memory/${参数.记忆ID}`, {
    content: 参数.内容 || 参数.文本,
    metadata: 参数.元数据,
    category: 参数.类别
  });
}

export async function 删除记忆(参数) {
  return api调用('DELETE', `/api/memory/${参数.记忆ID}`);
}

export async function 获取类别列表() {
  return api调用('GET', '/api/memory/categories');
}

export default {
  是否可用,
  添加记忆,
  添加多模态记忆,
  搜索记忆,
  获取记忆列表,
  获取记忆,
  更新记忆,
  删除记忆,
  获取类别列表
};
