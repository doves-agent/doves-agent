/**
 * @file extensions/_loader
 * @description 扩展包系统核心加载引擎，扫描并注册各模块
 * 
 * === 职责 ===
 * 1. 扫描 extensions/ 目录下所有扩展包
 * 2. 按 manifest.js 声明加载各模块
 * 3. 将各模块注册到框架对应的管理器（全链路注册）
 * 4. 为每个扩展创建 DoveAppContext (ctx) 并注入
 * 5. 支持卸载（逆序撤销所有注册点的注册）
 * 6. 支持重新加载
 * 
 * === 多位置注册链路 ===
 * 扩展包不只是注册到某一个地方，而是在白鸽框架里
 * skill/tools/mcp 涉及的每一个管理器、每一个注册点都同步操作：
 * - LLM层：意图识别器(扩展注册) + 常量(角色/策略) + LLM执行器(扩展条件提示)
 * - 工具层：技能管理器 + 工具定义 + 工具分类 + 能力映射 + 安全分级 + 能力管理器 + MCP配置
 * - 数据层：数据库权限注册（manifest.permissions.databases → 服务端 extensionDBRegistry）
 * - 接口层：DoveAppContext 创建与注入（按权限声明生成受控 API）
 */

import { readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('扩展加载器', { 前缀: '[扩展加载器]', 级别: 'debug', 显示调用位置: true });

// 框架侧注册函数
import { 注册扩展角色, 注销扩展角色, 注册扩展角色提示, 注销扩展角色提示, 注册扩展策略意图, 注销扩展策略意图 } from '../常量.js';
import { 注册扩展意图, 注销扩展意图 } from '../意图识别器/扩展注册.js';
import { 注册扩展能力, 注销扩展能力 } from '../扩展能力注册表.js';
import { 注册扩展工具, 注销扩展工具 } from '../tools/index.js';
import { 注册扩展执行, 注销扩展执行 } from '../智能体-LLM执行器/_扩展系统.js';
import { 注册扩展技能, 注销扩展技能 } from '../skills/技能常量.js';

// 接口底座
import { DoveAppContext } from './_context.js';
import { permissionValidator, permissionRegistry } from './_permissions.js';
// 授权与上报（从 _loader-授权与上报.js 拆分）
import { 验证开发者身份, 执行授权检查, 上报工具元数据, 上报Web资源, 注册数据库权限, 注销数据库权限, filterUserScopedOnly, 收集Web文件 } from './_loader-授权与上报.js';
import { 是否静默, 记录扩展 } from '../utils/启动汇总.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 扩展加载器类
 * 管理扩展包的发现、加载、注册、卸载生命周期
 */
export class ExtensionLoader {
  constructor() {
    this.扩展目录 = join(__dirname);
    this.已加载 = new Map();  // name → { manifest, modules, 上下文 }
  }

  /**
   * 扫描并加载所有扩展包
   * @param {Object} 上下文 - 框架上下文，包含各管理器引用
   */
  async loadAll(上下文) {
    if (!existsSync(this.扩展目录)) {
      return;
    }

    const 子目录列表 = readdirSync(this.扩展目录, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('_'))
      .map(d => d.name);

    if (子目录列表.length === 0) return;

    // 先读取所有 manifest
    const 扩展清单 = [];
    for (const 目录名 of 子目录列表) {
      try {
        const manifest = await this._读取Manifest(目录名);
        if (manifest) {
          扩展清单.push({ 目录名, manifest });
        }
      } catch (e) {
        logger.warn(`读取 ${目录名}/manifest.js 失败: ${e.message}`);
      }
    }

    // 并行加载所有扩展包（扩展包之间无依赖，可安全并发）
    const 结果列表 = await Promise.allSettled(
      扩展清单.map(({ 目录名 }) =>
        this.load(目录名, 上下文).catch(e => {
          logger.error(`加载扩展包 ${目录名} 失败: ${e.message}`);
          记录扩展(目录名, { 状态: '失败' });
          throw e; // 重新抛出以便 Promise.allSettled 捕获
        })
      )
    );
  }

  /**
   * 加载单个扩展包
   * @param {string} name - 扩展包目录名
   * @param {Object} 上下文 - 框架上下文
   */
  async load(name, 上下文) {
    if (this.已加载.has(name)) return;

    const _t0 = Date.now();
    const _step = (label) => {
      const ms = Date.now() - _t0;
      logger.debug(`${name} ${label} +${ms}ms`);
    };

    const 扩展目录 = join(this.扩展目录, name);
    const manifest = await this._读取Manifest(name);
    if (!manifest) {
      throw new Error(`${name}/manifest.js 不存在或无法加载`);
    }
    _step('manifest读取');

    const 模块缓存 = {};
    let 扩展技能数 = 0;
    let 扩展工具数 = 0;

    // ===== 0. 接口底座：权限声明解析 + DoveAppContext 创建 =====
    const permissions = manifest.permissions || {};
    const permValidation = permissionValidator.validate(permissions);
    if (!permValidation.valid) {
      logger.warn(`⚠️ ${name} 权限声明验证失败: ${permValidation.errors.join('; ')}`);
    }

    // 验证开发者凭证格式
    if (manifest.developer) {
      const devValidation = permissionValidator.validateDeveloper(manifest.developer);
      if (!devValidation.valid) {
        logger.warn(`⚠️ ${name} 开发者凭证格式验证失败: ${devValidation.errors.join('; ')}`);
      }
    }

    // 注册权限到运行时注册表
    const regResult = permissionRegistry.register(name, permissions);
    if (!regResult.success) {
      logger.warn(`⚠️ ${name} 权限注册失败: ${regResult.message}`);
    }

    // ===== 0.5. 开发者身份验证 =====
    const developerInfo = await 验证开发者身份(name, manifest, 上下文.DovesProxy);
    _step('开发者验证');

    // ===== 0.7. 扩展授权检查 =====
    const { authMode, effectivePermissions } = await 执行授权检查(name, manifest, permissions, 上下文.DovesProxy, {
      signatureVerified: developerInfo?.signatureVerified || false,
    });
    _step('授权检查');

    // 将授权信息注入上下文，供 DoveAppContext 使用
    上下文.authMode = authMode;
    上下文.effectivePermissions = effectivePermissions;

    // ===== 0.8. 创建 DoveAppContext（授权检查之后）=====
    let ctx = null;
    if (上下文.DovesProxy) {
      ctx = new DoveAppContext({
        extensionName: name,
        proxy: 上下文.DovesProxy,
        permissions,
        effectivePermissions,
        authMode,
        doveId: 上下文.doveId || null,
        userId: 上下文.userId || null,
        taskId: 上下文.taskId || null,
      });
    } else {
      logger.warn(`⚠️ ${name} 无 DovesProxy，跳过 DoveAppContext 创建`);
    }

    // 将 ctx 注入到上下文中，供扩展代码使用
    上下文.ctx = ctx;

    // ===== 1. LLM层：意图注册 + 扩展能力注册表 =====
    let 意图模块 = null;
    if (manifest.intent) {
      try {
        意图模块 = await this._加载模块(扩展目录, manifest.intent, 模块缓存, 'intent');
        注册扩展意图(意图模块, name);
      } catch (e) {
        logger.warn(`${name} 意图模块加载失败: ${e.message}`);
      }
    }

    // 注册到扩展能力注册表
    let 工作流模块 = null;
    if (manifest.workflow) {
      try {
        工作流模块 = await this._加载模块(扩展目录, manifest.workflow, 模块缓存, 'workflow');
      } catch (e) {
        logger.warn(`${name} 工作流模块加载失败: ${e.message}`);
      }
    }
    注册扩展能力(manifest, 意图模块, 工作流模块);

    // ===== 2. LLM层：角色注册 =====
    if (manifest.roles) {
      try {
        const 角色模块 = await this._加载模块(扩展目录, manifest.roles, 模块缓存, 'roles');
        if (角色模块.validRoles) {
          for (const 角色 of 角色模块.validRoles) {
            注册扩展角色(角色, name);
          }
        }
        if (角色模块.roles) {
          for (const [角色名, 提示] of Object.entries(角色模块.roles)) {
            注册扩展角色提示(角色名, 提示, name);
          }
        }
      } catch (e) {
        logger.warn(`${name} 角色模块加载失败: ${e.message}`);
      }
    }

    // ===== 4. LLM层：执行器增强注册 =====
    if (manifest.execution) {
      try {
        const 执行模块 = await this._加载模块(扩展目录, manifest.execution, 模块缓存, 'execution');
        注册扩展执行(执行模块, name);
      } catch (e) {
        logger.warn(`${name} 执行器增强模块加载失败: ${e.message}`);
      }
    }
    _step('LLM层加载');

    // ===== 6. 工具层：Skills 注册 =====
    if (manifest.skills) {
      try {
        const skillsDir = join(扩展目录, manifest.skills.replace('./', ''));
        if (existsSync(skillsDir)) {
          const 技能列表 = readdirSync(skillsDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);

          for (const 技能名 of 技能列表) {
            const 技能路径 = join(skillsDir, 技能名, 'index.js');
            if (existsSync(技能路径)) {
              try {
                const 技能模块 = await import(`file://${技能路径}`);
                const 技能 = 技能模块.default || 技能模块;

                if (上下文.技能管理器?.注册技能) {
                  上下文.技能管理器.注册技能(技能名, 技能);
                }

                const 分类 = 技能.category || 技能.分类 || null;
                注册扩展技能(技能名, 分类, name);
                扩展技能数++;
              } catch (e) {
                logger.warn(`${name} 技能 ${技能名} 加载失败: ${e.message}`);
              }
            }
          }
        }
      } catch (e) {
        logger.warn(`${name} skills 加载失败: ${e.message}`);
      }
    }

    // ===== 7. 工具层：Tools 注册 =====
    const 注册的工具元数据 = [];
    if (manifest.tools) {
      try {
        const toolsDir = join(扩展目录, manifest.tools.replace('./', ''));
        if (existsSync(toolsDir)) {
          const 工具文件列表 = readdirSync(toolsDir)
            .filter(f => f.endsWith('.js') && !f.startsWith('_'));

          for (const 工具文件 of 工具文件列表) {
            const 工具路径 = join(toolsDir, 工具文件);
            try {
              const 工具模块 = await import(`file://${工具路径}`);

              if (工具模块.extTools || 工具模块.handleExtTool) {
                注册扩展工具(工具模块, name);

                const safetyLevels = 工具模块.extToolSafetyLevels || {};
                for (const toolDef of (工具模块.extTools || [])) {
                  注册的工具元数据.push({
                    name: toolDef.name,
                    description: toolDef.description || '',
                    inputSchema: toolDef.inputSchema || {},
                    safetyLevel: safetyLevels[toolDef.name] || '谨慎',
                  });
                  扩展工具数++;
                }
              }
            } catch (e) {
              logger.warn(`${name} 工具 ${工具文件} 加载失败: ${e.message}`);
            }
          }
        }
      } catch (e) {
        logger.warn(`${name} tools 加载失败: ${e.message}`);
      }
    }

    // ===== 7.5 启动工具元数据上报（不等待，下方与其他上报并行）=====
    const 工具上报Promise = 注册的工具元数据.length > 0
      ? 上报工具元数据(name, 注册的工具元数据, 上下文.DovesProxy, 上下文.doveId || null)
      : Promise.resolve();

    // ===== 8. 工具层：MCP 配置注册 =====
    if (manifest.mcp) {
      try {
        const mcpPath = join(扩展目录, manifest.mcp.replace('./', ''));
        if (existsSync(mcpPath)) {
          const mcp模块 = await import(`file://${mcpPath}`);
          const mcp配置 = mcp模块.default || mcp模块;

          if (上下文.能力管理器?.从MCP配置加载能力) {
            await 上下文.能力管理器.从MCP配置加载能力(mcp配置);
          }
        }
      } catch (e) {
        logger.warn(`${name} MCP 配置加载失败: ${e.message}`);
      }
    }

    // ===== 9. 能力注册 =====
    if (manifest.abilities && 上下文.能力管理器) {
      上下文.能力管理器.注册扩展能力(manifest.abilities, name);
    }

    // ===== 10. 策略意图注册 =====
    if (manifest.abilities) {
      for (const 能力 of manifest.abilities) {
        注册扩展策略意图(能力, name);
      }
    }

    // ===== 11-12. 启动 Web资源上报 + DB权限注册（与工具上报三路并行）=====
    const Web上报Promise = manifest.web
      ? 上报Web资源(name, 扩展目录, manifest, 上下文.DovesProxy, 上下文.doveId || null)
      : Promise.resolve();
    const DB注册Promise = permissions.databases
      ? 注册数据库权限(name, permissions.databases, 上下文.DovesProxy, 上下文.doveId || null)
      : Promise.resolve();

    // 并行等待所有服务端上报完成
    await Promise.all([工具上报Promise, Web上报Promise, DB注册Promise]);
    _step('服务端上报(工具+Web+DB)');

    // ===== 13. 初始化钩子 =====
    if (manifest.onInit) {
      try {
        await manifest.onInit(ctx);
      } catch (e) {
        logger.warn(`${name} onInit 钩子失败: ${e.message}`);
      }
    }
    _step('onInit');

    // ===== 14. 扩展服务启动 =====
    const 启动的服务 = [];
    if (manifest.services) {
      for (const [svcName, svcConfig] of Object.entries(manifest.services)) {
        try {
          const svcModule = await this._加载模块(扩展目录, svcConfig.module, 模块缓存, `svc_${svcName}`);
          if (svcModule.start && typeof svcModule.start === 'function') {
            const port = svcConfig.port;
            const actualPort = await svcModule.start(port);
            启动的服务.push({ name: svcName, module: svcModule, config: svcConfig, actualPort });
          } else {
            logger.warn(`${name} 服务 ${svcName} 缺少 start() 方法`);
          }
        } catch (e) {
          logger.warn(`${name} 服务 ${svcName} 启动失败: ${e.message}`);
        }
      }
    }
    _step('服务启动');

    // 缓存加载结果
    this.已加载.set(name, { manifest, modules: 模块缓存, 上下文, ctx, permissions, developerInfo, 启动的服务 });
    // 记录到启动汇总
    记录扩展(name, { 状态: '成功', 技能数: 扩展技能数, 工具数: 扩展工具数, 模式: authMode });
    _step('✅完成');
  }

  /**
   * 卸载扩展包（逆序撤销所有注册点的注册）
   * @param {string} name - 扩展包目录名
   */
  async unload(name) {
    const 加载信息 = this.已加载.get(name);
    if (!加载信息) {
      logger.warn(`扩展包 ${name} 未加载，无法卸载`);
      return;
    }

    const { manifest, 上下文 } = 加载信息;
    logger.info(`卸载扩展包: ${name}`);

    // 逆序卸载（与加载顺序相反）

    // 14. 扩展服务停止
    if (加载信息.启动的服务?.length > 0) {
      for (const svc of 加载信息.启动的服务) {
        try {
          if (svc.module.stop && typeof svc.module.stop === 'function') {
            await svc.module.stop();
            logger.info(`扩展包 ${name} 服务 ${svc.name} 已停止`);
          }
        } catch (e) {
          logger.warn(`扩展包 ${name} 服务 ${svc.name} 停止失败: ${e.message}`);
        }
      }
    }

    // 13. 初始化钩子无需注销

    // 12. 数据库权限注销（服务端）
    const dbDeclarations = 加载信息.permissions?.databases || manifest.databases;
    if (dbDeclarations) {
      await 注销数据库权限(name, 上下文);
    }

    // 0. 权限注册表注销
    permissionRegistry.unregister(name);
    logger.info(`扩展包 ${name} 运行时权限已注销`);

    // 10. 策略意图注销
    if (manifest.abilities) {
      注销扩展策略意图(name);
    }

    // 9. 能力注销
    if (manifest.abilities && 上下文.能力管理器) {
      上下文.能力管理器.注销扩展能力(name);
    }

    // Web 声明无需注销（仅缓存数据，随已加载.delete自动清理）

    // 8. MCP 不支持动态断开特定扩展的连接（MCP连接是全局的），跳过

    // 7. Tools 注销
    if (manifest.tools) {
      注销扩展工具(name);
    }

    // 6. Skills 注销
    if (manifest.skills && 上下文.技能管理器) {
      if (上下文.技能管理器.注销技能) {
        const 扩展目录 = join(this.扩展目录, name);
        const skillsDir = join(扩展目录, manifest.skills.replace('./', ''));
        if (existsSync(skillsDir)) {
          const 技能列表 = readdirSync(skillsDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);
          for (const 技能名 of 技能列表) {
            上下文.技能管理器.注销技能(技能名);
          }
        }
      }
      注销扩展技能(name);
    }

    // 4. 执行器增强注销
    if (manifest.execution) {
      注销扩展执行(name);
    }

    // 3. 角色注销
    if (manifest.roles) {
      注销扩展角色(name);
      注销扩展角色提示(name);
    }

    // 1. 意图注销（直接调用模块级函数）
    if (manifest.intent) {
      注销扩展意图(name);
    }

    // 扩展能力注册表注销
    注销扩展能力(name);

    this.已加载.delete(name);
    logger.info(`扩展包 ${name} 卸载完成`);
  }

  /**
   * 重新加载扩展包
   */
  async reload(name, 上下文) {
    await this.unload(name);
    await this.load(name, 上下文);
  }

  /**
   * 获取所有已加载扩展包的 Web 配置
   */
  获取扩展Web配置() {
    const 结果 = [];
    for (const [name, { manifest }] of this.已加载) {
      if (manifest.web) {
        const config = {
          name,
          description: manifest.description || '',
          web: manifest.web,
        };
        // 将 externalUrls 权限声明注入 Web 配置
        // 前端引擎可据此控制扩展 Web 页面的出站连接
        if (manifest.permissions?.externalUrls) {
          config.externalUrls = manifest.permissions.externalUrls;
        }
        结果.push(config);
      }
    }
    return 结果;
  }

  获取已加载列表() {
    return Array.from(this.已加载.keys());
  }

  是否已加载(name) {
    return this.已加载.has(name);
  }

  async _读取Manifest(目录名) {
    const manifest路径 = join(this.扩展目录, 目录名, 'manifest.js');
    if (!existsSync(manifest路径)) return null;

    const 模块 = await import(`file://${manifest路径}`);
    return 模块.default || 模块;
  }

  async _加载模块(扩展目录, 模块路径, 缓存, 键名) {
    if (缓存[键名]) return 缓存[键名];

    const 完整路径 = join(扩展目录, 模块路径.replace('./', ''));
    const 模块 = await import(`file://${完整路径}`);
    const 结果 = 模块.default || 模块;
    缓存[键名] = 结果;
    return 结果;
  }

}

export default ExtensionLoader;
