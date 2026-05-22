/**
 * 微信 iLink Bot API 通道客户端
 * 
 * 安全模型（v2 加固版）：
 * - 绑定/解绑/启用/禁用 → 走服务端 API（MongoDB 存储，加密，审计）
 * - 实时操作（轮询/发消息/打字状态）→ 用服务端签发的临时会话令牌
 * - 本地不存储 botToken 明文，只缓存会话令牌（2小时过期）
 * - 会话令牌过期后自动向服务端续期
 * 
 * 核心协议：
 * - 扫码绑定：bind/initiate → bind/poll → bind/complete（全部走服务端）
 * - 收消息：getupdates 长轮询（35s），用会话令牌直接请求 iLink
 * - 发消息：sendmessage，必须带 context_token 关联对话
 * - 打字状态：sendtyping
 */

import { loadConfig, saveWechatBinding } from './config.js';
import { getSharedCryptoClient } from './base-client.js';
import qrcode from 'qrcode-terminal';
import chalk from 'chalk';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const ILINK_BASE = 'https://ilinkai.weixin.qq.com';

/**
 * 清理并解码 base64 图片数据
 * 
 * iLink API 可能返回以下格式：
 * 1. 纯 base64："iVBORw0KGgo..."
 * 2. Data URI："data:image/png;base64,iVBORw0KGgo..."
 * 
 * @param {string} raw - 原始数据
 * @returns {Buffer|null} PNG 图片 Buffer，无效则返回 null
 */
function decodeBase64Image(raw) {
  if (!raw || typeof raw !== 'string') return null;
  
  // URL 不是 base64，跳过
  if (raw.startsWith('http://') || raw.startsWith('https://')) return null;
  
  // 去掉 Data URI 前缀：data:image/png;base64,
  let base64Data = raw;
  const dataUriMatch = raw.match(/^data:image\/[^;]+;base64,(.+)$/s);
  if (dataUriMatch) {
    base64Data = dataUriMatch[1];
  }
  
  // 清理空白字符
  base64Data = base64Data.replace(/\s/g, '');
  
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    
    // 验证是否为有效 PNG（魔术字节: 89 50 4E 47 0D 0A 1A 0A）
    if (buffer.length > 8 &&
        buffer[0] === 0x89 && buffer[1] === 0x50 &&
        buffer[2] === 0x4E && buffer[3] === 0x47) {
      return buffer;
    }
    
    // 验证是否为有效 JPEG（魔术字节: FF D8 FF）
    if (buffer.length > 3 &&
        buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return buffer;
    }
    
    return null;
  } catch (e) {
    console.warn('[WeChat] base64图片解码失败:', e.message);
    return null;
  }
}

/**
 * 从服务端返回的二维码数据中提取微信可识别的绑定链接
 * 
 * iLink API 返回的数据结构（实测）：
 * - qrcode: "ee76xxxx" — token，用于轮询 get_qrcode_status
 * - qrcode_img_content: "https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=ee76xxxx" — 微信绑定链接！
 * - qrcode_url: 可能为图片 URL 或 nil
 * 
 * 微信扫码绑定流程：
 * 1. 把 liteapp URL 编码成二维码 → 用户用微信扫描
 * 2. 微信识别 liteapp URL → 自动在微信内打开绑定确认页
 * 3. 用户在微信内确认 → 服务端状态变为 confirmed
 * 
 * @param {Object} qrData - 服务端返回的二维码数据
 * @returns {string|null} 可编码为二维码的微信链接
 */
function extractWechatBindUrl(qrData) {
  // 优先级1：qrcodeImgContent（实测是 liteapp URL）
  if (qrData.qrcodeImgContent &&
      (qrData.qrcodeImgContent.startsWith('http://') ||
       qrData.qrcodeImgContent.startsWith('https://'))) {
    return qrData.qrcodeImgContent;
  }
  
  // 优先级2：qrcodeUrl
  if (qrData.qrcodeUrl &&
      (qrData.qrcodeUrl.startsWith('http://') ||
       qrData.qrcodeUrl.startsWith('https://'))) {
    return qrData.qrcodeUrl;
  }
  
  // 优先级3：都没 URL，用 qrcode token 构造 liteapp 链接（不一定有效，但值得试）
  if (qrData.qrcode) {
    return `https://liteapp.weixin.qq.com/q/?qrcode=${qrData.qrcode}`;
  }
  
  return null;
}

/**
 * 微信 iLink 通道类
 */
export class WeChatChannel extends EventEmitter {
  /**
   * @param {string} userId - 白鸽用户 ID，绑定按用户隔离
   * @param {string} gatewayUrl - 白鸽服务端地址
   */
  constructor(userId = null, gatewayUrl = null) {
    super();
    this.userId = userId;
    this.gatewayUrl = gatewayUrl || loadConfig().gateway || 'http://localhost:3003';
    
    // 会话令牌（2小时有效，用于实时操作）
    this._sessionToken = '';
    this._sessionExpires = 0;
    
    // 从服务端获取的绑定状态缓存
    this.botBaseUrl = '';
    this.botUserId = '';
    this.enabled = false;
    this.bound = false;
    
    this._listening = false;
    this._abortController = null;
    this._updatesBuf = '';
    this._lastContextToken = '';
    this._lastFromUserId = '';
    
    // 实时操作用的 botToken（从会话令牌获取，仅内存中）
    this._botToken = '';
  }

  // ==================== 服务端 API 调用 ====================

  /**
   * 获取认证头（白鸽 JWT）
   */
  _getAuthHeaders() {
    const config = loadConfig();
    const token = config.token;
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  }

  /**
   * 调用服务端微信 API
   */
  async _serverApi(method, path, body = null) {
    const cryptoClient = getSharedCryptoClient();
    if (!cryptoClient?.connected) {
      throw new Error(`加密通道未连接，无法调用微信服务端 API`);
    }

    const config = loadConfig();
    const requestBody = body ? { ...body } : {};
    requestBody.apiKey = config.token;

    const result = await cryptoClient.request(method, `/api/wechat${path}`, requestBody);
    if (!result.success) {
      throw new Error(result.error || '服务端请求失败');
    }
    return result.data;
  }

  // ==================== 会话令牌管理 ====================

  /**
   * 获取会话令牌（自动续期）
   * 会话令牌包含解密后的 botToken，用于实时 iLink 操作
   */
  async _ensureSession() {
    // 会话令牌未过期，直接用
    if (this._sessionToken && this._sessionExpires > Date.now() + 60000) {
      return;
    }

    // 向服务端申请新会话令牌
    try {
      const data = await this._serverApi('POST', '/session');
      this._sessionToken = data.sessionToken;
      this._sessionExpires = new Date(data.expiresAt).getTime();
      this.botBaseUrl = data.botBaseUrl || '';
      this.botUserId = data.botUserId || '';

      // 通过会话令牌验证接口获取 botToken（仅存内存）
      const cryptoClient = getSharedCryptoClient();
      if (!cryptoClient?.connected) {
        throw new Error('加密通道未连接');
      }
      const config = loadConfig();
      const verifyResult = await cryptoClient.request('POST', '/api/wechat/session/verify', {
        apiKey: config.token,
        sessionToken: this._sessionToken
      });
      if (verifyResult.success) {
        this._botToken = verifyResult.data.botToken;
        this.botBaseUrl = verifyResult.data.botBaseUrl || this.botBaseUrl;
        this.botUserId = verifyResult.data.botUserId || this.botUserId;
      }
    } catch (err) {
      throw new Error(`获取微信会话令牌失败: ${err.message}`);
    }
  }

  // ==================== HTTP 请求封装（实时操作） ====================

  /**
   * 生成随机 X-WECHAT-UIN
   */
  _generateUin() {
    const randomVal = Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;
    return Buffer.from(String(randomVal)).toString('base64');
  }

  /**
   * 构建 iLink 请求头（使用会话令牌中的 botToken）
   */
  _getIlinkHeaders() {
    return {
      'Content-Type': 'application/json',
      'AuthorizationType': 'ilink_bot_token',
      'X-WECHAT-UIN': this._generateUin(),
      'Authorization': `Bearer ${this._botToken}`,
    };
  }

  /**
   * iLink POST 请求（实时操作）
   */
  async _ilinkPost(path, body) {
    await this._ensureSession();
    const url = `${this.botBaseUrl || ILINK_BASE}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this._getIlinkHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`iLink API 错误 (${response.status}): ${text}`);
    }
    return response.json();
  }

  // ==================== 绑定流程（走服务端） ====================

  /**
   * 扫码绑定微信
   * 全部走服务端 API，客户端不接触 botToken
   */
  async bind() {
    console.log('');
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold.yellow('  微信 iLink 通道绑定'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log('');

    // 1. 向服务端请求绑定二维码
    console.log(chalk.blue('ℹ') + ' 正在获取微信绑定二维码（通过服务端）...');
    let qrData;
    try {
      qrData = await this._serverApi('POST', '/bind/initiate');
    } catch (err) {
      throw new Error(`获取二维码失败: ${err.message}`);
    }

    if (!qrData.qrcode && !qrData.qrcodeUrl && !qrData.qrcodeImgContent) {
      throw new Error('服务器未返回二维码数据');
    }

    // 2. 展示二维码
    //
    // iLink API 实测返回的数据结构：
    //   qrcode = "ee76xxxx" (token，用于轮询 get_qrcode_status)
    //   qrcode_img_content = "https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=ee76xxxx" (微信绑定链接！)
    //
    // 正确流程：把 liteapp URL 编码成二维码 → 微信扫码 → 微信识别 URL → 打开绑定确认页
    //
    // 之前犯错的原因：
    //   - 第一次把 qrcode token (hash) 编码成二维码 → 扫出来是一串 hash，微信不认 ✗
    //   - 第二次以为 qrcode_img_content 是 base64 图片 → 实际是 URL，解码出坏 PNG ✗
    //   - 现在正确理解：qrcode_img_content 就是个 liteapp URL，用 qrcode-terminal 编码即可 ✓

    console.log('');
    console.log(chalk.yellow('⚠') + ' 请用微信扫描下方二维码绑定：');
    console.log('');

    // 提取微信绑定链接
    const bindUrl = extractWechatBindUrl(qrData);
    
    // 也尝试解码 base64 图片（兼容未来 API 可能真的返回 base64）
    const decodedImage = qrData.qrcodeImgContent ? decodeBase64Image(qrData.qrcodeImgContent) : null;
    
    let imageShown = false;

    // 方式1：如果有 base64 图片，直接展示（终端内联 / 保存文件打开）
    if (decodedImage) {
      try {
        const terminalImage = (await import('terminal-image')).default;
        const imgText = await terminalImage(decodedImage, { width: '50%' });
        console.log(imgText);
        imageShown = true;
      } catch (e) {
        // 终端不支持内联图片，保存文件打开
        try {
          const tmpDir = path.join(os.homedir(), '.dove', 'tmp');
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
          const tmpFile = path.join(tmpDir, `wechat-bind-${Date.now()}.png`);
          fs.writeFileSync(tmpFile, decodedImage);
          console.log(chalk.gray('  已保存二维码图片：'));
          console.log(chalk.cyan(`  ${tmpFile}`));
          console.log('');
          try {
            execSync(`start "" "${tmpFile}"`, { stdio: 'ignore' });
            console.log(chalk.blue('ℹ') + ' 已自动打开二维码图片');
          } catch (e2) {
            console.log(chalk.yellow('⚠') + ' 请手动打开上方图片文件');
          }
          imageShown = true;
        } catch (e2) {
          console.warn('[WeChat] 保存二维码图片失败:', e2.message);
        }
      }
    }

    // 方式2：用 qrcode-terminal 把微信链接编码成终端二维码（主要方式）
    if (!imageShown && bindUrl) {
      await new Promise((resolve) => {
        qrcode.generate(bindUrl, { small: true }, (qrText) => {
          console.log(qrText);
          resolve();
        });
      });
      console.log('');
      imageShown = true;
    }

    // 方式3：浏览器打开 URL（兜底）
    if (!imageShown && qrData.qrcodeUrl) {
      console.log(chalk.gray('  请在浏览器打开以下链接：'));
      console.log(chalk.cyan(`  ${qrData.qrcodeUrl}`));
      console.log('');
      try {
        execSync(`start "" "${qrData.qrcodeUrl}"`, { stdio: 'ignore' });
        console.log(chalk.blue('ℹ') + ' 已在浏览器打开绑定页面');
        imageShown = true;
      } catch (e) {
        console.warn('[WeChat] 打开浏览器失败:', e.message);
      }
    }

    if (!imageShown) {
      console.log(chalk.red('✗') + ' 无法生成有效的微信绑定二维码');
      console.log(chalk.gray('  服务端返回数据: ' + JSON.stringify(qrData).substring(0, 200)));
      throw new Error('无法获取有效的微信绑定二维码');
    }

    console.log('');
    console.log(chalk.blue('ℹ') + ' 等待微信扫码确认...');
    console.log(chalk.gray('  (绑定过程中请勿关闭终端)'));
    console.log('');

    // 3. 轮询扫码状态（走服务端）
    const qrcodeId = qrData.qrcode;
    let confirmed = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 120;

    while (!confirmed && attempts < MAX_ATTEMPTS) {
      try {
        const pollResult = await this._serverApi('POST', '/bind/poll', { qrcodeId });

        if (pollResult.status === '已确认') {
          confirmed = true;
          break;
        } else if (pollResult.status === '已过期') {
          throw new Error('二维码已过期，请重新执行 dove wechat bind');
        } else if (pollResult.status === '已扫码' || pollResult.status === 'scanned') {
          // 官方协议是 'scaned'（无n），服务器已统一映射为 '已扫码'
          if (attempts % 5 === 0) {
            console.log(chalk.yellow('⚠') + ' 已扫码，请在手机上确认绑定...');
          }
        }
        // status === 'wait' | 'waiting' 继续等待
      } catch (err) {
        if (err.message.includes('已过期')) throw err;
      }

      await new Promise(r => setTimeout(r, 1500));
      attempts++;
    }

    if (!confirmed) {
      throw new Error('绑定超时，请重新执行 dove wechat bind');
    }

    // 4. 向服务端确认绑定完成（服务端存储加密的 botToken）
    console.log(chalk.blue('ℹ') + ' 确认绑定...');
    try {
      const completeResult = await this._serverApi('POST', '/bind/complete', { qrcodeId });
      
      this.bound = true;
      this.enabled = true;
      this.botUserId = completeResult.botUserId || '';
      this.botBaseUrl = completeResult.botBaseUrl || '';
      
      // 更新本地配置（只存 enabled 标记，不存 botToken）
      if (this.userId) {
        saveWechatBinding(this.userId, {
          enabled: true,
          botToken: '',  // 不存明文
          botBaseUrl: this.botBaseUrl,
          botUserId: this.botUserId,
        });
      }
    } catch (err) {
      throw new Error(`绑定确认失败: ${err.message}`);
    }

    console.log('');
    console.log(chalk.green('✓') + ' 微信绑定成功！');
    console.log(chalk.gray(`  Bot 用户: ${this.botUserId}`));
    console.log(chalk.gray(`  Base URL: ${this.botBaseUrl || '(默认)'}`));
    console.log('');
    console.log(chalk.blue('ℹ') + ' 微信通道已自动启用');
    console.log(chalk.blue('ℹ') + ' botToken 已加密存储在服务端，本地不保存');
    console.log('');
  }

  /**
   * 解除绑定（走服务端）
   */
  async unbind() {
    await this._serverApi('DELETE', '/bind');

    this.bound = false;
    this.enabled = false;
    this._botToken = '';
    this._sessionToken = '';
    this.botBaseUrl = '';
    this.botUserId = '';

    this.stopListening();
  }

  // ==================== 状态查询（走服务端） ====================

  /**
   * 从服务端同步绑定状态
   */
  async syncStatus() {
    try {
      const data = await this._serverApi('GET', '/status');
      this.bound = data.bound || false;
      this.enabled = data.enabled || false;
      this.botUserId = data.botUserId || '';
      this.botBaseUrl = data.botBaseUrl || '';
    } catch (err) {
      console.warn('[WeChat] 服务端不可达，无法同步微信状态:', err.message);
    }
  }

  /**
   * 获取绑定状态
   */
  getStatus() {
    return {
      enabled: this.enabled,
      bound: this.bound,
      botToken: this._botToken ? '***（会话中）' : '',
      botBaseUrl: this.botBaseUrl || '',
      botUserId: this.botUserId || '',
      listening: this._listening,
      userId: this.userId || '(未登录)',
      sessionActive: !!(this._sessionToken && this._sessionExpires > Date.now()),
    };
  }

  /**
   * 检查是否已绑定且启用
   */
  isReady() {
    return this.enabled && this.bound;
  }

  // ==================== 消息收取（已由服务端常驻进程接管） ====================

  isListening() { return false; }

  // ==================== 消息发送（已由服务端常驻进程接管） ====================

  /**
   * 发送文本消息 — 已弃用，服务端自动推送任务结果
   */
  async sendMessage(toUserId, text, contextToken) {
    console.log(chalk.blue('ℹ') + ' 微信消息由服务端自动推送，无需手动发送');
  }

  /**
   * 发送“正在输入”状态 — 已弃用
   */
  async sendTyping(toUserId) {}

  // ==================== 便捷方法（已弃用） ====================

  async pushMessage(text) {}

  async pushQuestion(questionData) {}

  /**
   * 清除会话令牌（登出时调用）
   */
  clearSession() {
    this._sessionToken = '';
    this._sessionExpires = 0;
    this._botToken = '';
  }
}

export default WeChatChannel;
