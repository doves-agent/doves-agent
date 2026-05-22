/**
 * @file 智能体
 * @description 自主抢任务、执行、拆解的核心智能体
 * 
 * === KISS 执行模式（v3 默认） ===
 * 
 * deepseek-v4-pro 1M 上下文 + 单 LLM 循环 → 替代旧多层管道
 * 
 * 旧架构（已废弃）：
 *   意图识别 → 规划 → 审核 → Branch → 递归拆分
 *   └─ 多层 LLM 调用串行，错误累积，延迟叠加，token 浪费
 * 
 * 新架构（KISS）：
 *   build messages → callLLM(tools) → execute → repeat → submit
 *   └─ 单模型循环，按需加载能力分组，精简直达
 * 
 * === 鸽子实例说明 ===
 * 一个智能体实例 = 一个鸽子，一次只执行一个任务
 * 并发执行由入口层管理多个鸽子实例实现
 * 
 * 鸽子 ID 策略：
 * 1. 首次部署：生成唯一 ID 并注册到数据库
 * 2. 重启时：从数据库加载已有 ID，保持身份一致
 * 3. 身份持久化：支持崩溃恢复、状态追踪
 * 
 * === 模块拆分 ===
 * 本文件已按 KISS 原则拆分为以下模块：
 * - 智能体-KISS执行器.js: ★ KISS 单循环执行核心（v3 默认）
 * - 智能体-任务执行器.js: 基础任务执行 + KISS 模式调度
 */

import { 任务队列 } from './任务队列.js';
import { 监工 } from './监工.js';
import { 任务状态, 任务类型, 默认模型配置, DEFAULT_PROVIDER } from './常量.js';
import { 模型选择器, Token统计器 } from './providers/index.js';
import { 技能管理器 } from './skills/index.js';
import { 存储接口 } from './tools/存储接口.js';
import { BranchTools, ConversationTools } from './tools/index.js';
import { getTimestamp, createTimestampFields, toLocalISOString } from '@dove/common/时间工具.js';
import { ObjectId } from '@dove/common/对象标识.js';
import { KeyManager, LLMCaller } from './llm/index.js';
import { getSkillIndex } from './技能索引.js';
import { DovesProxy } from './doves_proxy/index.js';
import { MCP配置管理器 } from './MCP配置管理器.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('智能体', { 前缀: '[智能体]', 级别: 'debug', 显示调用位置: true });
import { ExtensionLoader } from './extensions/_loader.js';

// 导入执行器模块
import { 任务执行器 } from './智能体-任务执行器.js';
import { 轨迹写入器 } from './轨迹写入器.js';
import { mixin任务调度 } from './智能体/任务调度.js';
import { mixin上下文管理 } from './智能体/上下文管理.js';
import { mixin执行协调 } from './智能体/执行协调.js';

/**
 * 智能体类 - 鸽子核心
 * 一个鸽子一次只执行一个任务
 * 
 * 鸽子 ID 策略：
 * 1. 首次部署：生成唯一 ID 并注册到数据库
 * 2. 重启时：从数据库加载已有 ID，保持身份一致
 * 3. 身份持久化：支持崩溃恢复、状态追踪
 */
export class 智能体 {
  constructor(配置 = {}) {
    const _t0 = Date.now();
    // ID 不再立即生成，而是在初始化时从数据库加载或创建
    this.ID = null;  // 初始化时设置
    this.实例标识 = 配置.实例标识 || null;  // 用于查找已有身份
    this.名称 = 配置.名称 || '未命名鸽子';
    this.状态 = '在线';  // 在线/忙碌/离线
    this.能力列表 = [];
    this.当前任务 = null;  // 一次只处理一个任务
    this.任务队列 = null;
    this.监工 = null;
    this.运行中 = false;
    
    // 中断控制器：停止时通过 AbortController 中断正在执行的 LLM 调用
    this.abortController = null;  // 每次执行任务时创建新的
    this.停止超时 = 配置.停止超时 || 10000;  // 停止超时 10 秒，超时后强制退出循环
    this.数据库名 = process.env.MONGODB_USER_DB || 'doves_user_data';  // 使用用户数据库
    // 机器标识：用于本地亲和调度（"帮我关机"只派给本机鸽子）
    this.machineId = 配置.machineId || process.env.MACHINE_ID || null;
    this.实例完整标识 = 配置.实例完整标识 || null;
    this.管理数据库名 = process.env.MONGODB_ADMIN_DB || 'doves_admin';
    this.用户数据库名 = process.env.MONGODB_USER_DB || 'doves_user_data';
    this.最大并发数 = parseInt(process.env.MAX_CONCURRENCY) || 配置.最大并发数 || 5;  // 子任务级并发上限
    this.抢任务阈值 = 配置.抢任务阈值 ?? 0.5;  // 低于此阈值不抢任务
    this.KISS执行模式 = 配置.KISS执行模式 ?? true;  // ★ v3 默认 KISS 单循环
    
    // ==================== 进程级共享资源（由鸽群管理器注入） ====================
    // 这些资源在同一进程内所有鸽子间共享，避免重复创建
    this.DovesProxy = 配置.共享DovesProxy || null;
    this.能力管理器 = 配置.共享能力管理器 || null;
    this.技能管理器 = 配置.共享技能管理器 || null;
    this.模型选择器 = 配置.共享模型选择器 || null;
    this.keyManager = 配置.共享KeyManager || null;
    this.llmCaller = 配置.共享LLMCaller || null;
    this.系统配置 = 配置.共享系统配置 || null;
    this.skillIndex = 配置.共享技能索引 || null;
    this.扩展加载器 = 配置.共享扩展加载器 || null;
    
    // ==================== 鸽子级独占资源（每鸽子 1 份） ====================
    this.Token统计 = new Token统计器();
    this.默认模型 = process.env.DEFAULT_MODEL || 默认模型配置.推理模型.model;
    this.快速模型 = process.env.FAST_MODEL || 默认模型配置.快速模型.model;  // FLASH路由模型
    this.视觉模型 = process.env.VISION_MODEL || 默认模型配置.视觉模型.model;  // 视觉模型（GUI截图验证等）
    this.默认提供商 = DEFAULT_PROVIDER;  // 从默认模型配置派生
    // 按角色提供商：每个角色从 默认模型配置 读取对应 provider，不再统一走百炼
    this.推理提供商 = 默认模型配置.推理模型.provider;
    this.快速提供商 = 默认模型配置.快速模型.provider;
    this.视觉提供商 = 默认模型配置.视觉模型.provider;
    // 废弃字段已移除：意图提供商、规划提供商（KISS 模式只用推理模型）
    
    // 没有注入共享模型选择器，创建独占实例
    if (!this.模型选择器) {
      this.模型选择器 = new 模型选择器();
    }
    // 没有注入共享技能管理器，创建独占实例
    if (!this.技能管理器) {
      this.技能管理器 = new 技能管理器();
    }
    
    // 存储接口
    this.存储接口 = null;  // 初始化后设置
    
    // 对话分支工具
    this.branchTools = null;  // 初始化后设置
    this.conversationTools = null;  // 初始化后设置
    
    // 执行器模块（初始化后设置）
    this.task执行器 = null;      // 任务执行器（含 KISS 调度）
    
    // 轨迹写入器（初始化后设置）
    this.轨迹写入器 = null;
    
    // 保存配置，用于后续初始化
    this.配置 = 配置;
    
    // 混入子模块方法
    mixin任务调度(this);
    mixin上下文管理(this);
    mixin执行协调(this);

    logger.debug(`→ 构造完成: 名称=${this.名称}, 最大并发=${this.最大并发数}, 抢任务阈值=${this.抢任务阈值}, 共享资源=${!!配置.共享DovesProxy} (${Date.now() - _t0}ms)`);
  }
}

export default 智能体;
