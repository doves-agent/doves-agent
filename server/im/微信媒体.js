/**
 * 微信 iLink CDN 媒体处理
 * 
 * 职责：
 * 1. 下载：从微信 CDN 下载并解密媒体文件（图片/文件/视频/语音）
 * 2. 上传：加密并上传文件到微信 CDN
 * 3. 发送：构造富媒体消息（image_item/file_item/video_item）
 * 
 * 依赖：wechat-ilink-client 库
 * 
 * CDN 加密规范：
 * - 算法: AES-128-ECB (PKCS7 padding)
 * - aes_key 编码:
 *   - 图片: base64(raw 16 bytes)
 *   - 文件/语音/视频: base64(hex string of 16 bytes)
 * - CDN 域名: https://novac2c.cdn.weixin.qq.com/c2c
 */

import { logger } from '../core.js';

// wechat-ilink-client 为可选依赖，未安装时相关功能不可用
// 使用惰性加载避免 CJS 格式的 top-level await 限制
const _lazy = {};
function _w(key) {
  if (!_lazy.mod) {
    try {
      _lazy.mod = require('wechat-ilink-client');
    } catch {
      logger.debug('[微信媒体] wechat-ilink-client 未安装，微信媒体功能不可用');
      _lazy.mod = {};
    }
  }
  return _lazy.mod[key];
}

// ==================== 常量 ====================

/** CDN 基地址 */
const CDN_BASE = _w('CDN_BASE_URL') || 'https://novac2c.cdn.weixin.qq.com/c2c';

/** 消息类型映射 */
const ITEM_TYPE = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
};

// ==================== 下载相关 ====================

/**
 * 从微信 CDN 下载并解密媒体文件
 * 
 * @param {Object} item - iLink 消息中的 MessageItem (含 image_item/file_item/video_item)
 * @param {string} [cdnBaseUrl=CDN_BASE] - CDN 基地址
 * @returns {Promise<{ data: Buffer, kind: string, fileName?: string } | null>}
 */
export async function 下载微信媒体(item, cdnBaseUrl = CDN_BASE) {
  try {
    // 使用 wechat-ilink-client 的 downloadMediaFromItem
    const result = await _w('downloadMediaFromItem')?.(item, cdnBaseUrl);
    
    if (!result) {
      logger.warn('[微信媒体] 下载返回 null，可能无有效 CDN 引用');
      return null;
    }
    
    logger.info(`[微信媒体] 下载完成: kind=${result.kind}, size=${result.data?.length || 0} bytes`);
    return result;
  } catch (err) {
    logger.error(`[微信媒体] 下载失败: ${err.message}`);
    throw err;
  }
}

/**
 * 从 iLink 消息中提取媒体文件信息（不下载）
 * 
 * @param {Object} item - iLink MessageItem
 * @returns {{ type: string, fileName: string, hasMedia: boolean }}
 */
export function 提取媒体信息(item) {
  const type = item.type;
  
  switch (type) {
    case ITEM_TYPE.IMAGE: {
      const img = item.image_item;
      return {
        type: 'image',
        fileName: `image_${Date.now()}.jpg`,
        hasMedia: !!(img?.media?.encrypt_query_param),
        size: img?.mid_size || img?.hd_size || 0,
      };
    }
    case ITEM_TYPE.VOICE: {
      const voice = item.voice_item;
      return {
        type: 'voice',
        fileName: `voice_${Date.now()}.wav`,
        hasMedia: !!(voice?.media?.encrypt_query_param),
        size: 0,
        duration: voice?.playtime || 0,
        text: voice?.text || '',
      };
    }
    case ITEM_TYPE.FILE: {
      const file = item.file_item;
      return {
        type: 'file',
        fileName: file?.file_name || `file_${Date.now()}.bin`,
        hasMedia: !!(file?.media?.encrypt_query_param),
        size: parseInt(file?.len) || 0,
        md5: file?.md5 || '',
      };
    }
    case ITEM_TYPE.VIDEO: {
      const video = item.video_item;
      return {
        type: 'video',
        fileName: `video_${Date.now()}.mp4`,
        hasMedia: !!(video?.media?.encrypt_query_param),
        size: video?.video_size || 0,
        duration: video?.play_length || 0,
      };
    }
    default:
      return { type: 'unknown', fileName: '', hasMedia: false, size: 0 };
  }
}

// ==================== 上传相关 ====================

/**
 * 创建 iLink API 客户端
 * 
 * @param {string} botToken - Bot Token
 * @param {string} botBaseUrl - API 基地址
 * @returns {ApiClient}
 */
export function 创建API客户端(botToken, botBaseUrl) {
  const ApiClient = _w('ApiClient');
  return new ApiClient({
    token: botToken,
    baseUrl: botBaseUrl,
    cdnBaseUrl: CDN_BASE,
  });
}

/**
 * 上传文件到微信 CDN
 * 自动根据 MIME 类型选择上传方式
 * 
 * @param {string} botToken - Bot Token
 * @param {string} botBaseUrl - API 基地址
 * @param {string} filePath - 本地文件路径
 * @param {string} toUserId - 目标用户ID（iLink 用户ID，用于 getuploadurl）
 * @returns {Promise<{ uploaded: Object, mediaType: string, fileName: string }>}
 */
export async function 上传微信媒体(botToken, botBaseUrl, filePath, toUserId) {
  const api = 创建API客户端(botToken, botBaseUrl);
  const mime = (_w('getMimeFromFilename') || (() => 'application/octet-stream'))(filePath);
  
  let uploaded;
  let mediaType;
  
  try {
    if (mime.startsWith('image/')) {
      // 图片上传
      uploaded = await _w('uploadImage')({
        filePath,
        toUserId,
        api,
        cdnBaseUrl: CDN_BASE,
      });
      mediaType = 'image';
      logger.info(`[微信媒体] 图片上传完成: ${filePath} → CDN (${uploaded.fileSize} bytes)`);
    } else if (mime.startsWith('video/')) {
      // 视频上传
      uploaded = await _w('uploadVideo')({
        filePath,
        toUserId,
        api,
        cdnBaseUrl: CDN_BASE,
      });
      mediaType = 'video';
      logger.info(`[微信媒体] 视频上传完成: ${filePath} → CDN (${uploaded.fileSize} bytes)`);
    } else {
      // 通用文件上传
      uploaded = await _w('uploadFile')({
        filePath,
        toUserId,
        api,
        cdnBaseUrl: CDN_BASE,
      });
      mediaType = 'file';
      logger.info(`[微信媒体] 文件上传完成: ${filePath} → CDN (${uploaded.fileSize} bytes)`);
    }
  } catch (err) {
    logger.error(`[微信媒体] 上传失败: ${err.message}`);
    throw err;
  }
  
  return {
    uploaded,
    mediaType,
    fileName: filePath.split(/[/\\]/).pop(), // 兼容 Windows/Unix 路径
  };
}

// ==================== 发送相关 ====================

/**
 * 发送富媒体消息到微信
 * 自动根据媒体类型构造 image_item/file_item/video_item
 * 
 * @param {string} botToken - Bot Token
 * @param {string} botBaseUrl - API 基地址
 * @param {string} toUserId - 目标用户 iLink ID
 * @param {string} contextToken - 上下文令牌（必填，从收到消息中获取）
 * @param {Object} uploaded - 上传结果（来自 上传微信媒体 的返回值）
 * @param {string} mediaType - 媒体类型 ('image'|'video'|'file')
 * @param {string} fileName - 文件名
 * @param {string} [caption] - 附加文字说明
 * @returns {Promise<string>} client_id
 */
export async function 发送微信富媒体消息(botToken, botBaseUrl, toUserId, contextToken, uploaded, mediaType, fileName, caption) {
  const api = 创建API客户端(botToken, botBaseUrl);
  
  try {
    let clientId;
    
    switch (mediaType) {
      case 'image':
        clientId = await _w('sendImage')(api, toUserId, uploaded, contextToken, caption);
        break;
      case 'video':
        clientId = await _w('sendVideo')(api, toUserId, uploaded, contextToken, caption);
        break;
      case 'file':
      default:
        clientId = await _w('sendFileMessage')(api, toUserId, fileName, uploaded, contextToken, caption);
        break;
    }
    
    logger.info(`[微信媒体] 发送${mediaType}消息完成: to=${toUserId}, file=${fileName}`);
    return clientId;
  } catch (err) {
    logger.error(`[微信媒体] 发送富媒体消息失败: ${err.message}`);
    throw err;
  }
}

/**
 * 一站式：上传 + 发送
 * 读取本地文件 → 上传到 CDN → 发送富媒体消息
 * 
 * @param {string} botToken - Bot Token
 * @param {string} botBaseUrl - API 基地址
 * @param {string} toUserId - 目标用户 iLink ID
 * @param {string} contextToken - 上下文令牌
 * @param {string} filePath - 本地文件路径
 * @param {string} [caption] - 附加文字说明
 * @returns {Promise<{ clientId: string, mediaType: string, fileName: string }>}
 */
export async function 上传并发送微信媒体(botToken, botBaseUrl, toUserId, contextToken, filePath, caption) {
  // 1. 上传
  const { uploaded, mediaType, fileName } = await 上传微信媒体(botToken, botBaseUrl, filePath, toUserId);
  
  // 2. 发送
  const clientId = await 发送微信富媒体消息(botToken, botBaseUrl, toUserId, contextToken, uploaded, mediaType, fileName, caption);
  
  return { clientId, mediaType, fileName };
}

// ==================== 直接发送（不走 CDN 上传） ====================

/**
 * 构造富媒体消息体（用于 sendmessage）
 * 当已有 CDN 引用时，可以直接构造消息体发送
 * 
 * @param {string} toUserId - 目标用户ID
 * @param {string} contextToken - 上下文令牌
 * @param {Object} cdnMediaRef - CDN 媒体引用 { encrypt_query_param, aes_key, encrypt_type }
 * @param {string} mediaType - 媒体类型 ('image'|'video'|'file')
 * @param {Object} extra - 附加参数 { file_name, len, video_size, play_length }
 * @returns {Object} sendmessage 请求体
 */
export function 构造富媒体消息体(toUserId, contextToken, cdnMediaRef, mediaType, extra = {}) {
  const baseMsg = {
    to_user_id: toUserId,
    message_type: 2,  // BOT
    message_state: 2, // FINISH
    context_token: contextToken,
  };
  
  let item;
  
  switch (mediaType) {
    case 'image':
      item = {
        type: ITEM_TYPE.IMAGE,
        image_item: {
          media: {
            encrypt_query_param: cdnMediaRef.encrypt_query_param,
            aes_key: cdnMediaRef.aes_key,
            encrypt_type: cdnMediaRef.encrypt_type ?? 1,
          },
          mid_size: extra.size || 0,
        },
      };
      break;
    case 'video':
      item = {
        type: ITEM_TYPE.VIDEO,
        video_item: {
          media: {
            encrypt_query_param: cdnMediaRef.encrypt_query_param,
            aes_key: cdnMediaRef.aes_key,
            encrypt_type: cdnMediaRef.encrypt_type ?? 1,
          },
          video_size: extra.size || 0,
          play_length: extra.duration || 0,
        },
      };
      break;
    case 'file':
    default:
      item = {
        type: ITEM_TYPE.FILE,
        file_item: {
          media: {
            encrypt_query_param: cdnMediaRef.encrypt_query_param,
            aes_key: cdnMediaRef.aes_key,
            encrypt_type: cdnMediaRef.encrypt_type ?? 1,
          },
          file_name: extra.file_name || 'file',
          len: String(extra.size || 0),
        },
      };
      break;
  }
  
  return {
    msg: {
      ...baseMsg,
      item_list: [item],
    },
  };
}

export default {
  下载微信媒体,
  提取媒体信息,
  上传微信媒体,
  发送微信富媒体消息,
  上传并发送微信媒体,
  构造富媒体消息体,
  创建API客户端,
  CDN_BASE,
  ITEM_TYPE,
};
