/**
 * @file extensions/_signature
 * @description 扩展包签名 CLI 工具
 * 
 * 核心签名逻辑已拆分到 @dove/common/扩展签名.js（Server + Doves 共用）
 * 本文件仅保留 CLI 工具函数（generateDevSignature）
 * 
 * 详见: 白鸽文档/dove_apps/接口底座规范.md
 */

export { computeSignaturePayload, signManifest, verifySignature } from '@dove/common/扩展签名.js';

import { signManifest, computeSignaturePayload } from '@dove/common/扩展签名.js';

// ==================== CLI 工具函数 ====================

/**
 * 为开发者生成扩展包签名
 * 供 CLI 命令调用
 * 
 * @param {string} manifestPath - manifest.js 文件路径
 * @param {string} signingKey - 开发者签名密钥
 * @returns {Promise<{success: boolean, signature?: string, error?: string}>}
 */
export async function generateDevSignature(manifestPath, signingKey) {
  try {
    const manifestModule = await import(`file://${manifestPath}`);
    const manifest = manifestModule.default || manifestModule;

    if (!manifest.name) {
      return { success: false, error: 'manifest 缺少 name 字段' };
    }

    const signature = signManifest(manifest, signingKey);
    const payload = computeSignaturePayload(manifest);

    return {
      success: true,
      signature,
      payload,
      manifest: {
        name: manifest.name,
        version: manifest.version,
      },
    };
  } catch (e) {
    return { success: false, error: `生成签名失败: ${e.message}` };
  }
}
