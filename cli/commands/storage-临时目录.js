/**
 * @file storage-临时目录.js
 * @description OSS 临时目录操作（从 storage.js 抽取）
 */

import { display } from '../display.js';
import fs from 'fs';

/**
 * 创建临时目录
 */
export async function createTempDir(client, taskId, ownerId) {
  if (!taskId || !ownerId) {
    display.error('请提供 --task <taskId> 和 --owner <ownerId>');
    return;
  }
  
  const spinner = display.spinner('创建临时目录...').start();
  const result = await client.createTempDir(taskId, ownerId);
  spinner.stop();
  
  if (result.success) {
    display.success(`临时目录已创建`);
    console.log('');
    display.title('目录URL');
    const urls = result.data.urls;
    console.log(`  private:  ${urls.private}`);
    console.log(`  public:   ${urls.public}`);
    console.log(`  dove/in:  ${urls.doveInput}`);
    console.log(`  dove/out: ${urls.doveOutput}`);
    console.log('');
    display.info(`hash: ${result.data.hash}`);
  }
}

/**
 * 获取临时目录 URL
 */
export async function getTempUrls(client, taskId, hash, ownerId) {
  if (!taskId || !hash || !ownerId) {
    display.error('请提供 --task, --hash, --owner');
    return;
  }
  
  const result = await client.getTempDirUrls(taskId, hash, ownerId);
  
  if (result.success) {
    display.title('临时目录URL');
    const urls = result.data;
    console.log(`  private:  ${urls.private}`);
    console.log(`  public:   ${urls.public}`);
    console.log(`  dove/in:  ${urls.doveInput}`);
    console.log(`  dove/out: ${urls.doveOutput}`);
  }
}

/**
 * 列出临时目录内容
 */
export async function listTempDir(client, taskId, ownerId, hash, dir) {
  if (!taskId || !ownerId || !hash) {
    display.error('请提供 --task, --owner, --hash');
    return;
  }
  
  const spinner = display.spinner('列出目录...').start();
  const result = await client.listTempDir(taskId, ownerId, hash, dir || '');
  spinner.stop();
  
  display.title(`目录: ${result.data.path}`);
  
  if (!result.data.files || result.data.files.length === 0) {
    display.info('目录为空');
    return;
  }
  
  result.data.files.forEach(file => {
    if (file.name === '.keep') return;
    const size = file.size ? ` (${formatSize(file.size)})` : '';
    console.log(`  📄 ${file.name}${size}`);
  });
}

/**
 * 上传文件到临时目录（流式上传到 OSS，禁止 base64）
 */
export async function uploadToTemp(client, taskId, ownerId, hash, target, filePath) {
  if (!taskId || !ownerId || !hash || !target || !filePath) {
    display.error('请提供 --task, --owner, --hash, --target, --file');
    return;
  }

  if (!fs.existsSync(filePath)) {
    display.error(`文件不存在: ${filePath}`);
    return;
  }

  const spinner = display.spinner(`上传文件: ${filePath}`).start();

  try {
    const result = await client.uploadToTempDir(
      taskId,
      target,
      filePath,
      ownerId,
      hash,
      (percent) => {
        spinner.text = `上传文件: ${filePath} ${percent}%`;
      }
    );
    spinner.stop();

    if (result.success) {
      display.success(`已上传: ${filePath} → ${result.data?.url || result.data?.path || target}`);
    }
  } catch (err) {
    spinner.stop();
    display.error(`上传失败: ${err.message}`);
  }
}

/**
 * 复制文件到临时目录
 */
export async function copyToTemp(client, taskId, ownerId, hash, source, target) {
  if (!taskId || !ownerId || !hash || !source || !target) {
    display.error('请提供 --task, --owner, --hash, --source, --target');
    return;
  }
  
  const spinner = display.spinner(`复制文件: ${source} → ${target}`).start();
  const result = await client.copyToTempDir(taskId, source, target, ownerId, hash);
  spinner.stop();
  
  if (result.success) {
    display.success(`已复制: ${result.data.url}`);
  }
}

/**
 * 完成任务并清理临时目录
 */
export async function finalizeTemp(client, taskId, ownerId, hash, syncTo) {
  if (!taskId || !ownerId || !hash) {
    display.error('请提供 --task, --owner, --hash');
    return;
  }
  
  const spinner = display.spinner('完成任务并清理...').start();
  const result = await client.finalizeTempDir(taskId, ownerId, hash, syncTo);
  spinner.stop();
  
  if (result.success) {
    display.success(`任务已完成`);
    if (result.data.synced) {
      display.info('结果已同步到Git存储');
    }
    display.info('临时目录已清理');
  }
}

/**
 * 删除临时目录
 */
export async function deleteTemp(client, taskId, ownerId, hash) {
  if (!taskId || !ownerId || !hash) {
    display.error('请提供 --task, --owner, --hash');
    return;
  }
  
  const spinner = display.spinner('删除临时目录...').start();
  const result = await client.deleteTempDir(taskId, ownerId, hash);
  spinner.stop();
  
  if (result.success) {
    display.success(`临时目录已删除`);
  }
}

/**
 * 文件大小格式化（也供外部使用）
 */
export function formatSize(bytes) {
  if (!bytes) return '0B';
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}
