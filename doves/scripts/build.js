/**
 * Doves 打包脚本
 * 使用 esbuild + Bun 编译成跨平台可执行文件
 * 
 * 用法：
 *   node scripts/build.js              # 构建当前平台
 *   node scripts/build.js --platform win32   # 构建 Windows
 *   node scripts/build.js --platform darwin  # 构建 macOS
 *   node scripts/build.js --platform linux   # 构建 Linux
 */

import esbuild from 'esbuild';
import { 
  copyFileSync, mkdirSync, existsSync, writeFileSync, readFileSync, rmSync, cpSync,
  readdirSync, statSync
} from 'fs';
import { join, dirname, basename, relative, extname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { platform, arch, tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dovesDir = join(__dirname, '..');
const distDir = join(dovesDir, 'dist');
const releaseDir = join(dovesDir, 'release');

// 确保目录存在
function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// 清理目录
function cleanDir(dir) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true });
  }
  ensureDir(dir);
}

// 复制节点模块及其依赖（递归）到发布目录
// npm 提升依赖到上层 node_modules，打包后需要将它们一并复制
const isWin = platform() === 'win32';
const copiedModules = new Set();

function copyNodeModule(moduleName, sourceNodeModules, destNodeModules) {
  if (copiedModules.has(moduleName)) return;
  copiedModules.add(moduleName);

  // 支持 scoped 包（如 @jitsi/robotjs）
  const moduleDir = moduleName.startsWith('@')
    ? join(sourceNodeModules, ...moduleName.split('/'))
    : join(sourceNodeModules, moduleName);

  if (!existsSync(moduleDir)) return;

  const destDir = join(destNodeModules, ...moduleName.split('/'));
  ensureDir(moduleName.startsWith('@') ? dirname(destDir) : destNodeModules);

  try {
    if (isWin) {
      try {
        execSync(`robocopy "${moduleDir}" "${destDir}" /E /NFL /NDL /NJH /NJS /NC /NS /NP`, { stdio: 'pipe' });
      } catch (rcErr) {
        if (rcErr.status && rcErr.status <= 3) { /* robocopy 成功 */ } else { throw rcErr; }
      }
    } else {
      cpSync(moduleDir, destDir, { recursive: true });
    }
    console.log(`   ✅ node_modules/${moduleName}/`);
  } catch (err) {
    console.warn(`   ⚠️ 复制 ${moduleName}/ 失败: ${err.message}`);
    return;
  }

  // 读取依赖列表并递归复制
  try {
    const pkgJsonPath = join(moduleDir, 'package.json');
    if (existsSync(pkgJsonPath)) {
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      const deps = Object.keys(pkgJson.dependencies || {});
      for (const dep of deps) {
        copyNodeModule(dep, sourceNodeModules, destNodeModules);
      }
    }
  } catch (e) {
    // package.json 读取失败，忽略
  }
}

const commonDir = join(dovesDir, '..', 'common');

const createBuildOptions = (entryPoint, outfile) => ({
  entryPoints: [entryPoint],
  absWorkingDir: dovesDir,
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: outfile,
  banner: {
    js: `// Doves - 白鸽鸽子框架\n// Bundled with esbuild\n`
  },
  alias: {
    '@dove/common/时间工具.js': join(commonDir, '时间工具.js'),
    '@dove/common/模型配置.js': join(commonDir, '模型配置.js'),
    '@dove/common/常量.js': join(commonDir, '常量.js'),
    '@dove/common/对象标识.js': join(commonDir, '对象标识.js'),
    '@dove/common/执行配置.js': join(commonDir, '执行配置.js'),
    '@dove/common/终端输出管理器.js': join(commonDir, '终端输出管理器.js'),
    '@dove/common/机器标识.js': join(commonDir, '机器标识.js'),
    '@dove/common/日志管理器.js': join(commonDir, '日志管理器.js'),
    '@dove/common/安全规范.js': join(commonDir, '安全规范.js'),
    '@dove/common/开发规范.js': join(commonDir, '开发规范.js'),
    '@dove/common/IM消息格式.js': join(commonDir, 'IM消息格式.js'),
    '@dove/common/crypto': join(commonDir, 'crypto'),
  },
  external: [
    'fsevents',
    'cpu-features',
    // ssh2 使用原生 .node 文件，无法被 esbuild 打包
    // 需要在运行时从 node_modules 加载
    'ssh2',
    // proxy-agent 是 urllib 在运行时动态加载的代理模块
    'proxy-agent',
    // @jitsi/robotjs 使用预编译 .node 原生二进制，无法被 esbuild 打包
    '@jitsi/robotjs',
    'robotjs',
    // screenshot-desktop 运行时需要读取 .bat 文件（通过 __dirname），打包后路径失效
    'screenshot-desktop'
  ],
  sourcemap: false,
  minify: false,
  mainFields: ['module', 'main'],
  conditions: ['node', 'require'],
});

// 获取目标平台信息
function getSystemTarget(targetPlatform) {
  const currentArch = arch();
  
  if (targetPlatform === 'win32' || targetPlatform === 'win') {
    return {
      platform: 'win32',
      arch: 'x64',
      outputFile: 'doves.exe',
      bunTarget: 'bun-windows-x64'
    };
  } else if (targetPlatform === 'darwin' || targetPlatform === 'macos') {
    return {
      platform: 'darwin',
      arch: currentArch,
      outputFile: `doves`,
      bunTarget: `bun-darwin-${currentArch}`
    };
  } else if (targetPlatform === 'linux') {
    return {
      platform: 'linux',
      arch: 'x64',
      outputFile: `doves`,
      bunTarget: 'bun-linux-x64'
    };
  } else {
    throw new Error(`不支持的操作系统: ${targetPlatform}`);
  }
}

// esbuild 打包
async function build() {
  console.log('🔨 开始构建...\n');
  
  // 打包入口文件
  console.log('\n📦 打包 入口.js...');
  await esbuild.build(createBuildOptions(
    join(dovesDir, '入口.js'),
    join(distDir, 'index.mjs')
  ));
  console.log('✅ 入口.js 打包完成\n');
  
  // 创建 dist/package.json (用于 Bun 编译)
  const pkgJson = JSON.parse(readFileSync(join(dovesDir, 'package.json'), 'utf-8'));
  const distPkgJson = {
    name: pkgJson.name,
    version: pkgJson.version,
    type: 'module',
    main: 'index.mjs',
    bin: 'index.mjs'
  };
  writeFileSync(join(distDir, 'package.json'), JSON.stringify(distPkgJson, null, 2));
  
  console.log('✅ 构建完成！');
  console.log(`📁 输出目录: ${distDir}`);
}

// 查找 Bun 二进制（优先本地绿色版，其次系统 PATH）
// 返回 { cmd: 命令字符串, cleanup?: 清理函数 } 或 null
function findBun() {
  const currentPlatform = platform();
  const currentArch = arch();
  const isWin32 = currentPlatform === 'win32';
  const ext = isWin32 ? '.exe' : '';

  // 本地绿色版路径: ../tools/bun-{platform}-{arch}/bun[.exe]
  const platformMap = {
    win32: 'bun-windows-x64',
    darwin: `bun-darwin-${currentArch}`,
    linux: 'bun-linux-x64',
  };
  const dirName = platformMap[currentPlatform];
  if (dirName) {
    const localBun = join(dovesDir, '..', 'tools', dirName, `bun${ext}`);
    if (existsSync(localBun)) {
      console.log(`   📦 使用本地 Bun: ../tools/${dirName}/bun${ext}`);
      // Bun --compile 需要复制自身到临时文件，中文路径会导致失败
      // 将 bun 复制到系统临时目录（纯 ASCII 路径）再使用
      const tmpBunDir = join(tmpdir(), 'dove-build-bun');
      ensureDir(tmpBunDir);
      const tmpBun = join(tmpBunDir, `bun${ext}`);
      copyFileSync(localBun, tmpBun);
      return {
        cmd: `"${tmpBun}"`,
        cleanup: () => { try { rmSync(tmpBunDir, { recursive: true }); } catch (e) { console.warn(`清理临时目录失败: ${e.message}`); } }
      };
    }
  }

  // 回退到系统 PATH
  try {
    execSync('bun --version', { stdio: 'pipe' });
    console.log('   📦 使用系统 Bun');
    return { cmd: 'bun' };
  } catch {
    return null;
  }
}

// 执行 Bun 编译打包
async function runBunBuild(target) {
  console.log(`\n📦 执行 Bun 编译打包...`);
  console.log(`   平台: ${target.platform}`);
  console.log(`   架构: ${target.arch}`);
  
  // 查找 Bun
  const bunInfo = findBun();
  if (!bunInfo) {
    console.warn('   ⚠️  未找到 Bun，跳过 exe 编译');
    console.log('   提示: 将 Bun 绿色版放入 tools/ 目录，或安装 Bun 到系统 PATH');
    console.log('   esbuild 产物已生成在 dist/ 目录，可通过 node dist/index.mjs 运行');
    return null;
  }
  
  // 读取版本信息
  const pkgJson = JSON.parse(readFileSync(join(dovesDir, 'package.json'), 'utf-8'));
  const outputPath = join(releaseDir, target.outputFile);
  
  // Bun 在 Windows 上对含中文的路径/参数存在编码 bug，会创建乱码目录
  // 解决方案：先输出到系统临时目录（纯 ASCII 路径），再移回目标位置
  const tmpReleaseDir = join(tmpdir(), 'dove-doves-build');
  const tmpOutputPath = join(tmpReleaseDir, target.outputFile);
  ensureDir(tmpReleaseDir);
  
  // 使用 bun build --compile
  let bunCmd = `${bunInfo.cmd} build index.mjs --compile --target=${target.bunTarget} --outfile="${tmpOutputPath}" --external=ssh2 --external=proxy-agent --external=@jitsi/robotjs --external=robotjs --external=screenshot-desktop`;
  
  // Windows 特定参数（避免中文，防止 Bun 编码 bug）
  if (target.platform === 'win32') {
    bunCmd += ` --windows-title="${pkgJson.name}"`;
    bunCmd += ` --windows-description="Dove Doves - Distributed Task Executor"`;
    bunCmd += ` --windows-version="${pkgJson.version}"`;
    bunCmd += ` --windows-publisher="DoveSystem"`;
    bunCmd += ` --windows-copyright="Copyright 2024 DoveSystem. All rights reserved."`;
  }
  
  try {
    execSync(bunCmd, {
      cwd: distDir,
      stdio: 'inherit'
    });
    // 将编译产物从临时目录移回目标路径
    if (existsSync(tmpOutputPath)) {
      copyFileSync(tmpOutputPath, outputPath);
      rmSync(tmpReleaseDir, { recursive: true });
    }
    console.log(`✅ 编译完成: ${target.outputFile}`);
  } catch (err) {
    throw new Error(`Bun 编译失败: ${err.message}`);
  } finally {
    bunInfo.cleanup?.();
  }
  
  // macOS 签名
  if (target.platform === 'darwin') {
    try {
      execSync(`codesign --sign - "${outputPath}"`, { stdio: 'pipe' });
      console.log('   ✅ 添加 ad-hoc 签名');
    } catch (err) {
      console.log('   ⚠️  签名失败（可忽略）');
    }
  }
  
  // Linux 设置执行权限
  if (target.platform === 'linux') {
    try {
      execSync(`chmod +x "${outputPath}"`, { stdio: 'pipe' });
    } catch (err) { console.warn('设置执行权限失败:', err.message); }
  }
  
  return outputPath;
}

// 设置 Windows 图标
async function setWindowsIcon(exePath, iconPath) {
  console.log('\n🎨 设置 Windows exe 图标...');
  
  try {
    const rceditModule = await import('rcedit');
    const rcedit = rceditModule.rcedit || rceditModule.default || rceditModule;
    await rcedit(exePath, { icon: iconPath });
    console.log('   ✅ 图标设置成功');
  } catch (err) {
    console.warn(`   ⚠️ 设置图标失败: ${err.message}`);
    console.warn('   提示: 需要安装 rcedit: npm install rcedit --save-dev');
  }
}

// 修复 exe 图标清晰度
// rcedit 设置图标后会添加 IDI_MYICON 图标组，与 Bun 自带的 #0 图标组共存
// Windows 会优先显示小尺寸的图标，导致图标模糊，需要删除 IDI_MYICON
function fixExeIcon(exePath) {
  console.log('\n🔧 修复 exe 图标清晰度...');
  
  const toolPath = join(dovesDir, '..', 'tools', 'edit_exe_icon', 'x64', 'Release', 'edit_exe_icon.exe');
  if (!existsSync(toolPath)) {
    console.warn('   ⚠️ 未找到 edit_exe_icon.exe，跳过图标修复');
    return;
  }
  
  try {
    execSync(`"${toolPath}" "${exePath}"`, { stdio: 'pipe' });
    console.log('   ✅ 图标修复完成（已删除多余的 IDI_MYICON 图标组）');
  } catch (err) {
    console.warn(`   ⚠️ 图标修复失败: ${err.message}`);
  }
}

// 复制资源文件
function copyAssets() {
  console.log('\n📋 复制资源文件...');
  
  // Windows 上 cpSync 处理中文路径不稳定，改用 robocopy
  const isWin = platform() === 'win32';
  
  // 复制 prompts 目录（如果有）
  const promptsDir = join(dovesDir, 'prompts');
  if (existsSync(promptsDir)) {
    try {
      const destPromptsDir = join(releaseDir, 'prompts');
      ensureDir(destPromptsDir);
      if (isWin) {
        try {
          execSync(`robocopy "${promptsDir}" "${destPromptsDir}" /E /NFL /NDL /NJH /NJS /NC /NS /NP`, { stdio: 'pipe' });
        } catch (rcErr) {
          if (rcErr.status && rcErr.status <= 3) { /* 成功 */ } else { throw rcErr; }
        }
      } else {
        cpSync(promptsDir, destPromptsDir, { recursive: true });
      }
      console.log('   ✅ prompts/');
    } catch (err) {
      console.warn(`   ⚠️ 复制 prompts/ 失败: ${err.message}`);
    }
  }
  
  // 复制 skills 目录（如果有）
  const skillsDir = join(dovesDir, 'skills');
  if (existsSync(skillsDir)) {
    try {
      const destSkillsDir = join(releaseDir, 'skills');
      ensureDir(destSkillsDir);
      if (isWin) {
        try {
          execSync(`robocopy "${skillsDir}" "${destSkillsDir}" /E /NFL /NDL /NJH /NJS /NC /NS /NP`, { stdio: 'pipe' });
        } catch (rcErr) {
          if (rcErr.status && rcErr.status <= 3) { /* 成功 */ } else { throw rcErr; }
        }
      } else {
        cpSync(skillsDir, destSkillsDir, { recursive: true });
      }
      console.log('   ✅ skills/');
    } catch (err) {
      console.warn(`   ⚠️ 复制 skills/ 失败: ${err.message}`);
    }
  }
  
  // 复制原生模块和需要运行时加载的模块（无法打包进 exe）
  const sourceNodeModules = join(dovesDir, 'node_modules');
  const destNodeModules = join(releaseDir, 'node_modules');
  ensureDir(destNodeModules);
  copiedModules.clear(); // 重置已复制集合

  // ssh2：原生 .node 模块
  copyNodeModule('ssh2', sourceNodeModules, destNodeModules);

  // @jitsi/robotjs：预编译 .node 原生二进制（含依赖 node-gyp-build）
  copyNodeModule('@jitsi/robotjs', sourceNodeModules, destNodeModules);

  // screenshot-desktop：运行时需要读取 .bat 文件（含依赖 temp → rimraf, mkdirp → minimist）
  copyNodeModule('screenshot-desktop', sourceNodeModules, destNodeModules);
  
  // 创建 README
  const readmeContent = `# 白鸽鸽子框架 (Doves)

分布式任务执行器，用于执行 白鸽系统 的任务。

## 使用方法

### Windows
\`\`\`
doves.exe
\`\`\`

### macOS
\`\`\`bash
chmod +x doves
./doves
\`\`\`

### Linux
\`\`\`bash
chmod +x doves
./doves
\`\`\`

## 配置

需要设置环境变量：
- \`SERVER_URL\`: 服务端地址
- \`SERVER_JWT\` 或 \`SERVER_API_KEY\`: 认证令牌

## 版本
${new Date().toISOString().split('T')[0]}
`;
  writeFileSync(join(releaseDir, 'README.md'), readmeContent);
  console.log('   ✅ README.md');
}

// 主流程
async function main() {
  const args = process.argv.slice(2);
  const bunOnly = args.includes('--bun-only');
  
  // 解析 --platform 参数
  let targetPlatform = null;
  const platformIndex = args.indexOf('--platform');
  if (platformIndex !== -1 && args[platformIndex + 1]) {
    targetPlatform = args[platformIndex + 1];
  }
  
  // 确定目标平台
  const currentPlatform = platform();
  const buildPlatform = targetPlatform || currentPlatform;
  
  console.log('🕊️  白鸽 Doves 打包工具\n');
  console.log(`   当前平台: ${currentPlatform}`);
  console.log(`   目标平台: ${buildPlatform}`);
  
  if (targetPlatform && targetPlatform !== currentPlatform) {
    console.log(`   ⚠️  交叉编译: ${currentPlatform} → ${targetPlatform}`);
  }
  
  // 1. 清理目录
  console.log('\n🧹 清理旧目录...');
  cleanDir(distDir);
  cleanDir(releaseDir);
  console.log('✅ 目录清理完成');
  
  // 2. esbuild 打包
  if (!bunOnly) {
    await build();
  } else {
    console.log('\n⏭️ 跳过 esbuild 打包，直接执行 Bun 编译...');
  }
  
  // 3. Bun 编译（Bun 不可用时跳过，esbuild 产物仍可使用）
  const target = getSystemTarget(buildPlatform);
  const exePath = await runBunBuild(target);
  
  // 4. Windows: 设置图标（仅 exe 编译成功时）
  if (exePath && buildPlatform === 'win32') {
    // 查找图标文件
    const iconPaths = [
      join(dovesDir, '..', 'logo.ico'),
      join(dovesDir, '..', 'logo.png'),
      join(dovesDir, 'logo.ico'),
    ];
    
    let iconPath = null;
    for (const p of iconPaths) {
      if (existsSync(p)) {
        iconPath = p;
        break;
      }
    }
    
    if (iconPath) {
      await setWindowsIcon(exePath, iconPath);
      // rcedit 设置图标后修复清晰度
      fixExeIcon(exePath);
    } else {
      console.warn('\n⚠️  未找到图标文件，跳过图标设置');
    }
  }
  
  // 5. 复制资源文件
  copyAssets();
  
  console.log('\n🎉 全部完成！');
  console.log(`📁 发布目录：${releaseDir}`);
  if (exePath) {
    console.log(`🚀 输出文件：${target.outputFile}`);
    const { statSync } = await import('fs');
    const stats = statSync(exePath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`📊 文件大小：${sizeMB} MB`);
  } else {
    console.log(`📁 esbuild 产物：dist/index.mjs`);
    console.log('   可通过 `node dist/index.mjs` 运行');
  }
}

main().catch(err => {
  console.error('❌ 构建失败:', err);
  process.exit(1);
});
