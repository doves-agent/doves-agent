/**
 * 飞书适配器
 * 
 * 基于飞书开放平台 API 实现
 * 支持自定义机器人 Webhook 和企业应用两种模式
 * 
 * 使用 @larksuiteoapi/node-sdk 官方 SDK，自动管理 token、类型提示
 * 飞书 API 文档: https://open.feishu.cn/document/
 * 
 * 支持能力：
 * - 文本/富文本消息发送
 * - 图片/文件/视频上传发送
 * - Webhook 回调接收消息
 * - 签名验证
 */

import { IM适配器, 适配器注册表 } from './适配器.js';
// @larksuiteoapi/node-sdk 为可选依赖，未安装时飞书适配器不可用
let lark = null;
try {
  lark = require('@larksuiteoapi/node-sdk');
} catch {
  // 飞书 SDK 未安装，适配器注册时会跳过
}
import crypto from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { basename, extname } from 'path';

/**
 * 飞书适配器类
 */
export class 飞书适配器 extends IM适配器 {
  /**
   * @param {Object} 配置 - 飞书配置
   * 
   * 自定义机器人模式：
   * @param {string} 配置.webhookUrl - 机器人 Webhook 地址
   * @param {string} 配置.secret - 签名密钥（可选）
   * 
   * 企业应用模式：
   * @param {string} 配置.appId - 应用 App ID
   * @param {string} 配置.appSecret - 应用 App Secret
   */
  constructor(配置) {
    super('feishu', 配置);
    this.webhookUrl = 配置.webhookUrl;
    this.secret = 配置.secret;
    this.appId = 配置.appId;
    this.appSecret = 配置.appSecret;
    // 飞书官方 SDK 客户端（企业应用模式自动管理 token）
    this._larkClient = null;
    this._等待回复回调 = new Map();
  }

  /**
   * 初始化适配器
   */
  async 初始化() {
    if (!this.webhookUrl && !this.appId) {
      throw new Error('飞书适配器需要配置 webhookUrl（自定义机器人）或 appId+appSecret（企业应用）');
    }

    // 验证 Webhook URL 格式
    if (this.webhookUrl) {
      try {
        new URL(this.webhookUrl);
      } catch {
        throw new Error('飞书 Webhook URL 格式无效');
      }
    }

    // 企业应用模式：创建 lark.Client 实例，SDK 自动管理 token
    if (this.appId && this.appSecret) {
      this._larkClient = new lark.Client({
        appId: this.appId,
        appSecret: this.appSecret,
        appType: lark.AppType.SelfBuild,
        domain: lark.Domain.Feishu,
      });
    }

    this.已初始化 = true;
    this._清除错误();
    console.log('[飞书适配器] 初始化成功（@larksuiteoapi/node-sdk）');
  }

  /**
   * 发送消息到飞书
   * @param {string} 用户ID - 目标用户ID
   * @param {Object} 消息 - 消息对象
   * @returns {Promise<Object>} 发送结果
   */
  async 发送消息(用户ID, 消息) {
    if (!this.已初始化) {
      throw new Error('适配器未初始化');
    }

    try {
      // 企业应用模式：通过开放 API 发送
      if (this.appId && 用户ID) {
        return await this._发送应用消息(用户ID, 消息);
      }

      // 自定义机器人模式：通过 Webhook 发送
      if (this.webhookUrl) {
        return await this._发送Webhook消息(消息);
      }

      throw new Error('无可用发送通道');
    } catch (错误) {
      this._记录错误(错误);
      throw 错误;
    }
  }

  /**
   * 等待用户回复
   * @param {string} 用户ID
   * @param {number} 超时毫秒
   * @returns {Promise<Object>}
   */
  async 等待回复(用户ID, 超时毫秒 = 300000) {
    if (!用户ID) {
      throw new Error('等待回复需要提供用户ID');
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._等待回复回调.delete(用户ID);
        resolve({
          超时: true,
          结果: '自动通过',
          用户ID,
          平台: 'feishu'
        });
      }, 超时毫秒);

      this._等待回复回调.set(用户ID, { resolve, timer, 开始时间: Date.now(), 超时毫秒 });
      console.log(`[飞书适配器] 开始等待用户 ${用户ID} 回复`);
    });
  }

  /**
   * 解析飞书回调消息
   * @param {Object} 原始消息
   * @returns {Object} 标准化回复对象
   */
  async 解析回复(原始消息) {
    const 事件 = 原始消息.event || 原始消息;
    const 发送者ID = 事件.sender?.sender_id?.user_id || '';
    const 内容 = 事件.message?.content || '';
    
    let 文本内容 = '';
    try {
      const parsed = typeof 内容 === 'string' ? JSON.parse(内容) : 内容;
      文本内容 = parsed.text || '';
    } catch {
      文本内容 = String(内容);
    }

    // 触发等待中的回调
    if (发送者ID) {
      const 回调 = this._等待回复回调.get(发送者ID);
      if (回调) {
        clearTimeout(回调.timer);
        this._等待回复回调.delete(发送者ID);
        回调.resolve({
          超时: false,
          结果: { 通过: true, 内容: 文本内容 },
          用户ID: 发送者ID,
          平台: 'feishu'
        });
      }
    }

    return {
      通过: true,
      内容: 文本内容,
      原始消息: { senderId: 发送者ID, timestamp: 原始消息.header?.create_time || Date.now() }
    };
  }

  /**
   * 测试连接
   * @returns {Promise<boolean>}
   */
  async 测试连接() {
    try {
      if (this.webhookUrl) {
        const 测试消息 = { toText: () => '白鸽系统飞书连接测试' };
        await this._发送Webhook消息(测试消息);
        return true;
      }
      if (this._larkClient) {
        // SDK 客户端已创建即表示配置有效
        return true;
      }
      return false;
    } catch (错误) {
      this._记录错误(错误);
      return false;
    }
  }

  // ==================== 媒体文件接口 ====================

  /**
   * 检查是否支持媒体操作
   * 飞书企业应用模式支持媒体上传/发送
   * @returns {boolean}
   */
  支持媒体() {
    return !!(this.appId && this.appSecret);
  }

  /**
   * 下载媒体文件
   * 从飞书下载媒体文件
   * @param {Object} 原始消息项 - 含媒体引用的消息项 { image_key, file_key, message_id, msg_type }
   * @returns {Promise<{ data: Buffer, kind: string, fileName?: string } | null>}
   */
  async 下载媒体(原始消息项) {
    try {
      if (!this._larkClient) {
        throw new Error('飞书 SDK 客户端未初始化');
      }

      const msgType = 原始消息项.msg_type || 原始消息项.msgtype || 'file';
      let kind = 'file';
      let result;

      if (msgType === 'image' && 原始消息项.image_key) {
        // 下载图片
        kind = 'image';
        result = await this._larkClient.im.image.get({
          path: { image_key: 原始消息项.image_key },
        });
      } else if ((msgType === 'file' || msgType === 'media') && 原始消息项.file_key && 原始消息项.message_id) {
        // 下载文件
        kind = 'file';
        result = await this._larkClient.im.messageResource.get({
          path: { message_id: 原始消息项.message_id, file_key: 原始消息项.file_key },
          params: { type: 'file' },
        });
      } else if (msgType === 'video' && 原始消息项.image_key && 原始消息项.message_id) {
        // 下载视频
        kind = 'video';
        result = await this._larkClient.im.messageResource.get({
          path: { message_id: 原始消息项.message_id, file_key: 原始消息项.image_key },
          params: { type: 'video' },
        });
      } else if (msgType === 'audio' && 原始消息项.file_key && 原始消息项.message_id) {
        // 下载音频
        kind = 'voice';
        result = await this._larkClient.im.messageResource.get({
          path: { message_id: 原始消息项.message_id, file_key: 原始消息项.file_key },
          params: { type: 'file' },
        });
      } else {
        console.warn('[飞书适配器] 无法下载：缺少必要的 key 或 message_id');
        return null;
      }

      if (!result || !result.data) {
        console.warn('[飞书适配器] 媒体下载返回空结果');
        return null;
      }

      // SDK 返回的 data 可能是 ArrayBuffer 或 Buffer
      const data = Buffer.isBuffer(result.data) ? result.data : Buffer.from(result.data);
      const fileName = 原始消息项.file_name || 原始消息项.fileName || null;

      console.log(`[飞书适配器] 媒体下载完成: kind=${kind}, size=${data.length} bytes`);
      return { data, kind, fileName };
    } catch (err) {
      console.error(`[飞书适配器] 媒体下载失败: ${err.message}`);
      return null;
    }
  }

  /**
   * 上传媒体文件到飞书
   * 
   * @param {string} 文件路径 - 本地文件路径
   * @param {string} 用户ID - 目标用户ID（飞书模式未使用，但保留接口一致）
   * @returns {Promise<Object>} 上传结果 { file_key / image_key, type }
   */
  async 上传媒体(文件路径, 用户ID) {
    if (!this.支持媒体()) {
      throw new Error('飞书媒体上传需要企业应用模式（appId + appSecret）');
    }

    if (!existsSync(文件路径)) {
      throw new Error(`文件不存在: ${文件路径}`);
    }

    if (!this._larkClient) {
      throw new Error('飞书 SDK 客户端未初始化');
    }

    const ext = extname(文件路径).toLowerCase();
    const fileName = basename(文件路径);

    // 根据 MIME 类型判断上传方式
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const isImage = imageExts.includes(ext);

    if (isImage) {
      // 上传图片（SDK 方法）
      const result = await this._larkClient.im.image.create({
        data: {
          image_type: 'message',
          image: createReadStream(文件路径),
        },
      });

      console.log(`[飞书适配器] 图片上传成功: ${fileName} -> image_key=${result.data?.image_key}`);
      return { image_key: result.data?.image_key, type: 'image' };
    } else {
      // 上传文件（SDK 方法）
      const result = await this._larkClient.im.file.create({
        data: {
          file_type: 'stream',
          file_name: fileName,
          file: createReadStream(文件路径),
        },
      });

      console.log(`[飞书适配器] 文件上传成功: ${fileName} -> file_key=${result.data?.file_key}`);
      return { file_key: result.data?.file_key, type: 'file' };
    }
  }

  /**
   * 发送富媒体消息到飞书
   * 
   * @param {string} 用户ID - 目标用户ID (open_id)
   * @param {Object} 上传结果 - 上传媒体() 的返回值
   * @param {string} 文件名 - 文件名
   * @param {string} [附加文字] - 附加文字说明
   * @returns {Promise<Object>} 发送结果
   */
  async 发送富媒体消息(用户ID, 上传结果, 文件名, 附加文字) {
    if (!this.支持媒体()) {
      throw new Error('飞书富媒体消息需要企业应用模式');
    }

    if (!this._larkClient) {
      throw new Error('飞书 SDK 客户端未初始化');
    }

    const mediaType = 上传结果.type || 'file';

    let msgType = 'file';
    let content = {};

    if (mediaType === 'image' && 上传结果.image_key) {
      msgType = 'image';
      content = { image_key: 上传结果.image_key };
    } else if (上传结果.file_key) {
      msgType = 'file';
      content = { file_key: 上传结果.file_key };
    }

    // 使用 SDK 发送富媒体消息
    const result = await this._larkClient.im.message.create({
      params: { receive_id_type: 'open_id' },
      data: {
        receive_id: 用户ID,
        msg_type: msgType,
        content: JSON.stringify(content),
      },
    });

    console.log(`[飞书适配器] 富媒体消息发送成功: ${文件名} -> ${用户ID}`);

    // 如果有附加文字，再发一条文本消息
    if (附加文字) {
      try {
        await this._发送应用消息(用户ID, { toText: () => 附加文字 });
      } catch (e) {
        console.warn(`[飞书适配器] 附加文字发送失败: ${e.message}`);
      }
    }

    return { 成功: true, 消息ID: result.data?.message_id, 平台: 'feishu' };
  }

  // ==================== 内部方法 ====================

  /**
   * 通过企业应用 API 发送消息（使用 SDK）
   * @private
   */
  async _发送应用消息(用户ID, 消息) {
    if (!this._larkClient) {
      throw new Error('飞书 SDK 客户端未初始化');
    }

    const text = 消息.toText ? 消息.toText() : String(消息);

    const result = await this._larkClient.im.message.create({
      params: { receive_id_type: 'open_id' },
      data: {
        receive_id: 用户ID,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });

    return { 成功: true, 消息ID: result.data?.message_id, 平台: 'feishu' };
  }

  /**
   * 通过 Webhook 发送消息
   * @private
   */
  async _发送Webhook消息(消息) {
    const url = this._签名URL();
    const body = {
      msg_type: 'text',
      content: JSON.stringify({ text: 消息.toText ? 消息.toText() : String(消息) }),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const result = await response.json();
    if (result.code !== 0) {
      throw new Error(`飞书Webhook发送失败: ${result.msg}`);
    }

    return { 成功: true, 平台: 'feishu' };
  }

  /**
   * 生成签名 URL
   * @private
   */
  _签名URL() {
    if (!this.secret) return this.webhookUrl;

    const timestamp = Math.floor(Date.now() / 1000);
    const stringToSign = `${timestamp}\n${this.secret}`;
    const sign = crypto.createHmac('sha256', this.secret)
      .update(stringToSign)
      .digest('base64');

    const sep = this.webhookUrl.includes('?') ? '&' : '?';
    return `${this.webhookUrl}${sep}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
  }

  /**
   * 验证回调签名
   * @param {string} timestamp
   * @param {string} nonce
   * @param {string} body
   * @param {string} signature
   * @returns {boolean}
   */
  验证回调签名(timestamp, nonce, body, signature) {
    if (!this.appSecret) return true;
    
    const content = timestamp + nonce + this.appSecret + body;
    const computed = crypto.createHash('sha256').update(content).digest('hex');
    return computed === signature;
  }
}

// 默认导出
export default {
  飞书适配器
};
