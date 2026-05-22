/**
 * 自然语言查询构建技能
 * 将自然语言描述转为SQL/MongoDB/HTTP API查询
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('query_builder', { 前缀: '[query_builder]', 级别: 'debug', 显示调用位置: true });

async function execute(args, context) {
  const { action = 'build', description, sourceType = 'sql', tableHint, fields = [] } = args;

  logger.info(`执行: ${action}`);

  try {
    switch (action) {

      case 'build': {
        if (!description) return { 成功: false, 错误: '缺少必填参数: description' };

        let query;
        if (sourceType === 'sql') {
          query = {
            type: 'sql',
            description,
            hint: '请根据自然语言描述和实际表结构生成SQL查询',
            template: `SELECT ${fields.length > 0 ? fields.join(', ') : '*'} FROM ${tableHint || 'table_name'} WHERE 1=1 LIMIT 100;`
          };
        } else if (sourceType === 'mongodb') {
          query = {
            type: 'mongodb',
            description,
            hint: '请根据自然语言描述和实际集合结构生成MongoDB查询',
            template: `db.collection.find({}).limit(100);`
          };
        } else if (sourceType === 'http_api') {
          query = {
            type: 'http_api',
            description,
            hint: '请根据自然语言描述构建HTTP API请求',
            template: { method: 'GET', url: '/api/data', params: {} }
          };
        }

        return {
          成功: true,
          数据: query
        };
      }

      case 'validate': {
        const { query: queryStr, sourceType: qType = 'sql' } = args;
        if (!queryStr) return { 成功: false, 错误: '缺少必填参数: query' };

        const issues = [];

        if (qType === 'sql') {
          // 基本SQL安全检查
          const upper = queryStr.toUpperCase();
          if (upper.includes('DROP ') || upper.includes('DELETE ') || upper.includes('TRUNCATE ') || upper.includes('ALTER ')) {
            issues.push('检测到危险的SQL操作（DROP/DELETE/TRUNCATE/ALTER），数据查询应只读');
          }
          if (upper.includes('INSERT ') || upper.includes('UPDATE ')) {
            issues.push('检测到写入操作（INSERT/UPDATE），只读查询优先');
          }
          if (!upper.includes('SELECT')) {
            issues.push('SQL查询应以SELECT开头');
          }
        }

        return {
          成功: true,
          数据: {
            valid: issues.length === 0,
            issues,
            type: qType
          }
        };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}，支持: build / validate` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'query_builder',
  description: '自然语言查询构建技能 — 将自然语言描述转为SQL/MongoDB/HTTP API查询',
  abilities: ['数据分析', '数据查询'],

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['build', 'validate'],
        description: '操作类型：build=构建查询 / validate=验证查询安全性'
      },
      description: { type: 'string', description: '自然语言查询描述' },
      sourceType: { type: 'string', enum: ['sql', 'mongodb', 'http_api'], description: '数据源类型' },
      tableHint: { type: 'string', description: '表名提示' },
      fields: { type: 'array', items: { type: 'string' }, description: '关注字段' },
      query: { type: 'string', description: '查询语句（validate使用）' }
    },
    required: ['action']
  },

  execute
};
