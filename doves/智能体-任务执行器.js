/**
 * @file 智能体-任务执行器
 * @description 负责基础任务执行、子任务管理
 * 
 * 拆分结构：
 * - 智能体-任务执行器.js: 任务执行器类核心
 * - 智能体-任务执行器/特殊任务执行.js: 事件LLM判断/扩展工具/MCP运维/技能任务
 * - 智能体-任务执行器/子任务管理.js: 拆解/创建/等待/汇总/取消子任务
 * 
 * === 监工体系说明 ===
 * 不再使用超时续期机制，改为监工扫描执行轨迹+结构化轮次总结的方式监控。
 * 鸽子执行任务不再有超时限制，由监工通过轨迹分析判断是否该终止。
 */

import { 任务状态 } from './常量.js';
import { 执行事件LLM判断任务, 执行扩展工具任务, 执行MCP运维任务, 执行技能任务 } from './智能体-任务执行器/特殊任务执行.js';
// 子任务管理（保留模块，仅 KISS 未使用的代理方法已移除）
import { 拆解任务, 创建子任务, 等待子任务完成, 查询子任务状态, 汇总子任务结果, 取消任务, 取消所有子任务 } from './智能体-任务执行器/子任务管理.js';
import { handleCurateTools } from './tools/系统工具/工具筛选.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';
import { KISS执行 } from './智能体-KISS执行器.js';
import { 多智能体协作执行 } from './智能体-多智能体协作执行器.js';
import { 提供商客户端 } from './providers/index.js';

const logger = 创建日志器('任务执行器', { 前缀: '[任务执行器]', 级别: 'debug', 显示调用位置: true });

/**
 * 任务执行器类
 * 封装基础任务执行逻辑
 */
export class 任务执行器 {
  constructor(智能体实例) {
    this.智能体 = 智能体实例;
  }

  /**
   * 从任务队列获取任务
   * 通过 Server claim-task API 抢任务，不直连DB
   * @returns {Object|null} 任务对象或null
   */
  async 抢任务() {
    const 任务 = await this.智能体.任务队列.抢任务(this.智能体.ID, this.智能体.能力列表);

    if (任务) {
      this.智能体.当前任务 = 任务;
      await this.智能体.切换状态('忙碌');
      logger.info(`[智能体 ${this.智能体.ID}] 成功获取任务 ${任务.任务ID}, 类型=${任务.类型 || 任务.任务类型}`);
      return 任务;
    }

    // logger.debug(`[智能体 ${this.智能体.ID}] 抢任务返回空`);

    return null;
  }

  /**
   * 执行任务
   * @param {Object} 任务 - 任务对象
   */
  async 执行任务(任务) {
    const taskId = 任务.任务ID;
    const taskType = 任务.任务类型;

    logger.info(`→ 执行任务: 任务=${taskId}, 类型=${taskType}`);
    const _t0 = Date.now();

    if (!任务) {
      return { 成功: false, 错误: '任务对象为空' };
    }

    try {
      // 启动心跳更新
      this.智能体.监工.启动(this.智能体);

      // 直接执行任务核心逻辑，不再使用超时包装
      // 监控由监工体系负责：扫描执行轨迹 → 综合判定 → 任务打终止标记
      const result = await this._执行任务核心(任务, taskId, taskType);
      logger.info(`← 任务完成: ${taskId}, 成功=${result.成功} (${Date.now() - _t0}ms)`);
      return result;

    } catch (错误) {
      logger.error(`[智能体 ${this.智能体.ID}] 任务执行失败:`, 错误);
      
      this.智能体.当前任务 = null;
      await this.智能体.切换状态('在线');
      
      try {
        await this.智能体.处理失败(任务, 错误);
      } catch (处理失败错误) {
        logger.error(`[智能体 ${this.智能体.ID}] 处理失败也出错: ${处理失败错误.message}`);
      }
      
      return { 成功: false, 错误: 错误.message };
    }
  }

  /**
   * 任务执行核心逻辑（从执行任务中抽取，用于超时包装）
   * @private
   */
  async _执行任务核心(任务, taskId, taskType) {
    // claim-task 已原子设置 running + 执行者，无需再更新状态
    // Branch 任务在 Branch执行器.执行Branch任务() 中会再次设置 running（带有执行模型信息）

    // 检查是否为事件调度LLM判断任务
    if (taskType === 'event_llm_judge') {
      logger.debug(`[智能体 ${this.智能体.ID}] 任务类型=event_llm_judge, 委托特殊任务执行`);
      return await 执行事件LLM判断任务(this, 任务);
    }

    // 检查是否为系统任务（技能任务）
    if (taskType === 'resource_allocation' || taskType?.startsWith('skill_')) {
      logger.debug(`[智能体 ${this.智能体.ID}] 任务类型=${taskType}, 委托技能任务执行`);
      return await 执行技能任务(this, 任务);
    }

    // 检查是否为扩展工具调用任务
    if (taskType === 'extension_tool') {
      logger.debug(`[智能体 ${this.智能体.ID}] 任务类型=extension_tool, 委托扩展工具执行`);
      return await 执行扩展工具任务(this, 任务);
    }

    // 检查是否为 MCP 运维任务（测试/刷新）
    if (taskType === 'mcp_test' || taskType === 'mcp_refresh') {
      logger.debug(`[智能体 ${this.智能体.ID}] 任务类型=${taskType}, 委托MCP运维执行`);
      return await 执行MCP运维任务(this, 任务);
    }

    // KISS 单循环执行：所有通用任务走单 LLM 循环
    logger.debug(`[智能体 ${this.智能体.ID}] KISS模式执行: ${taskId}, 类型=${taskType || '通用'}`);
    return await this._执行KISS(任务);
  }

  // ==================== KISS 执行 ====================

  /**
   * KISS 执行：创建提供商客户端 → 调用 KISS执行器 → 返回结果
   * @private
   */
  async _执行KISS(任务) {
    const 提供商名 = this.智能体.推理提供商 || '百炼';
    const 模型名 = this.智能体.默认模型 || 'deepseek-v4-pro';
    const userId = 任务.用户ID;

    let keyConfig;
    if (userId && this.智能体.keyManager) {
      keyConfig = await this.智能体.keyManager.获取用户APIKey(userId, 提供商名);
    } else if (this.智能体.keyManager) {
      keyConfig = this.智能体.keyManager.获取官方Key(提供商名);
    } else {
      keyConfig = { apiKey: '' };
    }

    if (!keyConfig.apiKey) {
      logger.error(`KISS执行: 未找到 ${提供商名} 的 API Key`);
      return { 成功: false, 错误: `API Key 未配置 (${提供商名})` };
    }

    const 客户端 = new 提供商客户端(提供商名, { API密钥: keyConfig.apiKey });

    // ★ 检测用户是否启用了多智能体配置
    const 多智能体配置 = await _获取用户多智能体配置(userId, this.智能体.DovesProxy);
    if (多智能体配置 && 多智能体配置.智能体列表?.length > 1) {
      const 其他成员 = 多智能体配置.智能体列表.filter(a => !a.是否主智能体);
      if (其他成员.length > 0) {
        logger.info(`→ 多智能体协作模式: 主智能体 + ${其他成员.map(a => a.角色名).join('、')}`);
        const multiResult = await 多智能体协作执行(任务, {
          多智能体配置,
          任务队列: this.智能体.任务队列,
          DovesProxy: this.智能体.DovesProxy,
          keyManager: this.智能体.keyManager,
          能力管理器: this.智能体.能力管理器,
          conversationTools: this.智能体.conversationTools,
        });

        if (multiResult.awaiting_cli) {
          this.智能体.当前任务 = null;
          await this.智能体.切换状态('在线');
          return { 成功: true, awaiting_cli: true, 回复: multiResult.result };
        }

        this.智能体.当前任务 = null;
        await this.智能体.切换状态('在线');
        return { 成功: multiResult.success, 数据: { 内容: multiResult.result }, 回复: multiResult.result };
      }
    }

    // 走原有 KISS 单智能体模式
    const result = await KISS执行(任务, {
      提供商客户端: 客户端,
      模型名,
      任务队列: this.智能体.任务队列,
      DovesProxy: this.智能体.DovesProxy,
      能力管理器: this.智能体.能力管理器,
      conversationTools: this.智能体.conversationTools,
    });

    // awaiting_cli: 任务已暂停等待 CLI 回复，不提交结果，由 CLI 回复后重新抢取执行
    if (result.awaiting_cli) {
      this.智能体.当前任务 = null;
      await this.智能体.切换状态('在线');
      return { 成功: true, awaiting_cli: true, 回复: result.result };
    }

    // KISS执行器内部已提交结果，这里清理状态
    this.智能体.当前任务 = null;
    await this.智能体.切换状态('在线');

    return { 成功: result.success, 数据: { 内容: result.result }, 回复: result.result };
  }

  // ==================== 代理方法：转发到子任务管理模块 ====================

  /** 拆解任务为子任务 */
  async 拆解任务(任务) { return await 拆解任务(this, 任务); }

  /** 创建子任务 */
  async 创建子任务(父任务, 子任务描述列表) { return await 创建子任务(this, 父任务, 子任务描述列表); }

  /** 等待子任务完成 */
  async 等待子任务完成(父任务) { return await 等待子任务完成(this, 父任务); }

  /** 查询子任务状态 */
  async 查询子任务状态(父任务) { return await 查询子任务状态(this, 父任务); }

  /** 汇总子任务结果 */
  async 汇总子任务结果(父任务) { return await 汇总子任务结果(this, 父任务); }

  /** 取消任务 */
  async 取消任务(任务ID, 原因 = '') { return await 取消任务(this, 任务ID, 原因); }

  /** 取消所有子任务 */
  async 取消所有子任务(父任务ID) { return await 取消所有子任务(this, 父任务ID); }

  // ==================== 代理方法：转发到特殊任务执行模块 ====================

  /** 执行事件LLM判断任务 */
  async 执行事件LLM判断任务(任务) { return await 执行事件LLM判断任务(this, 任务); }

  /** 执行扩展工具任务 */
  async 执行扩展工具任务(任务) { return await 执行扩展工具任务(this, 任务); }

  /** 执行MCP运维任务 */
  async 执行MCP运维任务(任务) { return await 执行MCP运维任务(this, 任务); }

  /** 执行技能任务 */
  async 执行技能任务(任务) { return await 执行技能任务(this, 任务); }
}

/**
 * 执行工具筛选：从全量工具目录精选趁手工具
 * 此函数不消耗LLM对话窗口，只调用一次精选工具模型
 */
async function 执行工具筛选(self, 任务) {
  const taskId = 任务.任务ID;
  logger.info(`→ 执行工具筛选: ${taskId}`);

  try {
    const result = await handleCurateTools({
      taskDescription: 任务.描述 || '',
      abilities: 任务.能力需求 || [],
    });

    if (result.success) {
      // 将精选结果写入任务文档并转为READY
      await self.智能体.任务队列.更新状态(taskId, 任务状态.READY, {
        精选工具列表: result.tools,
        工具筛选完成时间: new Date().toISOString(),
      });
      logger.info(`← 工具筛选完成: ${result.toolCount}个工具, 任务已转READY`);
    } else {
      // 精选失败，标记失败
      await self.智能体.任务队列.更新状态(taskId, 任务状态.FAILED, { error: result.error });
      logger.warn(`工具筛选失败: ${result.error}，任务已标记失败`);

      self.智能体.当前任务 = null;
      await self.智能体.切换状态('在线');
      return { 成功: false, 错误: result.error };
    }

    self.智能体.当前任务 = null;
    await self.智能体.切换状态('在线');

    return { 成功: true, 数据: { toolCount: result.toolCount || 0 } };

  } catch (error) {
    logger.error(`工具筛选异常: ${error.message}`);
    await self.智能体.任务队列.更新状态(taskId, 任务状态.FAILED, { error: error.message });
    self.智能体.当前任务 = null;
    await self.智能体.切换状态('在线');
    return { 成功: false, 错误: error.message };
  }
}

// ==================== 多智能体配置辅助函数 ====================

/**
 * 获取用户的多智能体团队配置
 * 仅当用户在 DB 中显式配置了团队时才启用多智能体协作
 * 无配置时返回 null → 走 KISS 单智能体（快速可靠）
 * @param {string} userId - 用户ID
 * @param {Object} DovesProxy - Doves 代理实例
 * @returns {Promise<Object|null>} 多智能体配置对象，无配置返回 null
 */
async function _获取用户多智能体配置(userId, DovesProxy) {
  if (!userId || !DovesProxy) return null;

  try {
    const result = await DovesProxy.dbOperation('多智能体配置', 'findOne', { query: { userId } });
    if (result?.success !== false && result?.配置) {
      logger.info(`已加载用户 ${userId} 的多智能体配置（自定义）`);
      return result.配置;
    }
  } catch (e) {
    // 无自定义配置，走 KISS 单智能体
  }

  return null;
}

export default 任务执行器;
