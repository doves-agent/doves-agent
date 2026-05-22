/**
 * CLI 能力定义与注册
 *
 * 定义 CLI 可被远端调用的能力清单，连接 Server 时注册，断开时注销。
 * 每个能力包含：名称、描述、参数 Schema、分类、能力标签。
 */

import { 获取或生成机器标识, 生成分组标识 } from './machine-id.js';

const logger = {
  info: (...args) => console.log('[CLI能力]', ...args),
  warn: (...args) => console.warn('[CLI能力] WARN:', ...args),
  error: (...args) => console.error('[CLI能力] ERROR:', ...args),
};

// ==================== CLI 能力清单 ====================

/**
 * CLI 可被远端调用的能力定义
 * 与 Server 端 cli-capability.js 的注册接口对齐
 */
export const CLI_CAPABILITIES = [
  {
    name: 'cli_file_upload',
    description: '上传本地文件到 OSS。当 Doves 需要访问用户本地文件但无法直接读取时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        localPath: { type: 'string', description: '本地文件绝对路径' },
        targetDir: { type: 'string', description: 'OSS 目标目录（可选，默认自动生成）' },
      },
      required: ['localPath'],
    },
    category: '文件操作',
    abilities: ['文件', '上传', 'OSS', '本地'],
  },
  {
    name: 'cli_file_download',
    description: '从 OSS 下载文件到本地指定路径。',
    inputSchema: {
      type: 'object',
      properties: {
        ossPath: { type: 'string', description: 'OSS 文件路径' },
        localPath: { type: 'string', description: '本地保存路径' },
      },
      required: ['ossPath', 'localPath'],
    },
    category: '文件操作',
    abilities: ['文件', '下载', 'OSS', '本地'],
  },
  {
    name: 'cli_file_read',
    description: '读取本地文件内容并返回。同机部署时 Doves 可直接使用，也支持远端 CLI 读取。',
    inputSchema: {
      type: 'object',
      properties: {
        localPath: { type: 'string', description: '本地文件绝对路径' },
        encoding: { type: 'string', description: '文件编码，默认 utf-8' },
        maxSize: { type: 'number', description: '最大读取字节数，默认 10MB' },
      },
      required: ['localPath'],
    },
    category: '文件操作',
    abilities: ['文件', '读取', '本地'],
  },
  {
    name: 'cli_local_path_check',
    description: '检查本地路径是否存在，返回路径类型（文件/目录/不存在）和大小。',
    inputSchema: {
      type: 'object',
      properties: {
        localPath: { type: 'string', description: '本地路径' },
      },
      required: ['localPath'],
    },
    category: '文件操作',
    abilities: ['文件', '路径', '检查', '本地'],
  },
  {
    name: 'cli_screenshot',
    description: '本机截图，返回截图文件的 OSS URL 或本地路径。',
    inputSchema: {
      type: 'object',
      properties: {
        display: { type: 'number', description: '显示器编号，默认 0' },
      },
    },
    category: '多媒体',
    abilities: ['截图', '屏幕', '本地'],
  },
];

// ==================== 注册/注销 ====================

let _registeredClientId = null;

/**
 * 获取 CLI 客户端唯一标识
 * @returns {string}
 */
export function getCliClientId() {
  if (_registeredClientId) return _registeredClientId;
  const machineId = 获取或生成机器标识();
  _registeredClientId = 生成分组标识(machineId, 'cli', 0);
  return _registeredClientId;
}

/**
 * 注册 CLI 能力到 Server
 * @param {object} client - DoveClient 实例（需有 baseUrl, getHeaders 方法）
 * @returns {Promise<{success: boolean}>}
 */
export async function registerCapabilities(client) {
  const clientId = getCliClientId();
  const machineId = 获取或生成机器标识();

  try {
    const data = await client.post('/api/cli/capabilities/register', {
      clientId,
      machineId,
      capabilities: CLI_CAPABILITIES,
    });
    logger.info(`注册成功: ${data.注册数} 个能力`);
    return { success: true };
  } catch (e) {
    logger.warn(`注册能力异常: ${e.message}`);
    return { success: false };
  }
}

/**
 * 注销 CLI 能力
 * @param {object} client - DoveClient 实例
 * @returns {Promise<void>}
 */
export async function unregisterCapabilities(client) {
  const clientId = getCliClientId();

  try {
    await client.post('/api/cli/capabilities/unregister', { clientId });
    logger.info('能力已注销');
  } catch (e) {
    // 注销失败不阻塞退出
  }
}
