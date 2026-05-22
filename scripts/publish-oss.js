#!/usr/bin/env node

/**
 * 白鸽 OSS 发布脚本
 * 
 * 将构建产物上传到阿里云 OSS，并生成 version.json 版本清单供自动更新使用。
 * 
 * 使用方法：
 *   node scripts/publish-oss.js                    # 上传当前平台的构建产物
 *   node scripts/publish-oss.js --platform win32   # 指定平台
 *   node scripts/publish-oss.js --dry-run          # 只生成清单预览，不上传
 *   node scripts/publish-oss.js --component cli    # 只上传指定组件（cli/doves）
 *   node scripts/publish-oss.js --release-dir ./out # 指定构建产物目录
 * 
 * 前置条件：
 *   - 已运行 npm run build，构建产物目录中有 exe 文件
 *   - 已配置 OSS 环境变量（.env 文件或环境变量）
 * 
 * 环境变量：
 *   OSS_REGION            - OSS 区域（如 oss-cn-beijing）
 *   OSS_ACCESS_KEY_ID     - 阿里云 AccessKey ID
 *   OSS_ACCESS_KEY_SECRET - 阿里云 AccessKey Secret
 *   OSS_BUCKET            - OSS Bucket 名称
 * 
 * 产出物（OSS 路径结构）：
 *   {OSS_PREFIX}/releases/version.json                        # 版本清单
 *   {OSS_PREFIX}/releases/{version}/{platform}/dc[.exe]       # CLI
 *   {OSS_PREFIX}/releases/{version}/{platform}/doves[.exe]    # Doves
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { platform } from 'os';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const DEFAULT_RELEASE_DIR = join(dirname(ROOT_DIR), '白鸽发布');

// ==================== 参数解析 ====================

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const platformArg = args.find(a => a.startsWith('--platform='))?.split('=')[1];
const componentArg = args.find(a => a.startsWith('--component='))?.split('=')[1];
const releaseDirArg = args.find(a => a.startsWith('--release-dir='))?.split('=')[1];

// ==================== 平台检测 ====================

function detectPlatform() {
  if (platformArg) return platformArg;
  const p = platform();
  if (p === 'win32') return 'win32';
  if (p === 'darwin') return 'darwin';
  return 'linux';
}

const TARGET_PLATFORM = detectPlatform();
const RELEASE_DIR = releaseDirArg || DEFAULT_RELEASE_DIR;

// ==================== 文件名 → 组件映射 ====================

const FILE_COMPONENT_MAP = {
  'dc': 'cli',
  'dc.exe': 'cli',
  'doves': 'doves',
  'doves.exe': 'doves',
};

// ==================== .env 加载 ====================

function loadEnv() {
  // 按优先级查找 .env 文件
  const envPaths = [
    join(ROOT_DIR, '..', '.env'),
    join(ROOT_DIR, '.env'),
  ];

  for (const envPath of envPaths) {
    if (!existsSync(envPath)) continue;

    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=').trim();
      if (!process.env[key] && value) {
        process.env[key] = value;
      }
    }
    console.log(`  📄 已加载: ${envPath}`);
    return;
  }

  console.log('  ⚠️  未找到 .env 文件，使用环境变量');
}

// ==================== 工具函数 ====================

/** 计算文件 SHA256 */
function calculateSHA256(filePath) {
  const hash = createHash('sha256');
  const data = readFileSync(filePath);
  return hash.update(data).digest('hex');
}

/** 获取 OSS 配置 */
function getOSSConfig() {
  return {
    region: process.env.OSS_REGION || 'oss-cn-beijing',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
    bucket: process.env.OSS_BUCKET || '',
  };
}

/** 获取 OSS 公网访问基路径 */
function getOSSBaseUrl(config) {
  return `https://${config.bucket}.${config.region}.aliyuncs.com`;
}

// ==================== 扫描构建产物 ====================

function scanReleaseFiles() {
  if (!existsSync(RELEASE_DIR)) {
    console.error(`❌ 构建产物目录不存在: ${RELEASE_DIR}`);
    console.error('请先运行 npm run build');
    process.exit(1);
  }

  const files = [];
  const entries = readdirSync(RELEASE_DIR);

  for (const entry of entries) {
    const filePath = join(RELEASE_DIR, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) continue;

    const componentName = FILE_COMPONENT_MAP[entry];
    if (!componentName) continue;

    // 过滤指定组件
    if (componentArg && componentName !== componentArg) continue;

    const sha256 = calculateSHA256(filePath);
    files.push({
      filename: entry,
      componentName,
      filePath,
      size: stat.size,
      sha256,
    });
  }

  return files;
}

// ==================== 版本清单 ====================

/**
 * 生成/合并版本清单
 * 策略：下载远端已有清单 → 合并当前平台数据 → 保留其他平台不变
 */
function generateManifest(files, version, releasePrefix, existingManifest = null) {
  const manifest = existingManifest
    ? { ...existingManifest, version, platforms: { ...existingManifest.platforms } }
    : { version, platforms: {} };

  // 深拷贝当前平台条目
  manifest.platforms[TARGET_PLATFORM] = {
    ...(manifest.platforms[TARGET_PLATFORM] || {}),
  };

  for (const file of files) {
    const ossPath = `${releasePrefix}/${version}/${TARGET_PLATFORM}/${file.filename}`;
    manifest.platforms[TARGET_PLATFORM][file.componentName] = {
      url: ossPath,
      size: file.size,
      sha256: file.sha256,
    };
  }

  return manifest;
}

/**
 * 从远端拉取已有版本清单
 */
async function fetchExistingManifest(baseUrl, releasePrefix) {
  const url = `${baseUrl}/${releasePrefix}/version.json`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (response.ok) {
      const manifest = await response.json();
      console.log('  ✅ 已获取远端版本清单');
      return manifest;
    }
    console.log(`  ℹ️  远端无版本清单 (HTTP ${response.status})，将创建新的`);
  } catch {
    console.log('  ℹ️  远端无版本清单，将创建新的');
  }
  return null;
}

// ==================== OSS 上传 ====================

async function uploadToOSS(client, ossPath, localPathOrBuffer, headers = {}) {
  try {
    await client.put(ossPath, localPathOrBuffer, { headers });
    console.log(`  ✅ ${ossPath}`);
  } catch (err) {
    throw new Error(`上传失败 ${ossPath}: ${err.message}`);
  }
}

// ==================== 主流程 ====================

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║       白鸽 OSS 发布脚本                      ║');
  console.log('╚════════════════════════════════════════════╝');

  // 1. 加载环境变量
  console.log('\n🔧 加载配置...');
  loadEnv();

  const OSS_PREFIX = process.env.OSS_PREFIX || 'dove';
  const RELEASE_PREFIX = `${OSS_PREFIX}/releases`;

  // 2. 获取版本号
  const pkgJson = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf-8'));
  const version = pkgJson.version;
  console.log(`\n📋 版本: ${version}`);
  console.log(`📋 平台: ${TARGET_PLATFORM}`);
  console.log(`📋 产物目录: ${RELEASE_DIR}`);

  // 3. 扫描构建产物
  console.log('\n📦 扫描构建产物...');
  const files = scanReleaseFiles();

  if (files.length === 0) {
    console.error('❌ 没有找到构建产物（dc / doves）');
    console.error('请先运行 npm run build');
    process.exit(1);
  }

  console.log(`  找到 ${files.length} 个文件:`);
  for (const f of files) {
    const sizeMB = (f.size / 1024 / 1024).toFixed(2);
    console.log(`    - ${f.filename} (${f.componentName}) ${sizeMB}MB  sha256:${f.sha256.slice(0, 16)}...`);
  }

  // 4. 获取 OSS 配置
  const ossConfig = getOSSConfig();
  const baseUrl = getOSSBaseUrl(ossConfig);

  // 5. 获取远端已有清单并合并
  console.log('\n📝 生成版本清单...');
  let existingManifest = null;
  if (ossConfig.accessKeyId) {
    existingManifest = await fetchExistingManifest(baseUrl, RELEASE_PREFIX);
  }

  const manifest = generateManifest(files, version, RELEASE_PREFIX, existingManifest);
  console.log('\n版本清单内容:');
  console.log(JSON.stringify(manifest, null, 2));

  // 6. dry-run 模式
  if (dryRun) {
    console.log('\n🏁 --dry-run 模式，跳过上传');
    console.log('\n如需实际上传，请运行:');
    console.log('  npm run release:oss');
    return;
  }

  // 7. 校验 OSS 配置
  if (!ossConfig.accessKeyId || !ossConfig.accessKeySecret || !ossConfig.bucket) {
    console.error('\n❌ OSS 配置不完整，需要以下环境变量:');
    console.error('  OSS_ACCESS_KEY_ID     - 阿里云 AccessKey ID');
    console.error('  OSS_ACCESS_KEY_SECRET - 阿里云 AccessKey Secret');
    console.error('  OSS_BUCKET            - OSS Bucket 名称');
    console.error('  OSS_REGION            - OSS 区域（可选，默认 oss-cn-beijing）');
    process.exit(1);
  }

  // 8. 初始化 OSS 客户端
  console.log('\n☁️  连接 OSS...');
  let OSS;
  try {
    OSS = (await import('ali-oss')).default;
  } catch {
    console.error('❌ 未安装 ali-oss SDK');
    console.error('请运行: npm install ali-oss --save-dev');
    process.exit(1);
  }

  const client = new OSS({
    region: ossConfig.region,
    accessKeyId: ossConfig.accessKeyId,
    accessKeySecret: ossConfig.accessKeySecret,
    bucket: ossConfig.bucket,
  });
  console.log(`  ✅ 已连接: ${ossConfig.bucket} (${ossConfig.region})`);

  // 9. 上传构建产物
  console.log('\n📤 上传构建产物...');
  for (const file of files) {
    const ossPath = `${RELEASE_PREFIX}/${version}/${TARGET_PLATFORM}/${file.filename}`;
    await uploadToOSS(client, ossPath, file.filePath, {
      'x-oss-object-acl': 'public-read',
    });
  }

  // 10. 上传版本清单
  console.log('\n📤 上传版本清单...');
  const manifestContent = JSON.stringify(manifest, null, 2);
  const manifestBuffer = Buffer.from(manifestContent, 'utf-8');
  await uploadToOSS(client, `${RELEASE_PREFIX}/version.json`, manifestBuffer, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'x-oss-object-acl': 'public-read',
  });

  // 11. 完成
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║            ✅ OSS 发布完成！                  ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`\n📁 版本清单: ${baseUrl}/${RELEASE_PREFIX}/version.json`);
  console.log(`🔄 自动更新将从此 URL 拉取更新信息`);
  console.log(`\n已上传文件:`);
  for (const file of files) {
    console.log(`  ${baseUrl}/${RELEASE_PREFIX}/${version}/${TARGET_PLATFORM}/${file.filename}`);
  }
}

main().catch(err => {
  console.error('❌ OSS 发布失败:', err);
  process.exit(1);
});
