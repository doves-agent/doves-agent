/**
 * 扩展资源分发 API
 *
 * 职责：
 * 1. 提供扩展Web资源包（HTML/JS/CSS/图片等）给CLI端下载缓存
 * 2. 提供扩展版本信息，供CLI端检测更新
 *
 * 设计理念：
 * - 扩展Web资源属于CLI展示层，Server 只负责分发资源文件，不执行扩展逻辑
 * - 无需强制认证 — 扩展资源是公开的展示层，业务数据走 tools/call 需认证
 * - 资源数据由 Doves 启动时通过 HTTP 上报，Server 不依赖 Doves 目录
 *
 * API:
 *   POST /api/ext/:name/assets-upload  — Doves 上报扩展资源（鸽子级认证）
 *   GET  /api/ext/:name/version         — 获取扩展版本信息
 *   GET  /api/ext/:name/assets          — 获取扩展Web资源包（全量）
 */

import { Router } from 'express';
import { logger } from '../core.js';

const router = Router();

// ==================== 扩展资源注册表（由 Doves HTTP 上报填充） ====================

/**
 * 扩展资源注册表
 * Map<extName, { version, hash, fileCount, files: Map<path, base64Content>, manifest, updatedAt }>
 * 
 * Doves 启动时扫描本地扩展目录，将 web 资源 base64 编码后上报给 Server
 */
const assetRegistry = new Map();

/**
 * 获取扩展资源注册表（供其他模块查询已加载的扩展信息）
 * @returns {Map} assetRegistry
 */
export function getAssetRegistry() {
  return assetRegistry;
}

/**
 * POST /api/ext/:name/assets-upload
 * Doves 上报扩展资源（base64编码的文件内容）
 * 
 * Body:
 *   version   (必填) 扩展版本号
 *   files     (必填) 文件内容对象 { "path": "base64Content", ... }
 *   manifest  (可选) Web 配置信息
 *   hash      (可选) 资源hash（用于版本比对）
 *   doveId    (必填) 上报的鸽子 ID
 */
router.post('/:name/assets-upload', async (req, res) => {
  const extName = req.params.name;
  const { version, files, manifest, hash, doveId } = req.body;

  if (!extName || extName.startsWith('_') || extName.startsWith('.')) {
    return res.status(400).json({ success: false, error: '无效的扩展名' });
  }

  if (!doveId) {
    return res.status(400).json({ success: false, error: '缺少必填参数: doveId' });
  }

  if (!files || typeof files !== 'object') {
    return res.status(400).json({ success: false, error: '缺少必填参数: files' });
  }

  const fileCount = Object.keys(files).length;
  const totalSize = Object.values(files).reduce((sum, content) => {
    // base64 编码后大小约为原始大小的 4/3
    return sum + Math.round(content.length * 0.75);
  }, 0);

  assetRegistry.set(extName, {
    version: version || '0.0.0',
    hash: hash || null,
    fileCount,
    files: new Map(Object.entries(files)),
    manifest: manifest || null,
    doveId,
    updatedAt: Date.now(),
  });

  logger.info(`[ext-assets] 鸽子 ${doveId} 上报扩展 ${extName} 资源: ${fileCount} 文件, ~${Math.round(totalSize / 1024)}KB`);

  res.json({
    success: true,
    data: { extName, fileCount, version: version || '0.0.0' },
  });
});

// ==================== 初始化（空操作，等待 Doves 上报） ====================

/**
 * 初始化扩展资源分发模块
 */
export function initializeExtensionAssets(options = {}) {
  logger.info('[ext-assets] 扩展资源分发API已初始化（等待 Doves 上报资源）');
}

// ==================== 查询 API ====================

/**
 * GET /api/ext/:name/version
 * 获取扩展版本信息
 */
router.get('/:name/version', (req, res) => {
  const extName = req.params.name;

  if (!extName || extName.startsWith('_') || extName.startsWith('.')) {
    return res.status(400).json({ success: false, error: '无效的扩展名' });
  }

  const entry = assetRegistry.get(extName);
  if (!entry) {
    return res.status(404).json({
      success: false,
      error: `扩展 ${extName} 资源未注册。Doves 启动后会自动上报`,
    });
  }

  res.json({
    success: true,
    data: {
      name: extName,
      version: entry.version,
      hash: entry.hash,
      fileCount: entry.fileCount,
    },
  });
});

/**
 * GET /api/ext/:name/assets
 * 获取扩展Web资源包（全量）
 * 返回所有文件内容（base64编码）
 */
router.get('/:name/assets', (req, res) => {
  const extName = req.params.name;

  if (!extName || extName.startsWith('_') || extName.startsWith('.')) {
    return res.status(400).json({ success: false, error: '无效的扩展名' });
  }

  const entry = assetRegistry.get(extName);
  if (!entry) {
    return res.status(404).json({
      success: false,
      error: `扩展 ${extName} 资源未注册。Doves 启动后会自动上报`,
    });
  }

  // 将 Map 转换回普通对象
  const fileData = {};
  let totalSize = 0;
  for (const [path, content] of entry.files) {
    fileData[path] = { content };
    totalSize += Math.round(content.length * 0.75);
  }

  res.json({
    success: true,
    data: {
      name: extName,
      version: entry.version,
      files: fileData,
      manifest: entry.manifest,
      stats: {
        fileCount: entry.fileCount,
        totalSize,
      },
    },
  });
});

export default router;
