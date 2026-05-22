/**
 * 数据命令（KISS 合并版）
 * 合并: file + storage + memory
 * 
 * 用法:
 *   dove data ls [path]           # 文件列表 (原 file list)
 *   dove data read <path>         # 读取文件 (原 file read)
 *   dove data upload <path>       # 上传文件 (原 file upload)
 *   dove data download <path>     # 下载文件 (原 file download)
 *   dove data rm <path>           # 删除文件 (原 file delete)
 *   dove data storage status      # 存储状态 (原 storage status)
 *   dove data storage mount       # 挂载Git存储 (原 storage mount)
 *   dove data storage temp-create # OSS临时目录 (原 storage temp-create)
 *   dove data mem search <query>  # 记忆搜索 (原 memory search)
 *   dove data mem list            # 记忆列表 (原 memory list)
 *   dove data mem add <content>   # 添加记忆 (原 memory add)
 *   dove data mem stats           # 记忆统计 (原 memory stats)
 */

import { Command } from 'commander';
import { display } from '../display.js';
import { DoveClient } from '../client.js';
import { StorageClient } from '../lib/storage.js';
import chalk from 'chalk';

const dataCommand = new Command('data')
  .description('数据存取 (文件/存储/记忆)');

// ==================== 文件操作子命令 ====================

const fileSub = new Command('ls')
  .description('列出文件')
  .argument('[path]', '目录路径', '/')
  .option('--json', 'JSON 格式输出')
  .action(async (filePath, options) => {
    const client = new DoveClient();
    await client.connectEncrypted();
    try {
      const spinner = display.spinner('列出文件...').start();
      const result = await client.listFiles(filePath);
      spinner.stop();
      
      if (options.json) { console.log(JSON.stringify(result, null, 2)); return; }
      
      if (result && result.files) {
        result.files.forEach(f => {
          const size = f.size ? `${(f.size / 1024).toFixed(1)}KB` : '';
          console.log(`  ${f.type === 'dir' ? '📁' : '📄'} ${f.name}  ${size}`);
        });
      } else if (Array.isArray(result)) {
        result.forEach(f => console.log(`  ${typeof f === 'string' ? f : JSON.stringify(f)}`));
      } else {
        display.info('空目录');
      }
    } catch (err) {
      display.error(err.message);
    }
  });

const readSub = new Command('read')
  .description('读取文件')
  .argument('<path>', '文件路径')
  .option('-o, --output <file>', '保存到本地文件')
  .action(async (filePath, options) => {
    const client = new DoveClient();
    await client.connectEncrypted();
    try {
      const spinner = display.spinner('读取文件...').start();
      const result = await client.readFile(filePath);
      spinner.stop();
      
      if (options.output) {
        const fs = await import('fs');
        fs.writeFileSync(options.output, result.content);
        display.success(`已保存到: ${options.output}`);
      } else {
        console.log(result.content);
      }
    } catch (err) {
      display.error(err.message);
    }
  });

const uploadSub = new Command('upload')
  .description('上传文件')
  .argument('<path>', '本地文件路径')
  .option('-d, --dest <dest>', '目标路径')
  .action(async (localPath, options) => {
    const client = new DoveClient();
    await client.connectEncrypted();
    try {
      const fs = await import('fs');
      const content = fs.readFileSync(localPath, 'utf-8');
      const destPath = options.dest || `/upload/${path.basename(localPath)}`;
      const spinner = display.spinner('上传中...').start();
      const result = await client.writeFile(destPath, content);
      spinner.stop();
      display.success(`已上传: ${destPath}`);
    } catch (err) {
      display.error(err.message);
    }
  });

const rmSub = new Command('rm')
  .description('删除文件')
  .argument('<path>', '文件路径')
  .action(async (filePath) => {
    const client = new DoveClient();
    await client.connectEncrypted();
    try {
      const spinner = display.spinner('删除中...').start();
      await client.deleteFile(filePath);
      spinner.stop();
      display.success(`已删除: ${filePath}`);
    } catch (err) {
      display.error(err.message);
    }
  });

// ==================== 存储管理子命令 ====================

const storageSub = new Command('storage')
  .description('存储管理 (Git存储 + OSS)');

storageSub
  .command('status')
  .description('存储状态')
  .action(async () => {
    const client = new StorageClient();
    try {
      const spinner = display.spinner('获取存储状态...').start();
      const result = await client.getStatus();
      spinner.stop();
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      display.error(err.message);
    }
  });

storageSub
  .command('mount')
  .description('挂载Git存储')
  .option('-p, --path <path>', '挂载路径')
  .action(async (options) => {
    const client = new StorageClient();
    try {
      const spinner = display.spinner('挂载中...').start();
      const result = await client.mountLakefs(options.path);
      spinner.stop();
      display.success('挂载成功');
    } catch (err) {
      display.error(err.message);
    }
  });

storageSub
  .command('temp-create')
  .description('创建OSS临时目录')
  .option('--task <taskId>', '任务ID')
  .option('--owner <ownerId>', '所有者ID')
  .action(async (options) => {
    const client = new StorageClient();
    try {
      const spinner = display.spinner('创建临时目录...').start();
      const result = await client.createTempDir(options.task, options.owner);
      spinner.stop();
      display.success('临时目录已创建');
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      display.error(err.message);
    }
  });

storageSub
  .command('temp-list')
  .description('列出OSS临时目录')
  .action(async () => {
    const client = new StorageClient();
    try {
      const spinner = display.spinner('获取临时目录列表...').start();
      const result = await client.listTempDirs();
      spinner.stop();
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      display.error(err.message);
    }
  });

// ==================== 记忆管理子命令 ====================

const memSub = new Command('mem')
  .description('记忆管理 (Git记忆)');

memSub
  .command('search')
  .alias('s')
  .description('语义搜索记忆')
  .argument('<query>', '搜索查询')
  .option('--threshold <n>', '相似度阈值', parseFloat, 0.3)
  .option('--top-k <n>', '返回数量', parseInt, 10)
  .option('--json', 'JSON 格式输出')
  .action(async (query, options) => {
    const client = new DoveClient();
    try {
      await client.ensureAuth();
      const spinner = display.spinner('搜索记忆...').start();
      const data = await client.post('/api/memory/search', { query, threshold: options.threshold, topK: options.topK });
      spinner.stop();

      if (options.json) { console.log(JSON.stringify(data, null, 2)); return; }

      if (data?.results?.length > 0) {
        display.title('搜索结果');
        data.results.forEach((r, i) => {
          console.log(`  ${i + 1}. [${(r.score * 100).toFixed(0)}%] ${r.content?.slice(0, 80) || r.text?.slice(0, 80) || JSON.stringify(r).slice(0, 80)}`);
        });
      } else {
        display.info('未找到相关记忆');
      }
    } catch (err) {
      display.error(err.message);
    }
  });

memSub
  .command('list')
  .alias('ls')
  .description('列出记忆')
  .option('-l, --limit <n>', '每页数量', '20')
  .option('-t, --type <type>', '按类型筛选')
  .option('--json', 'JSON 格式输出')
  .action(async (options) => {
    const client = new DoveClient();
    try {
      await client.ensureAuth();
      const spinner = display.spinner('获取记忆列表...').start();
      const data = await client.get(`/api/memory/list?limit=${options.limit}${options.type ? '&type=' + options.type : ''}`);
      spinner.stop();

      if (options.json) { console.log(JSON.stringify(data, null, 2)); return; }

      if (data?.memories?.length > 0) {
        data.memories.forEach(m => {
          console.log(`  ${m.type || '?'} ${m.content?.slice(0, 60) || '?'}  ${m.createdAt || ''}`);
        });
      } else {
        display.info('暂无记忆');
      }
    } catch (err) {
      display.error(err.message);
    }
  });

memSub
  .command('add')
  .alias('a')
  .description('添加记忆')
  .argument('<content>', '记忆内容')
  .option('-t, --type <type>', '记忆类型')
  .action(async (content, options) => {
    const client = new DoveClient();
    try {
      await client.ensureAuth();
      const spinner = display.spinner('添加记忆...').start();
      await client.post('/api/memory/add', { content, type: options.type });
      spinner.stop();
      display.success('记忆已添加');
    } catch (err) {
      display.error(err.message);
    }
  });

memSub
  .command('stats')
  .description('记忆统计')
  .action(async () => {
    const client = new DoveClient();
    try {
      await client.ensureAuth();
      const spinner = display.spinner('获取统计...').start();
      const data = await client.get('/api/memory/stats');
      spinner.stop();
      console.log(JSON.stringify(data, null, 2));
    } catch (err) {
      display.error(err.message);
    }
  });

// ==================== 注册所有子命令 ====================

dataCommand.addCommand(fileSub);
dataCommand.addCommand(readSub);
dataCommand.addCommand(uploadSub);
dataCommand.addCommand(rmSub);
dataCommand.addCommand(storageSub);
dataCommand.addCommand(memSub);

export { dataCommand };
export default dataCommand;

