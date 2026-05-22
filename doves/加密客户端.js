/**
 * @file 加密客户端
 * @description 为鸽子进程提供 SSH 级别的加密通讯能力
 * 
 * 继承通用 CryptoClient，添加鸽子专用便捷方法。
 * 同一台机器的所有鸽子共享一个加密 TCP 连接（使用 machineId 作为身份密钥），
 * 每个请求自动注入 apiKey 用于应用层认证，doveId 由调用方按需传入。
 * 
 * 使用方法：
 * ```javascript
 * import { DoveCryptoClient } from './加密客户端.js';
 * 
 * const client = new DoveCryptoClient({
 *   hostname: 'doves.fast-agent.cn',
 *   machineId: 'win_abc123',
 *   apiKey: 'sk_xxx'
 * });
 * 
 * await client.connect();
 * const task = await client.claimTask([], 'dove_001');
 * ```
 */

import { CryptoClient } from '@dove/common/crypto/加密客户端.js';
import { DEFAULT_PORT } from '@dove/common/crypto/index.js';

/**
 * 鸽子加密客户端
 * 继承通用 CryptoClient，自动注入 apiKey，提供鸽子专用便捷方法
 */
export class DoveCryptoClient extends CryptoClient {
  /**
   * @param {object} options
   * @param {string} options.hostname - 服务端主机名
   * @param {number} options.port - 服务端端口（默认 3003）
   * @param {string} options.machineId - 机器标识（用于加密层身份密钥）
   * @param {string} options.apiKey - API密钥（自动注入每个请求）
   */
  constructor(options) {
    const machineId = options.machineId || 'unknown_machine';
    super({
      hostname: options.hostname || 'localhost',
      port: options.port || DEFAULT_PORT.ENCRYPTED,
      clientId: machineId,
      keyName: `dove_${machineId}`
    });
    this.machineId = machineId;
    this.apiKey = options.apiKey;
  }

  /**
   * 发送请求（覆盖父类，自动注入 apiKey）
   * doveId 由调用方在 body 中按需提供
   */
  request(method, path, body = null, options = {}) {
    const enrichedBody = {
      ...(body || {}),
      apiKey: this.apiKey
    };
    return super.request(method, path, enrichedBody, options);
  }

  // ==================== 鸽子专用 API ====================

  /**
   * 抢任务
   * @param {string[]} capabilities - 能力列表
   * @param {string} [doveId] - 指定领取任务的鸽子ID（同机器不同实例）
   */
  async claimTask(capabilities = [], doveId = null) {
    const body = { capabilities };
    if (doveId) body.doveId = doveId;
    return this.request('POST', '/api/dove/claim-task', body);
  }

  /**
   * 提交任务结果
   * @param {string} taskId - 任务ID
   * @param {string} doveId - 鸽子ID
   * @param {object} result - 结果
   * @param {boolean} success - 是否成功
   */
  async submitResult(taskId, doveId, result, success = true, error = '', targetStatus = null) {
    const body = { taskId, doveId, result, success, error };
    if (targetStatus) body.targetStatus = targetStatus;
    return this.request('POST', '/api/dove/submit-result', body);
  }

  /**
   * 发送心跳
   * @param {string} doveId - 鸽子ID
   */
  async heartbeat(doveId) {
    return this.request('POST', '/api/dove/heartbeat', {
      doveId,
      currentTasks: []
    });
  }

  /**
   * 放弃任务
   * @param {string} taskId 
   * @param {string} doveId - 鸽子ID
   * @param {string} reason 
   */
  async abandonTask(taskId, doveId, reason = '') {
    return this.request('POST', '/api/dove/abandon-task', {
      taskId,
      doveId,
      reason
    });
  }

  /**
   * 获取系统配置
   */
  async getConfig() {
    return this.request('GET', '/api/dove/config');
  }
}

export default DoveCryptoClient;
