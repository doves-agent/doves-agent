/**
 * 任务状态机模块
 * 职责：任务状态枚举、状态转换验证、任务文档标准化
 * 
 * 从 server/routes/task.js 拆分，遵循KISS原则
 */

import { ObjectId } from 'mongodb';
import { createTimestampFields } from '../../db.js';

/**
 * 任务状态枚举
 * 按顺序定义，便于校验状态转换的合法性
 */
export const 任务状态 = {
  PENDING: '等待中',       // 等待领取
  TOOL_FILTERING: '工具筛选中', // 工具筛选中（精选趁手工具，完成后转已就绪）
  READY: '已就绪',           // 已就绪，可被领取
  RUNNING: '执行中',       // 执行中（领取即执行）
  WAITING_CHILDREN: '等待子任务', // 等待子任务
  COMPLETED: '已完成',   // 已完成
  COMPLETED_WITH_ERRORS: '已完成(部分失败)', // 部分子任务失败
  FAILED: '失败',         // 已失败
  CANCELLED: '已取消',   // 已取消
  TERMINATED: '已终止', // 已终止
  BLOCKED: '阻塞中'        // 被阻塞
};

/**
 * 合法的状态转换表
 * key: 当前状态, value: 可转换到的状态列表
 */
const 状态转换表 = {
  [任务状态.PENDING]: [任务状态.CLAIMED, 任务状态.CANCELLED],
  [任务状态.CLAIMED]: [任务状态.EXECUTING, 任务状态.FAILED, 任务状态.CANCELLED],
  [任务状态.EXECUTING]: [任务状态.REPORTING, 任务状态.FAILED, 任务状态.CANCELLED],
  [任务状态.REPORTING]: [任务状态.VALIDATING, 任务状态.COMPLETED, 任务状态.FAILED],
  [任务状态.VALIDATING]: [任务状态.COMPLETED, 任务状态.FAILED],
  [任务状态.COMPLETED]: [],
  [任务状态.FAILED]: [],
  [任务状态.CANCELLED]: []
};

/**
 * 验证状态转换是否合法
 * @param {string} 当前状态
 * @param {string} 目标状态
 * @returns {boolean}
 */
export function 验证状态转换(当前状态, 目标状态) {
  const 允许的转换 = 状态转换表[当前状态];
  return 允许的转换 && 允许的转换.includes(目标状态);
}

/**
 * 标准化任务文档结构
 * 确保创建的任务包含所有协议定义的字段
 */
export function 标准化任务文档(任务) {
  const ts = createTimestampFields();
  return {
    任务ID: 任务.任务ID || new ObjectId().toString(),
    描述: 任务.描述 || '',
    状态: 任务.状态 || 任务状态.PENDING,
    阶段: 任务.阶段 || '等待中',
    
    // 关联信息
    对话ID: 任务.对话ID || null,
    根任务ID: 任务.根任务ID || null,
    父任务ID: 任务.父任务ID || null,
    用户ID: 任务.用户ID || null,
    
    // 子任务
    子任务列表: 任务.子任务列表 || [],
    子任务状态: 任务.子任务状态 || { 总数: 0, 已完成: 0, 已失败: 0 },
    
    // 执行者信息
    执行者: 任务.执行者 || null,
    执行提供商: 任务.执行提供商 || null,
    
    // 心跳和进度
    心跳时间: 任务.心跳时间 || null,
    进度: 任务.进度 || { 阶段: '', 百分比: 0, 消息: '' },
    
    // 结果
    流缓冲: 任务.流缓冲 || [],
    结果: 任务.结果 || null,
    错误: 任务.错误 || null,
    
    // routing 信息
    routing: 任务.routing || {},
    
    // 执行配置
    执行配置: 任务.执行配置 || null,
    
    // 时间戳
    创建时间: 任务.创建时间 || ts.localTime,
    创建时间戳: 任务.创建时间戳 || ts.timestamp,
    更新时间: ts.localTime,
    更新时间戳: ts.timestamp,
    完成时间: null,
    完成时间戳: null
  };
}
