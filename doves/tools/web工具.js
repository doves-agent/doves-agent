/**
 * @file tools/web工具
 * @description 网络搜索与网页抓取工具
 * 
 * 网页搜索: 网络搜索，支持百度/Bing/模拟模式
 * 网页抓取:  抓取网页内容，提取正文文本
 * 
 * 设计原则：
 * - 参数自包含，不依赖外部上下文
 * - 无状态执行，支持并发调用
 * - 搜索失败直接报错，不做降级
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('web工具', { 前缀: '[web工具]', 级别: 'debug', 显示调用位置: true });

// ============================================================================
// 工具定义（LLM Function Calling 格式）
// ============================================================================

export const webTools = [
  {
    name: '网页搜索',
    description: '搜索互联网获取实时信息。[限制]百度HTML解析易被反爬，结果可能缺失摘要；Bing需配置API Key；无法搜索时直接报错，建议用户自行浏览器搜索。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词'
        },
        num_results: {
          type: 'integer',
          description: '返回结果数量（1-20），默认5',
          default: 5
        },
        engine: {
          type: 'string',
          enum: ['baidu', 'bing'],
          description: '搜索引擎类型，默认baidu',
          default: 'baidu'
        }
      },
      required: ['query']
    }
  },
  {
    name: '网页抓取',
    description: '抓取指定URL的网页内容，提取正文文本。[限制]需目标URL可直接访问；反爬站点可能被拦截；无法渲染JavaScript动态内容(单页应用可能拿到空壳)；超长内容截断至5000字符。',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要抓取的网页URL'
        },
        selector: {
          type: 'string',
          description: '可选CSS选择器，用于提取页面特定部分内容'
        },
        max_length: {
          type: 'integer',
          description: '最大返回内容长度（字符数），默认5000',
          default: 5000
        },
        timeout: {
          type: 'integer',
          description: '请求超时时间（毫秒），默认15000',
          default: 15000
        }
      },
      required: ['url']
    }
  }
];

// ============================================================================
// 百度搜索实现
// ============================================================================

async function baiduSearch(query, numResults) {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${numResults}`;
  
  const response = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`百度搜索失败: HTTP ${response.status}`);
  }

  const html = await response.text();
  return parseBaiduResults(html, numResults);
}

/**
 * 解析百度搜索结果HTML
 */
function parseBaiduResults(html, maxResults) {
  const results = [];
  
  // 匹配百度搜索结果项
  const resultPattern = /<h3[^>]*class="[^"]*t[^"]*"[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h3>/g;
  // 匹配摘要（百度多种摘要容器）
  const snippetPattern = /<span[^>]*class="[^"]*(?:content-right|right)[^"]*"[^>]*>([\s\S]*?)<\/span>/g;
  
  let match;
  let count = 0;
  
  while ((match = resultPattern.exec(html)) !== null && count < maxResults) {
    const url = match[1];
    const title = match[2].replace(/<[^>]+>/g, '').trim();
    
    // 过滤无效结果
    if (title && url && !url.includes('javascript:')) {
      results.push({
        title,
        url: url.startsWith('http') ? url : `https://www.baidu.com${url}`,
        snippet: '',  // 百度摘要解析不稳定，留空
        engine: 'baidu'
      });
      count++;
    }
  }
  
  return results;
}

// ============================================================================
// Bing 搜索实现
// ============================================================================

async function bingSearch(query, numResults, apiKey) {
  if (!apiKey) {
    throw new Error('Bing 搜索需要配置 BING_API_KEY 环境变量');
  }

  const searchUrl = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${numResults}&mkt=zh-CN`;
  
  const response = await fetch(searchUrl, {
    headers: { 'Ocp-Apim-Subscription-Key': apiKey },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Bing 搜索失败: HTTP ${response.status}`);
  }

  const data = await response.json();
  
  return (data.webPages?.value || []).map(item => ({
    title: item.name,
    url: item.url,
    snippet: item.snippet,
    engine: 'bing'
  }));
}

// ============================================================================
// 网页抓取实现
// ============================================================================

async function fetchWebPage(url, selector, maxLength, timeout) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`网页抓取失败: HTTP ${response.status}`);
  }

  const html = await response.text();
  
  // 提取文本内容
  let text = extractTextFromHtml(html, selector);
  
  // 截断
  if (text.length > maxLength) {
    text = text.substring(0, maxLength) + '\n...(内容已截断)';
  }
  
  return {
    url,
    content: text,
    length: text.length,
    status: response.status
  };
}

/**
 * 从HTML中提取纯文本
 */
function extractTextFromHtml(html, selector) {
  // 简单的HTML标签清理
  let text = html;
  
  // 如果指定了选择器，尝试提取对应部分（简易实现）
  if (selector) {
    // 移除script和style
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
    text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
    text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  }
  
  // 通用清理
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  
  // 保留部分语义标签
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n');
  
  // 移除所有剩余HTML标签
  text = text.replace(/<[^>]+>/g, '');
  
  // 解码HTML实体
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
  
  // 清理空白
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.trim();
  
  return text;
}

// ============================================================================
// 工具处理函数
// ============================================================================

/**
 * 处理 Web 工具调用
 * @param {string} name - 工具名称 (网页搜索 | 网页抓取)
 * @param {Object} args - 工具参数
 * @returns {Object} 执行结果
 */
export async function handleWebTool(name, args) {
  try {
    if (name === '网页搜索') {
      return await handleWebSearch(args);
    }
    if (name === '网页抓取') {
      return await handleWebFetch(args);
    }
    
    return {
      content: [{ type: 'text', text: `Unknown web tool: ${name}` }],
      isError: true
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Web工具执行失败: ${error.message}` }],
      isError: true
    };
  }
}

/**
 * 处理 网页搜索 工具调用
 */
async function handleWebSearch(args) {
  const {
    query,
    num_results = 5,
    engine = 'baidu'
  } = args;

  if (!query) {
    return {
      content: [{ type: 'text', text: '错误：缺少搜索关键词 (query)' }],
      isError: true
    };
  }

  const actualNumResults = Math.min(Math.max(num_results, 1), 20);

  try {
    let results;
    
    if (engine === 'baidu') {
      results = await baiduSearch(query, actualNumResults);
    } else if (engine === 'bing') {
      const apiKey = process.env.BING_API_KEY;
      results = await bingSearch(query, actualNumResults, apiKey);
    } else {
      return {
        content: [{ type: 'text', text: `不支持的搜索引擎: ${engine}，支持 baidu/bing` }],
        isError: true
      };
    }

    // 搜索无结果
    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: `搜索 "${query}" 未找到相关结果。建议更换关键词。` }]
      };
    }

    // 格式化搜索结果
    const formattedResults = results.map((r, i) => 
      `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet ? `摘要: ${r.snippet}` : ''}`
    ).join('\n\n');

    return {
      content: [{ type: 'text', text: `搜索 "${query}" (引擎: ${engine})，找到 ${results.length} 条结果：\n\n${formattedResults}` }]
    };

  } catch (error) {
    return {
      content: [{ type: 'text', text: `搜索引擎 ${engine} 不可用: ${error.message}。请检查网络连接或配置 BING_API_KEY 环境变量。` }],
      isError: true
    };
  }
}

/**
 * 处理 网页抓取 工具调用
 */
async function handleWebFetch(args) {
  const {
    url,
    selector,
    max_length = 5000,
    timeout = 15000
  } = args;

  if (!url) {
    return {
      content: [{ type: 'text', text: '错误：缺少URL参数' }],
      isError: true
    };
  }

  // URL 格式验证
  try {
    new URL(url);
  } catch (e) {
    logger.debug(`URL格式无效: ${url} | ${e.message}`);
    return {
      content: [{ type: 'text', text: `错误：无效的URL格式: ${url}` }],
      isError: true
    };
  }

  try {
    const result = await fetchWebPage(url, selector, max_length, timeout);
    
    return {
      content: [{ type: 'text', text: `网页内容 (${result.url}):\n\n${result.content}` }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `网页抓取失败: ${error.message}\nURL: ${url}` }],
      isError: true
    };
  }
}
