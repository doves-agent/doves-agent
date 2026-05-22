/**
 * CLI 能力调用工具
 *
 * 供 LLM 调用，请求 CLI 执行操作（上传文件、读取本地文件等）。
 * 当需要访问用户本地文件或本机资源时使用。
 * 需用户确认后执行。
 *
 * 流程：
 * 1. LLM 调用 CLI请求({ capability, params, description })
 * 2. 写入事件集合（事件类型=cli_action）
 * 3. SSE 推送 → CLI 弹确认 → 用户允许/拒绝 → 执行 → 回调
 * 4. Doves 轮询感知结果
 */

import { toLocalISOString, getTimestamp } from '@dove/common/时间工具.js';
import { 获取或生成机器标识 } from '@dove/common/机器标识.js';
import { getState, getProgressCallback } from './用户交互/状态管理.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('CLI能力调用', { 前缀: '[CLI能力调用]', 级别: 'debug', 显示调用位置: true });

// ==================== 工具定义 ====================

export const cliActionTools = [
  {
    name: 'CLI请求',
    description: '请求用户本机 CLI 执行操作（上传文件、读取本地文件、检查本地路径等）。当需要访问用户本地文件或本机资源时使用。需用户确认后执行，会阻塞等待结果。常见场景：用户消息包含本地文件路径(C:\\, /Users/, ~/)时，需要通过此工具请求 CLI 访问本地资源。',
    inputSchema: {
      type: 'object',
      properties: {
        capability: {
          type: 'string',
          description: 'CLI 能力名称: cli_file_upload(上传本地文件到OSS), cli_file_download(从OSS下载到本地), cli_file_read(读取本地文件), cli_local_path_check(检查本地路径是否存在), cli_screenshot(本机截图)',
          enum: ['cli_file_upload', 'cli_file_download', 'cli_file_read', 'cli_local_path_check', 'cli_screenshot'],
        },
        params: {
          type: 'object',
          description: '能力参数，不同能力需不同参数：cli_file_upload需{localPath,targetDir?}, cli_file_download需{ossPath,localPath}, cli_file_read需{localPath,encoding?,maxSize?}, cli_local_path_check需{localPath}, cli_screenshot需{display?}',
          properties: {
            localPath: { type: 'string', description: '本地文件绝对路径' },
            targetDir: { type: 'string', description: 'OSS目标目录(cli_file_upload可选)' },
            ossPath: { type: 'string', description: 'OSS文件路径(cli_file_download)' },
            encoding: { type: 'string', description: '文件编码(cli_file_read,默认utf-8)' },
            maxSize: { type: 'number', description: '最大读取字节(cli_file_read,默认10MB)' },
          },
        },
        description: {
          type: 'string',
          description: '向用户解释为什么需要执行此操作，便于用户做出授权决策',
        },
      },
      required: ['capability', 'params'],
    },
  },
];

// ==================== 工具处理器 ====================

/**
 * 处理 CLI 能力调用
 * @param {string} name - 工具名称
 * @param {Object} args - 工具参数
 * @param {Function} onProgress - 进度回调
 * @returns {Object} 执行结果
 */
export async function handleCliActionTool(name, args, onProgress) {
  if (name !== 'CLI请求') {
    return { content: [{ type: 'text', text: `Unknown CLI action tool: ${name}` }], isError: true };
  }

  const { capability, params, description } = args;

  if (!capability || !params) {
    return {
      content: [{ type: 'text', text: '缺少必填参数: capability 和 params' }],
      isError: true,
    };
  }

  // 获取状态引用
  const { DovesProxyRef, rootTaskIdRef, userIdRef } = getState();

  if (!DovesProxyRef || !rootTaskIdRef) {
    return {
      content: [{ type: 'text', text: 'CLI 能力调用不可用：DovesProxy 或根任务ID未设置' }],
      isError: true,
    };
  }

  logger.info(`请求: ${capability}, 参数: ${JSON.stringify(params).substring(0, 100)}`);

  // 查询 CLI 在线状态与机器标识，Doves 侧自行判断是否同机
  let coLocated = false;
  try {
    const cliInfo = await DovesProxyRef.getCliCapabilities();
    if (cliInfo) {
      // Doves 自己的 machineId 与 CLI 的 machineId 比较，判断同机
      const myMachineId = 获取或生成机器标识();
      const cliMachineIds = cliInfo.cliMachineIds || [];
      coLocated = cliMachineIds.includes(myMachineId);
      logger.info(`CLI在线: ${cliInfo.onlineClients > 0}, 同机: ${coLocated} (我=${myMachineId}, CLI=${cliMachineIds.join(',')})`);
      // CLI 不在线时提前返回错误
      if (cliInfo.onlineClients === 0) {
        return {
          content: [{ type: 'text', text: 'CLI 不在线，无法执行操作。请确保用户已启动 CLI 客户端。' }],
          isError: true,
        };
      }
    }
  } catch (e) {
    logger.warn(`查询CLI状态失败: ${e.message}`);
  }

  // 通知用户正在请求 CLI 操作
  const progressCb = onProgress || getProgressCallback();
  if (progressCb) {
    progressCb({
      type: 'user_question',
      data: {
        id: `cli-action-${Date.now()}`,
        question: `正在请求 CLI 执行: ${description || capability}`,
        type: 'confirmation',
        header: 'CLI操作',
      },
    });
  }

  // 写入事件集合
  const actionId = 'act-' + Math.random().toString(16).substr(2, 8);
  const ts = Date.now();

  const eventDoc = {
    事件ID: actionId,
    事件类型: 'cli_action',
    事件名称: description || `CLI操作: ${capability}`,
    根任务ID: rootTaskIdRef,
    操作请求: {
      capability,
      params,
      description: description || '',
      coLocated,  // 同机标记，CLI 端可据此优化交互提示
    },
    状态: '等待中',
    用户ID: userIdRef,
    答案: null,
    创建时间: toLocalISOString(),
    创建时间戳: ts,
    更新时间: toLocalISOString(),
    更新时间戳: ts,
  };

  try {
    await DovesProxyRef.dbOperation('事件', 'insertOne', { doc: eventDoc });
    logger.info(`事件已写入: ${actionId}, 根任务: ${rootTaskIdRef}`);
  } catch (e) {
    return {
      content: [{ type: 'text', text: `CLI 操作请求写入失败: ${e.message}` }],
      isError: true,
    };
  }

  // 轮询等待 CLI 返回结果
  const result = await _pollCliActionResult(DovesProxyRef, actionId, rootTaskIdRef);

  if (!result) {
    return {
      content: [{ type: 'text', text: `CLI 操作超时或被拒绝 (能力: ${capability})` }],
      isError: true,
    };
  }

  if (!result.success) {
    return {
      content: [{ type: 'text', text: `CLI 操作失败: ${result.error || '用户拒绝'}` }],
      isError: true,
    };
  }

  // 成功：返回结果数据
  const resultText = typeof result.data === 'object'
    ? JSON.stringify(result.data, null, 2)
    : String(result.data || '操作成功');

  logger.info(`完成: ${capability}, 成功: true`);

  return {
    content: [{ type: 'text', text: resultText }],
  };
}

// ==================== 轮询机制 ====================

/**
 * 轮询等待 CLI 操作结果
 * 复用事件集合轮询机制，与 user_interaction 模式一致
 *
 * @param {Object} DovesProxy - DovesProxy 实例
 * @param {string} actionId - 操作事件ID
 * @param {string} rootTaskId - 根任务ID
 * @param {number} timeoutMs - 超时毫秒数，默认 120000 (2分钟)
 * @returns {Promise<Object|null>} 操作结果
 */
async function _pollCliActionResult(DovesProxy, actionId, rootTaskId, timeoutMs = 120000) {
  const startTime = Date.now();
  const pollInterval = 2000; // 2秒轮询

  return new Promise((resolve) => {
    let settled = false;

    function doResolve(value) {
      if (settled) return;
      settled = true;
      clearInterval(pollingInterval);
      resolve(value);
    }

    const pollingInterval = setInterval(async () => {
      // 超时检查
      if (Date.now() - startTime > timeoutMs) {
        doResolve(null);
        logger.info(`轮询超时: ${actionId}`);
        return;
      }

      try {
        const resp = await DovesProxy.dbOperation('事件', 'findOne', {
          query: { 事件ID: actionId, 事件类型: 'cli_action', 状态: '已回复' },
        });

        const result = resp?.success ? resp.data : resp;
        if (result) {
          // 标记事件为已消费
          try {
            await DovesProxy.dbOperation('事件', 'findOneAndUpdate', {
              query: { 事件ID: actionId, 状态: '已回复' },
              update: { $set: { 状态: '已消费', 消费时间: toLocalISOString(), 消费时间戳: getTimestamp() } },
              options: { returnDocument: 'after' },
            });
          } catch (e) {
            logger.warn(`消费事件失败: ${e.message}`);
          }

          logger.info(`收到结果: ${actionId}, 成功: ${!!result.答案?.success}`);
          doResolve(result.答案);
        }
      } catch (err) {
        logger.error(`轮询出错: ${err.message}`);
      }
    }, pollInterval);

    // 立即执行一次检查（500ms 后）
    setTimeout(async () => {
      if (settled) return;
      try {
        const resp = await DovesProxy.dbOperation('事件', 'findOne', {
          query: { 事件ID: actionId, 事件类型: 'cli_action', 状态: '已回复' },
        });
        const result = resp?.success ? resp.data : resp;
        if (result) {
          doResolve(result.答案);
        }
      } catch (e) { logger.debug(`CLI操作状态预检查失败: ${e.message}`); }
    }, 500);
  });
}
