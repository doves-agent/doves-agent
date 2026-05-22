/**
 * 扩展包仓库 API
 * 挂载到 /api/dove/app/store
 *
 * 端点：
 *   POST /publish         发布扩展包（上传 .dove 文件到 OSS）
 *   GET  /search          搜索扩展包（从官方注册表+索引查询）
 *   GET  /download/:name  下载扩展包（从 OSS 获取 .dove 文件）
 *   GET  /info/:name      查询扩展包详情
 *
 * OSS 目录结构：
 *   agent/extensions/官方/{包名}/{版本}.dove    # 官方扩展包
 *   agent/extensions/第三方/{devId}/{包名}/{版本}.dove  # 第三方扩展包
 */

import { Router } from 'express';
import { getAdminDb, createTimestampFields, getOSSClient } from '../../db.js';
import { logger } from '../../core.js';
import { isOfficialExtension } from '../../注册服务/扩展授权.js';

const router = Router();

// OSS 扩展包路径前缀
const OSS_EXTENSIONS_PREFIX = 'extensions/';

/**
 * 生成 OSS 存储路径
 * @param {Object} metadata - 包元数据
 * @returns {string} OSS 路径
 */
function 生成OSS路径(metadata) {
  const { name, version, developer } = metadata;
  if (developer?.id === 'dev_official') {
    return `${OSS_EXTENSIONS_PREFIX}官方/${name}/${version}.dove`;
  }
  const devId = developer?.id || 'unknown';
  return `${OSS_EXTENSIONS_PREFIX}第三方/${devId}/${name}/${version}.dove`;
}

// ==================== 发布扩展包 ====================

router.post('/publish', async (req, res) => {
  const userId = req.user?.userId;
  const metadata = req.body.metadata;

  if (!metadata || !metadata.name || !metadata.version) {
    return res.status(400).json({ success: false, error: 'metadata 中 name 和 version 必填' });
  }

  try {
    const ossClient = await getOSSClient();
    if (!ossClient) {
      return res.status(500).json({ success: false, error: 'OSS 未配置' });
    }

    const oss路径 = 生成OSS路径(metadata);

    // 检查是否已存在同版本
    try {
      await ossClient.head(oss路径);
      return res.status(409).json({ success: false, error: `${metadata.name} v${metadata.version} 已发布，请升级版本号` });
    } catch {
      // 不存在，可以发布
    }

    // 更新官方注册表中的包索引
    const adminDb = getAdminDb();
    const ts = createTimestampFields();

    await adminDb.collection('扩展包索引').updateOne(
      { name: metadata.name },
      {
        $set: {
          name: metadata.name,
          latestVersion: metadata.version,
          description: metadata.description || '',
          abilities: metadata.abilities || [],
          dependencies: metadata.dependencies || [],
          developer: metadata.developer || null,
          permissions: metadata.permissions || null,
          signature: metadata.signature || null,
          oss路径,
          publishedBy: userId,
          updatedAt: ts.localTime,
        },
        $setOnInsert: {
          createdAt: ts.localTime,
        },
        $push: {
          versions: {
            version: metadata.version,
            oss路径,
            publishedAt: ts.localTime,
            publishedBy: userId,
            fileCount: Object.keys(metadata.files || {}).length,
            signature: metadata.signature,
          },
        },
      },
      { upsert: true }
    );

    logger.info(`[store] 扩展包 "${metadata.name}" v${metadata.version} 索引已更新`);

    res.json({
      success: true,
      data: {
        name: metadata.name,
        version: metadata.version,
        oss路径,
        hint: '请使用 CLI 上传 .dove 文件: dove app upload <file>',
      },
    });
  } catch (e) {
    logger.error(`[store] 发布失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 上传 .dove 文件 ====================

router.post('/upload', async (req, res) => {
  const userId = req.user?.userId;

  if (!req.body || !req.body.name || !req.body.version) {
    return res.status(400).json({ success: false, error: 'name 和 version 必填' });
  }

  try {
    const ossClient = await getOSSClient();
    if (!ossClient) {
      return res.status(500).json({ success: false, error: 'OSS 未配置' });
    }

    const { name, version } = req.body;

    // 从索引中获取 OSS 路径
    const adminDb = getAdminDb();
    const 索引 = await adminDb.collection('扩展包索引').findOne({ name });

    if (!索引) {
      return res.status(404).json({ success: false, error: `扩展包 "${name}" 未注册，请先 publish` });
    }

    const oss路径 = 生成OSS路径({ name, version, developer: 索引.developer });

    // 生成 OSS 签名上传 URL（客户端直传）
    const 签名URL = ossClient.signatureUrl(oss路径, {
      expires: 3600,
      method: 'PUT',
      'Content-Type': 'application/gzip',
    });

    res.json({
      success: true,
      data: {
        uploadUrl: 签名URL,
        oss路径,
        method: 'PUT',
        contentType: 'application/gzip',
      },
    });
  } catch (e) {
    logger.error(`[store] 上传URL生成失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 搜索扩展包 ====================

router.get('/search', async (req, res) => {
  const { keyword, page = 1, limit = 20 } = req.query;

  try {
    const adminDb = getAdminDb();
    const query = {};

    if (keyword) {
      query.$or = [
        { name: { $regex: keyword, $options: 'i' } },
        { description: { $regex: keyword, $options: 'i' } },
        { abilities: { $regex: keyword, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const 列表 = await adminDb.collection('扩展包索引')
      .find(query)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    const total = await adminDb.collection('扩展包索引').countDocuments(query);

    const 结果 = 列表.map(item => ({
      name: item.name,
      latestVersion: item.latestVersion,
      description: item.description,
      abilities: item.abilities,
      dependencies: item.dependencies,
      developer: item.developer ? {
        id: item.developer.id,
        isOfficial: item.developer.id === 'dev_official',
      } : null,
      versionCount: (item.versions || []).length,
      updatedAt: item.updatedAt,
    }));

    res.json({ success: true, data: { total, 列表: 结果 } });
  } catch (e) {
    logger.error(`[store] 搜索失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 查询扩展包详情 ====================

router.get('/info/:name', async (req, res) => {
  const { name } = req.params;

  try {
    const adminDb = getAdminDb();
    const 索引 = await adminDb.collection('扩展包索引').findOne({ name });

    if (!索引) {
      return res.status(404).json({ success: false, error: `扩展包 "${name}" 不存在` });
    }

    res.json({
      success: true,
      data: {
        name: 索引.name,
        latestVersion: 索引.latestVersion,
        description: 索引.description,
        abilities: 索引.abilities,
        dependencies: 索引.dependencies,
        developer: 索引.developer,
        permissions: 索引.permissions,
        versions: (索引.versions || []).map(v => ({
          version: v.version,
          publishedAt: v.publishedAt,
          fileCount: v.fileCount,
        })),
      },
    });
  } catch (e) {
    logger.error(`[store] 查询失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 下载扩展包 ====================

router.get('/download/:name/:version?', async (req, res) => {
  const { name, version } = req.params;

  try {
    const ossClient = await getOSSClient();
    if (!ossClient) {
      return res.status(500).json({ success: false, error: 'OSS 未配置' });
    }

    const adminDb = getAdminDb();
    const 索引 = await adminDb.collection('扩展包索引').findOne({ name });

    if (!索引) {
      return res.status(404).json({ success: false, error: `扩展包 "${name}" 不存在` });
    }

    // 确定版本
    const 目标版本 = version || 索引.latestVersion;

    // 找到对应版本的 OSS 路径
    let oss路径;
    if (version) {
      const 版本记录 = (索引.versions || []).find(v => v.version === version);
      if (版本记录) {
        oss路径 = 版本记录.oss路径;
      }
    }
    if (!oss路径) {
      oss路径 = 生成OSS路径({ name, version: 目标版本, developer: 索引.developer });
    }

    // 生成签名下载 URL（1小时有效）
    const 签名URL = ossClient.signatureUrl(oss路径, { expires: 3600, responseContentType: 'application/gzip' });

    res.json({
      success: true,
      data: {
        name,
        version: 目标版本,
        downloadUrl: 签名URL,
        oss路径,
      },
    });
  } catch (e) {
    logger.error(`[store] 下载失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
