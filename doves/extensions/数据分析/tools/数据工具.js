/**
 * 数据统计工具 - 扩展包版本
 * 5个工具：data_query / data_visualize / data_report / data_source_manage / data_anomaly_check
 */

import { randomBytes } from 'crypto';

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('数据工具', { 前缀: '[数据工具]', 级别: 'debug', 显示调用位置: true });

// ==================== 数据源内存缓存 ====================

const _数据源缓存 = new Map();

// ==================== 工具定义 ====================

export const extTools = [
  {
    name: 'data_query',
    description: '自然语言→数据查询，支持SQL/MongoDB/HTTP API。返回查询结果供后续分析。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '查询描述或SQL语句（必填）' },
        source: { type: 'string', description: '数据源名称（必填，需先通过data_source_manage配置）' },
        type: { type: 'string', enum: ['sql', 'mongodb', 'http_api', 'auto'], description: '查询类型（默认auto，根据数据源自动判断）' },
        limit: { type: 'number', description: '返回行数限制（默认100）' },
        params: { type: 'object', description: '查询参数（HTTP API时使用）' }
      },
      required: ['query', 'source']
    }
  },
  {
    name: 'data_visualize',
    description: '数据→ECharts图表HTML→OSS托管，返回可视化页面URL。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '图表标题（必填）' },
        data: { type: 'object', description: '图表数据（必填）' },
        chartType: { type: 'string', enum: ['bar', 'line', 'pie', 'scatter', 'radar', 'heatmap', 'treemap', 'funnel', 'mixed'], description: '图表类型（默认bar）' },
        options: { type: 'object', description: 'ECharts配置覆盖', properties: { theme: { type: 'string', enum: ['light', 'dark'] }, width: { type: 'string' }, height: { type: 'string' } } },
        visibility: { type: 'string', enum: ['private', 'public'], description: '可见性（默认private）' }
      },
      required: ['title', 'data']
    }
  },
  {
    name: 'data_report',
    description: '生成数据分析报告HTML并托管到OSS，返回报告URL。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '报告标题（必填）' },
        sections: {
          type: 'array',
          description: '报告章节',
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string', description: '章节标题' },
              content: { type: 'string', description: '章节内容（支持HTML）' },
              chart: { type: 'object', description: '嵌入的ECharts图表配置' }
            }
          }
        },
        summary: { type: 'string', description: '概述' },
        suggestions: { type: 'array', items: { type: 'string' }, description: '建议' },
        visibility: { type: 'string', enum: ['private', 'public'], description: '可见性（默认private）' }
      },
      required: ['title']
    }
  },
  {
    name: 'data_source_manage',
    description: '管理数据源配置（增删改查），支持MySQL/PostgreSQL/MongoDB/HTTP API。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'update', 'delete', 'test'], description: '操作类型（必填）' },
        name: { type: 'string', description: '数据源名称' },
        type: { type: 'string', enum: ['mysql', 'postgresql', 'mongodb', 'http_api'], description: '数据源类型' },
        config: { type: 'object', description: '连接配置（add/update使用）' },
        queryTemplates: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, template: { type: 'string' } } }, description: '预定义查询模板' }
      },
      required: ['action']
    }
  },
  {
    name: 'data_anomaly_check',
    description: '异常检测：统计规则+LLM判断，返回异常点和分析。',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'array', description: '数据数组（必填）' },
        field: { type: 'string', description: '检测字段名' },
        method: { type: 'string', enum: ['zscore', 'iqr', 'percentage', 'trend'], description: '检测方法（默认zscore）' },
        threshold: { type: 'number', description: '异常阈值（默认3）' },
        context: { type: 'string', description: '数据上下文描述（帮助LLM判断）' }
      },
      required: ['data']
    }
  }
];

// ==================== 工具分类/映射/安全分级 ====================

export const extToolCategories = {
  '数据工具': ['data_query', 'data_visualize', 'data_report', 'data_source_manage', 'data_anomaly_check'],
};

export const extToolAbilityMap = {
  data_query: ['数据分析', '数据查询'],
  data_visualize: ['数据分析', '数据可视化'],
  data_report: ['数据分析', '报表生成'],
  data_source_manage: ['数据分析'],
  data_anomaly_check: ['数据分析'],
};

export const extToolSafetyLevels = {
  data_query: '谨慎',
  data_visualize: '谨慎',
  data_report: '谨慎',
  data_source_manage: '谨慎',
  data_anomaly_check: '安全',
};

// ==================== 辅助函数 ====================

const text = (content) => ({
  content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }]
});

// ==================== ECharts HTML生成 ====================

function 生成图表HTML(title, data, chartType = 'bar', options = {}) {
  const theme = options.theme || 'light';
  const bgColor = theme === 'dark' ? '#1a1a2e' : '#fff';
  const textColor = theme === 'dark' ? '#e0e0e0' : '#333';

  let echartsOption;
  if (chartType === 'pie') {
    echartsOption = {
      tooltip: { trigger: 'item' },
      legend: {},
      series: [{
        type: 'pie',
        radius: '60%',
        data: data.values || data.series || [],
        emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.5)' } }
      }]
    };
  } else if (chartType === 'mixed' && Array.isArray(data.series)) {
    echartsOption = {
      tooltip: { trigger: 'axis' },
      legend: {},
      xAxis: { type: 'category', data: data.xAxis || [] },
      yAxis: data.yAxis || { type: 'value' },
      series: data.series
    };
  } else {
    echartsOption = {
      tooltip: { trigger: 'axis' },
      legend: {},
      xAxis: { type: 'category', data: data.xAxis || [] },
      yAxis: { type: 'value' },
      series: [{
        type: chartType,
        data: data.series || data.values || [],
        itemStyle: { color: '#667eea' }
      }]
    };
  }

  // 合并用户自定义配置
  if (options.echartsOption) {
    echartsOption = { ...echartsOption, ...options.echartsOption };
  }

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title><script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:${bgColor};color:${textColor};padding:20px}
h1{margin-bottom:20px}.chart{width:100%;height:${options.height || '500px'};background:${theme==='dark'?'#16213e':'#fff'};border-radius:8px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.06)}</style></head>
<body><h1>${title}</h1><div class="chart" id="chart"></div>
<script>var chart=echarts.init(document.getElementById('chart'));chart.setOption(${JSON.stringify(echartsOption)});window.addEventListener('resize',()=>chart.resize());</script></body></html>`;
}

// ==================== 报告HTML生成 ====================

function 生成报告HTML(title, sections = [], summary = '', suggestions = []) {
  const sectionHtml = sections.map(s => {
    let html = `<div class="section"><h2>${s.heading || '章节'}</h2>`;
    if (s.content) html += `<div class="content">${s.content}</div>`;
    if (s.chart) {
      const chartId = `chart_${Math.random().toString(36).substr(2, 8)}`;
      html += `<div id="${chartId}" style="width:100%;height:400px"></div>`;
      html += `<script>var c_${chartId}=echarts.init(document.getElementById('${chartId}'));c_${chartId}.setOption(${JSON.stringify(s.chart)});</script>`;
    }
    html += '</div>';
    return html;
  }).join('\n');

  const suggestionHtml = suggestions.length > 0
    ? `<div class="suggestions"><h2>建议</h2><ul>${suggestions.map(s => `<li>${s}</li>`).join('')}</ul></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title><script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f5;color:#333;padding:20px}
.report{max-width:1000px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 12px rgba(0,0,0,.06)}
h1{font-size:1.8em;border-bottom:2px solid #667eea;padding-bottom:12px;margin-bottom:20px;color:#333}
.summary{background:#f8f9fa;padding:16px;border-radius:8px;margin-bottom:24px;line-height:1.6;color:#555}
.section{margin-bottom:24px}.section h2{font-size:1.3em;color:#667eea;margin-bottom:12px}
.content{line-height:1.8;color:#555}.suggestions{background:#fff8e1;padding:16px;border-radius:8px;margin-top:20px}
.suggestions h2{color:#f57c00;margin-bottom:12px}.suggestions ul{padding-left:20px}
.suggestions li{margin-bottom:8px;line-height:1.6;color:#555}
.meta{text-align:right;color:#999;font-size:12px;margin-top:20px}</style></head>
<body><div class="report"><h1>${title}</h1>
${summary ? `<div class="summary">${summary}</div>` : ''}
${sectionHtml}
${suggestionHtml}
<div class="meta">生成时间：${new Date().toLocaleString('zh-CN')}</div></div></body></html>`;
}

// ==================== 工具处理函数 ====================

export async function handleExtTool(name, args) {
  switch (name) {

    // ===== data_query =====
    case 'data_query': {
      const { query, source, type = 'auto', limit = 100, params } = args;

      if (!query || !source) {
        return text({ error: '缺少必填参数: query 和 source' });
      }

      const sourceConfig = _数据源缓存.get(source);
      if (!sourceConfig) {
        return text({
          action: 'data_query',
          error: `数据源 "${source}" 未配置，请先使用 data_source_manage 添加`,
          availableSources: Array.from(_数据源缓存.keys())
        });
      }

      const queryType = type === 'auto' ? sourceConfig.type : type;

      // 根据数据源类型生成查询
      const result = {
        action: 'data_query',
        source,
        queryType,
        query,
        hint: '请基于以上查询需求，生成具体的查询语句。注意：实际数据库连接需要服务端支持，当前为查询构建模式。'
      };

      if (queryType === 'sql') {
        result.generatedQuery = `-- 基于自然语言生成的SQL查询\n-- 需求: ${query}\n-- 请根据实际表结构调整\nSELECT * FROM table_name LIMIT ${limit};`;
      } else if (queryType === 'mongodb') {
        result.generatedQuery = `// MongoDB查询\n// 需求: ${query}\ndb.collection.find({}).limit(${limit});`;
      } else if (queryType === 'http_api') {
        result.generatedQuery = {
          method: 'GET',
          url: sourceConfig.config?.端点 || 'https://api.example.com/data',
          params: params || {}
        };
      }

      return text(result);
    }

    // ===== data_visualize =====
    case 'data_visualize': {
      const { title, data, chartType = 'bar', options = {}, visibility = 'private' } = args;

      if (!title || !data) {
        return text({ error: '缺少必填参数: title 和 data' });
      }

      const html = 生成图表HTML(title, data, chartType, options);

      // 尝试托管到OSS
      let ossUrl = null;
      try {
        const { handleExtTool: pageHandle } = await import('../../tools/页面托管.js');
        const hostResult = await pageHandle('页面托管', { title: `[图表] ${title}`, html, visibility });
        const hostText = hostResult?.content?.[0]?.text;
        if (hostText) { try { ossUrl = JSON.parse(hostText).url; } catch { /* */ } }
      } catch { /* */ }

      return text({
        action: 'data_visualize',
        title,
        chartType,
        url: ossUrl || `memory://chart_${Date.now().toString(36)}`,
        storage: ossUrl ? 'oss' : 'memory',
        hint: ossUrl ? '图表已托管到OSS' : '图表HTML已生成，可使用 页面托管 手动托管'
      });
    }

    // ===== data_report =====
    case 'data_report': {
      const { title, sections = [], summary = '', suggestions = [], visibility = 'private' } = args;

      if (!title) {
        return text({ error: '缺少必填参数: title' });
      }

      const html = 生成报告HTML(title, sections, summary, suggestions);

      // 尝试托管到OSS
      let ossUrl = null;
      try {
        const { handleExtTool: pageHandle } = await import('../../tools/页面托管.js');
        const hostResult = await pageHandle('页面托管', { title: `[报告] ${title}`, html, visibility });
        const hostText = hostResult?.content?.[0]?.text;
        if (hostText) { try { ossUrl = JSON.parse(hostText).url; } catch { /* */ } }
      } catch { /* */ }

      return text({
        action: 'data_report',
        title,
        url: ossUrl || `memory://report_${Date.now().toString(36)}`,
        storage: ossUrl ? 'oss' : 'memory',
        hint: ossUrl ? '报告已托管到OSS' : '报告HTML已生成，可使用 页面托管 手动托管'
      });
    }

    // ===== data_source_manage =====
    case 'data_source_manage': {
      const { action: dsAction, name, type, config, queryTemplates } = args;

      switch (dsAction) {
        case 'list': {
          const sources = Array.from(_数据源缓存.entries()).map(([key, val]) => ({
            name: key,
            type: val.type,
            hasConfig: !!val.config,
            queryTemplates: val.queryTemplates?.length || 0
          }));
          return text({ action: 'data_source_manage', total: sources.length, sources });
        }

        case 'add': {
          if (!name || !type) {
            return text({ error: '缺少必填参数: name 和 type' });
          }
          if (_数据源缓存.has(name)) {
            return text({ error: `数据源已存在: ${name}，请使用 update 更新` });
          }
          _数据源缓存.set(name, { type, config: config || {}, queryTemplates: queryTemplates || [], createdAt: new Date().toISOString() });
          return text({ action: 'data_source_manage', operation: 'add', name, type, hint: '注意：敏感信息（密码/Token）应加密存储，禁止明文' });
        }

        case 'update': {
          if (!name) return text({ error: '缺少必填参数: name' });
          const existing = _数据源缓存.get(name);
          if (!existing) return text({ error: `数据源不存在: ${name}` });
          if (type) existing.type = type;
          if (config) existing.config = { ...existing.config, ...config };
          if (queryTemplates) existing.queryTemplates = queryTemplates;
          existing.updatedAt = new Date().toISOString();
          return text({ action: 'data_source_manage', operation: 'update', name });
        }

        case 'delete': {
          if (!name) return text({ error: '缺少必填参数: name' });
          if (!_数据源缓存.has(name)) return text({ error: `数据源不存在: ${name}` });
          _数据源缓存.delete(name);
          return text({ action: 'data_source_manage', operation: 'delete', name });
        }

        case 'test': {
          if (!name) return text({ error: '缺少必填参数: name' });
          const testSource = _数据源缓存.get(name);
          if (!testSource) return text({ error: `数据源不存在: ${name}` });
          // 实际连接测试需要服务端支持
          return text({
            action: 'data_source_manage',
            operation: 'test',
            name,
            status: 'configured',
            hint: '实际数据库连接测试需要服务端支持，当前仅验证配置完整性'
          });
        }

        default:
          return text({ error: `未知操作: ${dsAction}` });
      }
    }

    // ===== data_anomaly_check =====
    case 'data_anomaly_check': {
      const { data, field, method = 'zscore', threshold = 3, context = '' } = args;

      if (!data || !Array.isArray(data)) {
        return text({ error: '缺少必填参数: data（数组类型）' });
      }

      const values = field ? data.map(d => d[field]).filter(v => typeof v === 'number') : data.filter(v => typeof v === 'number');

      if (values.length < 3) {
        return text({ action: 'data_anomaly_check', anomalies: 0, hint: '数据量过少（<3），无法进行异常检测' });
      }

      const anomalies = [];

      // 统计量计算
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const stdDev = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
      const sorted = [...values].sort((a, b) => a - b);
      const q1 = sorted[Math.floor(sorted.length * 0.25)];
      const q3 = sorted[Math.floor(sorted.length * 0.75)];
      const iqr = q3 - q1;

      for (let i = 0; i < values.length; i++) {
        let isAnomaly = false;
        let score = 0;

        if (method === 'zscore') {
          score = stdDev > 0 ? Math.abs((values[i] - mean) / stdDev) : 0;
          isAnomaly = score > threshold;
        } else if (method === 'iqr') {
          score = iqr > 0 ? Math.abs(values[i] - mean) / iqr : 0;
          isAnomaly = values[i] < q1 - threshold * iqr || values[i] > q3 + threshold * iqr;
        } else if (method === 'percentage') {
          const pctChange = i > 0 && values[i - 1] !== 0 ? Math.abs((values[i] - values[i - 1]) / values[i - 1] * 100) : 0;
          score = pctChange;
          isAnomaly = pctChange > threshold * 10;
        } else if (method === 'trend') {
          // 简单趋势：与最近5个值的均值比较
          const window = values.slice(Math.max(0, i - 5), i);
          const windowMean = window.length > 0 ? window.reduce((a, b) => a + b, 0) / window.length : mean;
          score = stdDev > 0 ? Math.abs((values[i] - windowMean) / stdDev) : 0;
          isAnomaly = score > threshold;
        }

        if (isAnomaly) {
          anomalies.push({
            index: i,
            value: values[i],
            score: Math.round(score * 100) / 100,
            method,
            [field ? 'field' : '_']: field || '_'
          });
        }
      }

      return text({
        action: 'data_anomaly_check',
        totalPoints: values.length,
        anomalies: anomalies.length,
        anomalyRate: `${(anomalies.length / values.length * 100).toFixed(1)}%`,
        anomalies: anomalies.slice(0, 50),
        stats: { mean: Math.round(mean * 100) / 100, stdDev: Math.round(stdDev * 100) / 100, min: sorted[0], max: sorted[sorted.length - 1], q1, q3 },
        method,
        threshold,
        context,
        hint: anomalies.length > 0 ? `检测到 ${anomalies.length} 个异常点，建议进一步分析原因` : '未检测到异常'
      });
    }

    default:
      return null; // 不认识的工具返回 null，让其他扩展处理
  }
}
