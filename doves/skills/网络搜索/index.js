/**
 * 网络搜索技能
 * 
 * 支持搜索引擎：
 * - 百度搜索（默认，国内可用）
 * - Bing 搜索
 * - Google 搜索（需要代理）
 * 
 * 设计原则：
 * - 参数自包含，不依赖外部上下文
 * - 无状态执行，支持并发调用
 * - 支持模拟模式用于测试
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

// ============================================================================
// 日志器
// ============================================================================

const logger = 创建日志器('网络搜索', { 前缀: '[网络搜索]', 级别: 'debug', 显示调用位置: true });

// ============================================================================
// 配置
// ============================================================================

const CONFIG = {
  // 默认搜索引擎
  defaultEngine: 'baidu',
  // 默认返回结果数
  defaultNumResults: 5,
  // 最大返回结果数
  maxNumResults: 20,
  // 超时时间
  timeout: 15000
};

// ============================================================================
// 搜索引擎实现
// ============================================================================

/**
 * 百度搜索（HTML 解析方式）
 * 注意：实际生产环境建议使用官方 API
 */
async function baiduSearch(query, numResults) {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${numResults}`;
  
  try {
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      timeout: CONFIG.timeout
    });

    if (!response.ok) {
      throw new Error(`百度搜索失败: ${response.status}`);
    }

    const html = await response.text();
    return parseBaiduResults(html, numResults);
  } catch (error) {
    logger.error('百度搜索失败:', error.message);
    throw error;
  }
}

/**
 * 解析百度搜索结果
 */
function parseBaiduResults(html, maxResults) {
  const results = [];
  
  // 简单的正则解析（生产环境建议使用 cheerio 等库）
  const resultPattern = /<h3[^>]*class="[^"]*t[^"]*"[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h3>[\s\S]*?<span[^>]*class="[^"]*content-right[^"]*"[\s\S]*?>([\s\S]*?)<\/span>/g;
  
  let match;
  let count = 0;
  
  while ((match = resultPattern.exec(html)) !== null && count < maxResults) {
    const url = match[1];
    const title = match[2].replace(/<[^>]+>/g, '').trim();
    const snippet = match[3].replace(/<[^>]+>/g, '').trim().substring(0, 200);
    
    // 过滤无效结果
    if (title && url && !url.includes('javascript:')) {
      results.push({
        title,
        url: url.startsWith('http') ? url : `https://www.baidu.com${url}`,
        snippet,
        engine: 'baidu'
      });
      count++;
    }
  }
  
  return results;
}

/**
 * Bing 搜索（需要 API Key）
 */
async function bingSearch(query, numResults, apiKey) {
  if (!apiKey) {
    throw new Error('Bing 搜索需要配置 API Key');
  }

  const searchUrl = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${numResults}&mkt=zh-CN`;
  
  const response = await fetch(searchUrl, {
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey
    },
    timeout: CONFIG.timeout
  });

  if (!response.ok) {
    throw new Error(`Bing 搜索失败: ${response.status}`);
  }

  const data = await response.json();
  
  return (data.webPages?.value || []).map(item => ({
    title: item.name,
    url: item.url,
    snippet: item.snippet,
    engine: 'bing'
  }));
}

/**
 * 模拟搜索（用于测试）
 */
async function mockSearch(query, numResults) {
  logger.info('使用模拟搜索模式');
  
  // 模拟网络延迟
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // 返回模拟结果
  return Array.from({ length: numResults }, (_, i) => ({
    title: `搜索结果 ${i + 1}: ${query}`,
    url: `https://example.com/result/${i + 1}`,
    snippet: `这是关于 "${query}" 的第 ${i + 1} 个搜索结果。模拟搜索用于测试目的。`,
    engine: 'mock'
  }));
}

// ============================================================================
// 主执行函数
// ============================================================================

async function execute(args, context) {
  const {
    query,
    num_results = CONFIG.defaultNumResults,
    engine = CONFIG.defaultEngine,
    use_mock = false
  } = args;

  // 参数验证
  if (!query) {
    return { 成功: false, 错误: '缺少必填参数: query' };
  }

  // 限制结果数量
  const actualNumResults = Math.min(num_results, CONFIG.maxNumResults);

  logger.info(`搜索: "${query}" (引擎: ${engine}, 结果数: ${actualNumResults})`);

  try {
    let results;

    // 模拟模式
    if (use_mock || process.env.WEB_SEARCH_MOCK === 'true') {
      results = await mockSearch(query, actualNumResults);
    }
    // 根据搜索引擎选择
    else if (engine === 'baidu') {
      results = await baiduSearch(query, actualNumResults);
    }
    else if (engine === 'bing') {
      // 从 context 或环境变量获取 API Key
      const apiKey = context?.bingApiKey || process.env.BING_API_KEY;
      results = await bingSearch(query, actualNumResults, apiKey);
    }
    else if (engine === 'google') {
      // Google 搜索需要额外实现（或使用第三方库）
      return { 
        成功: false, 
        错误: 'Google 搜索暂未实现，请使用 baidu 或 bing',
        错误码: 'ENGINE_NOT_SUPPORTED'
      };
    }
    else {
      return { 
        成功: false, 
        错误: `不支持的搜索引擎: ${engine}`,
        错误码: 'INVALID_ENGINE'
      };
    }

    // 无结果时返回提示
    if (results.length === 0) {
      return {
        成功: true,
        数据: {
          query,
          results: [],
          total: 0,
          message: '未找到相关结果，请尝试更换关键词'
        }
      };
    }

    return {
      成功: true,
      数据: {
        query,
        results,
        total: results.length,
        engine
      }
    };

  } catch (error) {
    logger.error(`搜索失败: ${error.message}`);
    return {
      成功: false,
      错误: error.message,
      错误码: 'SEARCH_ERROR'
    };
  }
}

// ============================================================================
// 导出
// ============================================================================

export default {
  name: '网络搜索',
  description: '网络搜索技能 - 执行网络搜索获取实时信息，支持百度、Bing 等搜索引擎',

  // 内置技能，不需要拥有权检查
  需要拥有权: false,

  // 能力声明
  abilities: ['搜索', '网络搜索', '信息检索'],
  
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词（必填）'
      },
      num_results: {
        type: 'integer',
        default: 5,
        description: '返回结果数量（1-20）'
      },
      engine: {
        type: 'string',
        enum: ['baidu', 'bing', 'google', 'mock'],
        default: 'baidu',
        description: '搜索引擎类型'
      },
      use_mock: {
        type: 'boolean',
        default: false,
        description: '是否使用模拟模式（测试用）'
      }
    },
    required: ['query']
  },
  
  execute
};
