import { readFile, writeFile, unlink, readdir, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import {
  确保用户记忆仓库, 获取工作树路径,
  提交变更, 执行git, logger
} from './仓库管理.js';

const 记忆分支列表 = ['技能记忆', '对话记忆', '经验记忆', '用户画像', '事件触发'];

export function 是否可用() {
  return true;
}

function 获取分支工作树(用户ID, 类别) {
  return join(获取工作树路径(用户ID, 'memory'), 类别);
}

function 生成记忆ID() {
  return `mem_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function 中文分词(文本) {
  if (!文本) return [];
  const 词集 = new Set();
  // 标点分割
  const 片段列表 = 文本.split(/[，。！？；：、\s,.!?;:\n\r\t]+/).filter(Boolean);
  for (const 片段 of 片段列表) {
    词集.add(片段);
    // 双字符切分
    for (let i = 0; i < 片段.length - 1; i++) {
      词集.add(片段.slice(i, i + 2));
    }
    // 三字符切分（提高长词命中）
    for (let i = 0; i < 片段.length - 2; i++) {
      词集.add(片段.slice(i, i + 3));
    }
  }
  return [...词集];
}

function 计算相关度(记忆条目, 查询, 查询词列表) {
  let 分数 = 0;
  const 文本 = (记忆条目.content || '') + ' ' + (记忆条目.摘要 || '');
  const 关键词文本 = (记忆条目.keywords || []).join(' ');

  if (文本.includes(查询)) 分数 += 3;
  if (关键词文本.includes(查询)) 分数 += 2;

  for (const 词 of 查询词列表) {
    if (文本.includes(词)) 分数 += 0.5;
    if (关键词文本.includes(词)) 分数 += 1;
  }
  return 分数;
}

async function 读取索引(工作树路径) {
  try {
    const 内容 = await readFile(join(工作树路径, '_index.json'), 'utf8');
    return JSON.parse(内容);
  } catch {
    return { 条目: [], 更新时间: null };
  }
}

async function 写入索引(工作树路径, 索引) {
  索引.更新时间 = new Date().toISOString();
  await writeFile(join(工作树路径, '_index.json'), JSON.stringify(索引, null, 2), 'utf8');
}

async function 确保目录(路径) {
  await mkdir(路径, { recursive: true });
}

export async function 添加记忆({ 用户ID, 类别 = '对话记忆', 内容, 消息列表, 元数据 = {} }) {
  await 确保用户记忆仓库(用户ID);
  const 分支 = 记忆分支列表.includes(类别) ? 类别 : '对话记忆';
  const 工作树 = 获取分支工作树(用户ID, 分支);
  await 确保目录(工作树);

  const id = 生成记忆ID();
  const 文本 = 内容 || (消息列表 || []).map(m => `${m.role || ''}:${m.content || ''}`).join('\n');
  const 关键词 = 中文分词(文本);
  const 摘要 = 文本.slice(0, 200);

  const 记忆文档 = {
    id,
    content: 文本,
    keywords: 关键词.slice(0, 50),
    metadata: { ...元数据, 类别, user_id: 用户ID },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  await writeFile(join(工作树, `${id}.json`), JSON.stringify(记忆文档, null, 2), 'utf8');

  const 索引 = await 读取索引(工作树);
  索引.条目.push({ id, 摘要, keywords: 记忆文档.keywords, created_at: 记忆文档.created_at });
  await 写入索引(工作树, 索引);

  await 提交变更(工作树, `添加记忆: ${id}`);
  logger.debug(`已添加记忆 ${id} → ${分支} (用户: ${用户ID})`);
  return { 成功: true, data: { id, 类别: 分支 } };
}

export async function 搜索记忆({ 用户ID, 查询, 类别, 返回数量 = 10 }) {
  await 确保用户记忆仓库(用户ID);
  const 搜索分支列表 = 类别 ? [类别] : 记忆分支列表;
  const 查询词列表 = 中文分词(查询);
  let 全部结果 = [];

  for (const 分支 of 搜索分支列表) {
    const 工作树 = 获取分支工作树(用户ID, 分支);
    const 索引 = await 读取索引(工作树);

    for (const 条目 of 索引.条目) {
      const 分数 = 计算相关度(条目, 查询, 查询词列表);
      if (分数 > 0) {
        全部结果.push({ ...条目, 分数, 类别: 分支 });
      }
    }
  }

  全部结果.sort((a, b) => b.分数 - a.分数);
  const 前N = 全部结果.slice(0, 返回数量);

  const 详细结果 = [];
  for (const 条目 of 前N) {
    try {
      const 工作树 = 获取分支工作树(用户ID, 条目.类别);
      const 内容 = await readFile(join(工作树, `${条目.id}.json`), 'utf8');
      详细结果.push({ ...JSON.parse(内容), 相关度: 条目.分数, 类别: 条目.类别 });
    } catch { /* 索引与文件不一致，跳过 */ }
  }

  return { 成功: true, data: 详细结果 };
}

export async function 获取记忆列表({ 用户ID, 类别, 页码 = 1, 每页数量 = 20 }) {
  await 确保用户记忆仓库(用户ID);
  const 搜索分支列表 = 类别 ? [类别] : 记忆分支列表;
  let 全部条目 = [];

  for (const 分支 of 搜索分支列表) {
    const 工作树 = 获取分支工作树(用户ID, 分支);
    const 索引 = await 读取索引(工作树);
    全部条目.push(...索引.条目.map(e => ({ ...e, 类别: 分支 })));
  }

  全部条目.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const 总数 = 全部条目.length;
  const 起始 = (页码 - 1) * 每页数量;
  const 分页结果 = 全部条目.slice(起始, 起始 + 每页数量);

  return { 成功: true, data: { 条目: 分页结果, 总数, 页码, 每页数量 } };
}

export async function 获取记忆({ 用户ID, 记忆ID, 类别 }) {
  await 确保用户记忆仓库(用户ID);
  const 搜索分支列表 = 类别 ? [类别] : 记忆分支列表;

  for (const 分支 of 搜索分支列表) {
    const 文件路径 = join(获取分支工作树(用户ID, 分支), `${记忆ID}.json`);
    try {
      const 内容 = await readFile(文件路径, 'utf8');
      return { 成功: true, data: { ...JSON.parse(内容), 类别: 分支 } };
    } catch { continue; }
  }

  return { 成功: false, 错误: '记忆不存在' };
}

export async function 更新记忆({ 用户ID, 记忆ID, 类别, 内容, 元数据 }) {
  const 获取结果 = await 获取记忆({ 用户ID, 记忆ID, 类别 });
  if (!获取结果.成功) return 获取结果;

  const 原记忆 = 获取结果.data;
  const 分支 = 原记忆.类别;
  const 工作树 = 获取分支工作树(用户ID, 分支);

  if (内容 !== undefined) 原记忆.content = 内容;
  if (元数据) 原记忆.metadata = { ...原记忆.metadata, ...元数据 };
  原记忆.keywords = 中文分词(原记忆.content).slice(0, 50);
  原记忆.updated_at = new Date().toISOString();

  await writeFile(join(工作树, `${记忆ID}.json`), JSON.stringify(原记忆, null, 2), 'utf8');

  const 索引 = await 读取索引(工作树);
  const idx = 索引.条目.findIndex(e => e.id === 记忆ID);
  if (idx >= 0) {
    索引.条目[idx] = { id: 记忆ID, 摘要: 原记忆.content.slice(0, 200), keywords: 原记忆.keywords, created_at: 原记忆.created_at };
  }
  await 写入索引(工作树, 索引);
  await 提交变更(工作树, `更新记忆: ${记忆ID}`);

  return { 成功: true, data: { id: 记忆ID } };
}

export async function 删除记忆({ 用户ID, 记忆ID, 类别 }) {
  const 获取结果 = await 获取记忆({ 用户ID, 记忆ID, 类别 });
  if (!获取结果.成功) return 获取结果;

  const 分支 = 获取结果.data.类别;
  const 工作树 = 获取分支工作树(用户ID, 分支);

  await unlink(join(工作树, `${记忆ID}.json`));

  const 索引 = await 读取索引(工作树);
  索引.条目 = 索引.条目.filter(e => e.id !== 记忆ID);
  await 写入索引(工作树, 索引);
  await 提交变更(工作树, `删除记忆: ${记忆ID}`);

  return { 成功: true };
}

export async function 获取类别列表() {
  return { 成功: true, data: [...记忆分支列表] };
}
