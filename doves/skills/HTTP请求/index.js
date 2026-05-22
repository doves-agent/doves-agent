/**
 * HTTP 请求技能
 * 
 * 支持发送 HTTP/HTTPS 请求：
 * - GET: 获取资源
 * - POST: 提交数据
 * - PUT: 更新资源
 * - DELETE: 删除资源
 * - 支持自定义请求头、超时设置
 * 
 * 设计原则：
 * - 参数自包含，不依赖外部上下文
 * - 无状态执行，支持并发调用
 * - 安全限制：禁止访问内网地址、限制响应大小
 */

// ============================================================================
// 日志器
// ============================================================================

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('HTTP请求', { 前缀: '[HTTP请求]', 级别: 'debug', 显示调用位置: true });

// ============================================================================
// 安全配置
// ============================================================================

const SECURITY_CONFIG = {
  // 最大响应大小 (2MB)
  maxResponseSize: 2 * 1024 * 1024,
  // 默认超时 (30秒)
  defaultTimeout: 30000,
  // 最大超时 (60秒)
  maxTimeout: 60000,
  // 禁止访问的内网 IP 段
  blockedIPRanges: [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^127\./,
    /^localhost/i
  ]
};

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 检查 URL 是否安全
 * @param {string} url - 请求 URL
 * @returns {Object} { safe: boolean, reason?: string }
 */
function checkUrlSafety(url) {
  try {
    const urlObj = new URL(url);
    
    // 检查协议
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { safe: false, reason: `不支持的协议: ${urlObj.protocol}` };
    }
    
    // 检查是否为内网地址
    const hostname = urlObj.hostname;
    for (const pattern of SECURITY_CONFIG.blockedIPRanges) {
      if (pattern.test(hostname)) {
        return { safe: false, reason: `禁止访问内网地址: ${hostname}` };
      }
    }
    
    return { safe: true };
  } catch (error) {
    return { safe: false, reason: `无效的 URL: ${error.message}` };
  }
}

/**
 * 解析响应
 * @param {Response} response - fetch Response 对象
 * @returns {Promise<Object>} 解析后的响应数据
 */
async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  let data;
  let type = 'text';
  
  // 根据内容类型解析响应
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
      type = 'json';
    } catch {
      data = await response.text();
    }
  } else if (contentType.includes('text/')) {
    data = await response.text();
  } else {
    // 二进制内容，返回 base64
    const buffer = await response.arrayBuffer();
    data = Buffer.from(buffer).toString('base64');
    type = 'binary';
  }
  
  return { data, type, contentType };
}

// ============================================================================
// 主执行函数
// ============================================================================

async function execute(args, context) {
  const {
    url,
    method = 'GET',
    headers = {},
    body,
    timeout = SECURITY_CONFIG.defaultTimeout,
    follow_redirects = true,
    max_redirects = 5
  } = args;

  // 参数验证
  if (!url) {
    return { 成功: false, 错误: '缺少必填参数: url' };
  }

  // URL 安全检查
  const safetyCheck = checkUrlSafety(url);
  if (!safetyCheck.safe) {
    return { 成功: false, 错误: safetyCheck.reason, 错误码: 'SECURITY_VIOLATION' };
  }

  // 超时限制
  const actualTimeout = Math.min(timeout, SECURITY_CONFIG.maxTimeout);

  logger.info(`${method} ${url}`);

  try {
    // 构建请求选项
    const options = {
      method: method.toUpperCase(),
      headers: {
        'User-Agent': 'Dove/2.0',
        ...headers
      },
      timeout: actualTimeout,
      redirect: follow_redirects ? 'follow' : 'manual'
    };

    // 添加请求体
    if (body && ['POST', 'PUT', 'PATCH'].includes(options.method)) {
      if (typeof body === 'object') {
        options.body = JSON.stringify(body);
        options.headers['Content-Type'] = 'application/json';
      } else {
        options.body = String(body);
      }
    }

    // 发送请求
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), actualTimeout);
    
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    // 解析响应
    const { data, type, contentType } = await parseResponse(response);

    // 构建响应头对象
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // 截断过长的文本响应
    let truncated = false;
    let finalData = data;
    if (type === 'text' && typeof data === 'string' && data.length > 10000) {
      finalData = data.substring(0, 10000) + '\n... (响应已截断)';
      truncated = true;
    }

    return {
      成功: response.ok,
      数据: {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: finalData,
        bodyType: type,
        contentType,
        truncated
      }
    };

  } catch (error) {
    logger.error(`请求失败: ${error.message}`);
    
    // 错误类型判断
    let 错误码 = 'REQUEST_ERROR';
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      错误码 = 'TIMEOUT';
    } else if (error.code === 'ENOTFOUND') {
      错误码 = 'DNS_ERROR';
    } else if (error.code === 'ECONNREFUSED') {
      错误码 = 'CONNECTION_REFUSED';
    }

    return {
      成功: false,
      错误: error.message,
      错误码
    };
  }
}

// ============================================================================
// 导出
// ============================================================================

export default {
  name: 'HTTP请求',
  description: 'HTTP 请求技能 - 发送 HTTP/HTTPS 请求，支持 GET/POST/PUT/DELETE 等方法，可自定义请求头和超时设置',

  // 内置技能，不需要拥有权检查
  需要拥有权: false,

  // 能力声明（用于任务匹配）
  abilities: ['HTTP', '网络请求', 'API调用'],
  
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '请求 URL（必填）'
      },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
        default: 'GET',
        description: 'HTTP 方法'
      },
      headers: {
        type: 'object',
        description: '请求头对象，如 { "Authorization": "Bearer xxx" }'
      },
      body: {
        type: 'string',
        description: '请求体（POST/PUT/PATCH 时使用，JSON 字符串或普通文本）'
      },
      timeout: {
        type: 'number',
        default: 30000,
        description: '超时时间（毫秒），最大 60 秒'
      },
      follow_redirects: {
        type: 'boolean',
        default: true,
        description: '是否跟随重定向'
      }
    },
    required: ['url']
  },
  
  execute
};
