/**
 * 审计回顾工具 - 扩展包版本
 * 6个工具：audit_conversation_list / audit_conversation_detail / audit_task_detail / audit_task_trace / audit_dove_activity / audit_usage_stats
 *
 * 设计原则：
 * - 只能查自己的数据（userId 隔离）
 * - 只读，不写入任何数据
 * - 自动截断大文本，防止响应过大
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('审计工具', { 前缀: '[审计工具]', 级别: 'debug', 显示调用位置: true });

/** 截断阈值 */
const MAX_TEXT = 500;
const MAX_ARRAY = 20;

function 截断(str, max = MAX_TEXT) {
  if (!str || typeof str !== 'string') return str;
  return str.length > max ? str.substring(0, max) + '...' : str;
}

function 截断数组(arr, max = MAX_ARRAY) {
  if (!Array.isArray(arr)) return arr;
  return arr.length > max ? [...arr.slice(0, max), `... (共${arr.length}项，已截断)`] : arr;
}

/**
 * 获取用户数据库连接
 * 工具通过 setAuditDb 注入数据库连接
 */
let _db = null;
let _用户数据库名 = 'doves_user_data';

export function setAuditDb(dbConnection, 用户数据库名) {
  _db = dbConnection;
  _用户数据库名 = 用户数据库名 || 'doves_user_data';
}

function getUserDb() {
  if (!_db) return null;
  return _db.db(_用户数据库名);
}

// ==================== 工具1: audit_conversation_list ====================

async function handle_conversation_list(params) {
  const { keyword, limit = 20, offset = 0, startTime, endTime } = params;
  const db = getUserDb();
  if (!db) return { content: [{ type: 'text', text: '数据库未连接' }], isError: true };

  const query = {};
  if (keyword) {
    query.$or = [
      { 标题: { $regex: keyword, $options: 'i' } },
    ];
  }
  if (startTime || endTime) {
    query.创建时间戳 = {};
    if (startTime) query.创建时间戳.$gte = new Date(startTime).getTime();
    if (endTime) query.创建时间戳.$lte = new Date(endTime).getTime();
  }

  try {
    const conversations = await db.collection('对话')
      .find(query)
      .sort({ 更新时间戳: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    const result = conversations.map(c => ({
      对话ID: c.对话ID,
      标题: c.标题,
      轮次数: c.对话轮次?.length || 0,
      来源: c.来源 || 'cli',
      创建时间: c.创建时间,
      更新时间: c.更新时间,
    }));

    const total = await db.collection('对话').countDocuments(query);

    return {
      content: [{ type: 'text', text: JSON.stringify({ total, 列表: result }, null, 2) }],
    };
  } catch (e) {
    logger.error('查询对话列表失败:', e.message);
    return { content: [{ type: 'text', text: `查询失败: ${e.message}` }], isError: true };
  }
}

// ==================== 工具2: audit_conversation_detail ====================

async function handle_conversation_detail(params) {
  const { conversationId } = params;
  const db = getUserDb();
  if (!db) return { content: [{ type: 'text', text: '数据库未连接' }], isError: true };

  try {
    const conv = await db.collection('对话').findOne({ 对话ID: conversationId });
    if (!conv) {
      return { content: [{ type: 'text', text: `对话 ${conversationId} 不存在` }], isError: true };
    }

    const turns = (conv.对话轮次 || []).map(t => ({
      轮次ID: t.轮次ID,
      用户消息: 截断(t.用户消息, 200),
      attachments: t.attachments?.length || 0,
      routing: t.routing ? {
        分类: t.routing.分类,
        策略: t.routing.策略,
        执行模式: t.routing.执行模式,
        复杂度: t.routing.复杂度,
        压缩上下文: 截断(t.routing.压缩上下文, 200),
        机器亲和: t.routing.机器亲和,
        可闪回: t.routing.可闪回,
      } : null,
      flashResponse: t.flashResponse ? 截断(t.flashResponse.content, 200) : null,
      分支任务ID: t.分支任务ID,
      分支摘要: 截断(t.分支摘要, 300),
      创建时间: t.创建时间,
    }));

    return {
      content: [{ type: 'text', text: JSON.stringify({
        对话ID: conv.对话ID,
        标题: conv.标题,
        来源: conv.来源,
        创建时间: conv.创建时间,
        更新时间: conv.更新时间,
        轮次详情: turns,
      }, null, 2) }],
    };
  } catch (e) {
    logger.error('查询对话详情失败:', e.message);
    return { content: [{ type: 'text', text: `查询失败: ${e.message}` }], isError: true };
  }
}

// ==================== 工具3: audit_task_detail ====================

async function handle_task_detail(params) {
  const { taskId, includeChildren = true } = params;
  const db = getUserDb();
  if (!db) return { content: [{ type: 'text', text: '数据库未连接' }], isError: true };

  try {
    const task = await db.collection('任务').findOne({ 任务ID: taskId });
    if (!task) {
      return { content: [{ type: 'text', text: `任务 ${taskId} 不存在` }], isError: true };
    }

    const result = {
      任务ID: task.任务ID,
      类型: task.类型,
      状态: task.状态,
      描述: 截断(task.描述, 300),
      用户ID: task.用户ID,
      对话ID: task.对话ID,
      父任务ID: task.父任务ID,
      根任务ID: task.根任务ID,
      执行者: task.执行者,
      执行模型: task.执行模型,
      来源: task.来源,
      技能: task.技能,
      role: task.role,
      能力需求: task.能力需求,
      压缩上下文: 截断(task.压缩上下文, 300),
      routing: task.routing ? {
        分类: task.routing.分类,
        策略: task.routing.策略,
        执行模式: task.routing.执行模式,
        复杂度: task.routing.复杂度,
        压缩上下文: 截断(task.routing.压缩上下文, 300),
        机器亲和: task.routing.机器亲和,
        工具指引: 截断(task.routing.工具指引, 200),
      } : null,
      执行配置: task.执行配置 ? {
        名称: task.执行配置.名称,
        执行约束: task.执行配置.执行约束,
      } : null,
      创建时间: task.创建时间,
      完成时间: task.完成时间,
      结果: 截断(typeof task.结果 === 'string' ? task.结果 : JSON.stringify(task.结果), 500),
      错误: 截断(task.错误, 300),
      子任务列表: task.子任务列表,
      子任务状态: task.子任务状态,
    };

    // 查询子任务
    if (includeChildren && task.子任务列表?.length > 0) {
      const children = await db.collection('任务')
        .find({ 任务ID: { $in: task.子任务列表 } })
        .toArray();
      result.子任务详情 = children.map(c => ({
        任务ID: c.任务ID,
        技能: c.技能,
        状态: c.状态,
        描述: 截断(c.描述, 200),
        执行者: c.执行者,
        结果: 截断(typeof c.结果 === 'string' ? c.结果 : JSON.stringify(c.结果), 300),
        错误: 截断(c.错误, 200),
      }));
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (e) {
    logger.error('查询任务详情失败:', e.message);
    return { content: [{ type: 'text', text: `查询失败: ${e.message}` }], isError: true };
  }
}

// ==================== 工具4: audit_task_trace ====================

async function handle_task_trace(params) {
  const { taskId } = params;
  const db = getUserDb();
  if (!db) return { content: [{ type: 'text', text: '数据库未连接' }], isError: true };

  try {
    // 查轨迹文档（按根任务ID查）
    const traceDoc = await db.collection('轨迹').findOne({ 根任务ID: taskId });

    if (!traceDoc) {
      return { content: [{ type: 'text', text: `任务 ${taskId} 无轨迹数据` }], isError: true };
    }

    // 构建轨迹树
    const nodes = (traceDoc.轨迹节点 || []).map(n => ({
      轨迹ID: n.轨迹ID,
      类型: n.类型,
      名称: 截断(n.名称, 100),
      父轨迹ID: n.父轨迹ID,
      状态: n.状态,
      序号: n.序号,
      开始时间: n.开始时间,
      结束时间: n.结束时间,
      耗时: n.耗时,
      输入: n.输入,
      输出: n.输出,
      错误: 截断(n.错误, 300),
      元数据: n.元数据,
    }));

    return {
      content: [{ type: 'text', text: JSON.stringify({
        根任务ID: traceDoc.根任务ID,
        用户ID: traceDoc.用户ID,
        创建时间: traceDoc.创建时间,
        轨迹节点数: nodes.length,
        轨迹节点: 截断数组(nodes, 50),
      }, null, 2) }],
    };
  } catch (e) {
    logger.error('查询任务轨迹失败:', e.message);
    return { content: [{ type: 'text', text: `查询失败: ${e.message}` }], isError: true };
  }
}

// ==================== 工具5: audit_dove_activity ====================

async function handle_dove_activity(params) {
  const { taskId, limit = 50 } = params;
  const db = getUserDb();
  if (!db) return { content: [{ type: 'text', text: '数据库未连接' }], isError: true };

  try {
    const query = {};
    if (taskId) query.根任务ID = taskId;

    // 按执行者统计任务
    const pipeline = [
      { $match: { 执行者: { $ne: null }, ...query } },
      { $group: {
        _id: '$执行者',
        总任务数: { $sum: 1 },
        成功数: { $sum: { $cond: [{ $eq: ['$状态', '已完成'] }, 1, 0] } },
        失败数: { $sum: { $cond: [{ $eq: ['$状态', '失败'] }, 1, 0] } },
        最近执行时间: { $max: '$完成时间' },
      }},
      { $sort: { 总任务数: -1 } },
      { $limit: limit },
    ];

    const doveStats = await db.collection('任务').aggregate(pipeline).toArray();

    // 查询最近的鸽子活动
    const recentTasks = await db.collection('任务')
      .find({ 执行者: { $ne: null }, ...query })
      .sort({ 创建时间戳: -1 })
      .limit(20)
      .toArray();

    const recentActivity = recentTasks.map(t => ({
      任务ID: t.任务ID,
      类型: t.类型,
      技能: t.技能,
      状态: t.状态,
      执行者: t.执行者,
      执行模型: t.执行模型,
      描述: 截断(t.描述, 100),
      创建时间: t.创建时间,
      完成时间: t.完成时间,
    }));

    return {
      content: [{ type: 'text', text: JSON.stringify({
        鸽子统计: doveStats.map(d => ({
          鸽子ID: d._id,
          总任务数: d.总任务数,
          成功数: d.成功数,
          失败数: d.失败数,
          成功率: d.总任务数 > 0 ? `${(d.成功数 / d.总任务数 * 100).toFixed(1)}%` : 'N/A',
          最近执行时间: d.最近执行时间,
        })),
        最近活动: recentActivity,
      }, null, 2) }],
    };
  } catch (e) {
    logger.error('查询鸽子活动失败:', e.message);
    return { content: [{ type: 'text', text: `查询失败: ${e.message}` }], isError: true };
  }
}

// ==================== 工具6: audit_usage_stats ====================

async function handle_usage_stats(params) {
  const { startTime, endTime, groupBy = 'day' } = params;
  const db = getUserDb();
  if (!db) return { content: [{ type: 'text', text: '数据库未连接' }], isError: true };

  try {
    const timeQuery = {};
    if (startTime || endTime) {
      timeQuery.创建时间戳 = {};
      if (startTime) timeQuery.创建时间戳.$gte = new Date(startTime).getTime();
      if (endTime) timeQuery.创建时间戳.$lte = new Date(endTime).getTime();
    }

    // 任务统计
    const taskCount = await db.collection('任务').countDocuments(timeQuery);
    const taskByStatus = await db.collection('任务').aggregate([
      { $match: timeQuery },
      { $group: { _id: '$状态', count: { $sum: 1 } } },
    ]).toArray();

    // 对话统计
    const convCount = await db.collection('对话').countDocuments(timeQuery);
    const convWithTurns = await db.collection('对话').aggregate([
      { $match: timeQuery },
      { $project: { 轮次数: { $size: { $ifNull: ['$对话轮次', []] } } } },
      { $group: { _id: null, 总轮次: { $sum: '$轮次数' }, 平均轮次: { $avg: '$轮次数' } } },
    ]).toArray();

    // 技能使用统计
    const skillStats = await db.collection('任务').aggregate([
      { $match: { 技能: { $ne: null }, ...timeQuery } },
      { $group: { _id: '$技能', count: { $sum: 1 }, 成功: { $sum: { $cond: [{ $eq: ['$状态', '已完成'] }, 1, 0] } } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]).toArray();

    // 模型使用统计
    const modelStats = await db.collection('任务').aggregate([
      { $match: { 执行模型: { $ne: null }, ...timeQuery } },
      { $group: { _id: '$执行模型', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray();

    // 按时间分组统计
    let dateFormat;
    if (groupBy === 'hour') dateFormat = '%Y-%m-%d %H:00';
    else if (groupBy === 'month') dateFormat = '%Y-%m';
    else dateFormat = '%Y-%m-%d';

    const timeSeriesStats = await db.collection('任务').aggregate([
      { $match: timeQuery },
      { $group: {
        _id: { $dateToString: { format: dateFormat, date: { $toDate: { $toLong: '$创建时间戳' } } } },
        任务数: { $sum: 1 },
        成功数: { $sum: { $cond: [{ $eq: ['$状态', '已完成'] }, 1, 0] } },
      }},
      { $sort: { _id: 1 } },
      { $limit: 30 },
    ]).toArray();

    return {
      content: [{ type: 'text', text: JSON.stringify({
        总任务数: taskCount,
        任务状态分布: taskByStatus.map(s => ({ 状态: s._id, 数量: s.count })),
        对话数: convCount,
        对话轮次: convWithTurns[0] ? { 总轮次: convWithTurns[0].总轮次, 平均轮次: convWithTurns[0].平均轮次?.toFixed(1) } : null,
        技能使用TOP20: skillStats.map(s => ({ 技能: s._id, 使用次数: s.count, 成功次数: s.成功, 成功率: s.count > 0 ? `${(s.成功 / s.count * 100).toFixed(0)}%` : 'N/A' })),
        模型使用TOP10: modelStats.map(m => ({ 模型: m._id, 使用次数: m.count })),
        时间趋势: timeSeriesStats.map(t => ({ 时间: t._id, 任务数: t.任务数, 成功数: t.成功数 })),
      }, null, 2) }],
    };
  } catch (e) {
    logger.error('查询使用统计失败:', e.message);
    return { content: [{ type: 'text', text: `查询失败: ${e.message}` }], isError: true };
  }
}

// ==================== 工具注册表 ====================

export const extTools = [
  {
    name: 'audit_conversation_list',
    description: '查询对话列表。支持按关键词、时间范围过滤，返回对话ID、标题、轮次数等摘要信息。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词（匹配标题）' },
        limit: { type: 'number', description: '返回数量（默认20）' },
        offset: { type: 'number', description: '偏移量（默认0）' },
        startTime: { type: 'string', description: '开始时间（ISO格式）' },
        endTime: { type: 'string', description: '结束时间（ISO格式）' },
      },
    },
  },
  {
    name: 'audit_conversation_detail',
    description: '查询对话详情，包含每轮的用户消息、routing决策（意图/策略/压缩上下文）、分支摘要、Flash回复等完整信息。',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string', description: '对话ID（必填）' },
      },
      required: ['conversationId'],
    },
  },
  {
    name: 'audit_task_detail',
    description: '查询任务详情，包含类型/状态/执行者/模型/routing决策/子任务树/执行结果等。可查看任务的完整生命周期。',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID（必填）' },
        includeChildren: { type: 'boolean', description: '是否包含子任务详情（默认true）' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'audit_task_trace',
    description: '查询任务执行轨迹，包含routing决策、LLM调用、工具调用、token消耗等全链路追踪信息。类似区块链的交易回执。',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID（必填，会自动按根任务ID查找轨迹）' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'audit_dove_activity',
    description: '查询鸽子活动记录，包含哪只鸽子执行了什么任务、成功/失败率统计、最近活动列表。',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '按任务ID过滤' },
        limit: { type: 'number', description: '返回数量（默认50）' },
      },
    },
  },
  {
    name: 'audit_usage_stats',
    description: '查询使用统计，包含任务数、对话数、技能使用排行、模型使用排行、时间趋势等。',
    inputSchema: {
      type: 'object',
      properties: {
        startTime: { type: 'string', description: '开始时间（ISO格式）' },
        endTime: { type: 'string', description: '结束时间（ISO格式）' },
        groupBy: { type: 'string', enum: ['hour', 'day', 'month'], description: '时间分组粒度（默认day）' },
      },
    },
  },
];

// 能力映射
const _abilityMap = {
  audit_conversation_list: ['审计', '对话查询'],
  audit_conversation_detail: ['审计', '对话查询'],
  audit_task_detail: ['审计', '任务查询'],
  audit_task_trace: ['审计', '轨迹查询'],
  audit_dove_activity: ['审计', '鸽子活动'],
  audit_usage_stats: ['审计', '使用统计'],
};

function text(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

// ==================== 统一工具路由器 ====================

/**
 * 统一工具调用入口（供扩展加载器注册）
 * @param {string} name - 工具名
 * @param {Object} args - 工具参数
 * @param {Object} context - 执行上下文（含 userId, db 等）
 */
export async function handleExtTool(name, args, context) {
  // 注入数据库连接（如果尚未注入且上下文中有db）
  if (!_db && context?.db) {
    _db = context.db;
  }

  const handlerMap = {
    audit_conversation_list: handle_conversation_list,
    audit_conversation_detail: handle_conversation_detail,
    audit_task_detail: handle_task_detail,
    audit_task_trace: handle_task_trace,
    audit_dove_activity: handle_dove_activity,
    audit_usage_stats: handle_usage_stats,
  };

  const handler = handlerMap[name];
  if (!handler) {
    return { content: [{ type: 'text', text: `未知审计工具: ${name}` }], isError: true };
  }

  try {
    return await handler(args, context);
  } catch (e) {
    logger.error(`工具 ${name} 执行失败:`, e.message);
    return { content: [{ type: 'text', text: `工具执行失败: ${e.message}` }], isError: true };
  }
}

export const extToolAbilityMap = _abilityMap;

export const extToolSafetyLevels = {
  audit_conversation_list: '谨慎',
  audit_conversation_detail: '谨慎',
  audit_task_detail: '谨慎',
  audit_task_trace: '谨慎',
  audit_dove_activity: '谨慎',
  audit_usage_stats: '谨慎',
};
