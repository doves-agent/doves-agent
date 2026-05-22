/**
 * CLI 操作请求处理与用户确认
 *
 * 监听 SSE 中的 cli_action 事件，显示操作请求详情，
 * 用户确认/拒绝后执行对应操作，回调 Server 返回结果。
 */

import fs from 'fs';
import path from 'path';
import { select, input } from './interactive.js';
import { streamUploadFile, getDownloadUrl } from './stream-upload.js';
import { getCliClientId } from './cli-capability.js';

// OSS 路径前缀（从环境变量读取，默认 'dove'）
const OSS_PREFIX = process.env.OSS_PREFIX || 'dove';

const logger = {
  info: (...args) => console.log('[CLI操作]', ...args),
  warn: (...args) => console.warn('[CLI操作] WARN:', ...args),
  error: (...args) => console.error('[CLI操作] ERROR:', ...args),
};

// ==================== 操作执行器 ====================

/**
 * 上传本地文件到 OSS
 */
async function handleFileUpload(client, params) {
  const { localPath, targetDir } = params;

  if (!localPath) {
    return { success: false, error: '缺少 localPath 参数' };
  }

  // 检查文件是否存在
  if (!fs.existsSync(localPath)) {
    return { success: false, error: `文件不存在: ${localPath}` };
  }

  const stat = fs.statSync(localPath);
  if (stat.isDirectory()) {
    return { success: false, error: `路径是目录而非文件: ${localPath}` };
  }

  const sizeStr = stat.size > 1024 * 1024
    ? `${(stat.size / 1024 / 1024).toFixed(1)}MB`
    : `${(stat.size / 1024).toFixed(1)}KB`;

  logger.info(`上传文件: ${localPath} (${sizeStr})`);

  try {
    const result = await streamUploadFile({
      client,
      localPath,
      targetDir: targetDir || `${OSS_PREFIX}/users/${client.userId || 'anonymous'}/cli-uploads`,
      onProgress: (percent) => {
        if (percent % 25 === 0) {
          logger.info(`上传进度: ${percent}%`);
        }
      },
    });

    logger.info(`上传完成: ${result.url}`);
    return {
      success: true,
      data: {
        url: result.url,
        ossPath: result.path,
        size: result.size,
        localPath,
      },
    };
  } catch (e) {
    logger.error(`上传失败: ${e.message}`);
    return { success: false, error: `上传失败: ${e.message}` };
  }
}

/**
 * 从 OSS 下载文件到本地
 */
async function handleFileDownload(client, params) {
  const { ossPath, localPath } = params;

  if (!ossPath || !localPath) {
    return { success: false, error: '缺少 ossPath 或 localPath 参数' };
  }

  try {
    const downloadResult = await getDownloadUrl({
      client,
      filePath: ossPath,
    });

    // 使用 http/https 下载（根据 URL 协议自动选择）
    const parsedUrl = new URL(downloadResult.url);
    const httpModule = parsedUrl.protocol === 'https:' ? await import('https') : await import('http');
    const { createWriteStream } = await import('fs');

    // 确保目录存在
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await new Promise(async (resolve, reject) => {
      const file = createWriteStream(localPath);
      const doPipe = async (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          // 跟随重定向（根据目标 URL 协议选择模块）
          const redirectProto = response.headers.location.startsWith('https') ? 'https' : 'http';
          const redirectHttp = await import(redirectProto);
          redirectHttp.get(response.headers.location, (redirectResponse) => {
            redirectResponse.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
          }).on('error', reject);
        } else {
          response.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }
      };
      httpModule.get(downloadResult.url, (response) => {
        doPipe(response);
      }).on('error', reject);
    });

    logger.info(`下载完成: ${ossPath} → ${localPath}`);
    return {
      success: true,
      data: { ossPath, localPath, fileSize: fs.statSync(localPath).size },
    };
  } catch (e) {
    logger.error(`下载失败: ${e.message}`);
    return { success: false, error: `下载失败: ${e.message}` };
  }
}

/**
 * 读取本地文件内容
 */
async function handleFileRead(client, params) {
  const { localPath, encoding = 'utf-8', maxSize = 10 * 1024 * 1024 } = params;

  if (!localPath) {
    return { success: false, error: '缺少 localPath 参数' };
  }

  if (!fs.existsSync(localPath)) {
    return { success: false, error: `文件不存在: ${localPath}` };
  }

  try {
    const stat = fs.statSync(localPath);
    if (stat.size > maxSize) {
      return { success: false, error: `文件过大: ${stat.size} 字节 (上限 ${maxSize} 字节)` };
    }

    const content = fs.readFileSync(localPath, encoding);
    const ext = path.extname(localPath).toLowerCase();

    logger.info(`读取文件: ${localPath} (${stat.size} 字节)`);

    return {
      success: true,
      data: {
        content,
        size: stat.size,
        encoding,
        ext,
        localPath,
      },
    };
  } catch (e) {
    logger.error(`读取失败: ${e.message}`);
    return { success: false, error: `读取失败: ${e.message}` };
  }
}

/**
 * 检查本地路径是否存在
 */
async function handlePathCheck(client, params) {
  const { localPath } = params;

  if (!localPath) {
    return { success: false, error: '缺少 localPath 参数' };
  }

  try {
    if (!fs.existsSync(localPath)) {
      return {
        success: true,
        data: { exists: false, localPath },
      };
    }

    const stat = fs.statSync(localPath);
    return {
      success: true,
      data: {
        exists: true,
        type: stat.isDirectory() ? 'directory' : 'file',
        size: stat.size,
        modified: stat.mtime.toISOString(),
        localPath,
      },
    };
  } catch (e) {
    return { success: false, error: `检查失败: ${e.message}` };
  }
}

/**
 * 本机截图
 */
async function handleScreenshot(client, params) {
  // 截图能力复用 system_exec 工具的能力
  // 这里先返回一个提示，后续可以对接具体的截图工具
  return { success: false, error: '截图能力尚未实现，请通过编码工具使用 screenshot 工具' };
}

// ==================== 操作执行器映射 ====================

const actionHandlers = {
  cli_file_upload: handleFileUpload,
  cli_file_download: handleFileDownload,
  cli_file_read: handleFileRead,
  cli_local_path_check: handlePathCheck,
  cli_screenshot: handleScreenshot,
};

// ==================== 用户确认与执行 ====================

/**
 * 能力名称的中文映射（用于 UI 展示）
 */
const capabilityLabels = {
  cli_file_upload: '上传本地文件到 OSS',
  cli_file_download: '下载文件到本地',
  cli_file_read: '读取本地文件',
  cli_local_path_check: '检查本地路径',
  cli_screenshot: '本机截图',
};

/**
 * 处理 CLI 操作请求事件
 * 1. 展示操作请求详情
 * 2. 用户确认/拒绝
 * 3. 执行操作
 * 4. 回调 Server
 *
 * @param {object} client - DoveClient 实例
 * @param {object} eventData - SSE 收到的事件数据
 * @returns {Promise<void>}
 */
export async function handleCliAction(client, eventData) {
  const { 事件ID, 操作请求 } = eventData;

  if (!操作请求) {
    logger.warn('cli_action 事件缺少操作请求字段');
    return;
  }

  const { capability, params, description, coLocated } = 操作请求;
  const label = capabilityLabels[capability] || capability;

  // 展示请求详情
  const descLines = [
    `CLI 操作请求: ${label}${coLocated ? ' (同机部署)' : ''}`,
  ];
  if (description) {
    descLines.push(`原因: ${description}`);
  }

  // 展示关键参数
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        descLines.push(`${key}: ${value}`);
      }
    }
  }

  for (const line of descLines) {
    process.stdout.write(line + '\n');
  }
  process.stdout.write('\n');

  // 用户确认
  const CUSTOM_INPUT = '__custom_input__';
  const choice = await select('请选择:', [
    { name: '\u2713 允许', value: 'allow' },
    { name: '\u2717 拒绝', value: 'deny' },
    { name: '\u270f\ufe0f 修改参数', value: CUSTOM_INPUT },
  ], 'allow');

  if (choice === 'deny') {
    await _reportResult(client, 事件ID, { success: false, error: '用户拒绝操作' });
    return;
  }

  // 修改参数（可选）
  let finalParams = { ...params };
  if (choice === CUSTOM_INPUT) {
    // 允许用户修改 localPath 等关键参数
    if (params.localPath) {
      const newPath = await input('本地路径:', params.localPath);
      if (newPath && newPath !== params.localPath) {
        finalParams.localPath = newPath;
      }
    }
  }

  // 执行操作
  const handler = actionHandlers[capability];
  if (!handler) {
    await _reportResult(client, 事件ID, {
      success: false,
      error: `未知 CLI 能力: ${capability}`,
    });
    return;
  }

  try {
    const result = await handler(client, finalParams);
    await _reportResult(client, 事件ID, result);
  } catch (e) {
    await _reportResult(client, 事件ID, {
      success: false,
      error: `执行异常: ${e.message}`,
    });
  }
}

/**
 * 回调 Server 返回操作结果
 * @param {object} client - DoveClient 实例
 * @param {string} actionId - 操作ID
 * @param {object} result - 执行结果
 */
async function _reportResult(client, actionId, result) {
  try {
    await client.post('/api/cli/action/complete', { actionId, result });
    logger.info(`操作结果已回调: ${actionId}, 成功: ${!!result?.success}`);
  } catch (e) {
    logger.warn(`回调结果异常: ${e.message}`);
  }
}
