/**
 * CLI 能力注册 API
 *
 * CLI 连接 Server 时注册自身能力（文件上传、本地文件访问等），
 * Server 维护注册表供 Doves/LLM 查询。
 *
 * API:
 *   POST /api/cli/capabilities/register   — CLI 注册能力
 *   POST /api/cli/capabilities/unregister — CLI 断开时注销
 *   GET  /api/cli/capabilities/list       — 查询已注册的 CLI 能力
 */

import { Router } from 'express';
import { logger, CONFIG } from '../core.js';

const router = Router();

// ==================== CLI 能力注册表 ====================

/**
 * CLI 能力注册表
 * Map<capabilityName, { description, inputSchema, clientId, category, abilities, registeredAt }>
 */
const cliCapabilityRegistry = new Map();

/**
 * 已注册的 CLI 客户端信息
 * Map<clientId, { machineId, userId, registeredAt }>
 */
const clientInfoMap = new Map();

/**
 * 获取 CLI 能力注册表（供其他模块查询）
 * @returns {Map}
 */
export function getCliCapabilities() {
  return cliCapabilityRegistry;
}

/**
 * 检查是否有 CLI 在线
 * @returns {boolean}
 */
export function isCliOnline() {
  return clientInfoMap.size > 0;
}

/**
 * 获取所有在线 CLI 的机器标识列表
 * 同机判断由 Doves 侧自行完成（比较自己的 machineId 与 CLI 的 machineId）
 * Server 只负责透传信息，不做同机判断
 * @returns {string[]}
 */
export function getOnlineCliMachineIds() {
  const ids = [];
  for (const [, info] of clientInfoMap) {
    if (info.machineId) ids.push(info.machineId);
  }
  return ids;
}

/**
 * 获取 CLI 能力摘要（供 LLM prompt 注入）
 */
export function getCliCapabilitySummary() {
  if (clientInfoMap.size === 0) return null;

  const capabilities = [];
  for (const [name, entry] of cliCapabilityRegistry) {
    const shortDesc = entry.description.split('。')[0].split(',')[0];
    capabilities.push(`${name}(${shortDesc})`);
  }

  const cliMachineIds = getOnlineCliMachineIds();
  let summary = `CLI能力(在线): ${capabilities.join(', ')}`;
  if (cliMachineIds.length > 0) {
    summary += `\n- CLI机器标识: ${cliMachineIds.join(', ')}（Doves 据此自行判断是否同机）`;
  }
  summary += `\n- 当用户消息包含本地文件路径(C:\\, /Users/, ~/)时，可能需要通过 CLI 能力访问`;
  summary += `\n- 调用 cli_request_action 请求 CLI 执行操作，需用户确认`;
  return summary;
}

// ==================== 注册 API ====================

/**
 * POST /api/cli/capabilities/register
 * CLI 注册能力
 *
 * Body:
 *   clientId     (必填) CLI 客户端唯一标识
 *   capabilities (必填) 能力元数据数组
 *
 * 每个能力对象: { name, description, inputSchema, category, abilities }
 */
router.post('/register', async (req, res) => {
  const { clientId, capabilities, machineId } = req.body;
  const userId = req.user?.userId;

  if (!clientId || !capabilities) {
    return res.status(400).json({
      success: false,
      error: '缺少必填参数: clientId, capabilities',
    });
  }

  if (!Array.isArray(capabilities)) {
    return res.status(400).json({
      success: false,
      error: 'capabilities 必须是数组',
    });
  }

  // 先注销该客户端的旧能力（防止重复注册）
  for (const [name, entry] of cliCapabilityRegistry) {
    if (entry.clientId === clientId) {
      cliCapabilityRegistry.delete(name);
    }
  }

  let 注册数 = 0;
  for (const cap of capabilities) {
    if (!cap.name) continue;

    cliCapabilityRegistry.set(cap.name, {
      description: cap.description || '',
      inputSchema: cap.inputSchema || {},
      clientId,
      userId: userId || null,
      category: cap.category || '其他',
      abilities: cap.abilities || [],
      registeredAt: Date.now(),
    });
    注册数++;
  }

  clientInfoMap.set(clientId, {
    machineId: machineId || null,
    userId: userId || null,
    registeredAt: Date.now(),
  });

  // 同机判断由 Doves 侧自行完成，Server 不判断
  logger.info(`[CLI能力] 客户端 ${clientId} 注册能力: ${注册数} 个 (用户: ${userId || 'unknown'}, 机器: ${machineId || 'unknown'})`);

  res.json({
    success: true,
    data: { 注册数, 总能力数: cliCapabilityRegistry.size, 在线客户端数: clientInfoMap.size },
  });
});

/**
 * POST /api/cli/capabilities/unregister
 * CLI 断开时注销能力
 *
 * Body:
 *   clientId (必填) CLI 客户端唯一标识
 */
router.post('/unregister', async (req, res) => {
  const { clientId } = req.body;

  if (!clientId) {
    return res.status(400).json({
      success: false,
      error: '缺少必填参数: clientId',
    });
  }

  let 注销数 = 0;
  for (const [name, entry] of cliCapabilityRegistry) {
    if (entry.clientId === clientId) {
      cliCapabilityRegistry.delete(name);
      注销数++;
    }
  }

  clientInfoMap.delete(clientId);

  logger.info(`[CLI能力] 客户端 ${clientId} 注销: ${注销数} 个能力`);

  res.json({
    success: true,
    data: { 注销数, 总能力数: cliCapabilityRegistry.size, 在线客户端数: clientInfoMap.size },
  });
});

// ==================== 查询 API ====================

/**
 * GET /api/cli/capabilities/list
 * 查询已注册的 CLI 能力
 */
router.get('/list', (req, res) => {
  const capabilities = [];
  for (const [name, entry] of cliCapabilityRegistry) {
    capabilities.push({
      name,
      description: entry.description,
      inputSchema: entry.inputSchema,
      category: entry.category,
      abilities: entry.abilities,
      clientId: entry.clientId,
    });
  }

  // 收集在线 CLI 的 machineId（供 Doves 侧自行判断同机）
  const cliMachineIds = getOnlineCliMachineIds();

  res.json({
    success: true,
    data: {
      capabilities,
      total: capabilities.length,
      onlineClients: clientInfoMap.size,
      cliMachineIds,
    },
  });
});

export default router;
