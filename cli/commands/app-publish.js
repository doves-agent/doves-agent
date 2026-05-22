/**
 * @file app-publish
 * @description dove app publish / search / download 子命令
 *
 * 从 app.js 拆分，KISS 原则
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { DoveClient } from '../client.js';

// ---- app publish <dir> ----
export function registerPublishCommand(appCommand) {
  appCommand.command('publish <dir>')
    .description('编译并发布扩展包到仓库')
    .option('--signing-key <key>', '开发者签名密钥')
    .option('--dry-run', '仅编译不上传')
    .action(async (dir, options) => {
      try {
        const 扩展目录 = resolve(dir);
        if (!existsSync(扩展目录)) {
          console.error(`目录不存在: ${扩展目录}`);
          return;
        }

        // 1. 编译
        console.log(`正在编译: ${扩展目录}`);
        const { compileExtension } = await import('../../doves/extensions/扩展包编译器.js');
        const 输出目录 = join(扩展目录, '..');
        const result = await compileExtension(扩展目录, 输出目录, {
          signingKey: options.signingKey,
        });

        if (!result.success) {
          console.error(`❌ 编译失败: ${result.error}`);
          return;
        }

        console.log(`✅ 编译成功: ${result.doveFileName} (${(result.fileSize / 1024).toFixed(1)} KB)`);

        if (options.dryRun) {
          console.log('（dry-run 模式，未上传）');
          console.log(`文件位置: ${result.doveFile}`);
          return;
        }

        // 2. 注册索引到 Server
        const client = new DoveClient();
        const publishResult = await client.publishExtension(result.metadata);
        if (!publishResult.success) {
          console.error(`❌ 索引注册失败: ${publishResult.error}`);
          return;
        }

        console.log(`✅ 索引已注册: ${result.metadata.name} v${result.metadata.version}`);

        // 3. 获取上传 URL 并上传 .dove 文件
        const uploadResult = await client.getExtensionUploadUrl(result.metadata.name, result.metadata.version);
        if (!uploadResult.success) {
          console.error(`❌ 获取上传地址失败: ${uploadResult.error}`);
          return;
        }

        const { uploadUrl, method, contentType } = uploadResult.data;
        const doveBuffer = await import('fs').then(fs => fs.default.readFileSync(result.doveFile));

        console.log('正在上传 .dove 文件到 OSS...');
        const uploadResponse = await fetch(uploadUrl, {
          method: method || 'PUT',
          headers: { 'Content-Type': contentType || 'application/gzip' },
          body: doveBuffer,
        });

        if (uploadResponse.ok) {
          console.log(`✅ 发布成功: ${result.metadata.name} v${result.metadata.version}`);
        } else {
          console.error(`❌ 上传失败: ${uploadResponse.status} ${uploadResponse.statusText}`);
        }
      } catch (e) {
        console.error(`发布失败: ${e.message}`);
      }
    });
}

// ---- app search [keyword] ----
export function registerSearchCommand(appCommand) {
  appCommand.command('search [keyword]')
    .description('搜索扩展包仓库')
    .option('--page <n>', '页码', '1')
    .option('--limit <n>', '每页数量', '20')
    .action(async (keyword, options) => {
      try {
        const client = new DoveClient();
        const result = await client.searchExtensions(keyword || '', {
          page: parseInt(options.page),
          limit: parseInt(options.limit),
        });

        if (!result.success) {
          console.error(`搜索失败: ${result.error}`);
          return;
        }

        const { total, 列表 } = result.data;
        if (!列表 || 列表.length === 0) {
          console.log('没有找到扩展包');
          return;
        }

        console.log(`\n扩展包仓库 (共 ${total} 个):\n`);
        for (const item of 列表) {
          const 官方标记 = item.developer?.isOfficial ? ' [官方]' : '';
          const deps = item.dependencies?.length > 0 ? ` 依赖:${item.dependencies.join(',')}` : '';
          console.log(`  ${item.name} v${item.latestVersion}${官方标记}`);
          console.log(`    ${item.description || '无描述'}`);
          if (item.abilities?.length > 0) {
            console.log(`    能力: ${item.abilities.join(', ')}${deps}`);
          }
        }
        console.log();
      } catch (e) {
        console.error(`搜索失败: ${e.message}`);
      }
    });
}

// ---- app download <name> ----
export function registerDownloadCommand(appCommand) {
  appCommand.command('download <name>')
    .description('下载扩展包')
    .option('--version <version>', '指定版本（默认最新）')
    .option('--output <dir>', '输出目录（默认当前目录）')
    .action(async (name, options) => {
      try {
        const client = new DoveClient();
        const result = await client.downloadExtension(name, options.version);

        if (!result.success) {
          console.error(`下载失败: ${result.error}`);
          return;
        }

        const { downloadUrl, version } = result.data;
        const 输出目录 = options.output ? resolve(options.output) : process.cwd();
        const 输出文件 = join(输出目录, `${name}-${version}.dove`);

        if (!existsSync(输出目录)) {
          mkdirSync(输出目录, { recursive: true });
        }

        console.log(`正在下载 ${name} v${version}...`);
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          console.error(`下载失败: ${response.status} ${response.statusText}`);
          return;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        writeFileSync(输出文件, buffer);

        console.log(`✅ 已下载: ${输出文件} (${(buffer.length / 1024).toFixed(1)} KB)`);
      } catch (e) {
        console.error(`下载失败: ${e.message}`);
      }
    });
}
