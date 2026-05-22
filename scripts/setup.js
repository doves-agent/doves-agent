/**
 * 白鸽一键安装脚本
 * 对所有子项目执行 npm install，并验证依赖完整性
 * 
 * 用法: npm run setup   (推荐)
 * 或:   node scripts/setup.js
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// 需要安装依赖的子项目列表
const SUB_PROJECTS = [
  { name: '📦 根项目',    path: '.' },
  { name: '📦 common',    path: 'common' },
  { name: '📦 server',    path: 'server' },
  { name: '📦 doves',     path: 'doves' },
  { name: '📦 cli',       path: 'cli' },
  { name: '📦 test',      path: 'test' },
];

const SEPARATOR = '─'.repeat(60);

function color(text, code) {
  // 简单终端颜色（Windows PowerShell 也兼容）
  return `\x1b[${code}m${text}\x1b[0m`;
}

function green(text) { return color(text, 32); }
function red(text)   { return color(text, 31); }
function yellow(text) { return color(text, 33); }
function cyan(text)  { return color(text, 36); }

function log(title) {
  console.log(`\n${SEPARATOR}`);
  console.log(` ${title}`);
  console.log(SEPARATOR);
}

function hasPackageJson(dir) {
  return existsSync(resolve(ROOT, dir, 'package.json'));
}

function runNpmInstall(dir) {
  const cwd = resolve(ROOT, dir);
  console.log(`\n${cyan('→')} 安装依赖: ${yellow(dir || '(根项目)')}`);
  console.log(`  目录: ${cwd}\n`);

  try {
    execSync('npm install --no-fund --no-audit', {
      cwd,
      stdio: 'inherit',
      env: { ...process.env },
    });
    console.log(`\n ${green('✓')} ${dir || '根项目'} 依赖安装完成`);
    return true;
  } catch (err) {
    console.error(`\n ${red('✗')} ${dir || '根项目'} 安装失败`);
    return false;
  }
}

function verifyNodeModules(dir) {
  const projectDir = dir === '.' ? '(根项目)' : dir;
  const nmPath = resolve(ROOT, dir, 'node_modules');
  const hasNM = existsSync(nmPath);
  if (hasNM) {
    console.log(` ${green('✓')} ${projectDir}/node_modules ${green('存在')}`);
  } else {
    console.log(` ${red('✗')} ${projectDir}/node_modules ${red('不存在')}`);
  }
  return hasNM;
}

function findMissingDeps(dir) {
  const projectDir = dir === '.' ? '(根项目)' : dir;
  const pkgPath = resolve(ROOT, dir, 'package.json');
  if (!existsSync(pkgPath)) return [];

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  const nmPath = resolve(ROOT, dir, 'node_modules');
  const missing = [];

  for (const [dep] of Object.entries(allDeps)) {
    // 跳过 file: 本地依赖（它们是 symlink）
    if (dep.startsWith('@dove/')) continue;
    const depPath = resolve(nmPath, dep);
    if (!existsSync(depPath)) {
      missing.push(dep);
    }
  }

  if (missing.length > 0) {
    console.log(` ${red('⚠')} ${projectDir} 缺失依赖: ${missing.join(', ')}`);
  } else {
    console.log(` ${green('✓')} ${projectDir} 所有依赖已就绪`);
  }
  return missing;
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const args = process.argv.slice(2);
  const skipInstall = args.includes('--verify-only');

  console.log(`
${cyan('╔══════════════════════════════════════════════════╗')}
${cyan('║')}          🕊️  白鸽 - 一键安装与验证         ${cyan('║')}
${cyan('╚══════════════════════════════════════════════════╝')}
`);

  let allSuccess = true;

  // ─── 阶段一：安装依赖 ───
  if (!skipInstall) {
    log('🛠️  阶段一：安装所有子项目依赖');

    for (const project of SUB_PROJECTS) {
      if (!hasPackageJson(project.path)) {
        console.log(` ${yellow('~')} ${project.path} 无 package.json，跳过`);
        continue;
      }
      const ok = runNpmInstall(project.path);
      if (!ok) allSuccess = false;
    }
  } else {
    log('⏭️  跳过安装（--verify-only 模式）');
  }

  // ─── 阶段二：验证 node_modules ───
  log('🔍 阶段二：验证 node_modules 目录');

  for (const project of SUB_PROJECTS) {
    if (!hasPackageJson(project.path)) continue;
    verifyNodeModules(project.path);
  }

  // ─── 阶段三：检查缺失依赖 ───
  log('📋 阶段三：检查缺失依赖');

  let hasMissing = false;
  for (const project of SUB_PROJECTS) {
    if (!hasPackageJson(project.path)) continue;
    const missing = findMissingDeps(project.path);
    if (missing.length > 0) hasMissing = true;
  }

  // ─── 汇总 ───
  console.log(`\n${SEPARATOR}`);
  if (allSuccess && !hasMissing) {
    console.log(`\n ${green('✅  全部就绪！白鸽系统依赖安装完整。')}`);
    console.log(` ${green('💡 现在可以运行:')}`);
    console.log(`    ${cyan('npm run start:prod')}      - 启动生产环境`);
    console.log(`    ${cyan('npm run dev')}             - 启动开发模式`);
    console.log(`    ${cyan('npm run install:all')}     - 重新安装所有依赖`);
  } else if (!allSuccess) {
    console.log(`\n ${red('❌  部分项目安装失败，请检查上方错误信息。')}`);
    process.exitCode = 1;
  } else if (hasMissing) {
    console.log(`\n ${yellow('⚠️   依赖已安装但部分缺失，建议重新执行 npm run setup')}`);
    process.exitCode = 1;
  }

  console.log();
}

main().catch(err => {
  console.error(red(`\n❌ 脚本执行出错: ${err.message}`));
  process.exitCode = 1;
});
