/**
 * CLI 打包脚本
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
const cliDir = join(__dirname, '..');
const distDir = join(cliDir, 'dist');
const releaseDir = join(cliDir, 'release');

// 查找 Bun 二进制（优先本地绿色版，其次系统 PATH）
// 返回 { cmd: 命令字符串, cleanup?: 清理函数 }
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
    const localBun = join(cliDir, '..', 'tools', dirName, `bun${ext}`);
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
        cleanup: () => { try { rmSync(tmpBunDir, { recursive: true }); } catch {} }
      };
    }
  }

  // 回退到系统 PATH
  try {
    execSync('bun --version', { stdio: 'pipe' });
    console.log('   📦 使用系统 Bun');
    return { cmd: 'bun' };
  } catch {
    throw new Error('未找到 Bun：请将 Bun 绿色版放入 tools/ 目录，或安装 Bun 到系统 PATH');
  }
}

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

// esbuild 构建配置
const createBuildOptions = (entryPoint, outfile) => ({
  entryPoints: [entryPoint],
  absWorkingDir: cliDir,
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: outfile,
  alias: {
    '@dove/common': join(cliDir, '..', 'common')
  },
  banner: {
    js: `// CLI - 白鸽 CLI 客户端
// Bundled with esbuild

// Preserve __dirname and __filename
if (typeof __dirname === 'undefined') {
  try {
    global.__dirname = require('path').dirname(require('url').fileURLToPath(require('url').pathToFileURL(__filename).href));
  } catch (e) {
    global.__dirname = process.cwd();
  }
}
if (typeof __filename === 'undefined') {
  try {
    global.__filename = require('url').fileURLToPath(require('url').pathToFileURL(__filename).href);
  } catch (e) {
    console.warn('[CLI] __filename polyfill 失败:', e.message);
  }
}

// Polyfill import.meta.url for cjs
if (typeof importMeta === 'undefined') {
  global.importMeta = { url: require('url').pathToFileURL(__filename).href };
}
`
  },
  define: {
    'import.meta.url': 'importMeta.url'
  },
  external: [
    'fsevents',
    'cpu-features',
    // proxy-agent 是 urllib 在运行时动态加载的代理模块
    'proxy-agent'
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
      outputFile: 'dove.exe',
      bunTarget: 'bun-windows-x64'
    };
  } else if (targetPlatform === 'darwin' || targetPlatform === 'macos') {
    return {
      platform: 'darwin',
      arch: currentArch,
      // outputFile: `dove-macos-${currentArch}`,
      outputFile: `dove`,
      bunTarget: `bun-darwin-${currentArch}`
    };
  } else if (targetPlatform === 'linux') {
    return {
      platform: 'linux',
      arch: 'x64',
      outputFile: `dove`,
      // outputFile: 'dove-linux-x64',
      bunTarget: 'bun-linux-x64'
    };
  } else {
    throw new Error(`不支持的操作系统: ${targetPlatform}`);
  }
}

// 生成内嵌资源模块 (assets.js)
function generateAssets() {
  console.log('\n📄 生成内嵌资源模块...');
  
  const publicDir = join(cliDir, 'web', 'public');
  const assetsFile = join(cliDir, 'web', 'assets.js');
  
  if (!existsSync(publicDir)) {
    console.log('   ⚠️ web/public 不存在，跳过资源生成');
    return false;
  }
  
  const assets = {};
  
  // MIME 类型映射
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf'
  };
  
  // 支持的文件类型
  const supportedExts = Object.keys(mimeTypes);
  
  // 递归扫描目录
  function scanDir(dir, baseDir) {
    const items = readdirSync(dir, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = join(dir, item.name);
      
      if (item.isDirectory()) {
        scanDir(fullPath, baseDir);
      } else if (item.isFile()) {
        // 相对路径作为 key
        const assetPath = relative(baseDir, fullPath).replace(/\\/g, '/');
        const fileExt = extname(item.name).toLowerCase();
        
        if (!supportedExts.includes(fileExt)) continue;
        
        // 读取文件并转为 base64
        const content = readFileSync(fullPath);
        const base64 = content.toString('base64');
        
        assets[assetPath] = {
          content: base64,
          contentType: mimeTypes[fileExt] || 'application/octet-stream'
        };
        
        console.log(`   ✅ ${assetPath}`);
      }
    }
  }
  
  scanDir(publicDir, publicDir);
  
  // 生成 assets.js 模块 (CJS 格式，用于 require 加载)
  // 注意：移除时间戳，避免每次构建产生无意义的 diff
  const assetsJs = `/**
 * 内嵌静态资源 - 自动生成，请勿修改
 */

'use strict';

const ASSETS = ${JSON.stringify(assets, null, 2)};

module.exports = ASSETS;
module.exports.ASSETS = ASSETS;
`;
  
  // 只有内容变化时才写入文件，避免不必要的 git diff
  if (existsSync(assetsFile)) {
    const existingContent = readFileSync(assetsFile, 'utf-8');
    if (existingContent === assetsJs) {
      console.log(`\n   ⏭️ assets.js 无变化，跳过写入`);
    } else {
      writeFileSync(assetsFile, assetsJs);
      console.log(`\n   ✅ 生成 assets.js (${Object.keys(assets).length} 个文件)`);
    }
  } else {
    writeFileSync(assetsFile, assetsJs);
    console.log(`\n   ✅ 生成 assets.js (${Object.keys(assets).length} 个文件)`);
  }
  
  // 同时生成内嵌版本的 server.js（用于打包）
  const serverFile = join(cliDir, 'web', 'server.js');
  const serverContent = readFileSync(serverFile, 'utf-8');
  
  // 替换整个静态文件加载部分
  const embeddedAssetsCode = `// ==================== 静态文件加载 ====================

// 内嵌资源 - 构建时自动注入
const embeddedAssets = ${JSON.stringify(assets, null, 2)};

/**
 * 初始化内嵌资源（打包模式：资源已内嵌，无需加载）
 */
function initEmbeddedAssets() {
  // 资源已在构建时内嵌，此函数在打包模式下为空操作
}

/**
 * 读取静态文件内容
 * 支持两种模式：
 * 1. 打包模式：从内嵌的 assets 对象读取
 * 2. 开发模式：从文件系统读取
 */`;
  
  const patchedServerContent = serverContent.replace(
    /\/\/ ==================== 静态文件加载 ====================[\s\S]*?function readStaticFile/,
    embeddedAssetsCode + '\nfunction readStaticFile'
  );
  
  const patchedServerFile = join(cliDir, 'web', 'server.bundled.js');
  writeFileSync(patchedServerFile, patchedServerContent);
  console.log(`   ✅ 生成 server.bundled.js`);
  
  return { assetsCount: Object.keys(assets).length, bundledServer: patchedServerFile };
}

// esbuild 打包
async function build() {
  console.log('🔨 开始构建...\n');
  
  // 1. 生成内嵌资源
  const { bundledServer } = generateAssets();
  
  // 2. 临时替换 server.js
  const serverFile = join(cliDir, 'web', 'server.js');
  const serverBackup = join(cliDir, 'web', 'server.js.backup');
  
  console.log('\n📝 临时替换 server.js...');
  copyFileSync(serverFile, serverBackup);
  copyFileSync(bundledServer, serverFile);
  console.log('   ✅ 已替换为内嵌版本');
  
  try {
    // 3. 打包 CLI 入口
    console.log('\n📦 打包 index.js...');
    await esbuild.build(createBuildOptions(
      join(cliDir, 'index.js'),
      join(distDir, 'index.cjs')
    ));
    console.log('✅ index.js 打包完成\n');
  } finally {
    // 4. 恢复 server.js
    console.log('📝 恢复 server.js...');
    copyFileSync(serverBackup, serverFile);
    rmSync(serverBackup);
    rmSync(bundledServer);
    console.log('   ✅ 已恢复原始版本\n');
  }
  
  // 创建 dist/package.json (用于 Bun 编译)
  const pkgJson = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf-8'));
  const distPkgJson = {
    name: pkgJson.name,
    version: pkgJson.version,
    main: 'index.cjs',
    bin: 'index.cjs'
  };
  writeFileSync(join(distDir, 'package.json'), JSON.stringify(distPkgJson, null, 2));
  
  console.log('✅ 构建完成！');
  console.log(`📁 输出目录: ${distDir}`);
}

// 执行 Bun 编译打包
async function runBunBuild(target) {
  console.log(`\n📦 执行 Bun 编译打包...`);
  console.log(`   平台: ${target.platform}`);
  console.log(`   架构: ${target.arch}`);
  
  // 读取版本信息
  const pkgJson = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf-8'));
  const outputPath = join(releaseDir, target.outputFile);

  // Bun 在 Windows 上对含中文的路径/参数存在编码 bug，会创建乱码目录
  // 解决方案：先输出到系统临时目录（纯 ASCII 路径），再移回目标位置
  const tmpReleaseDir = join(tmpdir(), 'dove-build');
  const tmpOutputPath = join(tmpReleaseDir, target.outputFile);
  ensureDir(tmpReleaseDir);
  
  // 使用 bun build --compile
  const { cmd: bunBin, cleanup: bunCleanup } = findBun();
  let bunCmd = `${bunBin} build index.cjs --compile --target=${target.bunTarget} --outfile="${tmpOutputPath}" --external=proxy-agent`;
  
  // Windows 特定参数（避免中文，防止 Bun 编码 bug）
  if (target.platform === 'win32') {
    bunCmd += ` --windows-title="${pkgJson.name}"`;
    bunCmd += ` --windows-description="Dove CLI Client"`;
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
    bunCleanup?.();
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
    } catch (err) {
      console.warn('[Build] chmod 失败:', err.message);
    }
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
  
  const toolPath = join(cliDir, '..', 'tools', 'edit_exe_icon', 'x64', 'Release', 'edit_exe_icon.exe');
  if (!existsSync(toolPath)) {
    console.log('   ⚠️ 未找到 edit_exe_icon.exe，跳过图标修复');
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
  
  // 注意：web/public 静态文件已内嵌到 exe 中，无需复制
  
  // 创建 README
  const readmeContent = `# 白鸽 CLI 客户端

## 使用方法

### Windows
双击运行 \`dove.exe\` 或在命令行中执行：
\`\`\`
dove.exe
\`\`\`

### macOS
\`\`\`bash
chmod +x dove
./dove
\`\`\`

### Linux
\`\`\`bash
chmod +x dove
./dove
\`\`\`

## 配置

首次使用需要设置网关地址：
\`\`\`
dove config set gateway http://localhost:3003
\`\`\`

## Web 界面

启动 Web 界面：
\`\`\`
dove web
\`\`\`

Web 静态文件已内嵌到可执行文件中，无需额外配置。

## 版本
${new Date().toISOString().split('T')[0]}
`;
  writeFileSync(join(releaseDir, 'README.md'), readmeContent);
  console.log('   ✅ README.md');
  console.log('   ℹ️  Web 静态文件已内嵌');
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
  
  console.log('🕊️  白鸽 CLI 打包工具\n');
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
  
  // 3. Bun 编译
  const target = getSystemTarget(buildPlatform);
  const exePath = await runBunBuild(target);
  
  // 4. Windows: 设置图标
  if (buildPlatform === 'win32') {
    // 查找图标文件
    const iconPaths = [
      join(cliDir, '..', 'logo.ico'),
      join(cliDir, '..', 'logo.png'),
      join(cliDir, 'logo.ico'),
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
      console.log('\n⚠️  未找到图标文件，跳过图标设置');
    }
  }
  
  // 5. 复制资源文件
  copyAssets();
  
  console.log('\n🎉 全部完成！');
  console.log(`📁 发布目录：${releaseDir}`);
  console.log(`🚀 输出文件：${target.outputFile}`);
  
  // 显示文件大小
  const { statSync } = await import('fs');
  const stats = statSync(exePath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`📊 文件大小：${sizeMB} MB`);
}

main().catch(err => {
  console.error('❌ 构建失败:', err);
  process.exit(1);
});
