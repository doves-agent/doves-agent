/**
 * 开发者注册服务
 * 职责：开发者账号注册、签名密钥管理、扩展包归属绑定
 * 
 * 从接口底座 Phase 2 拆分，遵循KISS原则
 * 复用 server/注册服务/工具.js 的 ID 生成 + 密钥哈希模式
 */

import { getAdminDb, createTimestampFields } from '../db.js';
import { logger, CONFIG } from '../core.js';
import { verifySignature } from '@dove/common/扩展签名.js';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';

// ==================== 工具函数 ====================

/**
 * 生成开发者ID
 * 格式: dev_{objectId}
 */
export function generateDevId() {
  return `dev_${new ObjectId().toString()}`;
}

/**
 * 生成开发者签名密钥
 * 格式: dvsk_{devId}_{secret}
 * 用于扩展包 manifest 签名
 */
export function generateSigningKey(devId) {
  const secret = randomBytes(32).toString('hex');
  const signingKey = `dvsk_${devId}_${secret}`;
  return {
    signingKey,
    keyId: devId,
    keySecret: secret,
  };
}

/**
 * 哈希签名密钥部分（复用 bcrypt 12轮）
 */
export async function hashSigningKeySecret(secret) {
  return bcrypt.hash(secret, 12);
}

// ==================== 核心服务 ====================

/**
 * 确保官方开发者账号存在于数据库（服务端启动时调用）
 * 
 * 签名密钥从 .env 的 OFFICIAL_DEV_SIGNING_KEY 读取，服务端启动时同步到数据库。
 * 首次运行时自动创建记录；后续启动时如果 .env 中的密钥变更，自动更新数据库中的哈希。
 */
export async function ensureOfficialDevelopers() {
  const adminDb = getAdminDb();
  const ts = createTimestampFields();

  const officialDevelopers = [
    { devId: 'dev_official', name: '白鸽官方', userId: 'system' },
  ];

  for (const { devId, name, userId } of officialDevelopers) {
    try {
      // 从应用配置读取签名密钥
      const signingKey = CONFIG.officialDevSigningKey;
      if (!signingKey) {
        logger.warn(`[开发者注册] OFFICIAL_DEV_SIGNING_KEY 未配置，跳过官方开发者初始化`);
        continue;
      }

      // 解析签名密钥，提取 secret 部分
      const keySecret = signingKey.replace(/^dvsk_dev_official_/, '');
      const hashedSecret = await hashSigningKeySecret(keySecret);

      const existing = await adminDb.collection('开发者').findOne({ devId });

      if (existing) {
        // 已存在：检查密钥是否变更，变更则更新
        // bcrypt 哈希无法直接对比，因此每次都更新（幂等操作，代价极低）
        await adminDb.collection('开发者').updateOne(
          { devId },
          {
            $set: {
              signingKeyHash: hashedSecret,
              updatedAt: ts.localTime,
              updatedAtTimestamp: ts.timestamp,
            },
          }
        );
        logger.info(`[开发者注册] 官方开发者签名密钥已同步: ${name} (${devId})`);
        continue;
      }

      // 首次创建
      await adminDb.collection('开发者').insertOne({
        devId,
        name,
        userId,
        signingKeyHash: hashedSecret,
        状态: '活跃',
        extensions: [],
        createdAt: ts.localTime,
        createdAtTimestamp: ts.timestamp,
        updatedAt: ts.localTime,
        updatedAtTimestamp: ts.timestamp,
      });
      logger.info(`[开发者注册] 官方开发者已注册: ${name} (${devId})`);
    } catch (e) {
      logger.warn(`[开发者注册] 注册官方开发者 ${devId} 失败: ${e.message}`);
    }
  }
}

/**
 * 注册开发者账号
 * @param {Object} params
 * @param {string} params.name - 开发者名称
 * @param {string} params.userId - 关联的用户ID
 * @returns {Promise<{成功: boolean, 开发者?: Object, 错误?: string}>}
 */
export async function 注册开发者账号({ name, userId }) {
  const adminDb = getAdminDb();
  const ts = createTimestampFields();

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return { 成功: false, 错误: '开发者名称必填' };
  }

  if (!userId) {
    return { 成功: false, 错误: '关联用户ID必填' };
  }

  try {
    // 每个用户最多 1 个开发者账号
    const existing = await adminDb.collection('开发者').findOne({ userId, 状态: '活跃' });
    if (existing) {
      return { 成功: false, 错误: `该用户已注册开发者账号: ${existing.devId}` };
    }

    const devId = generateDevId();
    const keyInfo = generateSigningKey(devId);
    const hashedSecret = await hashSigningKeySecret(keyInfo.keySecret);

    const developer = {
      devId,
      name: name.trim(),
      userId,
      signingKeyHash: hashedSecret,
      状态: '活跃',
      extensions: [],
      createdAt: ts.localTime,
      createdAtTimestamp: ts.timestamp,
      updatedAt: ts.localTime,
      updatedAtTimestamp: ts.timestamp,
    };

    await adminDb.collection('开发者').insertOne(developer);

    logger.info(`开发者账号注册成功: ${name} (${devId}), 用户: ${userId}`);

    return {
      成功: true,
      开发者: {
        devId,
        name: name.trim(),
        signingKey: keyInfo.signingKey,  // 完整签名密钥，仅此一次返回
        createdAt: ts.localTime,
      },
    };
  } catch (错误) {
    logger.error(`注册开发者账号失败: ${错误.message}`);
    return { 成功: false, 错误: 错误.message };
  }
}

/**
 * 获取开发者信息
 * @param {string} devId - 开发者ID
 * @returns {Promise<{成功: boolean, 开发者?: Object, 错误?: string}>}
 */
export async function 获取开发者信息(devId) {
  const adminDb = getAdminDb();

  try {
    const developer = await adminDb.collection('开发者').findOne({ devId });
    if (!developer) {
      return { 成功: false, 错误: '开发者不存在' };
    }

    return {
      成功: true,
      开发者: {
        devId: developer.devId,
        name: developer.name,
        userId: developer.userId,
        状态: developer.状态,
        extensions: developer.extensions || [],
        createdAt: developer.createdAt,
        // 不返回 signingKeyHash
      },
    };
  } catch (错误) {
    logger.error(`获取开发者信息失败: ${错误.message}`);
    return { 成功: false, 错误: 错误.message };
  }
}

/**
 * 根据用户ID获取开发者信息
 * @param {string} userId - 用户ID
 * @returns {Promise<{成功: boolean, 开发者?: Object, 错误?: string}>}
 */
export async function 根据用户获取开发者(userId) {
  const adminDb = getAdminDb();

  try {
    const developer = await adminDb.collection('开发者').findOne({ userId, 状态: '活跃' });
    if (!developer) {
      return { 成功: false, 错误: '该用户未注册开发者账号' };
    }

    return {
      成功: true,
      开发者: {
        devId: developer.devId,
        name: developer.name,
        userId: developer.userId,
        状态: developer.状态,
        extensions: developer.extensions || [],
        createdAt: developer.createdAt,
      },
    };
  } catch (错误) {
    logger.error(`根据用户获取开发者失败: ${错误.message}`);
    return { 成功: false, 错误: 错误.message };
  }
}

/**
 * 绑定扩展包到开发者
 * @param {string} devId - 开发者ID
 * @param {string} userId - 操作者用户ID（必须与开发者的userId一致）
 * @param {string} extensionName - 扩展包名称
 * @returns {Promise<{成功: boolean, 错误?: string}>}
 */
export async function 绑定扩展(devId, userId, extensionName) {
  const adminDb = getAdminDb();
  const ts = createTimestampFields();

  if (!extensionName || typeof extensionName !== 'string') {
    return { 成功: false, 错误: '扩展包名称必填' };
  }

  try {
    const developer = await adminDb.collection('开发者').findOne({ devId, 状态: '活跃' });
    if (!developer) {
      return { 成功: false, 错误: '开发者不存在或已停用' };
    }

    if (developer.userId !== userId) {
      return { 成功: false, 错误: '无权操作此开发者账号' };
    }

    if (developer.extensions && developer.extensions.includes(extensionName)) {
      return { 成功: false, 错误: `扩展 "${extensionName}" 已绑定` };
    }

    await adminDb.collection('开发者').updateOne(
      { devId },
      {
        $addToSet: { extensions: extensionName },
        $set: { updatedAt: ts.localTime, updatedAtTimestamp: ts.timestamp },
      }
    );

    logger.info(`扩展绑定成功: ${extensionName} → 开发者 ${devId}`);
    return { 成功: true };
  } catch (错误) {
    logger.error(`绑定扩展失败: ${错误.message}`);
    return { 成功: false, 错误: 错误.message };
  }
}

/**
 * 解绑扩展包
 * @param {string} devId - 开发者ID
 * @param {string} userId - 操作者用户ID
 * @param {string} extensionName - 扩展包名称
 * @returns {Promise<{成功: boolean, 错误?: string}>}
 */
export async function 解绑扩展(devId, userId, extensionName) {
  const adminDb = getAdminDb();
  const ts = createTimestampFields();

  try {
    const developer = await adminDb.collection('开发者').findOne({ devId, 状态: '活跃' });
    if (!developer) {
      return { 成功: false, 错误: '开发者不存在或已停用' };
    }

    if (developer.userId !== userId) {
      return { 成功: false, 错误: '无权操作此开发者账号' };
    }

    await adminDb.collection('开发者').updateOne(
      { devId },
      {
        $pull: { extensions: extensionName },
        $set: { updatedAt: ts.localTime, updatedAtTimestamp: ts.timestamp },
      }
    );

    logger.info(`扩展解绑成功: ${extensionName} ← 开发者 ${devId}`);
    return { 成功: true };
  } catch (错误) {
    logger.error(`解绑扩展失败: ${错误.message}`);
    return { 成功: false, 错误: 错误.message };
  }
}

/**
 * 验证开发者ID是否有效
 * @param {string} devId - 开发者ID
 * @returns {Promise<{valid: boolean, name?: string, reason?: string}>}
 */
export async function 验证开发者(devId) {
  const adminDb = getAdminDb();

  try {
    const developer = await adminDb.collection('开发者').findOne({ devId });
    if (!developer) {
      return { valid: false, reason: '开发者不存在' };
    }

    if (developer.状态 !== '活跃') {
      return { valid: false, reason: `开发者已${developer.状态}` };
    }

    return { valid: true, name: developer.name };
  } catch (错误) {
    logger.error(`验证开发者失败: ${错误.message}`);
    return { valid: false, reason: `验证异常: ${错误.message}` };
  }
}

/**
 * 验证开发者签名密钥
 * 用于 /verify 端点，验证扩展包签名
 * 
 * 官方/第三方统一流程：
 * - 有签名时，用开发者签名密钥做 HMAC-SHA256 验签
 * - 官方开发者使用 CONFIG.officialDevSigningKey
 * - 第三方开发者使用数据库存储的签名密钥（待实现安全存储方案后启用）
 * 
 * @param {string} devId - 开发者ID
 * @param {string} signature - 扩展包签名
 * @param {string} payload - 待验证的签名内容
 * @returns {Promise<{valid: boolean, name?: string, reason?: string, signatureVerified?: boolean}>}
 */
export async function 验证开发者签名(devId, signature, payload) {
  const adminDb = getAdminDb();

  try {
    // 先验证开发者本身
    const devCheck = await 验证开发者(devId);
    if (!devCheck.valid) {
      return devCheck;
    }

    // 无签名时验证失败：所有扩展（包括官方）必须提供签名
    if (!signature) {
      return { valid: false, reason: '缺少扩展包签名，所有扩展必须签名' };
    }

    // 解析签名格式: hmac-sha256:<hex>
    const sigMatch = signature.match(/^hmac-sha256:([a-f0-9]+)$/);
    if (!sigMatch) {
      return { valid: false, reason: '签名格式无效，应为 hmac-sha256:<hex>' };
    }

    // 获取开发者签名密钥
    const developer = await adminDb.collection('开发者').findOne({ devId, 状态: '活跃' });
    if (!developer) {
      return { valid: false, reason: '开发者不存在' };
    }

    // 官方开发者：使用 CONFIG 中的签名密钥直接验签
    if (devId === 'dev_official') {
      const signingKey = CONFIG.officialDevSigningKey;
      if (!signingKey) {
        logger.error('[开发者注册] 官方开发者签名密钥未配置（CONFIG.officialDevSigningKey）');
        return { valid: false, reason: '官方开发者签名密钥未配置' };
      }

      // 从 payload 重建 manifest 子集用于验签
      // payload 格式: name\nversion\npermissions_json
      // 直接用 payload 做 HMAC 验证（与 signManifest 逻辑一致）
      const { createHmac } = await import('crypto');
      const hmac = createHmac('sha256', signingKey);
      hmac.update(payload || '');
      const expectedHex = hmac.digest('hex');

      if (sigMatch[1] === expectedHex) {
        return { valid: true, name: devCheck.name, signatureVerified: true };
      } else {
        return { valid: false, reason: '签名验证失败，manifest 可能已被修改' };
      }
    }

    // 第三方开发者：签名密钥以 bcrypt 哈希存储，无法直接做 HMAC 验证
    // TODO: 实现安全的签名密钥存储方案后启用服务端验签
    return { valid: true, name: devCheck.name, signatureVerified: false, note: '第三方签名验证待启用' };
  } catch (错误) {
    logger.error(`验证开发者签名失败: ${错误.message}`);
    return { valid: false, reason: `验证异常: ${错误.message}` };
  }
}

/**
 * 重新生成签名密钥
 * 旧密钥立即失效，所有使用旧密钥签名的扩展包需重新签名
 * @param {string} devId - 开发者ID
 * @param {string} userId - 操作者用户ID
 * @returns {Promise<{成功: boolean, signingKey?: string, 错误?: string}>}
 */
export async function 重新生成签名密钥(devId, userId) {
  const adminDb = getAdminDb();
  const ts = createTimestampFields();

  try {
    const developer = await adminDb.collection('开发者').findOne({ devId, 状态: '活跃' });
    if (!developer) {
      return { 成功: false, 错误: '开发者不存在或已停用' };
    }

    if (developer.userId !== userId) {
      return { 成功: false, 错误: '无权操作此开发者账号' };
    }

    const keyInfo = generateSigningKey(devId);
    const hashedSecret = await hashSigningKeySecret(keyInfo.keySecret);

    await adminDb.collection('开发者').updateOne(
      { devId },
      {
        $set: {
          signingKeyHash: hashedSecret,
          updatedAt: ts.localTime,
          updatedAtTimestamp: ts.timestamp,
        },
      }
    );

    logger.info(`开发者签名密钥已重新生成: ${devId}`);

    return {
      成功: true,
      signingKey: keyInfo.signingKey,  // 新密钥，仅此一次返回
    };
  } catch (错误) {
    logger.error(`重新生成签名密钥失败: ${错误.message}`);
    return { 成功: false, 错误: 错误.message };
  }
}
