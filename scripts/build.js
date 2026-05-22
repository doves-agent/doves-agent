#!/usr/bin/env node

/**
 * 白鸽构建脚本
 * 编译 CLI / Server / Doves 为三个独立可执行文件
 * 
 * 使用方法：
 *   node scripts/build.js              # 构建当前平台 3 个 exe
 *   node scripts/build.js --only cli   # 只构建 CLI
 *   node scripts/build.js --only server # 只构建 Server
 *   node scripts/build.js --only doves # 只构建 Doves
 * 
 * 产出物：
 *   白鸽发布/dove[.exe]            # CLI 可执行文件
 *   白鸽发布/dove-server[.exe]     # Server 可执行文件（仅本地构建）
 *   白鸽发布/doves[.exe]           # Doves 可执行文件
 *   白鸽发布/node_modules/         # 原生模块（ssh2, robotjs, screenshot-desktop）
 */

import esbuild from 'esbuild';
import { 
  copyFileSync, mkdirSync, existsSync, writeFileSync, readFileSync, rmSync, cpSync,
  readdirSync, statSync, renameSync
} from 'fs';
import { join, dirname, basename, relative, extname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { platform, arch, tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = join(__dirname, '..');
const distDir = join(projectDir, 'dist');
const releaseDir = join(dirname(projectDir), '白鸽发布');

// 查找 Bun 二进制（优先本地绿色版，其次系统 PATH）
// 返回 { cmd: 命令字符串, cleanup?: 清理函数 }
function findBun() {
  const currentPlatform = platform();
  const currentArch = arch();
  const isWin32 = currentPlatform === 'win32';
  const ext = isWin32 ? '.exe' : '';

  // 本地绿色版路径: tools/bun-{platform}-{arch}/bun[.exe]
  const platformMap = {
    win32: `bun-windows-x64`,
    darwin: `bun-darwin-${currentArch}`,
    linux: `bun-linux-x64`,
  };
  const dirName = platformMap[currentPlatform];
  if (dirName) {
    const localBun = join(projectDir, 'tools', dirName, `bun${ext}`);
    if (existsSync(localBun)) {
      console.log(`   📦 使用本地 Bun: tools/${dirName}/bun${ext}`);
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

// 清理目录（Windows 下可能因文件锁失败，自动重试）
function cleanDir(dir, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true });
      }
      ensureDir(dir);
      return;
    } catch (err) {
      if (err.code === 'EPERM' && i < retries - 1) {
        console.log(`   ⚠️ 目录清理被占用，等待重试 (${i + 1}/${retries})...`);
        // 同步等待 1 秒（兼容所有 shell）
        execSync('node -e "setTimeout(()=>{},1000)"', { stdio: 'pipe' });
      } else {
        throw err;
      }
    }
  }
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

// ==================== 构建目标定义 ====================

// 三个构建目标
const BUILD_TARGET_KEYS = ['cli', 'server', 'doves'];

const BUILD_TARGETS = {
  cli: {
    name: 'CLI',
    entry: 'cli/index.js',
    distFile: 'cli.cjs',
    outputName: 'dc',
    windowsTitle: '白鸽',
    windowsDesc: 'Dove-CLI - 智能体框架客户端',
    externals: [
      'fsevents',
      'cpu-features',
      // CLI 不需要 ssh2/robotjs/screenshot-desktop
    ],
    // CLI 需要的原生模块（运行时加载）
    nativeModules: [],
  },
  server: {
    name: 'Server',
    entry: 'server/index.js',
    distFile: 'server.cjs',
    outputName: 'dove-server',
    windowsTitle: '白鸽服务',
    windowsDesc: '白鸽服务 - 网关&数据代理',
    externals: [
      'fsevents',
      'cpu-features',
      // Server 不需要 ssh2/robotjs/screenshot-desktop
      // IM 适配器可选依赖（未安装时运行时跳过）
      'wechat-ilink-client',
      '@larksuiteoapi/node-sdk',
      'dingtalk-stream',
    ],
    nativeModules: [],
  },
  doves: {
    name: 'Doves',
    entry: 'doves/入口.js',
    distFile: 'doves.cjs',
    outputName: 'doves',
    windowsTitle: '鸽群',
    windowsDesc: '鸽群 - 任务执行智能体',
    externals: [
      'fsevents',
      'cpu-features',
      // ssh2 使用原生 .node 文件，无法被 esbuild 打包
      'ssh2',
      // proxy-agent 是 urllib 在运行时动态加载的代理模块
      'proxy-agent',
      // @jitsi/robotjs 使用预编译 .node 原生二进制，无法被 esbuild 打包
      '@jitsi/robotjs',
      'robotjs',
      // screenshot-desktop 运行时需要读取 .bat 文件（通过 __dirname），打包后路径失效
      'screenshot-desktop',
    ],
    // Doves 需要的原生模块（运行时加载）
    nativeModules: [
      { name: 'ssh2', source: 'node_modules' },
      { name: '@jitsi/robotjs', source: 'doves/node_modules' },
      { name: 'screenshot-desktop', source: 'doves/node_modules' },
    ],
  },
};

// 读取版本号（供 define 使用）
const pkgVersion = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8')).version;

// esbuild 构建配置
const createBuildOptions = (target, targetKey) => ({
  entryPoints: [join(projectDir, target.entry)],
  absWorkingDir: projectDir,
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: join(distDir, target.distFile),
  alias: {
    // 解析 @dove/common 别名 → 实际的 common 目录
    '@dove/common': join(projectDir, 'common'),
  },
  banner: {
    js: `// 白鸽 - ${target.name}
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
  } catch (e) {}
}

// Polyfill import.meta.url for cjs
if (typeof importMeta === 'undefined') {
  global.importMeta = { url: require('url').pathToFileURL(__filename).href };
}
`
  },
  define: {
    'import.meta.url': 'importMeta.url',
    '__VERSION__': JSON.stringify(pkgVersion),
    '__COMPONENT__': JSON.stringify(targetKey),
  },
  external: target.externals,
  sourcemap: false,
  minify: false,
  mainFields: ['module', 'main'],
  conditions: ['node', 'require'],
});

// 获取目标平台信息
function getSystemTarget(targetPlatform, outputName) {
  const currentArch = arch();
  const ext = targetPlatform === 'win32' ? '.exe' : '';
  
  if (targetPlatform === 'win32') {
    return { platform: 'win32', arch: 'x64', outputFile: `${outputName}${ext}`, bunTarget: 'bun-windows-x64' };
  } else if (targetPlatform === 'darwin') {
    return { platform: 'darwin', arch: currentArch, outputFile: outputName, bunTarget: `bun-darwin-${currentArch}` };
  } else if (targetPlatform === 'linux') {
    return { platform: 'linux', arch: 'x64', outputFile: outputName, bunTarget: 'bun-linux-x64' };
  } else {
    throw new Error(`不支持的操作系统: ${targetPlatform}`);
  }
}

// esbuild 打包单个目标（带重试机制：解析失败的路径自动加入 external）
async function buildTarget(targetKey) {
  const target = BUILD_TARGETS[targetKey];
  console.log(`📦 打包 ${target.entry}...`);
  
  // 最多重试 3 次，每次把解析失败的路径加入 external
  const extraExternals = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const options = createBuildOptions(target, targetKey);
      // 追加上次重试收集到的无法解析的路径
      if (extraExternals.length > 0) {
        options.external = [...options.external, ...extraExternals];
      }
      await esbuild.build(options);
      console.log(`✅ ${target.entry} 打包完成 → dist/${target.distFile}`);
      return target;
    } catch (err) {
      // 提取无法解析的路径
      const unresolvedPaths = [];
      const errorText = err.message || '';
      // 匹配 esbuild 的 "Could not resolve" 错误，提取路径
      const regex = /Could not resolve "([^"]+)"/g;
      let match;
      while ((match = regex.exec(errorText)) !== null) {
        unresolvedPaths.push(match[1]);
      }
      // 也匹配单引号版本
      const regex2 = /Could not resolve '([^']+)'/g;
      while ((match = regex2.exec(errorText)) !== null) {
        unresolvedPaths.push(match[1]);
      }
      
      if (unresolvedPaths.length === 0 || attempt >= 3) {
        throw err; // 非解析错误或超过重试次数，直接抛出
      }
      
      console.log(`   ⚠️  解析失败 ${unresolvedPaths.length} 个路径，重试 (${attempt}/3)...`);
      for (const p of unresolvedPaths) {
        console.log(`      - ${p}`);
        extraExternals.push(p);
      }
    }
  }
}

// esbuild 打包所有目标
async function buildAll(targetKeys) {
  console.log('🔨 开始 esbuild 打包...\n');
  
  const targets = [];
  for (const key of targetKeys) {
    const target = await buildTarget(key);
    targets.push(target);
  }
  
  // 创建 dist/package.json (用于 Bun 编译)
  const pkgJson = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'));
  const distPkgJson = {
    name: pkgJson.name,
    version: pkgJson.version,
    bin: targets.map(t => t.distFile)
  };
  writeFileSync(join(distDir, 'package.json'), JSON.stringify(distPkgJson, null, 2));
  
  console.log('\n✅ esbuild 打包全部完成！');
  return targets;
}

// 执行 Bun 编译打包单个目标
async function runBunBuild(target, buildPlatform) {
  const targetInfo = getSystemTarget(buildPlatform, target.outputName);
  
  console.log(`\n📦 Bun 编译 ${target.name}...`);
  console.log(`   入口: ${target.distFile}`);
  console.log(`   输出: ${targetInfo.outputFile}`);
  console.log(`   平台: ${targetInfo.platform}`);
  console.log(`   架构: ${targetInfo.arch}`);
  
  // 读取版本信息
  const pkgJson = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'));
  const outputPath = join(releaseDir, targetInfo.outputFile);
  
  // Bun 在 Windows 上对含中文的路径/参数存在编码 bug，会创建乱码目录
  // 解决方案：先输出到系统临时目录（纯 ASCII 路径），再移回目标位置
  const tmpReleaseDir = join(tmpdir(), 'dove-build');
  const tmpOutputPath = join(tmpReleaseDir, targetInfo.outputFile);
  ensureDir(tmpReleaseDir);
  
  // 构建 --external 参数
  const externalArgs = target.externals
    .filter(e => e !== 'fsevents' && e !== 'cpu-features')
    .map(e => `--external=${e}`)
    .join(' ');
  
  // 使用 bun build --compile
  const { cmd: bunBin, cleanup: bunCleanup } = findBun();
  let bunCmd = `${bunBin} build ${target.distFile} --compile --target=${targetInfo.bunTarget} --outfile="${tmpOutputPath}" ${externalArgs}`;
  
  // Windows 特定参数（避免中文，防止 Bun 编码 bug）
  if (targetInfo.platform === 'win32') {
    bunCmd += ` --windows-title="${target.windowsTitle}"`;
    bunCmd += ` --windows-description="${target.windowsDesc}"`;
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
    console.log(`✅ ${target.name} 编译完成: ${targetInfo.outputFile}`);
  } catch (err) {
    throw new Error(`${target.name} Bun 编译失败: ${err.message}`);
  } finally {
    bunCleanup?.();
  }
  
  // macOS 签名
  if (targetInfo.platform === 'darwin') {
    try {
      execSync(`codesign --sign - "${outputPath}"`, { stdio: 'pipe' });
      console.log('   ✅ 添加 ad-hoc 签名');
    } catch (err) {
      console.log('   ⚠️  签名失败（可忽略）');
    }
  }
  
  // Linux 设置执行权限
  if (targetInfo.platform === 'linux') {
    try {
      execSync(`chmod +x "${outputPath}"`, { stdio: 'pipe' });
    } catch (err) {}
  }
  
  // Windows: 设置图标
  if (targetInfo.platform === 'win32') {
    const iconPaths = [
      join(projectDir, 'logo.ico'),
      join(projectDir, 'logo.png'),
    ];
    
    let iconPath = null;
    for (const p of iconPaths) {
      if (existsSync(p)) {
        iconPath = p;
        break;
      }
    }
    
    if (iconPath) {
      await setWindowsIcon(outputPath, iconPath);
      fixExeIcon(outputPath);
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
  
  const toolPath = join(projectDir, 'tools', 'bun-windows-x64', 'edit_exe_icon.exe');
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

// 复制原生模块到发布目录
function copyAssets(targetKeys) {
  console.log('\n📋 复制原生模块...');
  
  const destNodeModules = join(releaseDir, 'node_modules');
  ensureDir(destNodeModules);
  copiedModules.clear();

  const allNativeModules = new Set();
  for (const key of targetKeys) {
    for (const mod of BUILD_TARGETS[key].nativeModules) {
      allNativeModules.add(mod);
    }
  }
  
  // 只在构建包含 doves 时复制原生模块
  for (const mod of allNativeModules) {
    const sourceDir = mod.source === 'doves/node_modules' 
      ? join(projectDir, 'doves', 'node_modules') 
      : join(projectDir, 'node_modules');
    copyNodeModule(mod.name, sourceDir, destNodeModules);
  }
}

// 主流程
async function main() {
  const args = process.argv.slice(2);
  const buildPlatform = platform();
  
  // 解析 --only 参数
  let onlyTarget = null;
  const onlyIndex = args.indexOf('--only');
  if (onlyIndex !== -1 && args[onlyIndex + 1]) {
    onlyTarget = args[onlyIndex + 1];
    if (!BUILD_TARGETS[onlyTarget]) {
      console.error(`❌ 未知构建目标: ${onlyTarget}`);
      console.error(`   可选: ${BUILD_TARGET_KEYS.join(', ')}`);
      process.exit(1);
    }
  }
  const targetKeys = onlyTarget ? [onlyTarget] : BUILD_TARGET_KEYS;
  
  console.log('🕊️  白鸽构建工具\n');
  console.log(`   目标平台: ${buildPlatform}`);
  console.log(`   构建目标: ${targetKeys.map(k => BUILD_TARGETS[k].name).join(' + ')}`);
  
  // 1. 清理目录
  console.log('\n🧹 清理旧目录...');
  cleanDir(distDir);
  // release 目录只确保存在，不强制清空（Windows 下可能被 exe 占用）
  ensureDir(releaseDir);
  console.log('✅ 目录清理完成');
  
  // 2. esbuild 打包
  const builtTargets = await buildAll(targetKeys);
  
  // 3. Bun 编译
  const exePaths = [];
  for (const target of builtTargets) {
    const exePath = await runBunBuild(target, buildPlatform);
    exePaths.push({ target, exePath });
  }
  
  // 4. 复制资源文件
  copyAssets(targetKeys);
  
  console.log('\n🎉 全部完成！');
  console.log(`📁 发布目录：${releaseDir}`);
  console.log('🚀 输出文件：');
  for (const { target, exePath } of exePaths) {
    const stats = statSync(exePath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`   ${target.outputName.padEnd(16)} ${sizeMB} MB`);
  }
  
  console.log('');
  console.log('使用方法：');
  console.log('  ./dove              # 进入 CLI 交互模式');
  console.log('  ./doves             # 启动 Doves');
}

main().catch(err => {
  console.error('❌ 构建失败:', err);
  process.exit(1);
});
