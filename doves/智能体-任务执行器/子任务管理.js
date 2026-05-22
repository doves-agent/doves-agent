/**
 * @file 子任务管理
 * @description 任务执行器的子任务管理模块
 * 
 * 包含：拆解任务、创建子任务、等待子任务完成、汇总子任务结果、取消任务
 */

import { 任务状态 } from '../常量.js';
import { createTimestampFields } from '@dove/common/时间工具.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('任务执行-子任务', { 前缀: '[任务执行/子任务]', 级别: 'debug', 显示调用位置: true });

/**
 * 拆解任务为子任务
 * @param {Object} 执行器 - 任务执行器实例
 * @param {Object} 任务 - 父任务
 * @returns {Array} 子任务列表
 */
export async function 拆解任务(执行器, 任务) {
  const _t0 = Date.now();
  logger.info(`→ 拆解任务: ${任务?.任务ID || 任务?.id || '未知'}`);

  // 调用规划器进行任务规划
  const 规划结果 = await 执行器.智能体.规划器.规划(任务, { 能力列表: 执行器.智能体.能力列表, 压缩上下文: 任务.routing?.压缩上下文 || 任务.压缩上下文 || null });

  // 调用审核器审核规划
  const 审核结果 = await 执行器.智能体.审核器.审核(规划结果, 任务);

  if (!审核结果.通过) {
    logger.info(`规划审核未通过: ${审核结果.问题列表}`);
    // 如果有修改后的规划，使用它
    if (审核结果.修改后的规划) {
      规划结果.子任务列表 = 审核结果.修改后的规划;
    } else {
      return [];
    }
  }

  // 创建子任务
  const 子任务列表 = await 创建子任务(执行器, 任务, 规划结果.子任务列表);

  logger.debug(`← 拆解任务完成: 子任务=${子任务列表?.length || 0}个 (${Date.now() - _t0}ms)`);
  return 子任务列表;
}

/**
 * 创建子任务（拆解后的任务）
 * 创建后自动更新父任务：状态→waiting_children，children 字段→子任务ID列表
 * @param {Object} 执行器 - 任务执行器实例
 * @param {Object} 父任务 - 父任务
 * @param {Array} 子任务描述列表 - 子任务描述列表
 * @returns {Array} 创建的子任务列表
 */
export async function 创建子任务(执行器, 父任务, 子任务描述列表) {
  const _t0 = Date.now();
  const 父任务ID = 父任务.任务ID || 父任务.id;
  logger.info(`→ 创建子任务: 父=${父任务ID}, 数量=${子任务描述列表.length}`);

  // 批量创建子任务
  const 子任务列表 = await 执行器.智能体.任务队列.批量创建子任务(
    父任务ID,
    子任务描述列表,
    父任务.根任务ID || 父任务.rootTaskId || 父任务ID
  );

  // 更新父任务状态为 waiting_children 并记录 children 字段
  await 执行器.智能体.任务队列.更新状态(父任务ID, 任务状态.WAITING_CHILDREN, {
    children: 子任务列表.map(t => t.任务ID || t.ID)
  });

  logger.info(`← 创建子任务完成: ${子任务列表.length}个 (${Date.now() - _t0}ms)`);
  return 子任务列表;
}

/**
 * 等待子任务完成（主任务进入等待状态）
 * @param {Object} 执行器 - 任务执行器实例
 * @param {Object} 父任务 - 父任务
 * @returns {Object} 子任务执行结果汇总
 */
export async function 等待子任务完成(执行器, 父任务) {
  const 父任务ID = 父任务.任务ID || 父任务.id;
  logger.debug(`等待子任务完成，父任务: ${父任务ID}`);

  // 保存断点到任务检查点（整合到任务对象）
  const waitTs = createTimestampFields();
  await 执行器.智能体.任务队列.保存检查点(父任务ID, {
    鸽子ID: 执行器.智能体.ID,
    任务: 父任务,
    状态: '等待子任务',
    开始等待时间: waitTs.localTime,
    开始等待时间戳: waitTs.timestamp
  });

  // 更新父任务状态为 waiting_children
  await 执行器.智能体.任务队列.更新状态(父任务ID, 任务状态.WAITING_CHILDREN);

  // 更新鸽子身份状态（管理库）
  await 执行器.智能体.更新鸽子身份状态('等待子任务', 父任务ID);

  // 等待子任务全部完成
  await 执行器.智能体.任务队列.等待子任务(父任务ID);

  // 汇总子任务结果
  const 汇总结果 = await 汇总子任务结果(执行器, 父任务);

  return 汇总结果;
}

/**
 * 查询子任务状态（只读查询）
 * @param {Object} 执行器 - 任务执行器实例
 * @param {Object} 父任务 - 父任务
 * @returns {Object} 子任务状态汇总
 */
export async function 查询子任务状态(执行器, 父任务) {
  // 实时从 MongoDB 查询子任务状态
  return await 执行器.智能体.任务队列.查询子任务状态(父任务.任务ID || 父任务.id);
}

/**
 * 汇总子任务结果
 * @param {Object} 执行器 - 任务执行器实例
 * @param {Object} 父任务 - 父任务
 * @returns {Object} 汇总结果
 */
export async function 汇总子任务结果(执行器, 父任务) {
  const _t0 = Date.now();
  const 父任务ID = 父任务.任务ID || 父任务.id;
  logger.debug(`→ 汇总子任务结果: 父=${父任务ID}`);
  
  // 获取子任务状态
  const 状态 = await 执行器.智能体.任务队列.查询子任务状态(父任务ID);
  const { 子任务列表, 完成数, 失败数, 总数 } = 状态;
  
  // 分类结果
  const 成功结果 = [];
  const 失败结果 = [];
  const 所有结果 = [];
  
  // 遍历子任务，提取结果
  for (const 子任务 of 子任务列表) {
    const 子任务状态 = 子任务.状态;
    const 结果摘要 = {
      id: 子任务.任务ID || 子任务.id,
      描述: 子任务.描述 || 子任务.description || '无描述',
      状态: 子任务状态,
      结果: 子任务.result || 子任务.结果
    };
    
    所有结果.push(结果摘要);
    
    if (子任务状态 === 任务状态.COMPLETED) {
      成功结果.push(结果摘要);
    } else if (子任务状态 === 任务状态.FAILED) {
      失败结果.push({
        ...结果摘要,
        错误: 子任务.error || 子任务.结果?.错误 || '未知错误'
      });
    }
  }
  
  // 生成汇总报告
  const 汇总报告 = _生成汇总报告({
    父任务,
    总数,
    完成数,
    失败数,
    成功结果,
    失败结果
  });
  
  // 合并结果数据
  const 合并数据 = _合并子任务数据(成功结果);
  
  // 构建最终结果
  const 最终结果 = {
    成功: 失败数 === 0,
    数据: {
      总数,
      完成数,
      失败数,
      成功率: 总数 > 0 ? Math.round(完成数 / 总数 * 100) + '%' : '0%',
      子任务结果: 所有结果,
      合并数据,
      汇总报告
    }
  };
  
  // 写入父任务结果
  await 执行器.智能体.任务队列.写入结果(父任务ID, 最终结果);
  
  // 更新父任务状态
  if (失败数 === 0) {
    await 执行器.智能体.任务队列.更新状态(父任务ID, 任务状态.COMPLETED, {
      childrenStatus: { total: 总数, completed: 完成数, failed: 失败数 }
    });
  } else {
    await 执行器.智能体.任务队列.更新状态(父任务ID, 任务状态.FAILED, {
      childrenStatus: { total: 总数, completed: 完成数, failed: 失败数 },
      error: `${失败数} 个子任务执行失败`
    });
  }
  
  // 清理状态
  执行器.智能体.当前任务 = null;
  await 执行器.智能体.切换状态('在线');
  
  logger.info(`← 汇总完成: 成功=${失败数 === 0}, 完成=${完成数}/${总数} (${Date.now() - _t0}ms)`);
  return 最终结果;
}

/**
 * 取消任务
 * @param {Object} 执行器 - 任务执行器实例
 * @param {string} 任务ID - 任务ID
 * @param {string} 原因 - 取消原因
 */
export async function 取消任务(执行器, 任务ID, 原因 = '') {
  logger.info(`取消任务 ${任务ID}: ${原因}`);

  // 通过任务队列取消任务
  await 执行器.智能体.任务队列.取消任务(任务ID, 执行器.智能体.ID, 原因);

  // 取消所有子任务
  await 取消所有子任务(执行器, 任务ID);

  // 清理当前状态
  if (执行器.智能体.当前任务 && (执行器.智能体.当前任务.任务ID || 执行器.智能体.当前任务.id) === 任务ID) {
    执行器.智能体.当前任务 = null;
    await 执行器.智能体.切换状态('在线');
  }
}

/**
 * 取消所有子任务
 * @param {Object} 执行器 - 任务执行器实例
 * @param {string} 父任务ID - 父任务ID
 */
export async function 取消所有子任务(执行器, 父任务ID) {
  logger.info(`取消任务 ${父任务ID} 的所有子任务`);

  // 获取子任务列表
  const 子任务列表 = await 执行器.智能体.任务队列.获取子任务(父任务ID);

  // 逐个取消子任务
  for (const 子任务 of 子任务列表) {
    const subTaskStatus = 子任务.状态;
    if (subTaskStatus === 任务状态.PENDING || subTaskStatus === 任务状态.READY || subTaskStatus === 任务状态.RUNNING) {
      await 执行器.智能体.任务队列.取消任务(子任务.任务ID, 执行器.智能体.ID, '父任务已取消');
    }
  }
}

// ==================== 私有辅助函数 ====================

/**
 * 生成汇总报告
 * @private
 */
function _生成汇总报告({ 父任务, 总数, 完成数, 失败数, 成功结果, 失败结果 }) {
  const lines = [];
  lines.push(`# 任务执行报告`);
  lines.push(``);
  lines.push(`**任务ID**: ${父任务.任务ID || 父任务.id}`);
  lines.push(`**描述**: ${父任务.描述 || 父任务.description || '无描述'}`);
  lines.push(``);
  lines.push(`## 执行统计`);
  lines.push(`- 总任务数: ${总数}`);
  lines.push(`- 成功: ${完成数}`);
  lines.push(`- 失败: ${失败数}`);
  lines.push(`- 成功率: ${总数 > 0 ? Math.round(完成数 / 总数 * 100) + '%' : '0%'}`);
  
  if (成功结果.length > 0) {
    lines.push(``);
    lines.push(`## 成功的任务`);
    成功结果.forEach((结果, 索引) => {
      lines.push(`${索引 + 1}. ${结果.描述}`);
    });
  }
  
  if (失败结果.length > 0) {
    lines.push(``);
    lines.push(`## 失败的任务`);
    失败结果.forEach((结果, 索引) => {
      lines.push(`${索引 + 1}. ${结果.描述}`);
      lines.push(`   错误: ${结果.错误}`);
    });
  }
  
  return lines.join('\n');
}

/**
 * 合并子任务数据
 * @private
 */
function _合并子任务数据(成功结果) {
  const 合并数据 = {};
  
  for (const 结果 of 成功结果) {
    if (!结果.结果) continue;
    
    // 处理标准格式的结果
    const 数据 = 结果.结果.数据 || 结果.结果.data || 结果.结果;
    
    if (typeof 数据 === 'object') {
      // 合并对象数据
      for (const [key, value] of Object.entries(数据)) {
        if (合并数据[key] === undefined) {
          合并数据[key] = value;
        } else if (Array.isArray(合并数据[key]) && Array.isArray(value)) {
          // 数组类型：合并
          合并数据[key] = [...合并数据[key], ...value];
        } else if (typeof 合并数据[key] === 'object' && typeof value === 'object') {
          // 对象类型：深度合并
          合并数据[key] = { ...合并数据[key], ...value };
        } else {
          // 其他类型：转为数组
          合并数据[key] = [合并数据[key], value];
        }
      }
    }
  }
  
  return 合并数据;
}
