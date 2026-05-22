/**
 * 异常检测技能
 * 统计规则 + LLM判断 — 自动发现数据异常
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('anomaly_detector', { 前缀: '[anomaly_detector]', 级别: 'debug', 显示调用位置: true });

/**
 * Z-Score 异常检测
 */
function zscoreDetect(values, threshold = 3) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const stdDev = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  if (stdDev === 0) return [];

  return values
    .map((v, i) => ({ index: i, value: v, score: Math.abs((v - mean) / stdDev) }))
    .filter(r => r.score > threshold);
}

/**
 * IQR 异常检测
 */
function iqrDetect(values, multiplier = 1.5) {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  if (iqr === 0) return [];

  const lower = q1 - multiplier * iqr;
  const upper = q3 + multiplier * iqr;

  return values
    .map((v, i) => ({ index: i, value: v, lower, upper })
    )
    .filter(r => r.value < r.lower || r.value > r.upper)
    .map(r => ({ ...r, score: r.value > r.upper ? (r.value - r.upper) / iqr : (r.lower - r.value) / iqr }));
}

/**
 * 变化率异常检测
 */
function changeRateDetect(values, threshold = 0.5) {
  const anomalies = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] === 0) continue;
    const changeRate = Math.abs((values[i] - values[i - 1]) / values[i - 1]);
    if (changeRate > threshold) {
      anomalies.push({ index: i, value: values[i], prevValue: values[i - 1], changeRate: Math.round(changeRate * 10000) / 100 });
    }
  }
  return anomalies;
}

async function execute(args, context) {
  const { action = 'detect', data, field, methods = ['zscore', 'iqr'], thresholds = {}, context: dataContext = '' } = args;

  logger.info(`执行: ${action}`);

  try {
    switch (action) {

      case 'detect': {
        if (!data || !Array.isArray(data)) {
          return { 成功: false, 错误: '缺少必填参数: data（数组类型）' };
        }

        const values = field ? data.map(d => d[field]).filter(v => typeof v === 'number') : data.filter(v => typeof v === 'number');

        if (values.length < 3) {
          return { 成功: true, 数据: { anomalies: 0, hint: '数据量过少（<3），无法进行异常检测' } };
        }

        const results = {};

        for (const method of methods) {
          const threshold = thresholds[method] || (method === 'zscore' ? 3 : method === 'iqr' ? 1.5 : 0.5);

          if (method === 'zscore') {
            results.zscore = zscoreDetect(values, threshold);
          } else if (method === 'iqr') {
            results.iqr = iqrDetect(values, threshold);
          } else if (method === 'change_rate') {
            results.change_rate = changeRateDetect(values, threshold);
          }
        }

        // 综合异常点（被多种方法检测到）
        const allIndices = new Set();
        for (const methodResults of Object.values(results)) {
          for (const r of methodResults) {
            allIndices.add(r.index);
          }
        }

        const stats = {
          mean: values.reduce((a, b) => a + b, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
          count: values.length
        };

        return {
          成功: true,
          数据: {
            totalAnomalies: allIndices.size,
            anomalyRate: `${(allIndices.size / values.length * 100).toFixed(1)}%`,
            byMethod: Object.fromEntries(
              Object.entries(results).map(([k, v]) => [k, { count: v.length, anomalies: v.slice(0, 20) }])
            ),
            stats,
            context: dataContext,
            hint: allIndices.size > 0
              ? `检测到 ${allIndices.size} 个异常点，建议结合业务上下文分析原因`
              : '未检测到异常'
          }
        };
      }

      case 'methods': {
        return {
          成功: true,
          数据: {
            methods: [
              { id: 'zscore', name: 'Z-Score', description: '基于标准差的异常检测，适合正态分布数据', defaultThreshold: 3 },
              { id: 'iqr', name: 'IQR', description: '基于四分位距的异常检测，对偏态分布鲁棒', defaultThreshold: 1.5 },
              { id: 'change_rate', name: '变化率', description: '基于相邻数据点变化率的异常检测，适合时序数据', defaultThreshold: 0.5 },
            ]
          }
        };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}，支持: detect / methods` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'anomaly_detector',
  description: '异常检测技能 — 统计规则（Z-Score/IQR/变化率）自动发现数据异常',
  abilities: ['数据分析'],

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['detect', 'methods'],
        description: '操作类型：detect=检测异常 / methods=列出方法'
      },
      data: { type: 'array', description: '数据数组' },
      field: { type: 'string', description: '检测字段名' },
      methods: { type: 'array', items: { type: 'string', enum: ['zscore', 'iqr', 'change_rate'] }, description: '检测方法列表' },
      thresholds: { type: 'object', description: '各方法阈值（如 {zscore: 3, iqr: 1.5}）' },
      context: { type: 'string', description: '数据上下文描述' }
    },
    required: ['action']
  },

  execute
};
