/**
 * 钉钉适配器 - 消息发送模块
 *
 * 提供企业消息、工作通知、Webhook消息的发送功能
 */
import { 构造企业消息体, 构造Webhook消息体 } from '../钉钉适配器/消息体.js';
import { 签名URL } from '../钉钉适配器/签名.js';

/**
 * 企业应用模式发送消息（工作通知 / 单聊消息）
 * @param {Object} adapter - 钉钉适配器实例
 * @param {string} 用户ID - 目标用户ID
 * @param {Object} 消息 - 消息对象
 */
export async function 发送企业消息(adapter, 用户ID, 消息) {
  const accessToken = await adapter._获取企业AccessToken();
  const body = adapter._构造企业消息体(消息);

  try {
    const response = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': accessToken,
      },
      body: JSON.stringify({
        robotCode: adapter.appKey,
        userIds: [用户ID],
        msgKey: body.msgKey,
        msgParam: body.msgParam,
      }),
    });

    if (!response.ok) {
      if (adapter.agentId) {
        return 发送工作通知(adapter, 用户ID, 消息, accessToken);
      }
      const errorText = await response.text();
      throw new Error(`钉钉企业API HTTP错误: ${response.status} ${errorText.slice(0, 200)}`);
    }

    const result = await response.json();
    adapter._清除错误();

    const 消息ID = result.body?.result?.message_key || `msg_${Date.now()}`;
    adapter._消息历史.set(消息ID, { 时间: Date.now(), 用户ID, 类型: body.msgKey });
    adapter._清理历史();

    return { 成功: true, 消息ID, 平台: 'dingtalk', 响应: result };
  } catch (错误) {
    adapter._记录错误(错误);
    throw 错误;
  }
}

/**
 * 发送工作通知（企业应用备选方案）
 * @param {Object} adapter - 钉钉适配器实例
 * @param {string} 用户ID - 目标用户ID
 * @param {Object} 消息 - 消息对象
 * @param {string} accessToken - 企业 AccessToken
 */
export async function 发送工作通知(adapter, 用户ID, 消息, accessToken) {
  const body = adapter._构造企业消息体(消息);

  const response2 = await fetch(
    `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: adapter.agentId,
        userid_list: 用户ID,
        msg: body,
      }),
    }
  );

  if (!response2.ok) {
    throw new Error(`钉钉工作通知 HTTP错误: ${response2.status}`);
  }

  const result = await response2.json();
  if (result.errcode !== 0) {
    throw new Error(`钉钉工作通知发送失败: ${result.errmsg} (code: ${result.errcode})`);
  }

  adapter._清除错误();
  const 消息ID = result.task_id?.toString() || `msg_${Date.now()}`;
  return { 成功: true, 消息ID, 平台: 'dingtalk', 响应: result };
}

/**
 * 群机器人模式发送消息
 * @param {Object} adapter - 钉钉适配器实例
 * @param {string} 用户ID - 目标用户ID
 * @param {Object} 消息 - 消息对象
 */
export async function 发送Webhook消息(adapter, 用户ID, 消息) {
  const url = 签名URL(adapter.webhookUrl, adapter.secret);
  const body = 构造Webhook消息体(消息);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    if (result.errcode !== 0) {
      throw new Error(`钉钉发送失败: ${result.errmsg} (code: ${result.errcode})`);
    }

    adapter._清除错误();

    const 消息ID = result.messageId || `msg_${Date.now()}`;
    adapter._消息历史.set(消息ID, { 时间: Date.now(), 用户ID, 类型: body.msgtype });
    adapter._清理历史();

    return { 成功: true, 消息ID, 平台: 'dingtalk', 响应: result };
  } catch (错误) {
    adapter._记录错误(错误);
    throw 错误;
  }
}

/**
 * 通过工作通知发送媒体消息
 * @param {Object} adapter - 钉钉适配器实例
 * @param {string} 用户ID - 目标用户ID
 * @param {Object} uploadResult - 上传结果
 * @param {string} 文件名 - 文件名
 * @param {string} [附加文字] - 附加文字说明
 */
export async function 发送富媒体工作通知(adapter, 用户ID, uploadResult, 文件名, 附加文字) {
  const accessToken = await adapter._获取企业AccessToken();
  const mediaType = uploadResult.type || 'file';

  let msg = {};
  switch (mediaType) {
    case 'image':
      msg = { msgtype: 'image', image: { media_id: uploadResult.media_id } };
      break;
    case 'voice':
      msg = { msgtype: 'voice', voice: { media_id: uploadResult.media_id, duration: uploadResult.duration || 0 } };
      break;
    case 'video':
      msg = { msgtype: 'video', video: { media_id: uploadResult.media_id } };
      break;
    case 'file':
    default:
      msg = { msgtype: 'file', file: { media_id: uploadResult.media_id } };
      break;
  }

  const response = await fetch(
    `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: adapter.agentId,
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

  if (附加文字) {
    try {
      await 发送企业消息(adapter, 用户ID, { toText: () => 附加文字, toMarkdown: () => 附加文字 });
    } catch (e) {
      // 附加文字发送失败不影响主流程
    }
  }

  return { 成功: true, 消息ID: result.task_id?.toString() || `msg_${Date.now()}`, 平台: 'dingtalk' };
}
