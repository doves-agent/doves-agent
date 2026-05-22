/**
 * 存储管理命令
 * 用法: dove storage <action> [options]
 *
 * 支持操作:
 * - Git存储: status, mount, clone, quota
 * - OSS临时目录: temp-create, temp-list, temp-upload, temp-finalize
 */

import { Command } from 'commander';
import { display } from '../display.js';
import { StorageClient } from '../lib/storage.js';
import { select, multiSelect, PERM_BIT_CHOICES } from '../lib/interactive.js';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { createTempDir, getTempUrls, listTempDir, uploadToTemp, copyToTemp, finalizeTemp, deleteTemp, formatSize } from './storage-临时目录.js';

const STORAGE_ACTION_CHOICES = [
  // Git存储
  { name: '── Git存储 ──', value: '__sep1__', disabled: true },
  { name: 'status       - 查看Git存储状态', value: 'status' },
  { name: 'mount        - 挂载Git存储', value: 'mount' },
  { name: 'clone        - 克隆快照', value: 'clone' },
  { name: 'quota        - 查看配额', value: 'quota' },
  { name: 'quota-set    - 设置配额', value: 'quota-set' },
  { name: 'quota-delete - 删除配额', value: 'quota-delete' },
  // OSS 临时目录
  { name: '── OSS临时目录 ──', value: '__sep2__', disabled: true },
  { name: 'temp-create   - 创建临时目录', value: 'temp-create' },
  { name: 'temp-urls     - 获取临时目录URL', value: 'temp-urls' },
  { name: 'temp-list     - 列出目录内容', value: 'temp-list' },
  { name: 'temp-upload   - 上传文件', value: 'temp-upload' },
  { name: 'temp-copy     - 复制文件', value: 'temp-copy' },
  { name: 'temp-finalize - 完成任务并清理', value: 'temp-finalize' },
  { name: 'temp-delete   - 删除临时目录', value: 'temp-delete' },
  // 目录权限
  { name: '── 目录权限 ──', value: '__sep3__', disabled: true },
  { name: 'dir-list     - 列出我的目录', value: 'dir-list' },
  { name: 'dir-create   - 创建目录', value: 'dir-create' },
  { name: 'dir-info     - 查看目录详情', value: 'dir-info' },
  { name: 'perm-grant   - 分配权限', value: 'perm-grant' },
  { name: 'perm-revoke  - 撤销权限', value: 'perm-revoke' },
  { name: 'perm-list    - 列出目录权限', value: 'perm-list' },
  // 文件操作
  { name: '── 文件操作 ──', value: '__sep4__', disabled: true },
  { name: 'file-read    - 读取文件', value: 'file-read' },
  { name: 'file-write   - 写入文件', value: 'file-write' },
  { name: 'file-delete  - 删除文件', value: 'file-delete' },
  { name: 'file-list    - 列出目录内容', value: 'file-list' },
];

export const storageCommand = new Command('storage')
  .description('存储管理 (Git存储 + OSS临时目录)')
  .argument('[action]', '操作类型')
  .argument('[args...]', '操作参数')
  .option('-p, --path <path>', '路径')
  .option('-t, --target <target>', '目标路径')
  .option('-s, --source <source>', '源路径')
  .option('--owner <ownerId>', '所有者ID')
  .option('--task <taskId>', '任务ID')
  .option('--hash <hash>', '临时目录hash')
  .option('--capacity <capacity>', '配额容量')
  .option('--inodes <inodes>', 'inode数量')
  .option('--preserve', '保留权限')
  .option('--sync-to <path>', '同步到Git存储路径')
  .option('-f, --file <file>', '本地文件路径')
  .option('-a, --all', '查看所有用户的存储数据（仅超级管理员可用）')
  .option('--uid <userId>', '查看指定用户的存储数据（仅超级管理员可用）')
  .action(async (action, args, options) => {
    const client = new StorageClient();
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
        action = await select('选择操作', STORAGE_ACTION_CHOICES);
      }
      if (!action || action.startsWith('__sep')) {
        display.info('已取消');
        return;
      }
      switch (action) {
        // ===== Git存储 =====
        case 'status':
          await showStatus(client);
          break;
        case 'mount':
          await mountGitStorage(client, options.path);
          break;
        case 'clone':
          await cloneSnapshot(client, options.source, options.target, options.preserve);
          break;
        case 'quota':
          await showQuota(client, options.path, args[0]);
          break;
        case 'quota-set':
          await setQuota(client, options.path, options.capacity, options.inodes);
          break;
        case 'quota-delete':
          await deleteQuota(client, options.path);
          break;
          
        // ===== OSS 临时目录 =====
        case 'temp-create':
          await createTempDir(client, options.task, options.owner);
          break;
        case 'temp-urls':
          await getTempUrls(client, options.task, options.hash, options.owner);
          break;
        case 'temp-list':
          await listTempDir(client, options.task, options.owner, options.hash, options.path);
          break;
        case 'temp-upload':
          await uploadToTemp(client, options.task, options.owner, options.hash, options.target, options.file);
          break;
        case 'temp-copy':
          await copyToTemp(client, options.task, options.owner, options.hash, options.source, options.target);
          break;
        case 'temp-finalize':
          await finalizeTemp(client, options.task, options.owner, options.hash, options.syncTo);
          break;
        case 'temp-delete':
          await deleteTemp(client, options.task, options.owner, options.hash);
          break;
          
        // ===== 目录权限 =====
        case 'dir-list':
          await listDirectories(client);
          break;
        case 'dir-create':
          await createDir(client, args[0], options.path, options.owner);
          break;
        case 'dir-info':
          await dirInfo(client, args[0]);
          break;
        case 'perm-grant':
          await grantPerm(client, args[0], args[1], args[2]);
          break;
        case 'perm-revoke':
          await revokePerm(client, args[0]);
          break;
        case 'perm-list':
          await listPerms(client, args[0]);
          break;
          
        // ===== 文件操作 =====
        case 'file-read':
          await readFile(client, options.path);
          break;
        case 'file-write':
          await writeFile(client, options.path, options.file);
          break;
        case 'file-delete':
          await deleteFile(client, options.path);
          break;
        case 'file-list':
          await listFiles(client, options.path);
          break;
          
        default:
          display.error(`未知操作: ${action}`);
          showHelp();
      }
    } catch (err) {
      display.error(err.message);
      process.exit(1);
    }
  });

// ==================== Git存储操作 ====================

async function showStatus(client) {
  const spinner = display.spinner('检查Git存储状态...').start();
  const result = await client.getGitStorageStatus();
  spinner.stop();

  display.title('Git存储状态');

  if (!result.data.enabled) {
    display.warn(result.data.reason || 'Git存储未启用');
    display.info('需要在 ECS 环境中配置 GIT_STORAGE_ENABLED=true');
    return;
  }

  const data = result.data;
  console.log(`  客户端: ${data.clientExists ? chalk.green('✓ 已安装') : chalk.red('✗ 未安装')}`);
  console.log(`  路径: ${data.clientPath}`);
  console.log(`  挂载点: ${data.mountPath}`);
  console.log(`  挂载状态: ${data.mounted ? chalk.green('已挂载') : chalk.yellow('未挂载')}`);
}

async function mountGitStorage(client, mountPath) {
  display.warn('mount 操作已废弃（原 lakefs 挂载概念不再适用于 Git 存储）');
  display.info('Git 存储默认可用，无需手动挂载');
}

async function cloneSnapshot(client, source, target, preserve) {
  if (!source || !target) {
    display.error('请提供源路径和目标路径');
    display.info('用法: dove storage clone -s <source> -t <target>');
    return;
  }
  
  const spinner = display.spinner(`克隆快照: ${source} → ${target}`).start();
  const result = await client.cloneSnapshot(source, target, preserve);
  spinner.stop();
  
  if (result.success) {
    display.success(`克隆完成`);
    if (result.data.output) {
      console.log(result.data.output);
    }
  }
}

async function showQuota(client, quotaPath, action) {
  const spinner = display.spinner('获取配额信息...').start();
  const result = await client.getQuota(quotaPath);
  spinner.stop();
  
  display.title('配额信息');
  
  if (result.data.output) {
    console.log(result.data.output);
  } else {
    display.info('无配额信息');
  }
}

async function setQuota(client, quotaPath, capacity, inodes) {
  if (!quotaPath) {
    display.error('请提供路径: --path <path>');
    return;
  }
  
  const spinner = display.spinner(`设置配额: ${quotaPath}`).start();
  const result = await client.setQuota(quotaPath, capacity ? parseInt(capacity) : undefined, inodes ? parseInt(inodes) : undefined);
  spinner.stop();
  
  if (result.success) {
    display.success(`配额已设置`);
  }
}

async function deleteQuota(client, quotaPath) {
  if (!quotaPath) {
    display.error('请提供路径: --path <path>');
    return;
  }
  
  const spinner = display.spinner(`删除配额: ${quotaPath}`).start();
  const result = await client.deleteQuota(quotaPath);
  spinner.stop();
  
  if (result.success) {
    display.success(`配额已删除`);
  }
}

// ==================== 目录权限操作 ====================

async function listDirectories(client) {
  const spinner = display.spinner('列出目录...').start();
  const result = await client.listMyDirectories();
  spinner.stop();
  
  display.title('我的目录');
  
  if (!result.directories || result.directories.length === 0) {
    display.info('暂无目录');
    return;
  }
  
  result.directories.forEach(dir => {
    const perm = dir.我的权限;
    const permStr = perm === 31 ? '管理员' : `权限:${perm}`;
    console.log(`  📁 ${dir.名称 || dir.路径}`);
    console.log(`     ID: ${dir.目录ID} | ${permStr}`);
  });
}

async function createDir(client, name, dirPath, ownerId) {
  if (!name || !dirPath) {
    display.error('请提供目录名称和路径');
    display.info('用法: dove storage dir-create <名称> -p <路径>');
    return;
  }
  
  const spinner = display.spinner(`创建目录: ${name}`).start();
  const result = await client.createDirectory(dirPath, name, { 拥有者ID: ownerId });
  spinner.stop();
  
  if (result.success) {
    display.success(`目录已创建`);
    console.log(`  ID: ${result.directory.目录ID}`);
    console.log(`  路径: ${result.directory.路径}`);
  }
}

async function dirInfo(client, dirId) {
  if (!dirId) {
    display.error('请提供目录ID');
    return;
  }
  
  const spinner = display.spinner('获取目录信息...').start();
  const result = await client.getDirectory(dirId);
  spinner.stop();
  
  display.title('目录详情');
  console.log(`  ID: ${result.directory.目录ID}`);
  console.log(`  名称: ${result.directory.名称 || '-'}`);
  console.log(`  路径: ${result.directory.路径}`);
  console.log(`  类型: ${result.directory.类型 || '-'}`);
  console.log(`  状态: ${result.directory.状态 || '-'}`);
  
  if (result.directory.权限列表 && result.directory.权限列表.length > 0) {
    console.log('');
    display.title('权限列表');
    result.directory.权限列表.forEach(p => {
      console.log(`  用户: ${p.用户ID} | 权限: ${p.权限值}`);
    });
  }
}

async function grantPerm(client, dirId, userId, permission) {
  if (!dirId) {
    display.error('请提供目录ID');
    return;
  }
  if (!userId) {
    display.error('请提供用户ID');
    return;
  }
  
  // 交互式多选权限位
  if (!permission) {
    const selected = await multiSelect('选择权限（空格勾选，回车确认）', PERM_BIT_CHOICES);
    if (selected.length === 0) {
      display.info('未选择任何权限');
      return;
    }
    permission = selected.reduce((sum, bit) => sum + bit, 0);
  } else {
    permission = parseInt(permission, 10);
  }
  
  const spinner = display.spinner('分配权限...').start();
  const result = await client.grantPermission(dirId, userId, permission);
  spinner.stop();
  
  if (result.success) {
    display.success(`权限已分配: ${permissionToString(permission)}`);
    console.log(`  权限ID: ${result.permission.权限ID}`);
  }
}

async function revokePerm(client, permId) {
  if (!permId) {
    display.error('请提供权限ID');
    return;
  }
  
  const spinner = display.spinner('撤销权限...').start();
  const result = await client.revokePermission(permId);
  spinner.stop();
  
  if (result.success) {
    display.success(`权限已撤销`);
  }
}

async function listPerms(client, dirId) {
  if (!dirId) {
    display.error('请提供目录ID');
    return;
  }
  
  const spinner = display.spinner('列出权限...').start();
  const result = await client.listDirectoryPermissions(dirId);
  spinner.stop();
  
  display.title('目录权限');
  
  if (!result.permissions || result.permissions.length === 0) {
    display.info('暂无权限记录');
    return;
  }
  
  result.permissions.forEach(p => {
    const permStr = permissionToString(p.权限值);
    console.log(`  用户: ${p.用户ID}`);
    console.log(`     权限: ${permStr} (${p.权限值})`);
    console.log(`     ID: ${p.权限ID}`);
    console.log('');
  });
}

function permissionToString(perm) {
  const parts = [];
  if (perm & 1) parts.push('查看');
  if (perm & 2) parts.push('下载');
  if (perm & 4) parts.push('编辑');
  if (perm & 8) parts.push('删除');
  if (perm & 16) parts.push('管理');
  return parts.join('+') || '无';
}

// ==================== 文件操作 ====================

async function readFile(client, filePath) {
  if (!filePath) {
    display.error('请提供文件路径: --path <路径>');
    return;
  }
  
  const spinner = display.spinner(`读取文件: ${filePath}`).start();
  
  try {
    const content = await client.readFile(filePath);
    spinner.stop();
    console.log(content);
  } catch (err) {
    spinner.stop();
    if (err.message === '文件不存在') {
      display.error('文件不存在');
    } else {
      throw err;
    }
  }
}

async function writeFile(client, filePath, localFile) {
  if (!filePath) {
    display.error('请提供文件路径: --path <路径>');
    return;
  }

  if (!localFile) {
    display.error('请提供本地文件: --file <本地文件>');
    return;
  }

  if (!fs.existsSync(localFile)) {
    display.error(`本地文件不存在: ${localFile}`);
    return;
  }

  const stat = fs.statSync(localFile);
  const isLargeOrBinary = stat.size > 64 * 1024; // > 64KB 视为大文件/二进制

  if (isLargeOrBinary) {
    // 大文件/二进制：流式上传到 OSS
    const spinner = display.spinner(`上传文件: ${filePath}`).start();
    try {
      const result = await client.streamUploadFile(localFile, null, {
        fileName: filePath,
        onProgress: (percent) => { spinner.text = `上传文件: ${filePath} ${percent}%`; },
      });
      spinner.stop();
      display.success(`文件已上传到 OSS: ${result.url}`);
    } catch (err) {
      spinner.stop();
      display.error(`上传失败: ${err.message}`);
    }
  } else {
    // 小文本文件：直接写入（适合配置文件等小文本）
    const content = fs.readFileSync(localFile, 'utf-8');
    const spinner = display.spinner(`写入文件: ${filePath}`).start();
    const result = await client.writeFile(filePath, content);
    spinner.stop();

    if (result.success) {
      display.success(`文件已写入`);
      if (result.path) {
        console.log(`  路径: ${result.path}`);
      }
    }
  }
}

async function deleteFile(client, filePath) {
  if (!filePath) {
    display.error('请提供文件路径: --path <路径>');
    return;
  }
  
  const spinner = display.spinner(`删除文件: ${filePath}`).start();
  
  try {
    const result = await client.deleteFile(filePath);
    spinner.stop();
    
    if (result.success) {
      display.success(`文件已删除`);
    }
  } catch (err) {
    spinner.stop();
    if (err.message === '文件不存在') {
      display.error('文件不存在');
    } else {
      throw err;
    }
  }
}

async function listFiles(client, dirPath) {
  const spinner = display.spinner(`列出目录...`).start();
  const result = await client.listFiles(dirPath || '');
  spinner.stop();
  
  display.title(`目录: ${result.path || dirPath || '/'}`);
  
  if (!result.files || result.files.length === 0) {
    display.info('目录为空');
    return;
  }
  
  result.files.forEach(file => {
    if (file.name === '.keep') return;
    const size = file.size ? ` (${formatSize(file.size)})` : '';
    const type = file.isDirectory ? '📁' : '📄';
    console.log(`  ${type} ${file.name}${size}`);
  });
}

function showHelp() {
  console.log('');
  display.title('Git存储操作');
  console.log('  status        查看Git存储状态');
  console.log('  mount         挂载Git存储');
  console.log('  clone         克隆快照');
  console.log('  quota         查看配额');
  console.log('  quota-set     设置配额');
  console.log('  quota-delete  删除配额');
  console.log('');
  display.title('OSS 临时目录操作');
  console.log('  temp-create   创建临时目录');
  console.log('  temp-urls     获取临时目录URL');
  console.log('  temp-list     列出目录内容');
  console.log('  temp-upload   上传文件');
  console.log('  temp-copy     复制文件');
  console.log('  temp-finalize 完成任务并清理');
  console.log('  temp-delete   删除临时目录');
  console.log('');
  display.title('目录权限操作');
  console.log('  dir-list      列出我的目录');
  console.log('  dir-create    创建目录 <名称> -p <路径>');
  console.log('  dir-info      查看目录详情 <目录ID>');
  console.log('  perm-grant    分配权限 <目录ID> <用户ID> <权限>');
  console.log('  perm-revoke   撤销权限 <权限ID>');
  console.log('  perm-list     列出目录权限 <目录ID>');
  console.log('');
  display.title('文件操作');
  console.log('  file-read     读取文件 -p <路径>');
  console.log('  file-write    写入文件 -p <路径> -f <本地文件>');
  console.log('  file-delete   删除文件 -p <路径>');
  console.log('  file-list     列出目录内容 -p <路径>');
}
