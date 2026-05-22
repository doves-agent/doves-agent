/**
 * dove app 命令 — 扩展应用管理
 *
 * 子命令：
 *   install <name>   安装扩展（展示权限摘要，用户确认后授权）
 *   uninstall <name> 撤销授权
 *   info <name>      查看扩展注册信息及权限声明
 *   list             列出已安装扩展
 *   submit           开发者提交审核
 *   review           管理员审核
 *   pending          列出待审核
 *   check <name>     检查运行模式
 *   publish <dir>    编译并发布扩展包到仓库  (→ app-publish.js)
 *   search [keyword] 搜索扩展包仓库        (→ app-publish.js)
 *   create <name>    创建新应用脚手架        (→ app-create.js)
 *   validate <dir>   校验 manifest 完整性    (→ app-create.js)
 *   dev <dir>        沙盒测试环境            (→ app-create.js)
 *   download <name>  下载扩展包              (→ app-publish.js)
 */

import { Command } from 'commander';
import { DoveClient } from '../client.js';
import { formatPermissionSummary, askConfirm } from './app-templates.js';
import { registerPublishCommand, registerSearchCommand, registerDownloadCommand } from './app-publish.js';
import { registerCreateCommand, registerValidateCommand, registerDevCommand } from './app-create.js';

export const appCommand = new Command('app')
  .description('扩展应用管理');

// ---- app install <name> ----
appCommand.command('install <name>')
  .description('安装扩展（展示权限摘要，确认后授权）')
  .option('-y, --yes', '跳过确认提示')
  .action(async (name, options) => {
    try {
      const client = new DoveClient();
      // 1. 从官方注册表查询扩展信息
      const registry = await client.getExtensionRegistry(name);
        if (!registry) {
          console.error(`扩展 "${name}" 未在官方注册表中发现`);
          console.log('提示: 开发者需先通过 dove app submit 提交审核');
          return;
        }

        // 2. 展示扩展信息和权限摘要
        console.log(`\n${registry.description || name} v${registry.version || '?'}\n`);
        console.log('该应用需要以下权限：');
        const summary = formatPermissionSummary(registry.permissions);
        console.log(summary);
        console.log();

        // 3. 用户确认（除非 -y）
        if (!options.yes) {
          const confirmed = await askConfirm('是否授权安装？ [y/N] ');
          if (!confirmed) {
            console.log('已取消安装');
            return;
          }
        }

        // 4. 调用授权 API
        const result = await client.authorizeExtension(name);
        if (result.success) {
          console.log(`✅ 扩展 "${name}" 已授权安装`);
        } else {
          console.error(`❌ 授权失败: ${result.error || result.message || '未知错误'}`);
        }
      } catch (e) {
        console.error(`安装失败: ${e.message}`);
      }
    });

// ---- app uninstall <name> ----
appCommand.command('uninstall <name>')
  .description('撤销扩展授权')
  .action(async (name) => {
    try {
      const client = new DoveClient();
      const result = await client.revokeExtension(name);
        if (result.success) {
          console.log(`✅ 扩展 "${name}" 授权已撤销`);
        } else {
          console.error(`❌ 撤销失败: ${result.error || result.message || '未知错误'}`);
        }
      } catch (e) {
        console.error(`撤销失败: ${e.message}`);
      }
    });

// ---- app info <name> ----
appCommand.command('info <name>')
  .description('查看扩展注册信息及权限声明')
  .action(async (name) => {
    try {
      const client = new DoveClient();
      const registry = await client.getExtensionRegistry(name);
        if (!registry) {
          console.error(`扩展 "${name}" 未在官方注册表中发现`);
          return;
        }

        console.log(`\n📦 ${name} v${registry.version || '?'}`);
        if (registry.description) console.log(`   描述: ${registry.description}`);
        if (registry.devId) console.log(`   开发者: ${registry.devId}`);
        console.log(`   状态: ${registry.status || '未知'}`);
        if (registry.signatureVerified) console.log(`   签名: ✅ 已验证`);

        console.log('\n权限声明:');
        const summary = formatPermissionSummary(registry.permissions);
        console.log(summary);
        console.log();
      } catch (e) {
        console.error(`查询失败: ${e.message}`);
      }
    });

// ---- app list ----
appCommand.command('list')
  .description('列出已授权扩展')
  .option('-a, --all', '查看所有用户的扩展（仅超级管理员可用）')
  .option('--uid <userId>', '查看指定用户的扩展（仅超级管理员可用）')
  .action(async (options) => {
    try {
      const client = new DoveClient();
      
      // 超管 --all 权限检查
      if (options.all) {
        if (!client.isAdmin()) {
          console.error('--all 选项仅超级管理员可用，请使用 dove login --admin 登录');
          return;
        }
        client.setAdminAll(true);
      }
      
      // 超管 --uid 权限检查
      if (options.uid) {
        if (!client.isAdmin()) {
          console.error('--uid 选项仅超级管理员可用，请使用 dove login --admin 登录');
          return;
        }
        client.setTargetUserId(options.uid);
      }
      
      const extensions = await client.listAuthorizedExtensions();
        if (!extensions || extensions.length === 0) {
          console.log('未安装任何扩展');
          return;
        }

        console.log('\n已授权扩展:');
        for (const ext of extensions) {
          console.log(`  ${ext.extensionName} (开发者: ${ext.devId || '未知'}, 授权于: ${ext.authorizedAt || '?'})`);
        }
        console.log();
      } catch (e) {
        console.error(`列出失败: ${e.message}`);
      }
    });

// ---- app submit ----
appCommand.command('submit')
  .description('提交扩展审核')
  .requiredOption('--name <name>', '扩展名称')
  .requiredOption('--dev-id <devId>', '开发者ID')
  .option('--version <version>', '版本号')
  .option('--description <desc>', '描述')
  .action(async (options) => {
    try {
      const client = new DoveClient();
      const result = await client.submitExtensionReview({
          devId: options.devId,
          extensionName: options.name,
          version: options.version,
          description: options.description,
        });
        if (result.success) {
          console.log(`✅ 扩展 "${options.name}" 已提交审核`);
        } else {
          console.error(`❌ 提交失败: ${result.error || result.message || '未知错误'}`);
        }
      } catch (e) {
        console.error(`提交失败: ${e.message}`);
      }
    });

// ---- app review ----
appCommand.command('review')
  .description('审核扩展（管理员）')
  .requiredOption('--name <name>', '扩展名称')
  .option('--approve', '审核通过')
  .option('--reject', '审核拒绝')
  .option('--note <note>', '审核备注')
  .action(async (options) => {
    try {
      const client = new DoveClient();
      const action = options.approve ? 'approve' : options.reject ? 'reject' : null;
      if (!action) {
        console.error('请指定 --approve 或 --reject');
        return;
      }
      const result = await client.reviewExtension(options.name, action, options.note);
        if (result.success) {
          console.log(`✅ 扩展 "${options.name}" 已${action === 'approve' ? '通过' : '拒绝'}审核`);
        } else {
          console.error(`❌ 审核失败: ${result.error || result.message || '未知错误'}`);
        }
      } catch (e) {
        console.error(`审核失败: ${e.message}`);
      }
    });

// ---- app pending ----
appCommand.command('pending')
  .description('列出待审核扩展（管理员）')
  .action(async () => {
    try {
      const client = new DoveClient();
      const list = await client.listPendingExtensions();
        if (!list || list.length === 0) {
          console.log('没有待审核的扩展');
          return;
        }

        console.log('\n待审核扩展:');
        for (const ext of list) {
          console.log(`  ${ext.extensionName} v${ext.version || '?'} (开发者: ${ext.devId || '?'})`);
        }
        console.log();
      } catch (e) {
        console.error(`查询失败: ${e.message}`);
      }
    });

// ---- app check <name> ----
appCommand.command('check <name>')
  .description('检查扩展运行模式')
  .option('--dev-id <devId>', '开发者ID')
  .action(async (name, options) => {
    try {
      const client = new DoveClient();
      const result = await client.checkExtensionMode(name, options.devId, {});
        if (result.success && result.data) {
          const { mode, warnings } = result.data;
          console.log(`扩展 "${name}" 运行模式: ${mode}`);
          if (warnings && warnings.length > 0) {
            console.log('警告:');
            for (const w of warnings) {
              console.log(`  ⚠️  ${w}`);
            }
          }
        } else {
          console.error(`❌ 检查失败: ${result.error || '未知错误'}`);
        }
      } catch (e) {
        console.error(`检查失败: ${e.message}`);
      }
    });

// ==================== 注册拆分到子文件的子命令 ====================
registerPublishCommand(appCommand);
registerSearchCommand(appCommand);
registerDownloadCommand(appCommand);
registerCreateCommand(appCommand);
registerValidateCommand(appCommand);
registerDevCommand(appCommand);

export default appCommand;
