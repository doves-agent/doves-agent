/**
 * 聊天消息发送 - 多网关通信（扇出/容灾）
 * 
 * 含扇出发送、容灾切换、isNetworkError 判断
 */

import { DoveClient } from '../../client.js';
import { display } from '../../display.js';
import { randomUUID } from 'crypto';
import { loadChatConfig } from './辅助函数.js';

/**
 * 判断是否为网络错误（触发容灾切换）
 * 服务端返回了响应（即使状态码非2xx）属于业务错误，不触发切换
 * 只有连接层面的失败（DNS/拒绝/超时等）才触发切换
 */
export function isNetworkError(err) {
  const msg = err.message || '';
  // 服务端返回了响应（4xx/5xx），属于业务错误，不切换
  if (msg.startsWith('发送消息失败')) return false;

  // 连接层面的错误：fetch 未获得响应就抛出
  if (err.name === 'TypeError' || err.name === 'AbortError') return true;

  // 错误消息包含典型网络错误码
  const netCodes = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'];
  if (netCodes.some(code => msg.includes(code))) return true;

  // 其他错误不触发容灾（保守策略，避免对业务错误做无意义重试）
  return false;
}

/**
 * 通过多网关发送消息（扇出/容灾/单网关）
 * 
 * @param {DoveClient} client - 主客户端
 * @param {string} message - 消息内容
 * @param {string} conversationId - 对话ID
 * @param {string} profile - 执行配置 profile
 * @param {Object} constraints - 执行约束
 * @param {Object} options - 选项（含 gateway 参数）
 * @param {string[]|null} gateways - 外部传入的网关列表
 * @returns {{ result: Object, conversationId: string }} 发送结果
 */
export async function 多网关发送(client, message, conversationId, profile, constraints, options, gateways) {
  let 扇出Gateways = gateways;
  let isExplicitFanout = false;

  // 命令行 --gateway → 扇出模式
  if (!扇出Gateways && options.gateway) {
    const raw = Array.isArray(options.gateway) ? options.gateway : [options.gateway];
    扇出Gateways = raw.flatMap(u => u.split(',').map(s => s.trim()).filter(Boolean));
    isExplicitFanout = true;
  }

  // 配置文件 gateways → 容灾备份（仅在非扇出模式下使用）
  let 备份Gateways = [];
  if (!扇出Gateways) {
    const cfg = loadChatConfig();
    if (cfg.gateways && cfg.gateways.length > 0) {
      备份Gateways = cfg.gateways.filter(u => u !== client.baseUrl);
    }
  }

  let result;

  if (扇出Gateways && 扇出Gateways.length > 0) {
    // ==================== 扇出模式（调试：并行发送到所有网关） ====================
    const requestId = randomUUID();
    const 扇出ConvId = !conversationId ? randomUUID() : conversationId;

    const allGateways = [client.baseUrl, ...扇出Gateways.filter(u => u !== client.baseUrl)];
    display.info(`扇出发送到 ${allGateways.length} 个 Server: ${allGateways.join(', ')}`);

    const 扇出Promises = allGateways.map(async (gw) => {
      const 扇出Client = new DoveClient();
      扇出Client.baseUrl = gw;
      扇出Client.token = client.token;
      扇出Client.config = { ...client.config };
      await 扇出Client.connectEncrypted();
      try {
        const r = await 扇出Client.sendMessage(
          message, 扇出ConvId, profile, constraints, requestId
        );
        return { gateway: gw, result: r, error: null };
      } catch (e) {
        return { gateway: gw, result: null, error: e.message };
      }
    });

    const 扇出Results = await Promise.allSettled(扇出Promises);

    // 找到第一个成功的结果（主 gateway 优先）
    let 扇出结果 = null;
    for (const r of 扇出Results) {
      if (r.status === 'fulfilled' && r.value.result) {
        扇出结果 = r.value;
        break;
      }
    }

    if (!扇出结果) {
      throw new Error('所有 Server 均无响应');
    }

    // 显示扇出结果摘要
    for (const r of 扇出Results) {
      if (r.status === 'fulfilled' && r.value) {
        const { gateway, result: rResult, error } = r.value;
        if (error) {
          display.warn(`${gateway}: 失败 - ${error}`);
        } else if (rResult.idempotent) {
          display.info(`${gateway}: 幂等返回 (已有任务)`);
        }
      }
    }

    result = 扇出结果.result;
    return { result, conversationId: 扇出ConvId };

  } else if (备份Gateways.length > 0) {
    // ==================== 容灾模式（正式：主网关失败后串行尝试备份） ====================
    try {
      result = await client.sendMessage(message, conversationId, profile, constraints);
    } catch (err) {
      // 仅网络错误触发容灾切换，业务错误直接抛出
      if (isNetworkError(err)) {
        const originalBaseUrl = client.baseUrl;
        let failoverSuccess = false;
        for (const backupGw of 备份Gateways) {
          display.warn(`主网关 ${originalBaseUrl} 不可达，尝试备份网关 ${backupGw}...`);
          try {
            client.baseUrl = backupGw;
            result = await client.sendMessage(message, conversationId, profile, constraints);
            display.success(`已切换到备份网关: ${backupGw}`);
            failoverSuccess = true;
            break;
          } catch (backupErr) {
            display.warn(`备份网关 ${backupGw} 也不可达`);
          }
        }
        if (!failoverSuccess) {
          client.baseUrl = originalBaseUrl;
          throw new Error(`所有网关均不可达 (已尝试 ${[originalBaseUrl, ...备份Gateways].join(', ')})`);
        }
      } else {
        throw err;
      }
    }

    return { result, conversationId };

  } else {
    // ==================== 单 Gateway 模式（无备份） ====================
    result = await client.sendMessage(message, conversationId, profile, constraints);
    return { result, conversationId };
  }
}
