/**
 * @file skills/技能管理器
 * @description 技能注册、加载、执行与权限验证
 */

import { readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { 验证技能参数 as _验证技能参数 } from './技能验证器.js';
import { 技能分类, 已实现技能, 扫描技能目录, 扫描多个技能目录 } from './技能常量.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('技能管理器', { 前缀: '[技能管理器]', 级别: 'debug', 显示调用位置: true });
import { 是否静默 } from '../utils/启动汇总.js';
import {
  设置禁用配置,
  检查技能禁用状态,
  获取技能分类,
  禁用技能,
  启用技能,
  禁用分类,
  启用分类,
  获取禁用列表,
  获取可用技能列表,
  获取所有技能详情
} from './技能禁用管理.js';

// 获取当前目录
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 技能管理器类
 */
export class 技能管理器 {
  constructor(配置 = {}) {
    this.已注册技能 = new Map();
    this.技能索引 = new Map();
    this.执行日志 = [];
    this.最大日志数 = 配置.最大日志数 || 1000;
    this.验证参数 = 配置.验证参数 !== false;
    this.数据库连接 = null;
    this.用户数据库名 = null;
    this.禁用技能列表 = new Set(配置.禁用技能列表 || []);
    this.禁用分类列表 = new Set(配置.禁用分类列表 || []);
  }

  // ==================== 禁用管理（委托给 技能禁用管理.js） ====================

  设置禁用配置(配置 = {}) { return 设置禁用配置(this, 配置); }
  检查技能禁用状态(技能名) { return 检查技能禁用状态(this, 技能名); }
  获取技能分类(技能名) { return 获取技能分类(this, 技能名); }
  禁用技能(技能名) { return 禁用技能(this, 技能名); }
  启用技能(技能名) { return 启用技能(this, 技能名); }
  禁用分类(分类名) { return 禁用分类(this, 分类名); }
  启用分类(分类名) { return 启用分类(this, 分类名); }
  获取禁用列表() { return 获取禁用列表(this); }
  获取可用技能列表() { return 获取可用技能列表(this); }
  获取所有技能详情() { return 获取所有技能详情(this); }

  设置数据库连接(db, dbName) {
    this.数据库连接 = db;
    this.用户数据库名 = dbName;
    logger.debug(`代理连接已设置: ${dbName}`);
  }

  /**
   * 统一技能加载方法 - 支持目录和数据库双模式加载
   */
  async loadSkills(配置 = {}) {
    const {
      从目录加载 = true,
      从数据库加载 = true,
      额外技能目录 = [],
      扫描目录 = true,
      指定技能列表 = null
    } = 配置;

    logger.info('开始加载技能...');
    logger.info(`加载配置: 目录=${从目录加载}, 数据库=${从数据库加载}`);

    const 结果 = {
      成功: 0,
      失败: 0,
      技能列表: [],
      来源: { 目录: 0, 数据库: 0 }
    };

    if (从目录加载) {
      const 目录加载结果 = await this._从目录加载技能(额外技能目录, 扫描目录, 指定技能列表);
      结果.成功 += 目录加载结果.成功;
      结果.失败 += 目录加载结果.失败;
      结果.技能列表.push(...目录加载结果.技能列表);
      结果.来源.目录 = 目录加载结果.成功;
    }

    if (从数据库加载) {
      if (this.数据库连接) {
        logger.debug('尝试从数据库加载技能...');
        const 数据库加载数量 = await this.从数据库加载技能();
        结果.来源.数据库 = 数据库加载数量;
        结果.成功 += 数据库加载数量;
      } else {
        logger.warn('未配置数据库连接，跳过数据库技能加载');
      }
    }

    logger.info(`技能加载完成: 成功 ${结果.成功}, 失败 ${结果.失败}`);
    logger.info(`来源统计: 目录 ${结果.来源.目录} 个, 数据库 ${结果.来源.数据库} 个`);
    
    return 结果;
  }

  /**
   * 从目录加载技能（内部方法）
   * @private
   */
  async _从目录加载技能(额外技能目录 = [], 扫描目录 = true, 指定技能列表 = null) {
    const 结果 = { 成功: 0, 失败: 0, 技能列表: [] };

    let 技能列表;
    if (指定技能列表 && Array.isArray(指定技能列表)) {
      技能列表 = 指定技能列表.map(名称 => ({
        名称,
        路径: join(__dirname, 名称, 'index.js'),
        目录: __dirname
      }));
      
      for (const 额外目录 of 额外技能目录) {
        for (const 技能名 of 指定技能列表) {
          const 额外路径 = join(额外目录, 技能名, 'index.js');
          if (existsSync(额外路径)) {
            const existing = 技能列表.find(s => s.名称 === 技能名);
            if (existing) {
              existing.路径 = 额外路径;
              existing.目录 = 额外目录;
            }
          }
        }
      }
    } else if (扫描目录) {
      技能列表 = 扫描多个技能目录(额外技能目录);
    } else {
      技能列表 = 已实现技能.map(名称 => ({
        名称,
        路径: join(__dirname, 名称, 'index.js'),
        目录: __dirname
      }));
    }

    for (const 技能 of 技能列表) {
      try {
        const 模块 = await import(`file:///${技能.路径.replace(/\\/g, '/')}`);
        
        if (模块.default) {
          this.已注册技能.set(技能.名称, 模块.default);
          结果.成功++;
          结果.技能列表.push({
            名称: 技能.名称,
            状态: '已加载',
            来源: '目录',
            路径: 技能.路径,
            描述: 模块.default.description || ''
          });
          logger.info(`从目录加载技能: ${技能.名称}`);
        } else {
          结果.失败++;
          结果.技能列表.push({ 名称: 技能.名称, 状态: '格式无效', 来源: '目录' });
        }
      } catch (错误) {
        结果.失败++;
        结果.技能列表.push({ 名称: 技能.名称, 状态: '加载失败', 来源: '目录', 错误: 错误.message });
        logger.error(`从目录加载技能 ${技能.名称} 失败: ${错误.message}`);
      }
    }

    return 结果;
  }

  /**
   * 从数据库加载所有活跃技能
   */
  async 从数据库加载技能() {
    if (!this.数据库连接) {
      logger.warn('未设置数据库连接，跳过从数据库加载技能');
      return 0;
    }

    try {
      const db = this.数据库连接;
      const skills = await db.collection('技能')
        .find({ 状态: '活跃' })
        .toArray();

      let 加载数量 = 0;
      for (const skill of skills) {
        try {
          const execute = this.编译技能代码(skill.代码, skill.id);
          if (!execute) continue;

          this.已注册技能.set(skill.id, {
            id: skill.id,
            _id: skill._id,
            标题: skill.标题,
            描述: skill.描述,
            参数: skill.参数 || { type: 'object', properties: {}, required: [] },
            仅限管理员: skill.仅限管理员 || false,
            黑名单: skill.黑名单 || [],
            价格: skill.价格 || 0,
            状态: skill.状态,
            需要拥有权: skill.需要拥有权 !== false,
            execute
          });

          加载数量++;
          logger.info(`从数据库加载技能: ${skill.id} (${skill.标题 || ''})`);
        } catch (错误) {
          logger.error(`加载技能 ${skill.id} 失败: ${错误.message}`);
        }
      }

      logger.info(`共从数据库加载 ${加载数量} 个技能`);
      return 加载数量;
    } catch (错误) {
      logger.error(`从数据库加载技能失败: ${错误.message}`);
      return 0;
    }
  }

  /**
   * 编译技能代码为可执行函数
   */
  编译技能代码(code, skillId) {
    if (!code || typeof code !== 'string') {
      logger.warn(`技能 ${skillId} 代码为空`);
      return null;
    }

    try {
      const execute = new Function(
        'params',
        'context',
        `return (${code})(params, context);`
      );

      if (typeof execute !== 'function') {
        throw new Error('编译结果不是函数');
      }

      return execute;
    } catch (错误) {
      logger.error(`编译技能 ${skillId} 代码失败: ${错误.message}`);
      return null;
    }
  }

  注册技能(技能名, 技能模块) {
    if (!技能模块 || typeof 技能模块.execute !== 'function') {
      logger.error(`无效的技能模块: ${技能名}`);
      return false;
    }
    
    this.已注册技能.set(技能名, 技能模块);
    logger.info(`注册技能: ${技能名}`);
    return true;
  }

  注销技能(技能名) {
    const result = this.已注册技能.delete(技能名);
    if (result) {
      logger.info(`注销技能: ${技能名}`);
    }
    return result;
  }

  批量注册(技能映射) {
    Object.entries(技能映射).forEach(([名称, 模块]) => {
      this.注册技能(名称, 模块);
    });
  }

  async 加载技能(技能名) {
    logger.info(`加载技能: ${技能名}`);
    
    if (this.已注册技能.has(技能名)) {
      return this.已注册技能.get(技能名);
    }
    
    try {
      const 模块 = await import(`./${技能名}/index.js`);
      if (模块.default) {
        this.注册技能(技能名, 模块.default);
        return 模块.default;
      }
    } catch (错误) {
      logger.error(`加载技能 ${技能名} 失败: ${错误.message}`);
    }
    
    return null;
  }

  async 加载所有技能(扫描目录 = true) {
    logger.info('开始加载所有技能...');
      
    const 技能列表 = 扫描目录 ? 扫描技能目录() : 已实现技能;
      
    const 结果 = { 成功: 0, 失败: 0, 技能列表: [] };
      
    for (const 技能名 of 技能列表) {
      const 技能 = await this.加载技能(技能名);
      if (技能) {
        结果.成功++;
        结果.技能列表.push({ 名称: 技能名, 状态: '已加载', 描述: 技能.description });
      } else {
        结果.失败++;
        结果.技能列表.push({ 名称: 技能名, 状态: '加载失败' });
      }
    }
      
    logger.info(`技能加载完成: 成功 ${结果.成功}, 失败 ${结果.失败}`);
    return 结果;
  }
  
  /**
   * 验证技能参数（委托给技能验证器）
   */
  验证技能参数(技能, 参数) {
    return _验证技能参数(技能, 参数);
  }
  
  记录执行日志(记录) {
    this.执行日志.push({
      ...记录,
      timestamp: new Date().toISOString()
    });
      
    if (this.执行日志.length > this.最大日志数) {
      this.执行日志.shift();
    }
  }
  
  获取执行日志(过滤条件 = {}) {
    let logs = [...this.执行日志];
      
    if (过滤条件.技能名) {
      logs = logs.filter(l => l.技能名 === 过滤条件.技能名);
    }
    if (过滤条件.成功 !== undefined) {
      logs = logs.filter(l => l.成功 === 过滤条件.成功);
    }
    if (过滤条件.开始时间) {
      logs = logs.filter(l => new Date(l.timestamp) >= new Date(过滤条件.开始时间));
    }
    if (过滤条件.限制数量) {
      logs = logs.slice(-过滤条件.限制数量);
    }
      
    return logs;
  }

  /**
   * 执行技能
   */
  async 执行技能(技能名, 参数, 上下文 = {}) {
    const 开始时间 = Date.now();
    logger.debug(`执行技能: ${技能名}`);
      
    const 技能 = this.已注册技能.get(技能名);
    if (!技能) {
      const 错误结果 = { 成功: false, 错误: `技能 ${技能名} 未注册`, 错误码: 'SKILL_NOT_FOUND' };
      this.记录执行日志({ 技能名, 参数, 结果: 错误结果, 成功: false, 耗时: 0 });
      return 错误结果;
    }
      
    // 参数验证
    if (this.验证参数) {
      const 验证结果 = this.验证技能参数(技能, 参数);
      if (!验证结果.valid) {
        const 错误结果 = { 
          成功: false, 
          错误: '参数验证失败', 
          错误码: 'INVALID_PARAMS',
          details: 验证结果.errors 
        };
        this.记录执行日志({ 技能名, 参数, 结果: 错误结果, 成功: false, 耗时: 0 });
        return 错误结果;
      }
    }
        
    // ==================== 权限验证逻辑 ====================
    const 用户角色 = 上下文.userRole || 上下文.用户角色 || 'user';
    const 用户ID = 上下文.userId || 上下文.用户ID;
    
    // 1. 管理员直接通过
    if (用户角色 === 'admin') {
      logger.debug(`管理员权限通过: ${技能名} (${用户ID})`);
    } else {
      // 2. 检查技能是否禁用
      if (技能.状态 === 'disabled') {
        const 错误结果 = { 
          成功: false, 
          错误: `技能「${技能名}」已禁用`, 
          错误码: 'SKILL_DISABLED'
        };
        this.记录执行日志({ 技能名, 参数, 结果: 错误结果, 成功: false, 耗时: 0 });
        return 错误结果;
      }
      
      // 3. 检查黑名单（最高优先级）
      if (技能.黑名单 && 技能.黑名单.includes(用户ID)) {
        const 错误结果 = { 
          成功: false, 
          错误: `您已被禁止使用技能「${技能名}」`, 
          错误码: 'BLACKLISTED'
        };
        this.记录执行日志({ 技能名, 参数, 结果: 错误结果, 成功: false, 耗时: 0 });
        logger.warn(`黑名单拒绝: ${技能名} 用户 ${用户ID}`);
        return 错误结果;
      }
      
      // 4. 检查是否仅限管理员
      if (技能.仅限管理员) {
        const 错误结果 = { 
          成功: false, 
          错误: `技能「${技能名}」仅限管理员使用`, 
          错误码: 'ADMIN_ONLY'
        };
        this.记录执行日志({ 技能名, 参数, 结果: 错误结果, 成功: false, 耗时: 0 });
        return 错误结果;
      }
      
      // 5. 检查用户是否拥有该技能
      if (技能.需要拥有权 !== false) {
        const 用户数据 = 上下文.userData || {};
        const 拥有技能 = 用户数据.拥有技能?.find(s => s.id === 技能名 || s.id === 技能.id);
        
        if (!拥有技能) {
          const 错误结果 = { 
            成功: false, 
            错误: `您尚未获得技能「${技能名}」的授权`, 
            错误码: 'NOT_OWNED'
          };
          this.记录执行日志({ 技能名, 参数, 结果: 错误结果, 成功: false, 耗时: 0 });
          return 错误结果;
        }
        
        // 检查是否过期
        if (拥有技能.过期时间 && new Date(拥有技能.过期时间) < new Date()) {
          const 错误结果 = { 
            成功: false, 
            错误: `技能「${技能名}」的授权已过期`, 
            错误码: 'EXPIRED'
          };
          this.记录执行日志({ 技能名, 参数, 结果: 错误结果, 成功: false, 耗时: 0 });
          return 错误结果;
        }
      }
      
      logger.debug(`权限验证通过: ${技能名} (${用户ID})`);
    }
    // ==================== 权限验证逻辑结束 ====================
        
    try {
      const 结果 = await 技能.execute(参数, 上下文);
      const 耗时 = Date.now() - 开始时间;
        
      const 标准结果 = this.标准化结果(结果, 技能名);
        
      this.记录执行日志({
        技能名,
        参数,
        结果: 标准结果,
        成功: 标准结果.成功 !== false,
        耗时
      });
        
      return 标准结果;
    } catch (错误) {
      const 耗时 = Date.now() - 开始时间;
      const 错误结果 = { 
        成功: false, 
        错误: 错误.message,
        错误码: 'EXECUTION_ERROR',
        stack: 错误.stack
      };
        
      this.记录执行日志({ 技能名, 参数, 结果: 错误结果, 成功: false, 耗时 });
      return 错误结果;
    }
  }
  
  /**
   * 标准化执行结果
   */
  标准化结果(结果, 技能名) {
    if (结果 && typeof 结果 === 'object' && ('成功' in 结果 || 'success' in 结果)) {
      if ('success' in 结果 && !('成功' in 结果)) {
        结果.成功 = 结果.success;
      }
      if ('error' in 结果 && !('错误' in 结果)) {
        结果.错误 = 结果.error;
      }
      return 结果;
    }
      
    return {
      成功: true,
      数据: 结果,
      技能名
    };
  }

  获取技能列表() {
    return Array.from(this.已注册技能.keys());
  }

  技能存在(技能名) {
    return this.已注册技能.has(技能名);
  }

  获取技能描述(技能名) {
    const 技能 = this.已注册技能.get(技能名);
    
    if (!技能) {
      return {
        name: 技能名,
        description: '技能未注册',
        parameters: { type: 'object', properties: {}, required: [] }
      };
    }
    
    let 描述文本 = 技能.description || '技能描述';
    if (技能.requiredRole) {
      描述文本 = `[需要${技能.requiredRole === 'admin' ? '管理员' : 技能.requiredRole}权限] ${描述文本}`;
    }
    
    return {
      name: 技能.name || 技能名,
      description: 描述文本,
      parameters: 技能.parameters || { type: 'object', properties: {}, required: [] },
      requiredRole: 技能.requiredRole || null
    };
  }

  获取所有技能描述() {
    return this.获取技能列表().map(名称 => this.获取技能描述(名称));
  }
}
