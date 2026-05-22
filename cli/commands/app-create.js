/**
 * @file app-create
 * @description dove app create / validate / dev 子命令
 *
 * 从 app.js 拆分，KISS 原则
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { DoveClient } from '../client.js';
import { createMockContext, testToolInSandbox } from '../lib/extension-sandbox.js';
import { formatPermissionSummary } from './app-templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- app create <name> ----
export function registerCreateCommand(appCommand) {
  appCommand.command('create <name>')
    .description('创建新的白鸽应用脚手架（生成 manifest.js + 模板文件）')
    .option('--dir <dir>', '目标目录（默认当前目录）')
    .option('--description <desc>', '应用描述')
    .action(async (name, options) => {
      try {
        // 延迟导入模板函数（避免循环依赖）
        const {
          generateManifestTemplate, generateIntentTemplate, generateStrategyTemplate,
          generateRolesTemplate, generateReviewTemplate, generateExecutionTemplate,
          generateExampleToolTemplate, generateExampleSkillTemplate, generateReadmeTemplate,
        } = await import('./app-templates.js');

        const 目标目录 = options.dir ? resolve(options.dir) : process.cwd();
        const 应用目录 = join(目标目录, name);

        if (existsSync(应用目录)) {
          console.error(`目录已存在: ${应用目录}`);
          return;
        }

        console.log(`正在创建白鸽应用: ${name}`);

        // 创建目录结构
        mkdirSync(应用目录, { recursive: true });
        mkdirSync(join(应用目录, 'tools'));
        mkdirSync(join(应用目录, 'skills'));
        mkdirSync(join(应用目录, 'web'));

        const description = options.description || `${name} - 白鸽应用`;

        // 生成各文件
        writeFileSync(join(应用目录, 'manifest.js'), generateManifestTemplate(name, description), 'utf-8');
        writeFileSync(join(应用目录, 'intent.js'), generateIntentTemplate(name), 'utf-8');
        writeFileSync(join(应用目录, 'strategy.js'), generateStrategyTemplate(), 'utf-8');
        writeFileSync(join(应用目录, 'roles.js'), generateRolesTemplate(), 'utf-8');
        writeFileSync(join(应用目录, 'review.js'), generateReviewTemplate(), 'utf-8');
        writeFileSync(join(应用目录, 'execution.js'), generateExecutionTemplate(), 'utf-8');
        writeFileSync(join(应用目录, 'tools', 'example.js'), generateExampleToolTemplate(name), 'utf-8');

        const skillDir = join(应用目录, 'skills', 'example');
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(join(skillDir, 'index.js'), generateExampleSkillTemplate(name), 'utf-8');
        writeFileSync(join(应用目录, 'README.md'), generateReadmeTemplate(name, description), 'utf-8');
        writeFileSync(join(应用目录, '.gitignore'), 'node_modules\n.dove-build-*\n*.dove\n', 'utf-8');

        console.log('');
        console.log(`✅ 白鸽应用 "${name}" 创建成功！`);
        console.log('');
        console.log('📁 目录结构:');
        console.log(`  ${name}/`);
        console.log('  ├── manifest.js       # 应用声明（名称/版本/能力/权限）');
        console.log('  ├── intent.js         # 意图定义');
        console.log('  ├── strategy.js       # 规划策略');
        console.log('  ├── roles.js          # 角色定义');
        console.log('  ├── review.js         # 审核规则（可选）');
        console.log('  ├── execution.js      # 执行器增强（可选）');
        console.log('  ├── tools/            # 工具目录');
        console.log('  │   └── example.js    # 示例工具');
        console.log('  ├── skills/           # 技能目录');
        console.log('  │   └── example/      # 示例技能');
        console.log('  ├── web/              # Web 页面（可选）');
        console.log('  ├── README.md');
        console.log('  └── .gitignore');
        console.log('');
        console.log('🚀 下一步:');
        console.log(`  cd ${name}`);
        console.log('  # 编辑 manifest.js 完善应用声明');
        console.log('  # 编辑 tools/ 和 skills/ 实现业务逻辑');
        console.log(`  dove app validate ${name}    # 校验 manifest 完整性`);
        console.log(`  dove app dev ${name}         # 沙盒测试`);
        console.log(`  dove app publish ${name}     # 编译发布`);
      } catch (e) {
        console.error(`创建失败: ${e.message}`);
      }
    });
}

// ---- app validate <dir> ----
export function registerValidateCommand(appCommand) {
  appCommand.command('validate <dir>')
    .description('校验 manifest.js 完整性与权限声明合理性')
    .action(async (dir) => {
      try {
        const 应用目录 = resolve(dir);
        if (!existsSync(应用目录)) {
          console.error(`目录不存在: ${应用目录}`);
          return;
        }

        const manifestPath = join(应用目录, 'manifest.js');
        if (!existsSync(manifestPath)) {
          console.error(`缺少 manifest.js: ${manifestPath}`);
          return;
        }

        console.log(`校验白鸽应用: ${应用目录}`);
        console.log('');

        let errors = [];
        let warnings = [];
        let passes = [];

        // 1. 加载 manifest.js
        let manifest;
        try {
          const manifestFileUrl = `file://${resolve(manifestPath)}`;
          const manifestModule = await import(manifestFileUrl);
          manifest = manifestModule.default || manifestModule;
        } catch (e) {
          errors.push(`manifest.js 加载失败: ${e.message}`);
        }

        if (!manifest) {
          console.log('❌ 校验失败，无法继续');
          for (const e of errors) console.log(`  ❌ ${e}`);
          return;
        }

        // 2. 基本信息校验
        if (!manifest.name || typeof manifest.name !== 'string') {
          errors.push('缺少 name 字段（应用名，建议使用中文）');
        } else {
          passes.push(`name: ${manifest.name}`);
        }

        if (!manifest.version) {
          errors.push('缺少 version 字段');
        } else {
          const semverRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;
          if (!semverRegex.test(manifest.version)) {
            warnings.push(`version "${manifest.version}" 不符合 semver 规范（建议 x.y.z 格式）`);
          }
          passes.push(`version: ${manifest.version}`);
        }

        if (!manifest.description) {
          warnings.push('建议填写 description 字段');
        } else {
          passes.push(`description: ${manifest.description}`);
        }

        if (!manifest.abilities || !Array.isArray(manifest.abilities) || manifest.abilities.length === 0) {
          warnings.push('未声明 abilities（建议至少声明 1 个能力，用于意图匹配）');
        } else {
          passes.push(`abilities: [${manifest.abilities.join(', ')}]`);
        }

        // 3. 开发者信息校验
        if (manifest.developer) {
          if (!manifest.developer.id) {
            errors.push('developer.id 必填');
          } else if (!manifest.developer.id.startsWith('dev_')) {
            errors.push(`developer.id "${manifest.developer.id}" 应以 dev_ 开头`);
          } else {
            passes.push(`developer.id: ${manifest.developer.id}`);
          }
        } else {
          warnings.push('未声明 developer，发布前需要添加开发者信息');
        }

        // 4. 权限声明校验
        if (!manifest.permissions) {
          warnings.push('未声明 permissions，应用将无法访问数据库/存储/API');
        } else {
          try {
            const { permissionValidator } = await import('../../doves/extensions/_permissions.js');
            const permValidation = permissionValidator.validate(manifest.permissions);
            if (!permValidation.valid) {
              for (const err of permValidation.errors) {
                errors.push(`permissions: ${err}`);
              }
            } else {
              passes.push('permissions 格式校验通过');
            }

            // 额外检查：user_scoped 是否声明 userField
            if (manifest.permissions.databases) {
              for (const [dbName, dbConfig] of Object.entries(manifest.permissions.databases)) {
                if (dbConfig.collections) {
                  for (const [collName, collConfig] of Object.entries(dbConfig.collections)) {
                    if (collConfig.scope === 'user_scoped' && !collConfig.userField) {
                      errors.push(`permissions.databases.${dbName}.${collName}: user_scoped 必须声明 userField`);
                    }
                  }
                }
              }
            }

            // 生成权限摘要供开发者确认
            const summary = formatPermissionSummary(manifest.permissions);
            console.log('权限声明:');
            console.log(summary);
            console.log('');
          } catch (e) {
            warnings.push(`权限校验模块加载失败: ${e.message}`);
          }
        }

        // 5. 文件完整性校验
        const checkFile = (field, path) => {
          if (manifest[field]) {
            const fullPath = join(应用目录, (path || manifest[field]).replace('./', ''));
            if (!existsSync(fullPath)) {
              errors.push(`${field}: "${manifest[field]}" 文件不存在`);
            } else {
              passes.push(`${field}: ${manifest[field]} ✓`);
            }
          }
        };
        checkFile('intent', 'intent.js');
        checkFile('strategy', 'strategy.js');
        checkFile('roles', 'roles.js');
        if (manifest.review) checkFile('review', manifest.review);
        if (manifest.execution) checkFile('execution', manifest.execution);

        // 检查 tools 目录
        if (manifest.tools) {
          const toolsDir = join(应用目录, manifest.tools.replace('./', ''));
          if (!existsSync(toolsDir)) {
            errors.push(`tools 目录不存在: ${manifest.tools}`);
          } else {
            const toolFiles = readdirSync(toolsDir).filter(f => f.endsWith('.js') && !f.startsWith('_'));
            if (toolFiles.length === 0) {
              warnings.push('tools 目录为空，建议至少添加一个工具');
            } else {
              passes.push(`tools: ${toolFiles.length} 个工具文件`);
            }
          }
        }

        // 检查 skills 目录
        if (manifest.skills) {
          const skillsDir = join(应用目录, manifest.skills.replace('./', ''));
          if (!existsSync(skillsDir)) {
            errors.push(`skills 目录不存在: ${manifest.skills}`);
          } else {
            const skillDirs = readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory());
            if (skillDirs.length === 0) {
              warnings.push('skills 目录为空');
            } else {
              passes.push(`skills: ${skillDirs.length} 个技能`);
            }
          }
        }

        // 6. 依赖校验
        if (manifest.dependencies && manifest.dependencies.length > 0) {
          const extensionsDir = join(__dirname, '..', '..', '..', 'doves', 'extensions');
          for (const dep of manifest.dependencies) {
            if (!existsSync(join(extensionsDir, dep))) {
              warnings.push(`依赖 "${dep}" 未在 extensions/ 中找到`);
            }
          }
          passes.push(`dependencies: [${manifest.dependencies.join(', ')}]`);
        }

        // 7. Web 声明校验
        if (manifest.web) {
          if (manifest.web.pages) {
            for (const [pageId, pageConfig] of Object.entries(manifest.web.pages)) {
              if (pageConfig.entry) {
                const entryPath = join(应用目录, pageConfig.entry.replace('./', ''));
                if (!existsSync(entryPath)) {
                  warnings.push(`web.pages.${pageId}.entry "${pageConfig.entry}" 文件不存在`);
                }
              }
            }
          }
          passes.push('web 声明已检测');
        }

        // 汇总输出
        console.log('═══════════════════════════════════════');
        console.log('  校验结果');
        console.log('═══════════════════════════════════════');

        if (passes.length > 0) {
          console.log(`\n✅ 通过 (${passes.length}):`);
          for (const p of passes) console.log(`  ✅ ${p}`);
        }

        if (warnings.length > 0) {
          console.log(`\n⚠️  警告 (${warnings.length}):`);
          for (const w of warnings) console.log(`  ⚠️  ${w}`);
        }

        if (errors.length > 0) {
          console.log(`\n❌ 错误 (${errors.length}):`);
          for (const e of errors) console.log(`  ❌ ${e}`);
        }

        console.log('');
        if (errors.length === 0) {
          console.log(warnings.length === 0
            ? '🎉 全部校验通过！可以执行 dove app publish 发布'
            : '✅ 基本校验通过，请关注以上警告项');
        } else {
          console.log('❌ 存在错误，请修复后再发布');
        }
      } catch (e) {
        console.error(`校验失败: ${e.message}`);
      }
    });
}

// ---- app dev <dir> ----
export function registerDevCommand(appCommand) {
  appCommand.command('dev <dir>')
    .description('沙盒测试环境：本地加载并测试应用（无需连接生产Server）')
    .option('--tool <name>', '直接测试指定工具')
    .option('--args <json>', '工具参数（JSON格式）')
    .action(async (dir, options) => {
      try {
        const 应用目录 = resolve(dir);
        if (!existsSync(应用目录)) {
          console.error(`目录不存在: ${应用目录}`);
          return;
        }

        const manifestPath = join(应用目录, 'manifest.js');
        if (!existsSync(manifestPath)) {
          console.error(`缺少 manifest.js: ${manifestPath}`);
          return;
        }

        console.log(`\n🔧 白鸽应用沙盒: ${dir}`);
        console.log('═'.repeat(45));

        // 加载 manifest
        let manifest;
        try {
          const manifestFileUrl = `file://${resolve(manifestPath)}`;
          const manifestModule = await import(manifestFileUrl);
          manifest = manifestModule.default || manifestModule;
        } catch (e) {
          console.error(`❌ manifest.js 加载失败: ${e.message}`);
          return;
        }

        console.log(`📦 ${manifest.name} v${manifest.version || '?'}`);
        if (manifest.description) console.log(`   ${manifest.description}`);
        console.log('');

        // 创建 Mock DoveAppContext
        const mockStorage = new Map();
        const mockCtx = createMockContext(manifest.name || dir, manifest, mockStorage);

        console.log('✅ 沙盒环境就绪（内存模式，数据不持久化）');
        console.log('');

        // --tool 模式：直接测试指定工具
        if (options.tool) {
          await testToolInSandbox(应用目录, manifest, options.tool, options.args, mockCtx);
          return;
        }

        // 交互模式
        console.log('可用命令:');
        console.log('  list                 列出应用的工具和技能');
        console.log('  tool <name> [args]   测试工具（args 为 JSON）');
        console.log('  info                 查看 manifest 摘要');
        console.log('  perms                查看权限声明');
        console.log('  help                 显示帮助');
        console.log('  exit                 退出沙盒');
        console.log('');

        // 加载工具列表
        let toolDefs = [];
        if (manifest.tools) {
          const toolsDir = join(应用目录, manifest.tools.replace('./', ''));
          if (existsSync(toolsDir)) {
            try {
              const toolFiles = readdirSync(toolsDir).filter(f => f.endsWith('.js') && !f.startsWith('_'));
              for (const f of toolFiles) {
                const toolModule = await import(`file://${join(toolsDir, f)}`);
                if (toolModule.extTools) toolDefs.push(...toolModule.extTools);
              }
            } catch (e) {
              console.warn('[App] 加载工具模块失败:', e.message);
            }
          }
        }

        let skillList = [];
        if (manifest.skills) {
          const skillsDir = join(应用目录, manifest.skills.replace('./', ''));
          if (existsSync(skillsDir)) {
            try {
              const dirs = readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory());
              skillList = dirs.map(d => d.name);
            } catch (e) {
              console.warn('[App] 加载技能目录失败:', e.message);
            }
          }
        }

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const ask = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

        while (true) {
          const input = (await ask('\n沙盒> ')).trim();
          if (!input) continue;
          if (input === 'exit' || input === 'quit') break;

          const parts = input.split(/\s+/);
          const cmd = parts[0];

          if (cmd === 'help') {
            console.log('');
            console.log('沙盒命令:');
            console.log('  list         列出应用的工具和技能');
            console.log('  tool <name>  测试工具（交互输入参数）');
            console.log('  info         查看 manifest 摘要');
            console.log('  perms        查看权限声明');
            console.log('  help         显示帮助');
            console.log('  exit         退出沙盒');
          } else if (cmd === 'list') {
            console.log('');
            if (toolDefs.length > 0) {
              console.log('工具:');
              for (const t of toolDefs) console.log(`  🔧 ${t.name}: ${t.description || '无描述'}`);
            } else {
              console.log('工具: （无）');
            }
            if (skillList.length > 0) {
              console.log(`技能: ${skillList.join(', ')}`);
            } else {
              console.log('技能: （无）');
            }
          } else if (cmd === 'info') {
            console.log('');
            console.log(`名称: ${manifest.name}`);
            console.log(`版本: ${manifest.version || '?'}`);
            console.log(`能力: ${(manifest.abilities || []).join(', ') || '（未声明）'}`);
            console.log(`依赖: ${(manifest.dependencies || []).join(', ') || '（无）'}`);
            console.log(`开发者: ${manifest.developer?.id || '（未声明）'}`);
          } else if (cmd === 'perms') {
            console.log('');
            if (manifest.permissions) {
              console.log(formatPermissionSummary(manifest.permissions));
            } else {
              console.log('（无权限声明）');
            }
          } else if (cmd === 'tool') {
            const toolName = parts[1];
            if (!toolName) {
              console.log('用法: tool <name>  或  tool <name> {"key":"value"}');
              continue;
            }
            let args = {};
            if (parts.length > 2) {
              try {
                args = JSON.parse(parts.slice(2).join(' '));
              } catch {
                console.log('参数需为有效 JSON');
                continue;
              }
            } else {
              const toolDef = toolDefs.find(t => t.name === toolName);
              if (!toolDef) {
                console.log(`工具 "${toolName}" 未找到`);
                continue;
              }
              console.log(`工具: ${toolDef.name} - ${toolDef.description || ''}`);
              if (toolDef.inputSchema?.properties) {
                for (const [propName, propDef] of Object.entries(toolDef.inputSchema.properties)) {
                  const val = (await ask(`  ${propName} (${propDef.description || propDef.type}): `)).trim();
                  if (val) {
                    try { args[propName] = JSON.parse(val); } catch { args[propName] = val; }
                  }
                }
              }
            }
            await testToolInSandbox(应用目录, manifest, toolName, JSON.stringify(args), mockCtx);
          } else {
            console.log(`未知命令: ${cmd}，输入 help 查看帮助`);
          }
        }

        rl.close();
        console.log('\n👋 退出沙盒');
      } catch (e) {
        console.error(`沙盒启动失败: ${e.message}`);
      }
    });
}
