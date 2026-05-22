import { readFile, writeFile, unlink, readdir, stat, mkdir } from 'fs/promises';
import { join, dirname, relative } from 'path';
import {
  确保用户数据仓库, 获取工作树路径, 获取仓库路径,
  提交变更, 执行git, 获取文件历史 as git获取文件历史,
  logger
} from './仓库管理.js';

const 最大文件大小 = 50 * 1024 * 1024; // 50MB

function 获取数据工作树(用户ID) {
  return 获取工作树路径(用户ID, 'data');
}

function 安全路径(工作树根, 相对路径) {
  const 规范路径 = join(工作树根, 相对路径);
  if (!规范路径.startsWith(工作树根)) throw new Error('路径越界');
  return 规范路径;
}

export async function 读取文件({ 用户ID, 路径 }) {
  await 确保用户数据仓库(用户ID);
  const 工作树 = 获取数据工作树(用户ID);
  const 文件路径 = 安全路径(工作树, 路径);

  try {
    const 内容 = await readFile(文件路径, 'utf8');
    return { 成功: true, data: { 路径, 内容 } };
  } catch (err) {
    if (err.code === 'ENOENT') return { 成功: false, 错误: '文件不存在' };
    throw err;
  }
}

export async function 读取二进制文件({ 用户ID, 路径 }) {
  await 确保用户数据仓库(用户ID);
  const 工作树 = 获取数据工作树(用户ID);
  const 文件路径 = 安全路径(工作树, 路径);

  try {
    const buffer = await readFile(文件路径);
    return { 成功: true, data: { 路径, buffer } };
  } catch (err) {
    if (err.code === 'ENOENT') return { 成功: false, 错误: '文件不存在' };
    throw err;
  }
}

export async function 写入文件({ 用户ID, 路径, 内容, 提交消息 }) {
  await 确保用户数据仓库(用户ID);
  const 工作树 = 获取数据工作树(用户ID);
  const 文件路径 = 安全路径(工作树, 路径);

  const 字节数 = Buffer.byteLength(内容, 'utf8');
  if (字节数 > 最大文件大小) {
    return { 成功: false, 错误: `文件超过50MB限制(${(字节数 / 1024 / 1024).toFixed(1)}MB)，请使用OSS` };
  }

  await mkdir(dirname(文件路径), { recursive: true });
  await writeFile(文件路径, 内容, 'utf8');
  await 提交变更(工作树, 提交消息 || `写入: ${路径}`);

  logger.debug(`写入文件: ${路径} (用户: ${用户ID})`);
  return { 成功: true, data: { 路径 } };
}

export async function 写入二进制文件({ 用户ID, 路径, buffer, 提交消息 }) {
  await 确保用户数据仓库(用户ID);
  const 工作树 = 获取数据工作树(用户ID);
  const 文件路径 = 安全路径(工作树, 路径);

  if (buffer.length > 最大文件大小) {
    return { 成功: false, 错误: `文件超过50MB限制(${(buffer.length / 1024 / 1024).toFixed(1)}MB)，请使用OSS` };
  }

  await mkdir(dirname(文件路径), { recursive: true });
  await writeFile(文件路径, buffer);
  await 提交变更(工作树, 提交消息 || `写入二进制: ${路径}`);

  return { 成功: true, data: { 路径 } };
}

export async function 删除文件({ 用户ID, 路径, 提交消息 }) {
  await 确保用户数据仓库(用户ID);
  const 工作树 = 获取数据工作树(用户ID);
  const 文件路径 = 安全路径(工作树, 路径);

  try {
    await unlink(文件路径);
  } catch (err) {
    if (err.code === 'ENOENT') return { 成功: false, 错误: '文件不存在' };
    throw err;
  }

  await 提交变更(工作树, 提交消息 || `删除: ${路径}`);
  return { 成功: true };
}

export async function 列出文件({ 用户ID, 路径 = '' }) {
  await 确保用户数据仓库(用户ID);
  const 工作树 = 获取数据工作树(用户ID);
  const 目录路径 = 安全路径(工作树, 路径);

  try {
    const 条目列表 = await readdir(目录路径, { withFileTypes: true });
    const 结果 = [];
    for (const 条目 of 条目列表) {
      if (条目.name.startsWith('.git')) continue;
      const 完整路径 = join(目录路径, 条目.name);
      const 信息 = await stat(完整路径);
      结果.push({
        名称: 条目.name,
        路径: join(路径, 条目.name),
        类型: 条目.isDirectory() ? '目录' : '文件',
        大小: 信息.size,
        修改时间: 信息.mtime.toISOString()
      });
    }
    return { 成功: true, data: 结果 };
  } catch (err) {
    if (err.code === 'ENOENT') return { 成功: true, data: [] };
    throw err;
  }
}

export async function 获取文件历史({ 用户ID, 路径, 数量 = 20 }) {
  await 确保用户数据仓库(用户ID);
  const 工作树 = 获取数据工作树(用户ID);
  const 历史 = await git获取文件历史(工作树, 路径, 数量);
  return { 成功: true, data: 历史 };
}

// ==================== 快照（Tag）操作 ====================

export async function 创建快照({ 用户ID, 名称, 描述 = '' }) {
  await 确保用户数据仓库(用户ID);
  const 工作树 = 获取数据工作树(用户ID);

  // 先提交所有未提交变更
  await 提交变更(工作树, `快照前自动提交`);

  const 标签名 = `snap_${Date.now()}_${名称.replace(/[^a-zA-Z0-9一-鿿_-]/g, '')}`;
  const 元数据 = JSON.stringify({ 名称, 描述, 创建时间: new Date().toISOString(), 用户ID });
  const result = await 执行git(工作树, 'tag', '-a', 标签名, '-m', 元数据);

  if (!result.成功) return { 成功: false, 错误: `创建快照失败: ${result.错误}` };

  logger.info(`已创建快照: ${标签名} (用户: ${用户ID})`);
  return { 成功: true, data: { 标签名, 名称, 创建时间: new Date().toISOString() } };
}

export async function 列出快照({ 用户ID }) {
  await 确保用户数据仓库(用户ID);
  const 工作树 = 获取数据工作树(用户ID);
  const result = await 执行git(工作树, 'tag', '-l', 'snap_*', '--sort=-creatordate');
  if (!result.成功) return { 成功: true, data: [] };

  const 标签列表 = result.stdout.split('\n').filter(Boolean);
  const 快照列表 = [];

  for (const 标签 of 标签列表) {
    const info = await 执行git(工作树, 'tag', '-n1', '--format=%(contents)', 标签);
    let 元数据 = {};
    try { 元数据 = JSON.parse(info.stdout); } catch { /* 旧格式tag */ }
    快照列表.push({ 标签名: 标签, ...元数据 });
  }

  return { 成功: true, data: 快照列表 };
}

export async function 恢复快照({ 用户ID, 标签名 }) {
  await 确保用户数据仓库(用户ID);
  const 工作树 = 获取数据工作树(用户ID);

  // 先提交当前变更
  await 提交变更(工作树, `恢复快照前自动保存`);

  const checkout = await 执行git(工作树, 'checkout', 标签名, '--', '.');
  if (!checkout.成功) return { 成功: false, 错误: `恢复快照失败: ${checkout.错误}` };

  await 提交变更(工作树, `恢复快照: ${标签名}`);
  logger.info(`已恢复快照: ${标签名} (用户: ${用户ID})`);
  return { 成功: true, data: { 标签名 } };
}

export async function 删除快照({ 用户ID, 标签名 }) {
  await 确保用户数据仓库(用户ID);
  const 工作树 = 获取数据工作树(用户ID);
  const result = await 执行git(工作树, 'tag', '-d', 标签名);
  if (!result.成功) return { 成功: false, 错误: `删除快照失败: ${result.错误}` };
  return { 成功: true };
}
