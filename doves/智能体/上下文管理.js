import { DovesProxy } from '../doves_proxy/index.js';
import { createTimestampFields } from '@dove/common/时间工具.js';
import { KeyManager, LLMCaller } from '../llm/index.js';
import { 任务队列 } from '../任务队列.js';
import { 监工 } from '../监工.js';
import { 存储接口 } from '../tools/存储接口.js';
import { BranchTools, ConversationTools } from '../tools/index.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('智能体', { 前缀: '[智能体]', 级别: 'debug', 显示调用位置: true });
import { getSkillIndex } from '../技能索引.js';
import { 任务执行器 } from '../智能体-任务执行器.js';
import { 轨迹写入器 } from '../轨迹写入器.js';
import { ExtensionLoader } from '../extensions/_loader.js';
import { MCP配置管理器 } from '../MCP配置管理器.js';
import { hostname } from 'os';
// 废弃模块（规划器/审核器/LLM执行器/路由执行器/Branch执行器/技能可靠性管理器/经验管理器）
// 已从主执行路径和初始化链路移除，文件保留备用

export function mixin上下文管理(instance) {
  //
  // 初始化智能体
  instance.初始化 = async function(数据库连接 = null) {
    const _t0 = Date.now();
    logger.info(`→ 初始化: 鸽子=${instance.名称}`);
    // 连接 MongoDB（数据库连接即鸽子代理）
    this.数据库连接 = 数据库连接 || await this.连接数据库();
    
    // 如果传入的是 DovesProxy 实例，直接使用
    if (this.数据库连接 instanceof DovesProxy) {
      if (!this.DovesProxy) {
        this.DovesProxy = this.数据库连接;
      }
      this.使用服务端模式 = true;
    }
    
    // 如果已有共享 DovesProxy（鸽群管理器注入），确保标记服务端模式
    if (this.DovesProxy) {
      this.使用服务端模式 = true;
    }
    
    // 核心步骤：加载或注册鸽子身份（确保 ID 唯一且持久化）
    await this.加载或注册身份();
    
    // 加载系统配置（如果鸽群管理器已注入，跳过；否则自己加载）
    if (!this.系统配置) {
      await this.加载系统配置();
    } else {
      // 用共享配置更新模型选择器（如果模型选择器是独占的）
      if (this.系统配置.llm && !this.配置.共享模型选择器) {
        for (const [提供商, cfg] of Object.entries(this.系统配置.llm)) {
          if (cfg.enabled && cfg.models) {
            this.模型选择器.注册模型(提供商, cfg.models);
          }
        }
      }
    }
    
    // 初始化 LLM 模块（如果鸽群管理器已注入共享实例，跳过创建）
    if (!this.keyManager) {
      this.keyManager = new KeyManager({
        数据库连接: this.数据库连接,
        用户数据库名: this.用户数据库名,
        系统配置: this.系统配置
      });
      // 注入 DovesProxy
      this.keyManager.DovesProxy = this.DovesProxy;
    }
    
    if (!this.llmCaller) {
      this.llmCaller = new LLMCaller({
        ID: this.ID,
        keyManager: this.keyManager,
        模型选择器: this.模型选择器,
        token统计: this.Token统计,
        任务队列: null  // 稍后设置
      });
    } else {
      // 共享 LLMCaller 已注入
    }

    // 初始化鸽子级独占组件
    this.任务队列 = new 任务队列(this.数据库连接, this.用户数据库名, this.加密客户端, this.ID);
    // 废弃模块已从初始化链路移除：规划器、审核器、LLM执行器、路由执行器、Branch执行器
    // KISS 单循环模式由 任务执行器 → KISS执行器 驱动，不再需要旧管道模块
    this.监工 = new 监工();
    
    // 更新 llmCaller 的任务队列引用（鸽子级，必须各自绑定）
    if (this.llmCaller) {
      this.llmCaller.任务队列 = this.任务队列;
    }
    
    // 能力列表：从鸽群管理器注入的共享能力管理器读取（能力发现由鸽群管理器统一完成）
    if (this.能力管理器) {
      this.能力列表 = this.能力管理器.获取所有名称();
    } else {
      logger.warn(`共享能力管理器未注入`);
    }
    
    // 加载MCP配置并连接MCP服务器（鸽子ID已确定，可以获取该鸽子的MCP配置）
    await this.连接MCP服务();
    
    // 加载内置技能（需要数据库连接，每个鸽子需设置自己的 db 引用）
    await this.加载内置技能();
    
    // 初始化存储接口
    this.存储接口 = new 存储接口(this.数据库连接, this.用户数据库名);
    
    // 初始化对话分支工具
    this.branchTools = new BranchTools({
      database: this.数据库连接,
      用户数据库名: this.用户数据库名
    });
    this.conversationTools = new ConversationTools({
      database: this.数据库连接,
      用户数据库名: this.用户数据库名
    });
    
    // 技能索引：如果鸽群管理器已注入，跳过重复初始化
    if (!this.skillIndex) {
      this.skillIndex = getSkillIndex();
      await this.skillIndex.initialize();
    } else {
      // 共享技能索引已注入
    }
    
    // 初始化任务执行器（KISS 模式唯一执行器）
    this.task执行器 = new 任务执行器(this);
    
    // 初始化轨迹写入器
    this.轨迹写入器 = new 轨迹写入器(this.数据库连接, this.用户数据库名);
    
    // 废弃模块已移除：技能可靠性管理器、经验管理器
    // KISS 模式不需要技能可靠性追踪和经验巩固，旧模块文件保留备用
    
    // ==================== 扩展包加载 ====================
    // 加载能力扩展包：将 extensions/ 下所有扩展包注册到各管理器
    // 如果鸽群管理器已统一加载，跳过（避免6个鸽子重复加载6次）
    if (!this.扩展加载器) {
      await this.加载扩展包();
    } else {
      // 扩展包已由鸽群管理器统一加载，更新能力列表
      if (this.能力管理器) {
        this.能力列表 = this.能力管理器.获取所有名称();
      }
    }
    
    // 加载渠道权限配置（鸽主+授权双模型）
    await this.加载渠道权限();
    
    // 核心修复：初始化完成后更新鸽子状态为"在线"
    // 确保数据库中的状态与内存中的状态同步
    await this.更新鸽子身份状态('在线');
    
    // 回收上次未完成的任务：将上次该鸽子 ID 正在执行但未完成的任务释放回 ready
    // 这样这些任务可以重新被领取执行，而不需要等待监控超时
    await this.回收未完成任务();
    
    // 初始化完成（能力信息由鸽群管理器统一汇总打印，不再每只鸽子重复打印）
    logger.info(`← 初始化完成: ID=${this.ID}, 能力=${this.能力列表?.length || 0}项 (${Date.now() - _t0}ms)`);
    return true;
  }

  //
  // 加载能力扩展包
  // 扫描 extensions/ 目录，将各扩展包的 LLM层 + 工具层 内容注册到各管理器
  instance.加载扩展包 = async function() {
    const _t0 = Date.now();
    try {
      this.扩展加载器 = new ExtensionLoader();
      const 上下文 = {
        能力管理器: this.能力管理器,
        技能管理器: this.技能管理器,
        // 接口底座：传入 DovesProxy 和运行时上下文
        DovesProxy: this.DovesProxy || null,
        doveId: this.ID || null,
        userId: null,  // 运行时动态注入
        taskId: null,  // 运行时动态注入
      };
      await this.扩展加载器.loadAll(上下文);

      // 扩展包加载后更新能力列表
      if (this.能力管理器) {
        this.能力列表 = this.能力管理器.获取所有名称();
      }
      logger.info(`扩展包加载完成 (${Date.now() - _t0}ms)`);
    } catch (e) {
      logger.warn(`扩展包加载失败: ${e.message}`);
    }
  }
  
  //
  // 加载或注册鸽子身份
  // 身份策略：
  // 1. 如果配置中指定了 ID，直接使用
  // 2. 如果有实例标识，尝试从数据库查找已有身份
  // 3. 如果都没有，创建新身份并注册到数据库
  instance.加载或注册身份 = async function() {
    // 情况1：配置中明确指定了 ID
    // 统一入口已通过注册API获取apiKey，并通过配置传入各自的鸽子ID
    // 此时用 updateDoveIdentity 认领身份（upsert，可创建新身份）
    if (this.配置?.ID) {
      this.ID = this.配置.ID;
      logger.info(`使用配置指定的 ID: ${this.ID}`);
    
      // 通过 updateDoveIdentity 认领/创建身份（upsert，不经过 adminDbOperation 的限制）
      if (this.DovesProxy) {
        await this.DovesProxy.updateDoveIdentity(this.ID, { 
          名称: this.名称,
          实例标识: this.实例标识 || this.ID,
          状态: '在线',
          最后见到时间: createTimestampFields().localTime
        });
      }
      return;
    }
    
    // 情况2：有实例标识，尝试查找已有身份
    // 注意：通过 adminDbOperation 的 findOne 会被服务端强制加 query.鸽子ID = doveId 过滤
    // 所以只能查到 apiKey 关联的鸽子身份。每个鸽子实例应该有各自不同的 ID（情况1传入）
    if (this.实例标识) {
      if (this.DovesProxy) {
        const result = await this.DovesProxy.adminDbOperation('鸽子身份', 'findOne', {
          query: { 鸽子ID: this.实例标识 }
        });
        
        const 已有身份 = result.success ? result.data : null;
        
        if (已有身份) {
          this.ID = 已有身份.鸽子ID;
          logger.info(`从数据库恢复身份: ${this.ID} (标识: ${this.实例标识})`);
        
          // 更新状态为在线和最后见到时间
          await this.DovesProxy.updateDoveIdentity(this.ID, {
            状态: '在线',
            最后见到时间: createTimestampFields().localTime
          });
          return;
        }
      }
    }
    
    // 情况3：没有配置ID也没找到已有身份，使用实例完整标识创建新身份
    const ts = createTimestampFields();
    if (!this.实例完整标识) {
      throw new Error('无法创建鸽子身份：缺少实例完整标识');
    }
    this.ID = this.实例完整标识;
    logger.info(`使用实例完整标识创建新身份: ${this.ID}`);
    
    if (this.DovesProxy) {
      await this.DovesProxy.updateDoveIdentity(this.ID, {
        名称: this.名称,
        实例标识: this.实例标识 || this.ID,
        状态: '在线',
        当前任务ID: null,
        最后见到时间: ts.localTime,
        最后见到时间戳: ts.timestamp,
        主机名: process.env.HOSTNAME || hostname(),
        进程ID: process.pid
      });
    }
  }
  
  //
  // 加载系统配置（通过服务端）
  instance.加载系统配置 = async function() {
    const _t0 = Date.now();
    logger.debug('加载系统配置...');
    
    try {
      // 通过服务端获取系统配置
      if (this.DovesProxy) {
        const 配置 = await this.DovesProxy.getSystemConfig();
        
        if (配置) {
          this.系统配置 = 配置;
          logger.info(`系统配置已加载 (${Date.now() - _t0}ms)`);
          
          // 更新模型选择器
          if (配置.llm) {
            for (const [提供商, cfg] of Object.entries(配置.llm)) {
              if (cfg.enabled && cfg.models) {
                this.模型选择器.注册模型(提供商, cfg.models);
              }
            }
          }
        } else {
          logger.warn(`警告: 未找到系统配置`);
        }
      } else {
        logger.warn(`警告: 无鸽子代理，跳过系统配置加载`);
      }
    } catch (错误) {
      logger.error(`加载系统配置失败:`, 错误.message);
    }
  }
  
  //
  // 加载渠道权限配置
  // 从数据库鸽子身份中读取 渠道权限 和 饲养员ID
  // 与默认配置深度合并：数据库值优先，缺省字段用默认值兜底
  // 这样 config.js 的改动能对已注册的鸽子也生效
  //
  // 默认渠道权限配置（与 server/registration/config.js 保持同步）
  const 默认渠道权限 = {
    鸽主: {
      local: { 工具安全级别上限: '危险', 禁用工具: [], 自定义提示: null },
      remote: { 工具安全级别上限: '谨慎', 禁用工具: [], 自定义提示: null },
      wechat: { 工具安全级别上限: '谨慎', 禁用工具: ['执行命令', '电源控制', '终止进程'], 自定义提示: '你通过微信与用户对话，无法直接操作用户电脑' },
      dingtalk: { 工具安全级别上限: '谨慎', 禁用工具: ['执行命令', '电源控制', '终止进程'], 自定义提示: null },
      feishu: { 工具安全级别上限: '谨慎', 禁用工具: ['执行命令', '电源控制', '终止进程'], 自定义提示: null },
      _default: { 工具安全级别上限: '谨慎', 禁用工具: [], 自定义提示: null },
    },
    授权: {
      local: { 工具安全级别上限: '谨慎', 禁用工具: ['执行命令', '电源控制', '终止进程', 'file_delete'], 自定义提示: null },
      remote: { 工具安全级别上限: '谨慎', 禁用工具: ['执行命令', '电源控制', '终止进程'], 自定义提示: null },
      wechat: { 工具安全级别上限: '谨慎', 禁用工具: ['执行命令', '电源控制', '终止进程'], 自定义提示: null },
      dingtalk: { 工具安全级别上限: '谨慎', 禁用工具: ['执行命令', '电源控制', '终止进程'], 自定义提示: null },
      feishu: { 工具安全级别上限: '谨慎', 禁用工具: ['执行命令', '电源控制', '终止进程'], 自定义提示: null },
      _default: { 工具安全级别上限: '谨慎', 禁用工具: ['执行命令', '电源控制', '终止进程'], 自定义提示: null },
    },
  };

  /**
   * 深度合并渠道权限：默认值为基准，数据库值覆盖手动调整过的渠道
   * 
   * 合并规则：
   * - 默认配置是标准答案，每个渠道都有推荐安全级别
   * - 数据库值来自用户手动调整（CLI/API），尊重用户选择
   * - 但如果用户从未调整过某个渠道，则使用最新默认值
   * - 判断依据：数据库渠道配置中是否有 禁用工具 或 自定义提示（手动调整的标志）
   */
  function 合并渠道权限(db权限, 默认权限) {
    if (!db权限) return 默认权限;
    const 合并结果 = {};
    for (const 角色 of Object.keys(默认权限)) {
      合并结果[角色] = {};
      for (const 渠道 of Object.keys(默认权限[角色])) {
        const db值 = db权限[角色]?.[渠道];
        const 默认值 = 默认权限[角色][渠道];
        if (db值) {
          // 检测是否用户手动调整过：有禁用工具或自定义提示说明用户主动配置过
          const 用户手动调整 = (db值.禁用工具?.length > 0) || db值.自定义提示;
          if (用户手动调整) {
            // 用户手动调整过的渠道：尊重用户选择，缺省字段用默认值补
            合并结果[角色][渠道] = {
              工具安全级别上限: db值.工具安全级别上限 ?? 默认值.工具安全级别上限,
              禁用工具: db值.禁用工具 ?? 默认值.禁用工具,
              自定义提示: db值.自定义提示 !== undefined ? db值.自定义提示 : 默认值.自定义提示,
            };
          } else {
            // 未手动调整的渠道：使用最新默认值（确保配置迭代生效）
            合并结果[角色][渠道] = { ...默认值 };
          }
        } else {
          // 数据库无此渠道配置：直接用默认值
          合并结果[角色][渠道] = { ...默认值 };
        }
      }
    }
    return 合并结果;
  }

  instance.加载渠道权限 = async function() {
    const _t0 = Date.now();
    try {
      if (this.DovesProxy) {
        let 身份 = null;

        // 优先使用鸽群管理器预查询的共享结果（9只鸽子共享同一份，只查一次DB）
        if (this.共享渠道权限数据 !== undefined) {
          身份 = { 渠道权限: this.共享渠道权限数据, 饲养员ID: this.共享饲养员ID };
        } else {
          // 回退到自行查询
          const result = await this.DovesProxy.adminDbOperation('鸽子身份', 'findOne', {
            query: { 鸽子ID: this.ID }
          });
          身份 = result.success ? result.data : null;
        }
        
        if (身份) {
          // 深度合并：数据库值优先，缺省字段用默认值兜底
          const 合并前 = 身份.渠道权限?.授权?.wechat?.工具安全级别上限;
          this.渠道权限 = 合并渠道权限(身份.渠道权限, 默认渠道权限);
          const 合并后 = this.渠道权限?.授权?.wechat?.工具安全级别上限;
          if (合并前 !== 合并后) {
            logger.debug(`渠道权限合并生效: 授权.wechat 安全级别 ${合并前} → ${合并后}`);
          }
          logger.debug(`渠道权限加载完成 (${Date.now() - _t0}ms)`);
          this.饲养员ID = 身份.饲养员ID || null;
        } else {
          logger.warn(`未找到鸽子身份，跳过渠道权限加载`);
        }
      }
    } catch (错误) {
            logger.warn(`加载渠道权限失败: ${错误.message}`);
    }
  }
  
  //
  // 连接数据库（通过鸽子代理）
  // 遵循"统一代理"原则，所有鸽子通过鸽子代理访问数据
  // 优先复用已注入的 DovesProxy（鸽群管理器注入），否则从环境变量创建
  // 
  instance.连接数据库 = async function() {
    const _t0 = Date.now();

    // 如果已有 DovesProxy（鸽群管理器注入），直接复用
    if (this.DovesProxy) {
            logger.debug('复用已注入的鸽子代理');
      this.使用服务端模式 = true;
      return this.DovesProxy;
    }

    // 否则从环境变量创建（独立鸽子模式）
    const serverUrl = process.env.SERVER_URL;
    const serverJwt = process.env.SERVER_JWT;
    const serverApiKey = process.env.SERVER_API_KEY;

    if (serverUrl && (serverJwt || serverApiKey)) {
            logger.debug('使用鸽子代理连接...');
      this.DovesProxy = new DovesProxy({
        serverUrl,
        jwt: serverJwt,
        apiKey: serverApiKey
      });
      this.使用服务端模式 = true;
      logger.debug(`数据库连接完成 (${Date.now() - _t0}ms)`);
      return this.DovesProxy;
    }

    // 服务端配置不可用，抛出错误（禁止直连数据库）
    throw new Error('[智能体] 错误：缺少服务端配置，请设置 SERVER_URL 和 SERVER_JWT/SERVER_API_KEY 环境变量');
  }

  //
  // 加载内置技能
  instance.加载内置技能 = async function() {
    try {
      // 设置技能管理器的数据库连接（共享实例只设置一次）
      if (this.数据库连接 && this.用户数据库名) {
        if (!this.技能管理器.数据库连接) {
          this.技能管理器.设置数据库连接(
            this.数据库连接.db(this.用户数据库名),
            this.用户数据库名
          );
        }
      }
      
      // 加载资源分配技能（共享实例只注册一次）
      if (!this.技能管理器.已注册技能.has('resource_allocation')) {
        const 资源分配技能 = await import('../skills/资源分配/index.js');
        if (资源分配技能.default) {
          const 技能模块 = {
            ...资源分配技能.default,
            需要拥有权: false
          };
          this.技能管理器.注册技能('resource_allocation', 技能模块);
        }
      }
      
      // 加载模型配置整理技能（共享实例只注册一次）
      if (!this.技能管理器.已注册技能.has('skill_model_organize')) {
        const 模型整理技能 = await import('../skills/模型整理/index.js');
        if (模型整理技能.default) {
          const 技能模块 = {
            ...模型整理技能.default,
            需要拥有权: false
          };
          this.技能管理器.注册技能('skill_model_organize', 技能模块);
        }
      }
      
      // 从数据库加载技能（共享实例只加载一次，避免 9 只鸽子重复查 DB）
      if (this.技能管理器.数据库连接 && !this.技能管理器._已从数据库加载) {
        this.技能管理器._已从数据库加载 = true;
        await this.技能管理器.从数据库加载技能();
      }
    } catch (错误) {
            logger.error(`加载内置技能失败:`, 错误.message);
    }
  }


  //
  // 连接MCP服务
  // 从数据库加载鸽子的MCP配置，连接到配置的MCP服务器，发现并注册MCP能力
  instance.连接MCP服务 = async function() {
    const _t0 = Date.now();
    if (!this.DovesProxy || !this.ID) {
            logger.warn('跳过MCP连接: 缺少DovesProxy或鸽子ID');
      return;
    }
    
    try {
      let mcpConfig;
      
      // 优先使用鸽群管理器预查询的共享结果（避免 9 只鸽子各查一次）
      if (this.共享MCP配置 !== undefined) {
        mcpConfig = this.共享MCP配置;
      } else {
        // 回退到自行查询
        mcpConfig = await this.DovesProxy.getMCPConfig(this.ID);
        if (!mcpConfig?.servers?.length) {
          const identity = await this.DovesProxy.getDoveIdentity(this.ID);
          mcpConfig = identity?.MCP配置 || null;
        }
      }
      
      if (!mcpConfig?.servers?.length) {
                logger.info('无MCP Server配置，跳过连接');
        return;
      }
      
      const 启用的服务器 = mcpConfig.servers.filter(s => s.启用 !== false);
      if (!启用的服务器.length) {
                logger.info('无已启用的MCP Server，跳过连接');
        return;
      }
      
            logger.info(`发现 ${启用的服务器.length} 个已启用的MCP Server，开始连接...`);
      
      // 使用MCP配置管理器连接
      const mcp管理器 = new MCP配置管理器();
      const 连接结果 = await mcp管理器.从配置连接(mcpConfig);
      
      // 将MCP工具能力注册到能力管理器
      if (this.能力管理器) {
        const mcpAbilities = await this.能力管理器.加载MCP能力();
        // 更新能力列表（包括新发现的MCP能力）
        this.能力列表 = this.能力管理器.获取所有名称();
      }
      
            logger.info(`MCP连接完成: 成功=${连接结果.成功}, 失败=${连接结果.失败} (${Date.now() - _t0}ms)`);
    } catch (error) {
      // MCP连接失败不应阻塞鸽子初始化
            logger.warn(`MCP连接失败: ${error.message}`);
    }
  }

}
