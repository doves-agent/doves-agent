/**
 * @file extensions/_loader-授权与上报
 * @description 扩展加载器中的授权验证与服务端上报逻辑
 * 
 * 从 _loader.js 拆分，KISS 原则
 * 职责：
 * 1. 开发者身份验证（步骤 0.5）
 * 2. 扩展授权检查（步骤 0.7）
 * 3. 工具元数据上报到 Server（步骤 7.5）
 * 4. Web 资源上报到 Server（步骤 11）
 * 5. 数据库权限注册/注销到 Server（步骤 12）
 * 6. 辅助函数：filterUserScopedOnly、收集Web文件
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { computeSignaturePayload } from '@dove/common/扩展签名.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('扩展加载器', { 前缀: '[扩展加载器]', 级别: 'debug', 显示调用位置: true });

// ==================== 辅助函数 ====================

/**
 * 过滤出仅 user_scoped 的权限（开发模式用）
 */
export function filterUserScopedOnly(perms) {
  if (!perms || !perms.databases) return {};
  const result = {};
  const filteredDbs = {};
  for (const [dbName, dbConfig] of Object.entries(perms.databases)) {
    if (!dbConfig.collections) continue;
    const filteredColls = {};
    for (const [collName, collConfig] of Object.entries(dbConfig.collections)) {
      if (collConfig.scope === 'user_scoped') {
        filteredColls[collName] = collConfig;
      }
    }
    if (Object.keys(filteredColls).length > 0) {
      filteredDbs[dbName] = { ...dbConfig, collections: filteredColls };
    }
  }
  if (Object.keys(filteredDbs).length > 0) {
    result.databases = filteredDbs;
  }
  return result;
}

/**
 * 递归收集 Web 资源文件，返回 base64 编码内容
 * @param {string} dir - 当前扫描目录
 * @param {string} baseDir - 基准目录（计算相对路径）
 * @param {Object} files - 输出对象 { "relative/path": "base64Content" }
 */
export function 收集Web文件(dir, baseDir, files = {}) {
  if (!existsSync(dir)) return files;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_')) {
      收集Web文件(fullPath, baseDir, files);
    } else if (entry.isFile() && !entry.name.startsWith('.')) {
      const relPath = fullPath.slice(baseDir.length + 1).replace(/\\/g, '/');
      try {
        const content = readFileSync(fullPath);
        files[relPath] = content.toString('base64');
      } catch (e) {
        logger.warn(`读取Web资源失败 ${relPath}: ${e.message}`);
      }
    }
  }
  return files;
}

// ==================== 授权验证 ====================

/**
 * 验证开发者身份（步骤 0.5）
 * 
 * 所有扩展（包括官方）统一走 Server /api/dove/developer/verify 远程验证
 * 签名验证由 Server 端完成，鸽子端不区分官方/第三方
 * 
 * @param {string} name - 扩展包名
 * @param {Object} manifest - 扩展 manifest
 * @param {Object} DovesProxy - 鸽子代理
 * @returns {Object|null} developerInfo 或 null
 */
export async function 验证开发者身份(name, manifest, DovesProxy) {
  if (!manifest.developer) return null;

  const { id: devId, signature } = manifest.developer;
  if (!devId) {
    logger.warn(`${name} manifest.developer 缺少 id 字段`);
    return null;
  }
  if (!devId.startsWith('dev_')) {
    logger.warn(`${name} manifest.developer.id 格式无效，应以 dev_ 开头`);
    return null;
  }

  if (!DovesProxy) {
    logger.warn(`${name} 无 DovesProxy，跳过开发者验证`);
    return null;
  }

  try {
    const verifyPayload = { devId };
    if (signature) {
      verifyPayload.signature = signature;
      verifyPayload.payload = computeSignaturePayload(manifest);
    }
    const result = await DovesProxy.fetch('/api/dove/developer/verify', {
      method: 'POST',
      body: verifyPayload,
    });
    if (result.success && result.data?.valid) {
      const sigStatus = result.data.signatureVerified ? '签名验证通过' : (signature ? '签名未验证' : '无签名');
      logger.info(`${name} 开发者验证通过: ${devId} (${result.data.name}) [${sigStatus}]`);
      return { devId, name: result.data.name, signatureVerified: result.data.signatureVerified };
    } else {
      const reason = result.data?.reason || result.error || '未知原因';
      logger.warn(`${name} 开发者验证失败: ${reason}`);
      return null;
    }
  } catch (e) {
    logger.warn(`${name} 开发者验证请求失败: ${e.message}`);
    return null;
  }
}

/**
 * 执行授权检查（步骤 0.7）
 * 所有扩展统一走 Server 授权流程
 * 官方扩展：签名验证通过 = 已授权（OFFICIAL_DEV_SIGNING_KEY 即超管授权凭证）
 * 第三方扩展：需要扩展授权集合中有记录
 * @param {string} name - 扩展包名
 * @param {Object} manifest - 扩展 manifest
 * @param {Object} permissions - manifest.permissions
 * @param {Object} DovesProxy - 鸽子代理
 * @param {Object} [options]
 * @param {boolean} [options.signatureVerified=false] - 开发者签名是否验证通过
 * @returns {{ authMode: string, effectivePermissions: Object }}
 */
export async function 执行授权检查(name, manifest, permissions, DovesProxy, { signatureVerified = false } = {}) {
  let authMode = 'dev'; // 默认开发模式
  let effectivePermissions = filterUserScopedOnly(permissions);
  const devId = manifest.developer?.id;

  if (DovesProxy) {
    // 统一授权流程：调用 /check 获取运行模式（官方/第三方一致）
    try {
      const checkResult = await DovesProxy.fetch('/api/dove/app/check', {
        method: 'POST',
        body: {
          extensionName: name,
          devId: devId || null,
          permissions,
          signatureVerified,
        },
      });

      if (checkResult.success && checkResult.data) {
        authMode = checkResult.data.mode;
        effectivePermissions = checkResult.data.effectivePermissions;

        if (authMode === 'production') {
          logger.info(`${name} 上线模式，权限已授权`);
        } else if (authMode === 'rejected') {
          logger.warn(`${name} 扩展未授权，拒绝加载`);
        } else if (authMode === 'dev') {
          logger.warn(`${name} 开发模式${checkResult.data.warnings?.length ? ': ' + checkResult.data.warnings.join('; ') : '：仅 user_scoped 数据访问'}`);
          logger.warn('提示: 使用 dove app submit 提交审核 或 dove app install 安装授权');
        }
      } else {
        throw new Error(`${name} 授权检查失败: ${checkResult.error || '未知错误'}`);
      }
    } catch (e) {
      throw new Error(`${name} 授权检查请求失败: ${e.message}`);
    }
  } else {
    logger.warn(`${name} 无 DovesProxy，跳过授权检查，默认开发模式`);
  }

  return { authMode, effectivePermissions };
}

// ==================== 服务端上报 ====================

/**
 * 上报工具元数据到 Server（步骤 7.5）
 * @param {string} name - 扩展包名
 * @param {Array} 注册的工具元数据 - 工具元数据列表
 * @param {Object} DovesProxy - 鸽子代理
 * @param {string|null} doveId - 鸽子ID
 */
export async function 上报工具元数据(name, 注册的工具元数据, DovesProxy, doveId) {
  if (!DovesProxy) return;
  try {
    const result = await DovesProxy.fetch('/api/extensions/tools/register', {
      method: 'POST',
      body: { doveId, extension: name, tools: 注册的工具元数据 },
    });
    if (result.success) {
      logger.info(`${name} 工具元数据已上报 Server: ${result.data.注册数} 个`);
    } else {
      logger.warn(`${name} 工具元数据上报失败: ${result.error}`);
    }
  } catch (e) {
    logger.warn(`${name} 工具元数据上报失败（Server 可能未启动）: ${e.message}`);
  }
}

/**
 * 上报 Web 资源到 Server（步骤 11）
 * @param {string} name - 扩展包名
 * @param {string} 扩展目录 - 扩展包根目录
 * @param {Object} manifest - 扩展 manifest
 * @param {Object} DovesProxy - 鸽子代理
 * @param {string|null} doveId - 鸽子ID
 */
export async function 上报Web资源(name, 扩展目录, manifest, DovesProxy, doveId) {
  if (!DovesProxy) return;
  try {
    const webDirName = manifest.web.root || 'web';
    const webDir = join(扩展目录, webDirName);
    if (!existsSync(webDir)) return;

    const files = {};
    收集Web文件(webDir, webDir, files);
    const totalSize = Object.values(files).reduce((s, c) => s + Math.round(c.length * 0.75), 0);

    if (Object.keys(files).length > 0) {
      const result = await DovesProxy.fetch(`/api/ext/${name}/assets-upload`, {
        method: 'POST',
        body: {
          doveId,
          version: manifest.version || '0.0.0',
          files,
          manifest: {
            ...manifest.web,
            abilities: manifest.abilities || [],
            name: manifest.name || name,
            description: manifest.description || '',
          },
        },
      });
      if (result.success) {
        logger.info(`${name} Web资源已上报 Server: ${Object.keys(files).length} 文件, ~${Math.round(totalSize / 1024)}KB`);
      } else {
        logger.warn(`${name} Web资源上报失败: ${result.error}`);
      }
    }
  } catch (e) {
    logger.warn(`${name} Web资源上报失败: ${e.message}`);
  }
}

/**
 * 注册数据库权限到 Server（步骤 12）
 * @param {string} name - 扩展包名
 * @param {Object} dbDeclarations - manifest.permissions.databases
 * @param {Object} DovesProxy - 鸽子代理（可选，为空时尝试从存储接口获取）
 * @param {string|null} doveId - 鸽子ID
 */
export async function 注册数据库权限(name, dbDeclarations, DovesProxy, doveId) {
  try {
    const proxy = DovesProxy || (await import('../tools/存储接口.js')).getDovesProxy();
    const proxyInstance = await (typeof proxy === 'function' ? proxy() : proxy);
    const result = await proxyInstance.fetch('/api/dove/extension/db-register', {
      method: 'POST',
      body: { extension: name, databases: dbDeclarations },
    });
    if (result.success) {
      logger.info(`扩展包 ${name} 数据库权限注册成功: ${result.message}`);
    } else {
      logger.warn(`扩展包 ${name} 数据库权限注册失败: ${result.error || result.message}`);
    }
  } catch (e) {
    logger.warn(`扩展包 ${name} 数据库权限注册失败（服务端可能未启动）: ${e.message}`);
  }
}

/**
 * 注销数据库权限（卸载时调用，步骤 12 逆操作）
 * @param {string} name - 扩展包名
 * @param {Object} 上下文 - 框架上下文
 */
export async function 注销数据库权限(name, 上下文) {
  try {
    const proxy = 上下文.DovesProxy || (await import('../tools/存储接口.js')).getDovesProxy();
    const proxyInstance = await (typeof proxy === 'function' ? proxy() : proxy);
    await proxyInstance.fetch('/api/dove/extension/db-unregister', {
      method: 'POST',
      body: { extension: name },
    });
    logger.info(`扩展包 ${name} 数据库权限已注销`);
  } catch (e) {
    logger.warn(`扩展包 ${name} 数据库权限注销失败: ${e.message}`);
  }
}
