/**
 * IM 文件发送技能
 * 
 * 支持通过 IM 平台（微信/钉钉/飞书）发送文件给用户
 * 
 * 使用场景：
 * - 用户在微信/钉钉/飞书说"把上次的报告发给我"
 * - 鸽子找到文件后，调用此技能发送到对应 IM 平台
 * - 支持图片/视频/文件等所有类型
 * 
 * 设计原则：
 * - 参数自包含，通过 serverUrl 和 token 连接服务端
 * - 无状态执行
 * - 自动根据 MIME 类型选择发送方式（图片/视频/文件）
 * - 统一通过 /api/im/sendfile 入口，支持三平台
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';
import { getDovesProxy } from '../../tools/存储接口.js';

// ============================================================================
// 日志器
// ============================================================================

const logger = 创建日志器('IM文件发送', { 前缀: '[IM文件发送]', 级别: 'debug', 显示调用位置: true });

// ============================================================================
// 核心执行函数
// ============================================================================

/**
 * 发送文件到 IM 平台
 * 
 * @param {Object} params - 参数
 * @param {string} params.file_path - 本地文件路径（必须）
 * @param {string} params.platform - 平台名称: 'wechat' | 'dingtalk' | 'feishu'（默认 'wechat'）
 * @param {string} params.caption - 附加文字说明（可选）
 * @param {string} params.to_user_id - 目标用户ID（可选，默认用上次对话用户）
 * @param {string} params.context_token - 上下文令牌（可选，仅微信需要）
 * @param {Object} context - 执行上下文
 * @param {string} context.serverUrl - 服务端地址
 * @param {string} context.token - JWT 令牌
 * @param {Object} context.imContext - IM上下文（从任务中注入，含 platform/userId 等）
 * @returns {Object} 发送结果
 */
async function execute(params, context = {}) {
  const {
    file_path,
    platform: platformParam,
    caption = '',
    to_user_id,
    context_token,
  } = params;

  // 参数验证
  if (!file_path) {
    return { 成功: false, 错误: 'file_path 必填', 错误码: 'MISSING_PARAM' };
  }

  // 确定平台：优先使用参数，其次从 IM 上下文推断，最后默认 wechat
  let platform = platformParam;
  if (!platform && context.imContext?.platform) {
    platform = context.imContext.platform;
  }
  if (!platform) {
    platform = 'wechat';
  }

  // 平台校验
  const supportedPlatforms = ['wechat', 'dingtalk', 'feishu'];
  if (!supportedPlatforms.includes(platform)) {
    return { 成功: false, 错误: `不支持的平台: ${platform}，支持: ${supportedPlatforms.join('/')}`, 错误码: 'UNSUPPORTED_PLATFORM' };
  }

  // 获取服务端连接信息
  const token = context.token || process.env.DOVE_TOKEN;

  if (!token) {
    return { 成功: false, 错误: '未提供认证令牌', 错误码: 'NO_AUTH' };
  }

  try {
    const body = {
      filePath: file_path,
      platform,
      caption,
    };

    // 目标用户：优先参数，其次从 IM 上下文获取
    const targetUserId = to_user_id || context.imContext?.userId;
    if (targetUserId) body.toUserId = targetUserId;

    // 上下文令牌（微信需要）
    const targetContextToken = context_token || context.imContext?.contextToken;
    if (targetContextToken) body.contextToken = targetContextToken;

    const proxy = await getDovesProxy();
    const result = await proxy.fetch('/api/im/sendfile', { method: 'POST', body });

    logger.info(`文件已发送: platform=${platform}, file=${result?.fileName || file_path} -> ${result?.toUserId || targetUserId}`);

    return {
      成功: true,
      数据: {
        平台: platform,
        文件名: result?.fileName,
        媒体类型: result?.mediaType,
        目标用户: result?.toUserId || targetUserId,
        客户端ID: result?.clientId,
      }
    };
  } catch (err) {
    logger.error(`发送文件异常: ${err.message}`);
    return {
      成功: false,
      错误: `发送文件失败: ${err.message}`,
      错误码: 'NETWORK_ERROR',
    };
  }
}

// ============================================================================
// 技能导出
// ============================================================================

export default {
  id: 'IM文件发送',
  name: 'IM文件发送',
  version: '1.0.0',
  description: '通过IM平台（微信/钉钉/飞书）发送文件给用户。支持图片、视频、文件等所有类型，自动根据MIME类型选择发送方式。统一通过 /api/im/sendfile 入口发送。',
  abilities: ['IM', '微信', '文件发送', '图片发送', '视频发送', '钉钉', '飞书'],

  // 内置技能，不需要拥有权检查
  需要拥有权: false,
  
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: '要发送的本地文件路径（必须）'
      },
      platform: {
        type: 'string',
        enum: ['wechat', 'dingtalk', 'feishu'],
        description: 'IM平台名称（可选，默认自动从任务来源推断，无法推断时默认 wechat）'
      },
      caption: {
        type: 'string',
        description: '附加文字说明，随文件一起发送'
      },
      to_user_id: {
        type: 'string',
        description: '目标用户ID（可选，默认发到当前对话用户）'
      },
      context_token: {
        type: 'string',
        description: '上下文令牌（可选，仅微信需要，默认使用当前对话的令牌）'
      }
    },
    required: ['file_path']
  },

  execute
};
