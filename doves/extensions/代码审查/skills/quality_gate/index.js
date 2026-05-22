/**
 * 质量门禁技能
 * 
 * 能力：
 * - 配置项目级质量门禁规则
 * - 跟踪门禁通过/阻断历史
 * - 生成门禁报告
 */

import fs from 'fs/promises';
import path from 'path';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('quality_gate', { 前缀: '[quality_gate]', 级别: 'debug', 显示调用位置: true });

// 门禁历史存储路径
const GATE_HISTORY_FILE = '.doves/gate-history.json';

// 默认门禁配置
const DEFAULT_CONFIG = {
  passThreshold: 80,
  blockOnCritical: true,
  dimensions: {
    security: { weight: 30, threshold: 70 },
    performance: { weight: 20, threshold: 60 },
    style: { weight: 15, threshold: 70 },
    maintainability: { weight: 20, threshold: 65 },
    complexity: { weight: 15, threshold: 70 },
  },
  rules: {
    maxFileChanges: 20,
    maxTotalChanges: 1000,
    requireTests: true,
    requireDocs: false,
    blockPatterns: ['*.min.js', '*.min.css'],
  }
};

/**
 * 读取门禁配置
 */
async function 读取配置(cwd) {
  const configPath = path.join(cwd, '.doves', 'quality-gate.json');
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * 读取门禁历史
 */
async function 读取历史(cwd) {
  const histPath = path.join(cwd, GATE_HISTORY_FILE);
  try {
    const content = await fs.readFile(histPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

/**
 * 写入门禁历史
 */
async function 写入历史(cwd, history) {
  const histPath = path.join(cwd, GATE_HISTORY_FILE);
  const dir = path.dirname(histPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(histPath, JSON.stringify(history, null, 2), 'utf-8');
}

/**
 * 执行质量门禁
 */
async function execute(args, context) {
  const { action = 'check', cwd = process.cwd() } = args;

  logger.info(`执行: ${action}, cwd: ${cwd}`);

  try {
    switch (action) {

      // 检查门禁
      case 'check': {
        const { reviewResults = [], passThreshold, blockOnCritical } = args;
        const config = await 读取配置(cwd);
        const threshold = passThreshold || config.passThreshold;
        const block = blockOnCritical !== undefined ? blockOnCritical : config.blockOnCritical;

        if (reviewResults.length === 0) {
          return { 成功: true, 数据: { pass: false, score: 0, message: '无审查结果', verdict: '阻断' } };
        }

        // 计算加权分数
        let totalWeight = 0;
        let weightedScore = 0;
        const dimensionResults = [];

        for (const result of reviewResults) {
          const dimConfig = config.dimensions[result.dimension] || { weight: 10 };
          const weight = dimConfig.weight;
          totalWeight += weight;
          weightedScore += (result.score || 0) * weight;

          const dimThreshold = dimConfig.threshold || 60;
          const dimPass = (result.score || 0) >= dimThreshold;

          dimensionResults.push({
            dimension: result.dimension,
            score: result.score || 0,
            weight,
            threshold: dimThreshold,
            pass: dimPass,
            issues: result.issues || 0,
            criticalIssues: result.criticalIssues || 0,
          });
        }

        const finalScore = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;
        const totalCritical = reviewResults.reduce((s, r) => s + (r.criticalIssues || 0), 0);
        const allDimsPass = dimensionResults.every(d => d.pass);
        const pass = finalScore >= threshold && !((block && totalCritical > 0) || !allDimsPass);

        // 记录历史
        const history = await 读取历史(cwd);
        const entry = {
          timestamp: new Date().toISOString(),
          score: finalScore,
          pass,
          threshold,
          totalCritical,
          dimensions: dimensionResults.map(d => ({ dimension: d.dimension, score: d.score, pass: d.pass })),
        };
        history.push(entry);
        // 只保留最近100条
        if (history.length > 100) history.splice(0, history.length - 100);
        await 写入历史(cwd, history);

        return {
          成功: true,
          数据: {
            score: finalScore,
            pass,
            passThreshold: threshold,
            totalCritical,
            blockOnCritical: block,
            dimensions: dimensionResults,
            verdict: pass ? '通过 — 可以进行merge/push' : '阻断 — 存在严重问题或评分不足，请修复后重新审查',
            trend: history.length > 1 ? `最近${Math.min(5, history.length)}次: ${history.slice(-5).map(h => h.pass ? '✓' : '✗').join(' ')}` : '',
          }
        };
      }

      // 获取/设置配置
      case 'config': {
        const { set: configSet } = args;
        if (configSet && typeof configSet === 'object') {
          // 写入配置
          const current = await 读取配置(cwd);
          const updated = { ...current, ...configSet };
          const configPath = path.join(cwd, '.doves', 'quality-gate.json');
          const dir = path.dirname(configPath);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8');
          return { 成功: true, 数据: { message: '配置已更新', config: updated } };
        }

        // 读取当前配置
        const config = await 读取配置(cwd);
        return { 成功: true, 数据: { config } };
      }

      // 查看历史趋势
      case 'history': {
        const { limit = 20 } = args;
        const history = await 读取历史(cwd);
        const recent = history.slice(-limit);

        const passCount = recent.filter(h => h.pass).length;
        const failCount = recent.length - passCount;
        const avgScore = recent.length > 0 ? Math.round(recent.reduce((s, h) => s + h.score, 0) / recent.length) : 0;

        // 按维度统计
        const dimensionTrends = {};
        for (const entry of recent) {
          for (const dim of (entry.dimensions || [])) {
            if (!dimensionTrends[dim.dimension]) dimensionTrends[dim.dimension] = [];
            dimensionTrends[dim.dimension].push(dim.score);
          }
        }

        const dimensionAverages = {};
        for (const [dim, scores] of Object.entries(dimensionTrends)) {
          dimensionAverages[dim] = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
        }

        return {
          成功: true,
          数据: {
            totalChecks: recent.length,
            passRate: recent.length > 0 ? Math.round(passCount / recent.length * 100) : 0,
            passCount, failCount,
            avgScore,
            dimensionAverages,
            trend: recent.map(h => ({ time: h.timestamp, score: h.score, pass: h.pass })),
          }
        };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'quality_gate',
  description: '质量门禁技能 — 配置项目级门禁规则、检查门禁通过/阻断、跟踪历史趋势',
  abilities: ['质量门禁', '代码审查'],
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['check', 'config', 'history'],
        description: '操作类型：check(检查门禁) / config(获取/设置配置) / history(查看历史趋势)'
      },
      reviewResults: {
        type: 'array',
        description: '审查结果列表（check时使用）',
        items: {
          type: 'object',
          properties: {
            dimension: { type: 'string', description: '维度名' },
            score: { type: 'number', description: '分数(0-100)' },
            issues: { type: 'number', description: '问题数' },
            criticalIssues: { type: 'number', description: '严重问题数' }
          },
          required: ['dimension', 'score']
        }
      },
      passThreshold: { type: 'number', description: '通过阈值（覆盖配置，check时可选）' },
      blockOnCritical: { type: 'boolean', description: '有严重问题时阻断（覆盖配置，check时可选）' },
      set: { type: 'object', description: '要设置的配置项（config时使用）' },
      limit: { type: 'number', description: '历史条数（history时使用，默认20）' },
      cwd: { type: 'string', description: '工作目录' }
    },
    required: ['action']
  },
  execute
};
