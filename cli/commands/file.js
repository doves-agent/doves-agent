/**
 * 文件命令
 * 用法: dove file <action> <path> [options]
 */

import { Command } from 'commander';
import { display } from '../display.js';
import { DoveClient, AdminClient } from '../client.js';
import { StorageClient } from '../lib/storage.js';
import { loadConfig } from '../lib/config.js';
import { select } from '../lib/interactive.js';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

const FILE_ACTION_CHOICES = [
  { name: 'read     - 读取文件', value: 'read' },
  { name: 'write    - 写入文件', value: 'write' },
  { name: 'list     - 列出文件', value: 'list' },
  { name: 'delete   - 删除文件', value: 'delete' },
  { name: 'upload   - 上传文件', value: 'upload' },
  { name: 'download - 下载文件', value: 'download' },
];

export const fileCommand = new Command('file')
  .description('文件操作')
  .argument('[action]', '操作: read|write|list|delete|upload|download')
  .argument('[path]', '文件路径')
  .option('-o, --output <file>', '输出文件')
  .option('-c, --content <content>', '文件内容')
  .option('-a, --all', '查看所有用户的文件（仅超级管理员可用）')
  .option('--uid <userId>', '查看指定用户的文件（仅超级管理员可用）')
  .action(async (action, filePath, options) => {
    const config = loadConfig();
    const client = config.role === 'admin' ? new AdminClient() : new DoveClient();
    const authed = await client.ensureAuth();
    if (!authed) {
      display.error('登录已过期，请重新执行 dove login');
      process.exit(1);
    }
    await client.connectEncrypted();

    // 超管 --all 权限检查
    if (options.all) {
      if (!client.isAdmin()) {
        display.error('--all 选项仅超级管理员可用，请使用 dove login --admin 登录');
        process.exit(1);
      }
      client.setAdminAll(true);
    }
    
    // 超管 --uid 权限检查
    if (options.uid) {
      if (!client.isAdmin()) {
        display.error('--uid 选项仅超级管理员可用，请使用 dove login --admin 登录');
        process.exit(1);
      }
      client.setTargetUserId(options.uid);
    }
    
    try {
      // 无 action 时交互式选择
      if (!action) {
        action = await select('选择操作', FILE_ACTION_CHOICES, 'list');
      }
      
      switch (action) {
        case 'read':
          await readFile(client, filePath, options);
          break;
        case 'write':
          await writeFile(client, filePath, options);
          break;
        case 'list':
          await listFiles(client, filePath);
          break;
        case 'delete':
          await deleteFile(client, filePath);
          break;
        case 'upload':
          await uploadFile(client, filePath, options);
          break;
        case 'download':
          await downloadFile(client, filePath, options);
          break;
        default:
          display.error(`未知操作: ${action}`);
          display.info('可用操作: read, write, list, delete, upload, download');
      }
    } catch (err) {
      display.error(err.message);
      process.exit(1);
    }
  });

// 读取文件
async function readFile(client, filePath, options) {
  if (!filePath) {
    display.error('请提供文件路径');
    return;
  }
  
  const spinner = display.spinner('读取文件...').start();
  const result = await client.readFile(filePath);
  spinner.stop();
  
  if (options.output) {
    fs.writeFileSync(options.output, result.content);
    display.success(`已保存到: ${options.output}`);
  } else {
    console.log(result.content);
  }
}

// 写入文件
async function writeFile(client, filePath, options) {
  if (!filePath) {
    display.error('请提供文件路径');
    return;
  }
  
  const content = options.content;
  if (!content) {
    display.error('请提供文件内容: -c "内容"');
    return;
  }
  
  const spinner = display.spinner('写入文件...').start();
  await client.writeFile(filePath, content);
  spinner.stop();
  
  display.success(`文件已写入: ${filePath}`);
}

// 列出文件
async function listFiles(client, dirPath) {
  const spinner = display.spinner('获取文件列表...').start();
  const result = await client.listFiles(dirPath || '');
  spinner.stop();
  
  display.title('文件列表');
  
  if (!result.files || result.files.length === 0) {
    display.info('目录为空');
    return;
  }
  
  result.files.forEach(file => {
    const type = file.type === 'directory' ? chalk.blue('📁') : '📄';
    const size = file.type === 'file' ? ` (${formatSize(file.size)})` : '';
    console.log(`  ${type} ${file.name}${size}`);
  });
}

// 删除文件
async function deleteFile(client, filePath) {
  if (!filePath) {
    display.error('请提供文件路径');
    return;
  }
  
  await client.deleteFile(filePath);
  display.success(`文件已删除: ${filePath}`);
}

// 上传文件（流式上传到 OSS，禁止直接发送/base64）
async function uploadFile(client, localPath, options) {
  if (!localPath || !fs.existsSync(localPath)) {
    display.error('请提供有效的本地文件路径');
    return;
  }

  const spinner = display.spinner('上传文件...').start();

  try {
    // 使用流式上传到 OSS
    const storage = new StorageClient();
    storage.baseUrl = client.baseUrl;
    storage.token = client.token;
    storage.config = client.config;

    const result = await storage.streamUploadFile(localPath, null, {
      fileName: options.output || path.basename(localPath),
      onProgress: (percent) => {
        spinner.text = `上传文件... ${percent}%`;
      },
    });
    spinner.stop();

    display.success(`已上传: ${localPath} → ${result.url}`);
  } catch (err) {
    spinner.stop();
    display.error(`上传失败: ${err.message}`);
  }
}

// 下载文件
async function downloadFile(client, remotePath, options) {
  if (!remotePath) {
    display.error('请提供远程文件路径');
    return;
  }
  
  const spinner = display.spinner('下载文件...').start();
  const result = await client.readFile(remotePath);
  const localPath = options.output || path.basename(remotePath);
  fs.writeFileSync(localPath, result.content);
  spinner.stop();
  
  display.success(`已下载: ${remotePath} → ${localPath}`);
}

// 格式化文件大小
function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

