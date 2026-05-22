#!/usr/bin/env node
/**
 * 白鸽发布脚本
 * 
 * 功能：
 * 1. 构建可发布模块（Doves + CLI）
 * 2. 在独立临时目录中管理 release 分支（不影响源码目录）
 * 3. 推送 release 分支到远程
 *
 * 注意：Server 只本地构建，不参与发布流程
 * 
 * 使用方法：
 *   node scripts/release.js              # 发布当前平台
 *   node scripts/release.js --platform win32   # 指定平台
 *   node scripts/release.js --push       # 构建后自动推送
 *   node scripts/release.js --skip-build # 跳过构建，只提交
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync, rmSync, cpSync, mkdirSync, writeFileSync, mkdtempSync, statSync } from 'fs';
import { join } from 'path';
import { platform, arch, tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

// 解析命令行参数
const args = process.argv.slice(2);
const shouldPush = args.includes('--push');
const skipBuild = args.includes('--skip-build');
const platformArg = args.find(a => a.startsWith('--platform='))?.split('=')[1];

// 检测当前平台
function detectPlatform() {
  if (platformArg) return platformArg;
  const p = platform();
  const a = arch();
  if (p === 'win32') return 'win32';
  if (p === 'darwin') return a === 'arm64' ? 'darwin-arm64' : 'darwin';
  return 'linux';
}

const TARGET_PLATFORM = detectPlatform();

// 执行命令
function run(cmd, cwd = ROOT_DIR, silent = false) {
  try {
    const result = execSync(cmd, { 
      cwd, 
      encoding: 'utf-8',
      stdio: silent ? 'pipe' : 'inherit'
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 获取当前分支名
function getCurrentBranch() {
  const result = run('git rev-parse --abbrev-ref HEAD', ROOT_DIR, true);
  return result.success ? result.output.trim() : null;
}

// 构建单个模块
function buildModule(moduleName, modulePath) {
  console.log(`\n📦 构建 ${moduleName}...`);
  
  const buildScript = join(modulePath, 'scripts', 'build.js');
  if (!existsSync(buildScript)) {
    console.log(`  ⚠️  跳过 ${moduleName}（无构建脚本）`);
    return false;
  }
  
  console.log(`  📥 安装依赖...`);
  const installResult = run('npm ci', modulePath);
  if (!installResult.success) {
    console.log(`  ❌ 依赖安装失败`);
    return false;
  }
  
  console.log(`  🔨 构建中...`);
  const buildResult = run(`node scripts/build.js --platform ${TARGET_PLATFORM}`, modulePath);
  if (!buildResult.success) {
    console.log(`  ❌ 构建失败`);
    return false;
  }
  
  console.log(`  ✅ ${moduleName} 构建完成`);
  return true;
}

// 收集构建产物
function collectArtifacts() {
  const artifacts = [];
  
  const modules = [
    { name: 'doves', targetDir: 'doves' },
    { name: 'CLI', targetDir: 'cli' }
  ];
  
  for (const mod of modules) {
    const releaseDir = join(ROOT_DIR, mod.name, 'release');
    if (!existsSync(releaseDir)) continue;
    
    const files = readdirSync(releaseDir);
    for (const file of files) {
      const srcPath = join(releaseDir, file);
      artifacts.push({
        module: mod.name,
        targetDir: mod.targetDir,
        file,
        srcPath
      });
    }
  }
  
  return artifacts;
}

// 主发布流程
async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║       白鸽发布脚本                          ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`\n📋 目标平台: ${TARGET_PLATFORM}`);
  
  // 1. 检查 git 状态
  const originalBranch = getCurrentBranch();
  if (!originalBranch) {
    console.error('❌ 无法获取当前分支');
    process.exit(1);
  }
  console.log(`📌 当前分支: ${originalBranch}（源码目录不会被修改）`);
  
  // 2. 构建
  if (!skipBuild) {
    const modules = [
      { name: 'doves', path: join(ROOT_DIR, 'doves') },
      { name: 'CLI', path: join(ROOT_DIR, 'CLI') }
    ];
    
    let buildSuccess = true;
    for (const mod of modules) {
      if (!buildModule(mod.name, mod.path)) {
        buildSuccess = false;
      }
    }
    
    if (!buildSuccess) {
      console.error('\n❌ 构建失败，终止发布');
      process.exit(1);
    }
  }
  
  // 3. 收集构建产物
  console.log('\n📦 收集构建产物...');
  const artifacts = collectArtifacts();
  
  if (artifacts.length === 0) {
    console.error('❌ 没有找到构建产物');
    process.exit(1);
  }
  
  console.log(`  找到 ${artifacts.length} 个构建产物:`);
  artifacts.forEach(a => console.log(`    - ${a.module}/${a.file}`));
  
  // 4. 创建独立工作目录（完全独立，不影响源码目录）
  const workDir = mkdtempSync(join(tmpdir(), 'dove-release-work-'));
  console.log(`\n📁 创建独立工作目录: ${workDir}`);
  console.log('   （源码目录保持不变）');
  
  try {
    // 5. 获取远程仓库地址
    const remoteResult = run('git config --get remote.origin.url', ROOT_DIR, true);
    const remoteUrl = remoteResult.success ? remoteResult.output.trim() : null;
    
    if (!remoteUrl) {
      console.error('❌ 无法获取远程仓库地址');
      rmSync(workDir, { recursive: true, force: true });
      process.exit(1);
    }
    
    // 6. 检查 release 分支是否存在
    const branchResult = run('git branch --list release', ROOT_DIR, true);
    const releaseBranchExists = branchResult.output.trim().length > 0;
    
    // 7. 在工作目录初始化 git
    console.log('\n🔄 初始化工作目录的 Git...');
    run('git init', workDir);
    run(`git remote add origin ${remoteUrl}`, workDir);
    
    if (releaseBranchExists) {
      console.log('  检出已有 release 分支...');
      run('git fetch origin release', workDir);
      run('git checkout -b release origin/release', workDir);
    } else {
      console.log('  创建新的 release 孤儿分支...');
      run('git checkout --orphan release', workDir);
    }
    
    // 8. 清理工作目录（保留 .git）
    console.log('\n🧹 清理旧发布文件...');
    const workFiles = readdirSync(workDir).filter(f => f !== '.git');
    for (const file of workFiles) {
      rmSync(join(workDir, file), { recursive: true, force: true });
    }
    
    // 9. 复制构建产物到工作目录
    console.log('\n📋 复制构建产物...');
    
    for (const artifact of artifacts) {
      const targetDir = join(workDir, artifact.targetDir);
      mkdirSync(targetDir, { recursive: true });
      const destPath = join(targetDir, artifact.file);
      
      if (statSync(artifact.srcPath).isDirectory()) {
        cpSync(artifact.srcPath, destPath, { recursive: true });
      } else {
        cpSync(artifact.srcPath, destPath);
      }
      console.log(`  ✓ ${artifact.targetDir}/${artifact.file}`);
    }
    
    // 10. 创建附加文件
    console.log('\n📝 创建附加文件...');
    
    const envExample = `# 白鸽环境配置
# 复制此文件为 .env 并填写实际值

# 安全密钥（必须修改）
JWT_SECRET=your-jwt-secret-at-least-32-characters
HASH_SECRET=your-hash-secret-at-least-32-characters

# MongoDB 连接
MONGODB=mongodb://localhost:27017
MONGODB_ADMIN_DB=doves_admin
MONGODB_USER_DB=doves_user_data

# 服务端口（加密 TCP，唯一对外端口）
PORT=3003

# LLM 配置（至少配置一个）
# BAILIAN_API_KEY=
# DEEPSEEK_API_KEY=
# GLM_API_KEY=
`;
    writeFileSync(join(workDir, '.env.example'), envExample);
    console.log('  ✓ .env.example');
    
    const readme = `# 白鸽发布包

这是白鸽的构建发布包，包含以下组件：

## 目录结构

\`\`\`
├── doves/      # 智能体可执行文件
├── cli/        # 命令行工具
├── .env.example
└── README.md
\`\`\`

## 快速开始

1. 复制配置文件
   \`\`\`bash
   cp .env.example .env
   # 编辑 .env 填写实际配置
   \`\`\`

2. 启动智能体
   \`\`\`bash
   ./doves/doves.exe    # Windows
   ./doves/doves        # Linux/macOS
   \`\`\`

3. 使用 CLI 工具
   \`\`\`bash
   ./cli/dove --help
   \`\`\`

## 版本信息

- 构建时间: ${new Date().toISOString()}
- 平台: ${TARGET_PLATFORM}
`;
    writeFileSync(join(workDir, 'README.md'), readme);
    console.log('  ✓ README.md');
    
    const startSh = `#!/bin/bash
# 白鸽启动脚本
if [ ! -f .env ]; then
    echo "❌ 缺少 .env 文件，请复制 .env.example 并配置"
    exit 1
fi
echo "启动智能体..."
./doves/doves &
echo "✅ Doves 已启动"
`;
    writeFileSync(join(workDir, 'start.sh'), startSh);
    console.log('  ✓ start.sh');
    
    const startBat = `@echo off
if not exist .env (
    echo ❌ 缺少 .env 文件，请复制 .env.example 并配置
    exit /b 1
)
echo 启动智能体...
start /b doves\doves.exe
echo ✅ Doves 已启动
`;
    writeFileSync(join(workDir, 'start.bat'), startBat);
    console.log('  ✓ start.bat');
    
    // 11. 提交到 release 分支
    console.log('\n📤 提交发布...');
    run('git add -A', workDir);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const commitMsg = `发布 ${timestamp} [${TARGET_PLATFORM}]`;
    
    const commitResult = run(`git commit -m "${commitMsg}"`, workDir, true);
    if (!commitResult.success) {
      console.log('  ⚠️  没有变更需要提交');
    } else {
      console.log(`  ✓ ${commitMsg}`);
    }
    
    // 12. 推送（如果指定）
    if (shouldPush) {
      console.log('\n🚀 推送到远程...');
      const pushResult = run('git push origin release --force', workDir);
      if (pushResult.success) {
        console.log('  ✅ 推送成功');
      } else {
        console.log('  ⚠️  推送失败，请手动推送');
      }
    }
    
    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║            ✅ 发布完成！                     ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log(`\n发布分支: release`);
    console.log(`构建产物: ${artifacts.length} 个文件`);
    console.log(`\n工作目录: ${workDir}`);
    console.log(`源码目录: ${ROOT_DIR} （未修改）`);
    
    if (!shouldPush) {
      console.log('\n后续步骤:');
      console.log(`  cd ${workDir}`);
      console.log('  git push origin release --force');
    }
    
  } catch (err) {
    console.error('\n❌ 发布失败:', err);
    console.log(`\n工作目录保留: ${workDir}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ 发布失败:', err);
  process.exit(1);
});
