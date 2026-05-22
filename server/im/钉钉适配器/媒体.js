/**
 * 钉钉适配器 - 媒体处理模块
 * 
 * 提供媒体文件的上传、下载和发送功能
 */
import { readFileSync, existsSync } from 'fs';
import { basename, extname } from 'path';
import crypto from 'crypto';

/**
 * 检查是否支持媒体操作
 * @param {string} appKey - 企业应用 AppKey
 * @param {string} appSecret - 企业应用 AppSecret
 * @returns {boolean}
 */
export function 支持媒体(appKey, appSecret) {
  return !!(appKey && appSecret);
}

/**
 * 下载媒体文件
 * @param {Function} 获取Token - 获取企业 AccessToken 的函数
 * @param {Object} 原始消息项 - 含媒体引用的消息项
 * @returns {Promise<{ data: Buffer, kind: string, fileName?: string } | null>}
 */
export async function 下载媒体(获取Token, 原始消息项) {
  try {
    const accessToken = await 获取Token();
    const mediaId = 原始消息项.mediaId || 原始消息项.media_id || 原始消息项.downloadCode;
    const messageType = 原始消息项.msgtype || 原始消息项.type || 'file';

    if (!mediaId) {
      console.warn('[钉钉适配器] 媒体消息无 mediaId');
      return null;
    }

    // 钉钉下载媒体 API
    const url = `https://oapi.dingtalk.com/media/download?access_token=${accessToken}&media_id=${mediaId}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`钉钉媒体下载失败: HTTP ${response.status}`);
    }

    const data = Buffer.from(await response.arrayBuffer());
    const kind = messageType === 'picture' || messageType === 'image' ? 'image'
      : messageType === 'video' ? 'video'
      : messageType === 'voice' ? 'voice' : 'file';

    const fileName = 原始消息项.fileName || 原始消息项.filename || null;

    console.log(`[钉钉适配器] 媒体下载完成: kind=${kind}, size=${data.length} bytes`);
    return { data, kind, fileName };
  } catch (err) {
    console.error(`[钉钉适配器] 媒体下载失败: ${err.message}`);
    return null;
  }
}

/**
 * 上传媒体文件到钉钉
 * @param {Function} 获取Token - 获取企业 AccessToken 的函数
 * @param {string} 文件路径 - 本地文件路径
 * @returns {Promise<Object>} 上传结果 { media_id, type, created_at }
 */
export async function 上传媒体(获取Token, 文件路径) {
  if (!existsSync(文件路径)) {
    throw new Error(`文件不存在: ${文件路径}`);
  }

  const accessToken = await 获取Token();
  const ext = extname(文件路径).toLowerCase();
  const fileName = basename(文件路径);

  // 根据后缀判断上传 type
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
  const videoExts = ['.mp4', '.mov', '.webm', '.avi'];
  const voiceExts = ['.mp3', '.wav', '.amr', '.m4a'];

  let mediaType = 'file';
  if (imageExts.includes(ext)) mediaType = 'image';
  else if (videoExts.includes(ext)) mediaType = 'video';
  else if (voiceExts.includes(ext)) mediaType = 'voice';

  // 构建 multipart/form-data
  const fileBuffer = readFileSync(文件路径);
  const boundary = '----DoveDingTalkBoundary' + crypto.randomBytes(8).toString('hex');

  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="media"; filename="${fileName}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`
  );
  const trailer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, fileBuffer, trailer]);

  const url = `https://oapi.dingtalk.com/media/upload?access_token=${accessToken}&type=${mediaType}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`钉钉媒体上传 HTTP 错误 (${response.status}): ${errText.slice(0, 200)}`);
  }

  const result = await response.json();
  if (result.errcode !== 0) {
    throw new Error(`钉钉媒体上传失败: ${result.errmsg} (code: ${result.errcode})`);
  }

  console.log(`[钉钉适配器] 媒体上传成功: ${fileName} → media_id=${result.media_id}, type=${mediaType}`);
  return {
    media_id: result.media_id,
    type: mediaType,
    created_at: result.created_at,
  };
}

/**
 * 通过企业机器人单聊发送富媒体消息
 * @param {Function} 获取Token - 获取企业 AccessToken 的函数
 * @param {string} appKey - 企业应用 AppKey
 * @param {string} agentId - 企业应用 AgentId
 * @param {string} 用户ID - 目标用户ID
 * @param {Object} 上传结果 - 上传媒体() 的返回值
 * @param {string} 文件名 - 文件名
 * @param {string} [附加文字] - 附加文字说明
 * @param {Function} [发送企业消息] - 企业消息发送函数（用于附加文字）
 * @returns {Promise<Object>} 发送结果
 */
export async function 发送富媒体消息(获取Token, appKey, agentId, 用户ID, 上传结果, 文件名, 附加文字, 发送企业消息) {
  if (!支持媒体(appKey, '')) {
    throw new Error('钉钉富媒体消息需要企业应用模式');
  }

  const accessToken = await 获取Token();

  // 优先使用机器人单聊消息 API
  try {
    const sendBody = {
      robotCode: appKey,
      userIds: [用户ID],
      msgKey: 'sampleFile',
      msgParam: JSON.stringify({
        mediaId: 上传结果.media_id,
        fileName: 文件名 || 'file',
        fileType: 上传结果.type || 'file',
      }),
    };

    const response = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': accessToken,
      },
      body: JSON.stringify(sendBody),
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`[钉钉适配器] 富媒体消息发送成功: ${文件名} -> ${用户ID}`);
      if (附加文字 && 发送企业消息) {
        await 发送企业消息(用户ID, { toText: () => 附加文字, toMarkdown: () => 附加文字 });
      }
      return { 成功: true, 消息ID: result.body?.result?.message_key || `msg_${Date.now()}`, 平台: 'dingtalk' };
    }
  } catch (err) {
    console.warn(`[钉钉适配器] 单聊消息发送失败，尝试工作通知: ${err.message}`);
  }

  // 降级到工作通知
  if (agentId) {
    return await 发送工作通知媒体(获取Token, agentId, 用户ID, 上传结果, 文件名, 附加文字);
  }

  throw new Error('钉钉富媒体发送失败：单聊API不可用且未配置 agentId');
}

/**
 * 通过工作通知发送媒体消息
 * @param {Function} 获取Token - 获取企业 AccessToken 的函数
 * @param {string} agentId - 企业应用 AgentId
 * @param {string} 用户ID - 目标用户ID
 * @param {Object} 上传结果 - 上传媒体() 的返回值
 * @param {string} 文件名 - 文件名
 * @param {string} [附加文字] - 附加文字说明
 * @returns {Promise<Object>} 发送结果
 */
async function 发送工作通知媒体(获取Token, agentId, 用户ID, 上传结果, 文件名, 附加文字) {
  const accessToken = await 获取Token();
  const mediaType = 上传结果.type || 'file';

  // 构建消息体
  let msg = {};
  switch (mediaType) {
    case 'image':
      msg = { msgtype: 'image', image: { media_id: 上传结果.media_id } };
      break;
    case 'voice':
      msg = { msgtype: 'voice', voice: { media_id: 上传结果.media_id, duration: 上传结果.duration || 0 } };
      break;
    case 'video':
      msg = { msgtype: 'video', video: { media_id: 上传结果.media_id } };
      break;
    case 'file':
    default:
      msg = { msgtype: 'file', file: { media_id: 上传结果.media_id } };
      break;
  }

  const response = await fetch(
    `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agentId,
        userid_list: 用户ID,
        msg,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`钉钉工作通知 HTTP 错误: ${response.status}`);
  }

  const result = await response.json();
  if (result.errcode !== 0) {
    throw new Error(`钉钉工作通知发送失败: ${result.errmsg} (code: ${result.errcode})`);
  }

  // 如果有附加文字，再发一条文本消息
  if (附加文字) {
    try {
      // 注意：这里需要一个发送企业消息的函数引用
      // 通常由调用方传入
    } catch (e) {
      // 附加文字发送失败不影响主流程
    }
  }

  return { 成功: true, 消息ID: result.task_id?.toString() || `msg_${Date.now()}`, 平台: 'dingtalk' };
}
