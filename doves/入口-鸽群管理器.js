/**
 * @file 入口-鸽群管理器
 * @description 鸽群管理器类 - 管理多个鸽子实例的并发执行
 *
 * 身份持久化策略：
 * 1. 每个鸽子有唯一的实例标识 (instanceKey)
 * 2. 实例标识 = 服务标识 + 鸽子序号
 * 3. 重启时根据实例标识恢复已有身份
 *
 * 资源共享策略（单进程多鸽子优化）：
 * - 进程级共享（1 份）：DovesProxy、能力管理器、技能管理器、模型选择器、KeyManager、LLMCaller
 * - 鸽子级独占（每鸽子 1 份）：鸽子ID、任务队列、Token统计器、执行器、当前任务状态
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createConnection as tcpCreateConnection } from 'net';
import { 创建日志器 } from '@dove/common/日志管理器.js';
import { 智能体 } from './智能体.js';
import { 获取或生成机器标识, 生成分组标识 } from '@dove/common/机器标识.js';
import { DovesProxy } from './doves_proxy/index.js';
import { 能力管理器 as 能力管理器类 } from './能力管理器.js';
import { 技能管理器 as 技能管理器类 } from './skills/index.js';
import { 模型选择器, Token统计器 } from './providers/index.js';
import { KeyManager, LLMCaller } from './llm/index.js';
import { getSkillIndex } from './技能索引.js';
import { cleanupAllPendingQuestions } from './tools/用户交互.js';
import { ExtensionLoader } from './extensions/_loader.js';
import { DoveCryptoClient } from './加密客户端.js';
import { 启动直连服务 } from './入口-直连服务.js';
import { 发现本地MCP } from './MCP配置管理器.js';
import { 是否静默, 启用静默, 关闭静默, 开始计时, 结束计时, 记录鸽子数, 记录能力, 记录不可用, 记录扩展, 记录服务端地址, 记录机器标识, 记录残留任务, 记录加密, 记录直连端口, 打印汇总 } from './utils/启动汇总.js';

const logger = 创建日志器('鸽群管理器', { 前缀: '[鸽群管理器]', 级别: 'debug', 显示调用位置: true });

/**
 * 快速探测 TCP 端口是否可达
 * 用 3 秒超时替代 30 秒握手超时，避免加密端口不可达时白白等待
 */
function 探测端口(hostname, port, timeout = 3000) {
  return new Promise((resolve) => {
    const socket = tcpCreateConnection(port, hostname, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(timeout);
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { resolve(false); });
  });
}

export class 鸽群管理器 {
  constructor(配置 = {}) {
    this.鸽子列表 = [];
    this.最大实例数 = 配置.最大实例数 || 配置.最大鸽子数 || 5;
    this.运行中 = false;
    this.服务端代理 = null;
    this.服务标识 = 配置.服务标识 || process.env.DOVE_SERVICE_KEY || 'default';
    this.心跳定时器列表 = [];
    this.心跳间隔 = 配置.心跳间隔 || 30000;

    // 进程级共享资源
    this.DovesProxy = null;
    this.共享能力管理器 = null;
    this.共享技能管理器 = null;
    this.共享模型选择器 = null;
    this.共享KeyManager = null;
    this.共享LLMCaller = null;
    this.共享系统配置 = null;
    this.共享技能索引 = null;
    this.加密客户端 = null;
    this.直连服务 = null;
  }

  async 初始化共享资源(服务端代理) {
    启用静默();

    if (服务端代理 instanceof DovesProxy) {
      this.服务端代理 = 服务端代理;
    }

    if (this.服务端代理) {
      this.共享系统配置 = await this.服务端代理.getSystemConfig();
    }

    this.共享模型选择器 = new 模型选择器();
    if (this.共享系统配置?.llm) {
      for (const [提供商, cfg] of Object.entries(this.共享系统配置.llm)) {
        if (cfg.enabled && cfg.models) {
          this.共享模型选择器.注册模型(提供商, cfg.models);
        }
      }
    }

    this.共享能力管理器 = new 能力管理器类();
    await this.共享能力管理器.发现能力();

    this.共享技能管理器 = new 技能管理器类();

    this.共享KeyManager = new KeyManager({
      数据库连接: 服务端代理,
      用户数据库名: process.env.MONGODB_USER_DB || 'doves_user_data',
      系统配置: this.共享系统配置
    });
    this.共享KeyManager.DovesProxy = this.服务端代理;

    this.共享LLMCaller = new LLMCaller({
      ID: 'shared_llm',
      keyManager: this.共享KeyManager,
      模型选择器: this.共享模型选择器,
      token统计: null,
      任务队列: null
    });

    this.共享技能索引 = getSkillIndex();
    this.共享技能索引.setSkillManager(this.共享技能管理器);
    await this.共享技能索引.initialize();

    this.共享扩展加载器 = new ExtensionLoader();
    const apiDoveId = this.服务端代理?.cryptoClient?.clientId || null;
    const 扩展上下文 = {
      能力管理器: this.共享能力管理器,
      技能管理器: this.共享技能管理器,
      DovesProxy: this.服务端代理,
      doveId: apiDoveId,
    };
    await this.共享扩展加载器.loadAll(扩展上下文);
    await this.共享技能索引.reinitialize(this.共享技能管理器);

    const 能力统计 = this.共享能力管理器?.检测结果
      ? {
          总数: this.共享能力管理器.获取所有名称().length,
          模型: Object.keys(this.共享能力管理器.检测结果.model).filter(k => this.共享能力管理器.检测结果.model[k]?.available).length,
          技能: Object.keys(this.共享能力管理器.检测结果.skill).filter(k => this.共享能力管理器.检测结果.skill[k]?.available).length,
          工具: Object.keys(this.共享能力管理器.检测结果.tool).filter(k => this.共享能力管理器.检测结果.tool[k]?.available).length,
          平台: Object.keys(this.共享能力管理器.检测结果.platform).filter(k => this.共享能力管理器.检测结果.platform[k]?.available).length,
          MCP: Object.keys(this.共享能力管理器.检测结果.mcp).filter(k => this.共享能力管理器.检测结果.mcp[k]?.available).length,
        }
      : { 总数: 0, 模型: 0, 技能: 0, 工具: 0, 平台: 0, MCP: 0 };
    记录能力(能力统计);
    if (this.共享能力管理器?._不可用列表) {
      记录不可用(this.共享能力管理器._不可用列表);
    }
  }

  创建鸽子(配置 = {}, 序号 = 0) {
    const 实例标识 = `${this.服务标识}_dove_${序号 + 1}`;
    const machineId = 获取或生成机器标识();
    const 完整标识 = 生成分组标识(machineId, 'dove', 序号);

    const 鸽子配置 = {
      ...配置,
      实例标识,
      machineId,
      实例完整标识: 完整标识,
      共享DovesProxy: this.DovesProxy,
      共享能力管理器: this.共享能力管理器,
      共享技能管理器: this.共享技能管理器,
      共享模型选择器: this.共享模型选择器,
      共享KeyManager: this.共享KeyManager,
      共享LLMCaller: this.共享LLMCaller,
      共享系统配置: this.共享系统配置,
      共享技能索引: this.共享技能索引,
      共享扩展加载器: this.共享扩展加载器,
    };

    const 鸽子 = new 智能体(鸽子配置);
    this.鸽子列表.push(鸽子);
    return 鸽子;
  }

  批量创建鸽子(数量, 配置模板 = {}) {
    const 鸽子们 = [];
    for (let i = 0; i < 数量; i++) {
      const 鸽子 = this.创建鸽子({ ...配置模板, 名称: `${配置模板.名称 || '鸽子'}_${i + 1}` }, i);
      鸽子们.push(鸽子);
    }
    return 鸽子们;
  }

  async 启动全部() {
    this.运行中 = true;
    开始计时();
    记录鸽子数(this.鸽子列表.length);

    await this.初始化共享资源(this.服务端代理);

    const machineId = 获取或生成机器标识();
    记录机器标识(machineId);

    // 所有鸽子统一格式 ID：{os}_{hash}_dove_{index}
    for (let i = 0; i < this.鸽子列表.length; i++) {
      const 鸽子 = this.鸽子列表[i];
      if (!鸽子.配置.ID) {
        鸽子.配置.ID = 生成分组标识(machineId, 'dove', i);
      }
    }

    // 加密客户端由 入口-启动器 在 DovesProxy 中创建，此处提取共享
    if (this.服务端代理?.cryptoClient) {
      this.加密客户端 = this.服务端代理.cryptoClient;
      记录加密(true);
    } else {
      this.加密客户端 = null;
    }

    // 共享资源注入到所有鸽子实例
    for (const 鸽子 of this.鸽子列表) {
      鸽子.DovesProxy = this.服务端代理;
      鸽子.能力管理器 = this.共享能力管理器;
      鸽子.技能管理器 = this.共享技能管理器;
      鸽子.模型选择器 = this.共享模型选择器;
      鸽子.keyManager = this.共享KeyManager;
      鸽子.llmCaller = this.共享LLMCaller;
      鸽子.系统配置 = this.共享系统配置;
      鸽子.skillIndex = this.共享技能索引;
      鸽子.扩展加载器 = this.共享扩展加载器;
      鸽子.加密客户端 = this.加密客户端;
    }

    // 预查询 MCP 配置
    let 共享MCP配置 = undefined;
    if (this.服务端代理 && this.鸽子列表.length > 0) {
      try {
        const firstDoveId = this.鸽子列表[0]?.配置?.ID || this.鸽子列表[0]?.ID;
        if (firstDoveId) {
          const mcpConfig = await this.服务端代理.getMCPConfig(firstDoveId);
          if (mcpConfig?.servers?.length) {
            共享MCP配置 = mcpConfig;
          } else {
            const identity = await this.服务端代理.getDoveIdentity(firstDoveId);
            const identityMcp = identity?.MCP配置 || null;
            共享MCP配置 = identityMcp?.servers?.length ? identityMcp : null;
          }
        }
      } catch (e) {
        logger.warn(`MCP配置预查询失败: ${e.message}`);
      }
    }
    for (const 鸽子 of this.鸽子列表) {
      鸽子.共享MCP配置 = 共享MCP配置;
    }

    // 自动发现本地白鸽MCP（连接成功则注册 GUI 能力，失败静默跳过）
    await 发现本地MCP();

    // 预查询渠道权限
    let 共享渠道权限数据 = null;
    let 共享饲养员ID = null;
    if (this.服务端代理 && this.鸽子列表.length > 0) {
      try {
        const firstDoveId = this.鸽子列表[0]?.配置?.ID || this.鸽子列表[0]?.ID;
        if (firstDoveId) {
          const result = await this.服务端代理.adminDbOperation('鸽子身份', 'findOne', { query: { 鸽子ID: firstDoveId } });
          const 身份 = result.success ? result.data : null;
          if (身份) {
            共享渠道权限数据 = 身份.渠道权限 || null;
            共享饲养员ID = 身份.饲养员ID || null;
          }
        }
      } catch (e) { logger.warn(`渠道权限预查询失败: ${e.message}`); }
    }
    for (const 鸽子 of this.鸽子列表) {
      鸽子.共享渠道权限数据 = 共享渠道权限数据;
      鸽子.共享饲养员ID = 共享饲养员ID;
    }

    // 清理残留任务
    if (this.服务端代理) {
      try {
        const 清理结果 = await this.服务端代理.releaseStaleTasks('鸽群重启，回收残留任务');
        if (清理结果 && 清理结果.releasedCount > 0) {
          记录残留任务(清理结果.releasedCount);
        }
      } catch (e) {
        logger.warn(`清理残留任务失败: ${e.message}`);
      }
    }

    // 并行初始化所有鸽子
    await Promise.all(this.鸽子列表.map(async (鸽子) => { await 鸽子.初始化(this.服务端代理); }));

    // 统一报告能力
    if (this.共享能力管理器 && this.服务端代理) {
      for (const 鸽子 of this.鸽子列表) {
        try { await this.共享能力管理器.报告能力(this.服务端代理, { 鸽子ID: 鸽子.ID }); } catch (错误) { logger.warn(`鸽子 ${鸽子.ID} 能力上报失败:`, 错误.message); }
      }
    }

    // 启动任务循环
    this.鸽子列表.forEach(鸽子 => { 鸽子.启动(); });

    this._启动心跳();
    await 启动直连服务(this);

    关闭静默();
    结束计时();
    if (this.直连服务?.actualPort) { 记录直连端口(this.直连服务.actualPort); }
    打印汇总();
    logger.info('✅ 白鸽已就绪，等待任务...');
  }

  async 停止全部() {
    this.运行中 = false;
    logger.info('停止所有鸽子');
    this._停止心跳();

    const 停止超时 = 5000;
    const 停止Promise列表 = this.鸽子列表.map(async (鸽子) => {
      try {
        await Promise.race([鸽子.停止(), new Promise((_, reject) => setTimeout(() => reject(new Error('停止超时')), 停止超时))]);
      } catch (错误) {
        logger.error(`鸽子 ${鸽子.ID} 停止失败/超时: ${错误.message}`);
        鸽子.运行中 = false;
        鸽子.当前任务 = null;
        鸽子.abortController?.abort();
        try { await 鸽子.切换状态('离线'); } catch (e) { logger.warn(`鸽子 ${鸽子.ID} 切换离线状态失败: ${e.message}`); }
      }
    });

    await Promise.allSettled(停止Promise列表);

    if (this.服务端代理 && typeof this.服务端代理.close === 'function') { this.服务端代理.close().catch(e => logger.warn(`服务端代理关闭失败: ${e.message}`)); }
    if (this.加密客户端 && typeof this.加密客户端.close === 'function') { try { this.加密客户端.close(); } catch (e) { logger.warn(`加密客户端关闭失败: ${e.message}`); } this.加密客户端 = null; }
    if (this.直连服务) { try { await this.直连服务.stop(); } catch (e) { logger.warn(`直连服务停止失败: ${e.message}`); } this.直连服务 = null; }

    try { cleanupAllPendingQuestions(); } catch (e) { logger.warn(`清理待处理问题失败: ${e.message}`); }
  }

  _启动心跳() {
    if (!this.服务端代理) { logger.warn('无服务端代理，跳过心跳启动'); return; }
    for (const 鸽子 of this.鸽子列表) {
      const timer = setInterval(async () => {
        try {
          const 鸽子状态 = 鸽子.当前任务 ? '忙碌' : '在线';
          await this.服务端代理.updateDoveIdentity(鸽子.ID, { 状态: 鸽子状态, 当前任务ID: 鸽子.当前任务?.任务ID || 鸽子.当前任务?.id || null });
        } catch (error) { logger.warn(`鸽子 ${鸽子.ID} 心跳更新失败: ${error.message}`); }
      }, this.心跳间隔);
      this.心跳定时器列表.push(timer);
    }
    logger.info(`${this.心跳定时器列表.length} 个心跳已启动`);
  }

  _停止心跳() {
    for (const timer of this.心跳定时器列表) { clearInterval(timer); }
    this.心跳定时器列表 = [];
    logger.info('心跳定时器已清理');
  }

  获取空闲数量() { return this.鸽子列表.filter(鸽子 => 鸽子.可接受任务()).length; }

  获取状态报告() {
    return {
      运行中: this.运行中,
      总鸽子数: this.鸽子列表.length,
      最大实例数: this.最大实例数,
      空闲数量: this.获取空闲数量(),
      忙碌数量: this.鸽子列表.length - this.获取空闲数量(),
      直连服务: this.直连服务 ? { 端口: this.直连服务.actualPort, 连接数: this.直连服务.connections.size } : null,
      鸽子状态: this.鸽子列表.map(鸽子 => 鸽子.获取状态报告())
    };
  }
}
