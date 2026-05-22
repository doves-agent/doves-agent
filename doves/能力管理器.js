/**
 * @file 能力管理器
 * @description 能力自动发现与注册，含内联注册表
 * 
 * === 能力发现机制 ===
 * 1. 鸽子启动时自动发现
 * 2. CLI 命令手动刷新：dove capability refresh
 * 3. 进官方管理库存储
 * 
 * === 能力来源 ===
 * - 模型能力：从 providers/index.js 加载
 * - 技能能力：从 skills 目录扫描
 * - 工具能力：从 tools 目录扫描
 * - 平台能力：运行时检测操作系统
 * - MCP能力：从已连接的 MCP Server 发现工具
 */

import { 加载模型能力, 加载技能能力, 加载工具能力, 检测平台能力, 加载MCP能力, 从MCP配置加载能力 } from './能力加载器.js';
import { createTimestampFields } from '@dove/common/时间工具.js';
import { ObjectId } from '@dove/common/对象标识.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('能力管理器', { 前缀: '[能力管理器]', 级别: 'debug', 显示调用位置: true });
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));



// ==================== 能力常量（原能力注册表.js） ====================

/**
 * 能力分类枚举
 */
export const 能力分类 = {
  推理: '推理',
  感知: '感知',
  执行: '执行',
  内容: '内容',
  特性: '特性',
  扩展: '扩展'
};

/**
 * 能力来源类型枚举
 */
export const 能力来源类型 = {
  模型: '模型',
  技能: '技能',
  工具: '工具',
  平台: '平台',
  MCP: 'MCP'
};

/**
 * 标准能力定义表（简化版：只保留分类和描述，供注册时填充默认值）
 */
const 标准能力定义 = {
  '推理': { 分类: 能力分类.推理, 描述: '逻辑推理、复杂问题分析、决策规划' },
  '编程': { 分类: 能力分类.推理, 描述: '代码生成、代码理解、代码调试' },
  '数学推理': { 分类: 能力分类.推理, 描述: '数学计算、逻辑推导、公式推导' },
  '创意': { 分类: 能力分类.推理, 描述: '创意写作、头脑风暴、内容创作' },
  '知识库': { 分类: 能力分类.推理, 描述: '知识检索、RAG增强、记忆查询' },
  '视觉': { 分类: 能力分类.感知, 描述: '图像/视频综合理解' },
  '图片理解': { 分类: 能力分类.感知, 描述: '静态图像内容分析' },
  '视频理解': { 分类: 能力分类.感知, 描述: '动态视频内容分析' },
  'OCR': { 分类: 能力分类.感知, 描述: '图片文字识别提取' },
  '界面理解': { 分类: 能力分类.感知, 描述: 'UI界面元素识别、布局理解' },
  '语音识别': { 分类: 能力分类.感知, 描述: '语音转文本（ASR）' },
  '工具调用': { 分类: 能力分类.执行, 描述: '调用外部工具/API、Function Calling' },
  '浏览器控制': { 分类: 能力分类.执行, 描述: '自动化浏览器操作、网页交互' },
  'GUI自动化': { 分类: 能力分类.执行, 描述: '桌面自动化操作、键鼠控制' },
  '远程执行': { 分类: 能力分类.执行, 描述: 'SSH远程命令执行、SFTP文件传输' },
  '系统管理': { 分类: 能力分类.执行, 描述: '进程管理、系统监控、资源管理' },
  '文件操作': { 分类: 能力分类.执行, 描述: '文件读写、目录管理、文件处理' },
  '网络请求': { 分类: 能力分类.执行, 描述: 'HTTP请求、API调用' },
  '网络搜索': { 分类: 能力分类.执行, 描述: '网络搜索、信息检索' },
  '结果验证': { 分类: 能力分类.执行, 描述: '任务结果验证、质量评估' },
  '图片生成': { 分类: 能力分类.内容, 描述: 'AI图像生成、文生图' },
  '图片编辑': { 分类: 能力分类.内容, 描述: 'AI图像编辑、修图' },
  '语音合成': { 分类: 能力分类.内容, 描述: '文本转语音（TTS）' },
  '文档生成': { 分类: 能力分类.内容, 描述: 'PDF/Word/Excel等文档生成' },
  '翻译': { 分类: 能力分类.内容, 描述: '多语言翻译' },
  '多语言': { 分类: 能力分类.内容, 描述: '多语言理解与生成' },
  '快速': { 分类: 能力分类.特性, 描述: '响应速度快、低延迟' },
  '长文本': { 分类: 能力分类.特性, 描述: '长上下文处理、大文档支持' },
  '低成本': { 分类: 能力分类.特性, 描述: '经济实惠、低Token消耗' },
  '多模态': { 分类: 能力分类.特性, 描述: '支持多种输入输出模态' },
  '向量嵌入': { 分类: 能力分类.特性, 描述: '文本向量化、语义嵌入' }
};

/**
 * 能力管理器类 - 能力自动发现与注册（内联注册表）
 * 
 * 使用方式：
 * const manager = new 能力管理器();
 * const 能力列表 = await manager.发现能力();
 * const 所有能力 = manager.获取所有能力();
 */
export class 能力管理器 {
  constructor(配置 = {}) {
    // 内联注册表：Map<能力名, 能力信息>
    this.已注册能力 = new Map();
    // 配置
    this.技能目录 = 配置.技能目录 || join(__dirname, 'skills');
    this.工具目录 = 配置.工具目录 || join(__dirname, 'tools');
    // 鸽子信息（用于报告能力）
    this.鸽子ID = 配置.鸽子ID || null;
    this.鸽子类型 = 配置.鸽子类型 || 'official';
  }

  // ==================== 内联注册表操作 ====================

  /**
   * 注册能力（静默注册，不打印逐条日志）
   * @param {string} 名称 - 能力名称
   * @param {Object} 信息 - 能力信息 { 来源, 提供商, 技能, 工具, 平台, 模型映射, 描述, ... }
   * @param {Object} 选项 - 注册选项（暂未使用）
   */
  注册(名称, 信息, 选项 = {}) {
    const 标准 = 标准能力定义[名称] || { 分类: 能力分类.扩展, 描述: 信息.描述 || '扩展能力' };
    const ts = createTimestampFields();
    
    const 能力信息 = {
      id: new ObjectId().toString(),
      名称,
      分类: 信息.分类 || 标准.分类,
      描述: 信息.描述 || 标准.描述,
      来源: 信息.来源,
      提供商: 信息.提供商 || null,
      技能: 信息.技能 || null,
      工具: 信息.工具 || null,
      平台: 信息.平台 || null,
      模型映射: 信息.模型映射 || null,
      发现时间: ts.localTime,
      更新时间: ts.localTime
    };
    
    this.已注册能力.set(名称, 能力信息);
    return 能力信息;
  }

  /**
   * 获取能力信息
   */
  获取(名称) {
    return this.已注册能力.get(名称) || null;
  }

  /**
   * 检查是否具备某能力
   */
  具备(名称) {
    return this.已注册能力.has(名称);
  }

  /**
   * 获取所有能力名称
   */
  获取所有名称() {
    return Array.from(this.已注册能力.keys());
  }

  /**
   * 获取所有能力信息
   */
  获取所有() {
    return Array.from(this.已注册能力.values());
  }

  /**
   * 按分类获取能力
   */
  按分类获取(分类) {
    return this.获取所有().filter(能力 => 能力.分类 === 分类);
  }

  /**
   * 清空注册表
   */
  清空() {
    this.已注册能力.clear();
  }

  // ==================== 能力发现 ====================

  /**
   * 自动发现本实例所有能力
   * @param {Object} 选项 - 发现选项
   * @returns {Object} 发现结果
   */
  async 发现能力(选项 = {}) {
    const {
      includeModel = true,
      includeSkills = true,
      includeTools = true,
      includePlatform = true,
      includeMCP = true,
      skipCheck = false
    } = 选项;
      
    // 检测结果记录
    this.检测结果 = {
      model: {},
      skill: {},
      tool: {},
      platform: {},
      mcp: {}
    };
    
    // 收集不可用项（只记录不逐条打印）
    const 不可用列表 = [];
    this._不可用列表 = 不可用列表;
      
    if (includeModel) await this.加载模型能力(skipCheck);
    if (includeSkills) await this.加载技能能力(skipCheck);
    if (includeTools) await this.加载工具能力(skipCheck);
    if (includePlatform) await this.检测平台能力(skipCheck);
    if (includeMCP) await this.加载MCP能力(skipCheck);
      
    const 能力列表 = this.获取所有名称();
    
    // 统一汇总打印
    const 统计 = {
      总数: 能力列表.length,
      模型能力: Object.keys(this.检测结果.model).filter(k => this.检测结果.model[k]?.available).length,
      技能能力: Object.keys(this.检测结果.skill).filter(k => this.检测结果.skill[k]?.available).length,
      工具能力: Object.keys(this.检测结果.tool).filter(k => this.检测结果.tool[k]?.available).length,
      平台能力: Object.keys(this.检测结果.platform).filter(k => this.检测结果.platform[k]?.available).length,
      MCP能力: Object.keys(this.检测结果.mcp).filter(k => this.检测结果.mcp[k]?.available).length
    };
    logger.info(`能力发现完成: 共 ${统计.总数} 项 (模型${统计.模型能力} 技能${统计.技能能力} 工具${统计.工具能力} 平台${统计.平台能力} MCP${统计.MCP能力})`);
    
    // 如果有不可用项，汇总打印
    if (不可用列表.length > 0) {
      logger.warn(`${不可用列表.length} 项不可用: ${不可用列表.join(', ')}`);
    }
    
    delete this._不可用列表;
      
    return {
      能力列表,
      检测结果: this.检测结果,
      统计
    };
  }

  /** 从提供商配置加载模型能力 */
  async 加载模型能力(skipCheck = false) {
    return 加载模型能力(this, skipCheck);
  }

  /** 从 skills 目录加载技能能力 */
  async 加载技能能力(skipCheck = false) {
    return 加载技能能力(this, skipCheck);
  }

  /** 从 tools 目录加载工具能力 */
  async 加载工具能力(skipCheck = false) {
    return 加载工具能力(this, skipCheck);
  }

  /** 检测平台能力（运行时检测） */
  async 检测平台能力(skipCheck = false) {
    return 检测平台能力(this, skipCheck);
  }
  
  /** 加载MCP能力（从已配置的MCP Server） */
  async 加载MCP能力(skipCheck = false) {
    return 加载MCP能力(this, skipCheck);
  }
  
  /** 从MCP配置连接并发现能力 */
  async 从MCP配置加载能力(MCP配置) {
    return 从MCP配置加载能力(this, MCP配置);
  }
  
  // ==================== 对外接口 ====================

  /**
   * 获取所有能力名称
   */
  获取所有能力() {
    return this.获取所有名称();
  }

  /**
   * 获取所有能力详细信息
   */
  获取能力详情() {
    return this.获取所有();
  }

  /**
   * 检查是否具备某能力
   */
  具备能力(能力名) {
    return this.具备(能力名);
  }

  /**
   * 获取能力信息
   */
  获取能力(能力名) {
    return this.获取(能力名);
  }

  /**
   * 匹配任务所需能力
   */
  匹配任务能力(任务) {
    const 匹配的能力 = [];
    const 缺失的能力 = [];
    const 所需能力 = 任务.所需能力 || 任务.requiredCapabilities || [];
    
    for (const 能力 of 所需能力) {
      if (this.具备能力(能力)) {
        匹配的能力.push(能力);
      } else {
        缺失的能力.push(能力);
      }
    }
    
    return {
      匹配成功: 缺失的能力.length === 0,
      匹配的能力,
      缺失的能力
    };
  }

  /**
   * 向管理库报告能力（用于分布式协调）
   * @param {Object} dovesProxy - 鸽子代理
   * @param {Object} 选项 - { 鸽子ID: string } 覆盖本实例的鸽子ID，用于鸽群统一上报
   */
  async 报告能力(dovesProxy = null, 选项 = {}) {
    const 鸽子ID = 选项.鸽子ID || this.鸽子ID;
    
    const 能力数据 = {
      版本: '1.0.0',
      能力总数: this.已注册能力.size,
      能力列表: this.获取所有(),
      doveId: 鸽子ID,
      doveType: this.鸽子类型
    };
    
    // 【技能可靠性】能力报告附带技能可靠性数据
    if (选项.技能可靠性数据) {
      能力数据.技能可靠性 = 选项.技能可靠性数据;
    }
    
    if (!dovesProxy) {
      return { 成功: false, 原因: '无鸽子代理' };
    }
    
    try {
      const result = await dovesProxy.fetch('/api/dove/report-capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(能力数据)
      });
      
      logger.info(`能力报告成功: ${鸽子ID || 'unknown'} ${能力数据.能力总数} 项`);
      return { 成功: true, data: result };
    } catch (错误) {
      logger.error(`报告能力失败 (${鸽子ID}):`, 错误.message);
      return { 成功: false, 错误: 错误.message };
    }
  }

  /**
   * 从管理库同步能力（用于恢复）
   */
  async 同步能力(dovesProxy = null) {
    if (!dovesProxy) {
      return { 成功: false, 原因: '无鸽子代理' };
    }
    
    try {
      const result = await dovesProxy.fetch('/api/dove/get-capabilities');
      
      if (result.success && result.data) {
        this.清空();
        if (result.data.能力列表) {
          for (const 能力 of result.data.能力列表) {
            this.已注册能力.set(能力.名称, 能力);
          }
        }
        logger.debug(`从管理库同步 ${this.已注册能力.size} 项能力`);
        return { 成功: true };
      }
      
      return { 成功: false, 原因: '无数据' };
    } catch (错误) {
      logger.error('同步能力失败:', 错误.message);
      return { 成功: false, 错误: 错误.message };
    }
  }

  /**
   * 注册扩展能力（供扩展加载器调用）
   * @param {string[]} 能力名列表 - 能力名称列表
   * @param {string} 扩展包名 - 来源扩展包
   */
  注册扩展能力(能力名列表, 扩展包名) {
    for (const 能力名 of 能力名列表) {
      this.注册(能力名, {
        来源: '扩展',
        扩展包: 扩展包名,
        描述: `扩展包 ${扩展包名} 提供的能力`
      });
    }
    logger.info(`注册扩展能力: [${能力名列表.join(', ')}] (来自 ${扩展包名})`);
  }

  /**
   * 注销扩展能力（供扩展加载器卸载时调用）
   * @param {string} 扩展包名 - 来源扩展包
   */
  注销扩展能力(扩展包名) {
    const 待移除 = [];
    for (const [名称, 信息] of this.已注册能力) {
      if (信息.扩展包 === 扩展包名) {
        待移除.push(名称);
      }
    }
    for (const 名称 of 待移除) {
      this.已注册能力.delete(名称);
    }
    if (待移除.length > 0) {
      logger.info(`注销扩展能力: [${待移除.join(', ')}] (来自 ${扩展包名})`);
    }
  }

  /**
   * 获取能力摘要（用于显示）
   */
  获取摘要() {
    const lines = [];
    lines.push('=== 能力注册表摘要 ===');
    lines.push(`能力总数: ${this.已注册能力.size}`);
    lines.push('');
    
    for (const 分类 of Object.values(能力分类)) {
      const 能力列表 = this.按分类获取(分类);
      if (能力列表.length > 0) {
        lines.push(`[${分类}] (${能力列表.length}项)`);
        for (const 能力 of 能力列表) {
          lines.push(`  ${能力.名称}: ${能力.描述}`);
        }
        lines.push('');
      }
    }
    
    return lines.join('\n');
  }

  /**
   * 清空能力（重新发现前调用）
   */
  清空能力() {
    this.清空();
  }
}

export default 能力管理器;
