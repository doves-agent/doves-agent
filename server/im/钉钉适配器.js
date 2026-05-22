/**
 * 钉钉适配器
 * 
 * 实现钉钉机器人消息发送和回调处理
 * 支持两种模式：
 * 1. 群机器人Webhook模式（webhookUrl + secret）
 * 2. 企业应用模式（appKey + appSecret，支持双向对话）
 * 
 * 支持ActionCard格式（带按钮）和Markdown格式
 */

import { IM适配器, 适配器注册表 } from './适配器.js';
// dingtalk-stream 为可选依赖，未安装时钉钉适配器不可用
let DWClient, TOPIC_ROBOT, EventAck;
try {
  ({ DWClient, TOPIC_ROBOT, EventAck } = require('dingtalk-stream'));
} catch {
  // 钉钉 SDK 未安装，适配器注册时会跳过
}
import { 验证回调签名, 签名URL } from './钉钉适配器/签名.js';
import { 构造企业消息体, 构造Webhook消息体, 构造ActionCard消息, 提取标题 } from './钉钉适配器/消息体.js';
import { 下载媒体 as 下载媒体Fn, 上传媒体 as 上传媒体Fn, 发送富媒体消息 as 发送富媒体消息Fn, 支持媒体 as 支持媒体Fn } from './钉钉适配器/媒体.js';
import { 发送企业消息 as 发送企业消息Fn, 发送工作通知 as 发送工作通知Fn, 发送Webhook消息 as 发送Webhook消息Fn, 发送富媒体工作通知 as 发送富媒体工作通知Fn } from './钉钉适配器/消息发送.js';

/**
 * 钉钉适配器类
 * 支持钉钉群机器人Webhook和企业应用两种模式
 */
export class 钉钉适配器 extends IM适配器 {
  /**
   * @param {Object} 配置 - 钉钉配置
   * 
   * 群机器人模式：
   * @param {string} 配置.webhookUrl - 机器人Webhook地址
   * @param {string} 配置.secret - 签名密钥（可选，用于安全验证）
   * 
   * 企业应用模式：
   * @param {string} 配置.appKey - 企业应用 AppKey
   * @param {string} 配置.appSecret - 企业应用 AppSecret
   * @param {string} 配置.agentId - 企业应用 AgentId（用于工作通知）
   * @param {string} 配置.accessToken - 已有的 AccessToken（可选，优先使用 appKey/appSecret 自动获取）
   */
  constructor(配置) {
    super('dingtalk', 配置);
    // 群机器人模式
    this.webhookUrl = 配置.webhookUrl;
    this.secret = 配置.secret;
    // 企业应用模式
    this.appKey = 配置.appKey;
    this.appSecret = 配置.appSecret;
    this.agentId = 配置.agentId;
    this.accessToken = 配置.accessToken;
    // dingtalk-stream SDK 客户端（企业模式自动管理 token）
    this._dwClient = null;
    // 判断模式
    this._企业模式 = !!(配置.appKey && 配置.appSecret);
    this._等待回复回调 = new Map(); // 用户ID -> { resolve, timer }
    this._消息历史 = new Map(); // 用于去重
  }

  /**
   * 初始化适配器
   * 验证配置完整性
   */
  async 初始化() {
    if (this._企业模式) {
      // 企业应用模式：验证 appKey/appSecret
      if (!this.appKey) throw new Error('钉钉企业应用 AppKey 未配置');
      if (!this.appSecret) throw new Error('钉钉企业应用 AppSecret 未配置');
      // 创建 dingtalk-stream SDK 客户端，自动管理 token
      this._dwClient = new DWClient({
        clientId: this.appKey,
        clientSecret: this.appSecret,
      });
      // 验证配置有效性（获取一次 token）
      await this._获取企业AccessToken();
      console.log('[钉钉适配器] 企业应用模式初始化成功（dingtalk-stream SDK）');
    } else {
      // 群机器人模式：验证 webhookUrl
      if (!this.webhookUrl) {
        throw new Error('钉钉Webhook URL未配置');
      }
      try {
        new URL(this.webhookUrl);
      } catch {
        throw new Error('钉钉Webhook URL格式无效');
      }
      console.log('[钉钉适配器] 群机器人模式初始化成功');
    }

    this.已初始化 = true;
    this._清除错误();
  }

  /**
   * 是否为企业应用模式
   */
  get 企业模式() {
    return this._企业模式;
  }

  /**
   * 发送消息到钉钉
   * 企业应用模式：通过工作通知 API 发送私聊消息
   * 群机器人模式：通过 Webhook 发送群消息
   * 
   * @param {string} 用户ID - 目标用户ID
   *   企业模式：userid（钉钉用户ID）
   *   群机器人：可传null（发到群）
   * @param {Object} 消息 - 消息对象（需支持 toText/toMarkdown 方法）
   * @returns {Promise<Object>} 发送结果
   */
  async 发送消息(用户ID, 消息) {
    if (!this.已初始化) {
      throw new Error('适配器未初始化');
    }

    if (this._企业模式 && 用户ID) {
      return this._发送企业消息(用户ID, 消息);
    }

    // 群机器人模式
    return this._发送Webhook消息(用户ID, 消息);
  }

  /**
   * 企业应用模式发送消息（工作通知 / 单聊消息）
   * @private
   */
  async _发送企业消息(用户ID, 消息) {
    return 发送企业消息Fn(this, 用户ID, 消息);
  }

  /**
   * 发送工作通知（企业应用备选方案）
   * @private
   */
  async _发送工作通知(用户ID, 消息, accessToken) {
    return 发送工作通知Fn(this, 用户ID, 消息, accessToken);
  }

  /**
   * 群机器人模式发送消息
   * @private
   */
  async _发送Webhook消息(用户ID, 消息) {
    return 发送Webhook消息Fn(this, 用户ID, 消息);
  }

  /**
   * 等待用户回复
   * 通过Webhook回调机制实现
   * @param {string} 用户ID - 目标用户ID
   * @param {number} 超时毫秒 - 等待超时时间（默认5分钟）
   * @returns {Promise<Object>} 用户回复结果
   */
  async 等待回复(用户ID, 超时毫秒 = 300000) {
    if (!用户ID) {
      throw new Error('等待回复需要提供用户ID');
    }

    // 如果该用户已有等待中的回调，先清理
    const 现有回调 = this._等待回复回调.get(用户ID);
    if (现有回调) {
      clearTimeout(现有回调.timer);
      现有回调.resolve({ 超时: true, 结果: '被覆盖', 原因: '新的等待请求' });
      this._等待回复回调.delete(用户ID);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._等待回复回调.delete(用户ID);
        resolve({ 
          超时: true, 
          结果: '自动通过',
          用户ID,
          平台: 'dingtalk'
        });
      }, 超时毫秒);

      this._等待回复回调.set(用户ID, { 
        resolve, 
        timer,
        开始时间: Date.now(),
        超时毫秒
      });

      console.log(`[钉钉适配器] 开始等待用户 ${用户ID} 回复，超时: ${超时毫秒}ms`);
    });
  }

  /**
   * 解析钉钉回调消息
   * 从钉钉Webhook回调中提取发送者信息和消息内容
   * @param {Object} 原始消息 - 钉钉原始消息格式
   * @returns {Object} 标准化回复对象
   */
  async 解析回复(原始消息) {
    // 从钉钉回调中提取发送者ID和消息内容
    const 发送者ID = 原始消息.senderStaffId || 原始消息.senderId || 原始消息.StaffId;
    const 内容 = 原始消息.text?.content?.trim() || 
                 原始消息.content?.trim() || 
                 原始消息.msg?.trim() || 
                 '';

    // 解析审批结果
    let 审批结果 = { 
      通过: false, 
      内容,
      原始消息: {
        senderId: 发送者ID,
        timestamp: 原始消息.createAt || Date.now()
      }
    };

    // 关键词匹配
    const 通过关键词 = /^(确认|同意|通过|yes|ok|approve|y)$/i;
    const 拒绝关键词 = /^(取消|拒绝|否|no|reject|n)$/i;

    if (通过关键词.test(内容)) {
      审批结果.通过 = true;
      审批结果.动作 = 'approve';
    } else if (拒绝关键词.test(内容)) {
      审批结果.通过 = false;
      审批结果.动作 = 'reject';
    } else {
      审批结果.动作 = 'unknown';
    }

    // 如果有等待中的回调，触发它
    if (发送者ID) {
      const 回调 = this._等待回复回调.get(发送者ID);
      if (回调) {
        clearTimeout(回调.timer);
        this._等待回复回调.delete(发送者ID);
        
        const 等待时长 = Date.now() - 回调.开始时间;
        回调.resolve({ 
          超时: false, 
          结果: 审批结果,
          等待时长,
          用户ID: 发送者ID,
          平台: 'dingtalk'
        });
        
        console.log(`[钉钉适配器] 用户 ${发送者ID} 回复已处理，等待时长: ${等待时长}ms`);
      }
    }

    return 审批结果;
  }

  /**
   * 测试连接
   * 验证配置是否正确
   * @returns {Promise<boolean>} 连接是否成功
   */
  async 测试连接() {
    try {
      if (this._企业模式) {
        // 企业模式：验证 access_token 可用
        const token = await this._获取企业AccessToken();
        if (!token) return false;
        console.log('[钉钉适配器] 企业应用连接测试成功（access_token 有效）');
        return true;
      }

      // 群机器人模式：发送测试消息
      const 测试消息 = {
        toText: () => '白鸽系统IM连接测试',
        toMarkdown: () => '**白鸽系统IM连接测试**\n\n✅ 连接正常'
      };

      const 结果 = await this.发送消息(null, 测试消息);
      console.log('[钉钉适配器] 群机器人连接测试成功');
      return 结果.成功;

    } catch (错误) {
      this._记录错误(错误);
      console.error('[钉钉适配器] 连接测试失败:', 错误.message);
      return false;
    }
  }

  /**
   * 处理钉钉回调签名验证
   * 用于验证Webhook回调是否来自钉钉
   * @param {string} timestamp - 时间戳
   * @param {string} sign - 签名
   * @returns {boolean} 签名是否有效
   */
  验证回调签名(timestamp, sign) {
    return 验证回调签名(timestamp, sign, this.secret);
  }

  /**
   * 生成签名URL
   * 钉钉机器人Webhook需要签名验证
   * @private
   * @returns {string} 带签名的URL
   */
  _签名URL() {
    return 签名URL(this.webhookUrl, this.secret);
  }

  // ==================== 企业应用模式 Token 管理 ====================

  /**
   * 获取企业应用 access_token
   * 委托给 dingtalk-stream SDK 自动管理，无需手动刷新
   * @private
   */
  async _获取企业AccessToken() {
    if (!this._dwClient) {
      throw new Error('钉钉 SDK 客户端未初始化');
    }
    return this._dwClient.getAccessToken();
  }

  /**
   * 构造企业应用消息体
   * 用于机器人单聊和工作通知 API
   * @private
   */
  _构造企业消息体(消息) {
    return 构造企业消息体(消息);
  }

  // ==================== 群机器人消息构造 ====================

  /**
   * 构造钉钉群机器人消息体
   * 根据消息类型选择合适的格式
   * @private
   * @param {Object} 消息 - 消息对象
   * @returns {Object} 钉钉消息格式
   */
  _构造消息体(消息) {
    return 构造Webhook消息体(消息);
  }

  /**
   * 构造ActionCard消息（带按钮）
   * 适用于审批请求等需要用户交互的场景
   * @private
   * @param {string} markdown - Markdown内容
   * @param {Object} 消息 - 原始消息对象
   * @returns {Object} ActionCard消息格式
   */
  _构造ActionCard消息(markdown, 消息) {
    return 构造ActionCard消息(markdown, 消息);
  }

  /**
   * 从Markdown提取标题
   * @private
   * @param {string} markdown - Markdown文本
   * @returns {string|null} 标题
   */
  _提取标题(markdown) {
    return 提取标题(markdown);
  }

  /**
   * 清理过期消息历史
   * @private
   */
  _清理历史() {
    const 过期时间 = Date.now() - 3600000; // 1小时前
    for (const [消息ID, 记录] of this._消息历史) {
      if (记录.时间 < 过期时间) {
        this._消息历史.delete(消息ID);
      }
    }
  }

  /**
   * 获取等待中的回复请求数
   * @returns {number} 等待数
   */
  获取等待数() {
    return this._等待回复回调.size;
  }

  /**
   * 取消指定用户的等待
   * @param {string} 用户ID - 用户ID
   * @param {string} 原因 - 取消原因
   * @returns {boolean} 是否成功取消
   */
  取消等待(用户ID, 原因 = '手动取消') {
    const 回调 = this._等待回复回调.get(用户ID);
    if (回调) {
      clearTimeout(回调.timer);
      this._等待回复回调.delete(用户ID);
      回调.resolve({ 
        超时: false, 
        结果: '已取消',
        原因,
        用户ID,
        平台: 'dingtalk'
      });
      return true;
    }
    return false;
  }

  /**
   * 下载媒体文件
   * 从钉钉下载媒体文件
   * @param {Object} 原始消息项 - 含媒体引用的消息项
   * @returns {Promise<{ data: Buffer, kind: string, fileName?: string } | null>}
   */
  async 下载媒体(原始消息项) {
    return 下载媒体Fn(() => this._获取企业AccessToken(), 原始消息项);
  }

  /**
   * 检查是否支持媒体操作
   * 钉钉企业应用模式支持媒体上传/发送
   * @returns {boolean}
   */
  支持媒体() {
    return 支持媒体Fn(this.appKey, this.appSecret);
  }

  /**
   * 上传媒体文件到钉钉
   * 通过企业应用媒体上传接口
   * 
   * @param {string} 文件路径 - 本地文件路径
   * @param {string} 用户ID - 目标用户ID（钉钉模式未使用，但保留接口一致）
   * @returns {Promise<Object>} 上传结果 { media_id, type, created_at }
   */
  async 上传媒体(文件路径, 用户ID) {
    if (!this.支持媒体()) {
      throw new Error('钉钉媒体上传需要企业应用模式（appKey + appSecret）');
    }
    return 上传媒体Fn(() => this._获取企业AccessToken(), 文件路径);
  }

  /**
   * 发送富媒体消息到钉钉
   * 
   * @param {string} 用户ID - 目标用户ID
   * @param {Object} 上传结果 - 上传媒体() 的返回值（含 media_id）
   * @param {string} 文件名 - 文件名
   * @param {string} [附加文字] - 附加文字说明
   * @returns {Promise<Object>} 发送结果
   */
  async 发送富媒体消息(用户ID, 上传结果, 文件名, 附加文字) {
    if (!this.支持媒体()) {
      throw new Error('钉钉富媒体消息需要企业应用模式');
    }
    return 发送富媒体消息Fn(
      () => this._获取企业AccessToken(),
      this.appKey,
      this.agentId,
      用户ID,
      上传结果,
      文件名,
      附加文字,
      (uid, msg) => this._发送企业消息(uid, msg)
    );
  }

  /**
   * 通过工作通知发送媒体消息
   * @private
   */
  async _发送工作通知媒体(用户ID, msg, accessToken, 附加文字) {
    return 发送富媒体工作通知Fn(this, 用户ID, { media_id: msg.file?.media_id, type: msg.msgtype }, null, 附加文字);
  }
}

// 默认导出
export default {
  钉钉适配器
};
