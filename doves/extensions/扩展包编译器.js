/**
 * 扩展包编译器
 * 将扩展包目录编译为 .dove 格式（tar.gz + 签名 + 元数据）
 *
 * === .dove 包格式 ===
 * 本质是 tar.gz 压缩包，扩展名 .dove，内容结构：
 *
 *   包名-版本.dove
 *   ├── manifest.json     # 编译后的 manifest（JSON格式，含签名）
 *   ├── metadata.json     # 编译元数据（时间、文件列表、hash）
 *   ├── intent.js
 *   ├── strategy.js
 *   ├── roles.js
 *   ├── review.js
 *   ├── execution.js
 *   ├── tools/            # 工具目录
 *   ├── skills/           # 技能目录
 *   ├── web/              # Web页面目录（可选）
 *   └── mcp/              # MCP配置（可选）
 *
 * === 编译流程 ===
 * 1. 读取 manifest.js → 解析为 JSON
 * 2. 递归扫描目录下所有 .js/.json/.html/.css 文件
 * 3. 计算 manifest 签名（HMAC-SHA256）
 * 4. 生成 metadata.json（文件列表+每个文件的 SHA256）
 * 5. 打包为 tar.gz → 命名为 {name}-{version}.dove
 */

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync, unlinkSync, rmSync } from 'fs';
import { join, relative, basename, dirname, sep, resolve } from 'path';
import { pathToFileURL } from 'url';
import { createHash, createHmac } from 'crypto';
import { execSync } from 'child_process';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('编译器', { 前缀: '[编译器]', 级别: 'debug', 显示调用位置: true });

/** 允许打包的文件扩展名 */
const ALLOWED_EXTENSIONS = ['.js', '.json', '.html', '.css', '.svg', '.png', '.ico'];
/** 排除的文件/目录 */
const EXCLUDE_PATTERNS = ['node_modules', '.git', '.DS_Store', 'Thumbs.db', '__pycache__'];

/**
 * 编译扩展包
 *
 * @param {string} 扩展目录 - 扩展包目录的绝对路径（如 /path/to/extensions/编码）
 * @param {string} 输出目录 - .dove 文件输出目录
 * @param {Object} 选项 - 编译选项
 * @param {string} 选项.signingKey - 开发者签名密钥（可选，官方包不需要）
 * @returns {Promise<{success: boolean, doveFile?: string, metadata?: Object, error?: string}>}
 */
export async function compileExtension(扩展目录, 输出目录, 选项 = {}) {
  // 1. 验证目录
  if (!existsSync(扩展目录)) {
    return { success: false, error: `扩展目录不存在: ${扩展目录}` };
  }

  const manifestPath = join(扩展目录, 'manifest.js');
  if (!existsSync(manifestPath)) {
    return { success: false, error: `缺少 manifest.js: ${manifestPath}` };
  }

  // 2. 读取 manifest
  let manifest;
  try {
    const manifestFileUrl = pathToFileURL(resolve(manifestPath)).href;
    const manifestModule = await import(manifestFileUrl);
    manifest = manifestModule.default;
  } catch (e) {
    return { success: false, error: `manifest.js 加载失败: ${e.message}` };
  }

  if (!manifest.name) {
    return { success: false, error: 'manifest 缺少 name 字段' };
  }
  if (!manifest.version) {
    return { success: false, error: 'manifest 缺少 version 字段' };
  }

  const 包名 = manifest.name;
  const 版本 = manifest.version;
  const doveFileName = `${包名}-${版本}.dove`;

  logger.info(`编译扩展包: ${包名} v${版本}`);

  // 3. 递归扫描文件
  const 文件列表 = 扫描文件(扩展目录);
  logger.info(`扫描到 ${文件列表.length} 个文件`);

  // 4. 计算每个文件的 SHA256
  const 文件hash = {};
  for (const 文件 of 文件列表) {
    const 相对路径 = relative(扩展目录, 文件).replace(/\\/g, '/');
    const 内容 = readFileSync(文件);
    const hash = createHash('sha256').update(内容).digest('hex');
    文件hash[相对路径] = hash;
  }

  // 5. 序列化 manifest 为 JSON（确定性排序）
  const manifestJson = JSON.stringify(manifest, null, 2);

  // 6. 计算 manifest 签名
  let signature = null;
  if (选项.signingKey) {
    signature = signManifest(manifest, 选项.signingKey);
    logger.info(`manifest 已签名: ${signature.substring(0, 20)}...`);
  }

  // 7. 生成 metadata.json
  const metadata = {
    name: 包名,
    version: 版本,
    description: manifest.description || '',
    abilities: manifest.abilities || [],
    dependencies: manifest.dependencies || [],
    developer: manifest.developer || null,
    permissions: manifest.permissions || null,
    signature,
    files: 文件hash,
    compiledAt: new Date().toISOString(),
    compiler: 'dove-pack@1.0.0',
  };

  // 8. 创建临时打包目录
  const 临时目录 = join(输出目录, `.dove-build-${包名}-${Date.now()}`);
  mkdirSync(临时目录, { recursive: true });

  try {
    // 写入 manifest.json
    writeFileSync(join(临时目录, 'manifest.json'), manifestJson, 'utf-8');
    // 写入 metadata.json
    writeFileSync(join(临时目录, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');

    // 复制所有源文件
    for (const 文件 of 文件列表) {
      const 相对路径 = relative(扩展目录, 文件);
      const 目标路径 = join(临时目录, 相对路径);
      const 目标目录 = dirname(目标路径);
      if (!existsSync(目标目录)) {
        mkdirSync(目标目录, { recursive: true });
      }
      // 直接复制（不处理，保持原始内容）
      const 内容 = readFileSync(文件);
      writeFileSync(目标路径, 内容);
    }

    // 9. 打包为 tar.gz
    const dovePath = join(输出目录, doveFileName);
    const tar = await import('tar');
    await tar.create(
      {
        gzip: true,
        file: dovePath,
        cwd: 临时目录,
      },
      ['.']
    );

    const 文件大小 = statSync(dovePath).size;
    logger.info(`编译完成: ${doveFileName} (${(文件大小 / 1024).toFixed(1)} KB)`);

    return {
      success: true,
      doveFile: dovePath,
      doveFileName,
      fileSize: 文件大小,
      metadata,
    };
  } catch (e) {
    return { success: false, error: `打包失败: ${e.message}` };
  } finally {
    // 清理临时目录
    try { rmSync(临时目录, { recursive: true }); } catch (e) { logger.debug(`清理临时目录失败: ${e.message}`); }
  }
}

/**
 * 解包 .dove 文件
 *
 * @param {string} dovePath - .dove 文件路径
 * @param {string} 目标目录 - 解包目标目录
 * @returns {Promise<{success: boolean, metadata?: Object, error?: string}>}
 */
export async function extractDove(dovePath, 目标目录) {
  if (!existsSync(dovePath)) {
    return { success: false, error: `.dove 文件不存在: ${dovePath}` };
  }

  try {
    // 确保目标目录存在
    if (!existsSync(目标目录)) {
      mkdirSync(目标目录, { recursive: true });
    }

    const tar = await import('tar');
    await tar.extract({
      file: dovePath,
      cwd: 目标目录,
    });

    // 读取 metadata
    const metadataPath = join(目标目录, 'metadata.json');
    if (!existsSync(metadataPath)) {
      return { success: false, error: '缺少 metadata.json，不是有效的 .dove 包' };
    }

    const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));

    // 验证文件完整性
    let 损坏文件 = 0;
    for (const [相对路径, 期望hash] of Object.entries(metadata.files || {})) {
      const 文件路径 = join(目标目录, 相对路径);
      if (!existsSync(文件路径)) {
        logger.warn(`文件缺失: ${相对路径}`);
        损坏文件++;
        continue;
      }
      const 内容 = readFileSync(文件路径);
      const 实际hash = createHash('sha256').update(内容).digest('hex');
      if (实际hash !== 期望hash) {
        logger.warn(`文件损坏: ${相对路径}`);
        损坏文件++;
      }
    }

    if (损坏文件 > 0) {
      return { success: false, error: `${损坏文件} 个文件损坏或缺失` };
    }

    // 将 manifest.json 转回 manifest.js
    const manifestJsonPath = join(目标目录, 'manifest.json');
    if (existsSync(manifestJsonPath)) {
      const manifestData = JSON.parse(readFileSync(manifestJsonPath, 'utf-8'));
      // 生成 manifest.js（带签名）
      const signatureLine = metadata.signature
        ? `\n  signature: '${metadata.signature}',`
        : '';
      const manifestJs = `// 由 .dove 包解包生成\nexport default ${JSON.stringify(manifestData, null, 2).replace(/\n$/, '')}${signatureLine}\n};\n`;
      // 替换最后的 } 为带签名的版本
      const finalManifestJs = `// 由 .dove 包解包生成\nexport default ${JSON.stringify(manifestData, null, 2)};\n`;
      writeFileSync(join(目标目录, 'manifest.js'), finalManifestJs, 'utf-8');
      // 删除 manifest.json（鸽子用 manifest.js）
      unlinkSync(manifestJsonPath);
    }

    // 删除 metadata.json（安装后不需要）
    if (existsSync(metadataPath)) {
      unlinkSync(metadataPath);
    }

    logger.info(`解包完成: ${metadata.name} v${metadata.version}`);
    return { success: true, metadata };
  } catch (e) {
    return { success: false, error: `解包失败: ${e.message}` };
  }
}

// ==================== 内部工具 ====================

/**
 * 递归扫描目录下的所有允许的文件
 */
function 扫描文件(目录) {
  const 结果 = [];

  function 递归(当前目录) {
    const 条目 = readdirSync(当前目录, { withFileTypes: true });
    for (const 条 of 条目) {
      const 完整路径 = join(当前目录, 条.name);

      // 排除
      if (EXCLUDE_PATTERNS.some(p => 条.name.includes(p))) continue;

      if (条.isDirectory()) {
        递归(完整路径);
      } else if (条.isFile()) {
        const ext = 条.name.substring(条.name.lastIndexOf('.'));
        if (ALLOWED_EXTENSIONS.includes(ext)) {
          结果.push(完整路径);
        }
      }
    }
  }

  递归(目录);
  return 结果;
}

/**
 * 计算 manifest 签名（与 _signature.js 逻辑一致）
 */
function signManifest(manifest, signingKey) {
  const name = manifest.name || '';
  const version = manifest.version || '';
  const permissions = deterministicStringify(manifest.permissions || {});
  const payload = `${name}\n${version}\n${permissions}`;
  const hmac = createHmac('sha256', signingKey);
  hmac.update(payload);
  return `hmac-sha256:${hmac.digest('hex')}`;
}

/**
 * 确定性 JSON 序列化
 */
function deterministicStringify(obj, depth = 0) {
  if (depth > 10) return '...';
  if (obj === null) return 'null';
  if (obj === undefined) return 'undefined';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return `[${obj.map(item => deterministicStringify(item, depth + 1)).join(',')}]`;
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(key => `${JSON.stringify(key)}:${deterministicStringify(obj[key], depth + 1)}`);
  return `{${pairs.join(',')}}`;
}
