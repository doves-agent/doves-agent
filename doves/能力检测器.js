/**
 * @file 能力检测器
 * @description 统一的能力可用性检测系统，覆盖技能/工具/模型/平台
 * 
 * === 检测类型 ===
 * - skill: 技能检测
 * - tool: 工具检测
 * - model: 模型检测
 * - platform: 平台能力检测
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { access, constants } from 'fs/promises';
import { getProviderApiKeyFromEnv, getProviderEnvKeyNames } from './常量.js';

const execAsync = promisify(exec);

// ============================================================================
// 依赖检测
// ============================================================================

/**
 * 检测 npm 包是否可用
 */
async function 检测Npm包(包名) {
  try {
    const 模块路径 = import.meta.resolve(包名);
    return { available: true, path: 模块路径 };
  } catch (e) {
    return { available: false, error: `包未安装: ${包名}` };
  }
}

/**
 * 检测多个 npm 包
 */
async function 检测Npm包列表(包列表) {
  const 结果 = {};
  let 全部可用 = true;
  
  for (const 包名 of 包列表) {
    const 检测 = await 检测Npm包(包名);
    结果[包名] = 检测;
    if (!检测.available) {
      全部可用 = false;
    }
  }
  
  return { 全部可用, 详情: 结果 };
}

/**
 * 检测系统命令是否可用
 */
async function 检测系统命令(命令) {
  try {
    const platform = process.platform;
    const checkCmd = platform === 'win32' 
      ? `where ${命令}` 
      : `which ${命令}`;
    
    await execAsync(checkCmd, { timeout: 5000 });
    return { available: true };
  } catch (e) {
    return { available: false, error: `命令未找到: ${命令}` };
  }
}

// ============================================================================
// 平台能力检测
// ============================================================================

/**
 * 平台能力检测配置
 * 只保留有实际检测逻辑的能力（纯 process.platform === 的无需配置）
 */
const 平台能力检测配置 = {
  'GUI自动化': {
    平台匹配: ['win32', 'darwin', 'linux'],
    检测方法: async () => {
      try {
        const { mcpConnectionManager } = await import('./tools/mcp客户端.js');
        const conn = mcpConnectionManager.getConnection('os_mcp');
        if (conn?.connected) {
          const guiTools = conn.tools.filter(t =>
            t.name.startsWith('keyboard_') || t.name.startsWith('mouse_') ||
            t.name.startsWith('screenshot_') || t.name.startsWith('window_') ||
            t.name.startsWith('process_')
          );
          return {
            available: true,
            details: { source: 'MCP:os_mcp', toolCount: guiTools.length }
          };
        }
        return {
          available: false,
          reason: '白鸽MCP (os_mcp) 未连接，GUI自动化不可用'
        };
      } catch (e) {
        return {
          available: false,
          reason: `GUI自动化检测失败: ${e.message}`
        };
      }
    }
  },
  
  '浏览器控制': {
    平台匹配: ['win32', 'darwin', 'linux'],
    依赖包: ['puppeteer-core', 'playwright'],
    检测方法: async () => {
      // 简化：只检测 puppeteer-core/playwright 包是否存在
      // 浏览器路径由各引擎自行发现，不需要硬编码
      const puppeteer检测 = await 检测Npm包('puppeteer-core');
      const playwright检测 = await 检测Npm包('playwright');
      
      if (!puppeteer检测.available && !playwright检测.available) {
        return {
          available: false,
          reason: 'puppeteer-core 和 playwright 都未安装',
          安装建议: 'npm install puppeteer-core 或 npm install playwright'
        };
      }
      
      return {
        available: true,
        details: {
          puppeteer: puppeteer检测.available,
          playwright: playwright检测.available
        }
      };
    }
  },
  
  '文件操作': {
    平台匹配: ['win32', 'darwin', 'linux'],
    检测方法: async () => {
      try {
        const testPath = process.cwd();
        await access(testPath, constants.R_OK | constants.W_OK);
        return { available: true, details: { testPath } };
      } catch (e) {
        return { available: false, reason: `文件系统访问受限: ${e.message}` };
      }
    }
  },
  
  '系统管理': {
    平台匹配: ['win32', 'darwin', 'linux'],
    检测方法: async () => {
      try {
        const platform = process.platform;
        const listCmd = platform === 'win32' 
          ? 'tasklist /FI "PID eq 1"' 
          : 'ps -p 1';
        
        await execAsync(listCmd, { timeout: 5000 });
        return { available: true };
      } catch (e) {
        return { available: false, reason: `进程管理受限: ${e.message}` };
      }
    }
  },
  
  '远程执行': {
    平台匹配: ['win32', 'darwin', 'linux'],
    依赖包: ['ssh2'],
    检测方法: async () => {
      const 包检测 = await 检测Npm包('ssh2');
      if (!包检测.available) {
        return { 
          available: false, 
          reason: 'ssh2 未安装，远程执行不可用' 
        };
      }
      return { available: true };
    }
  }
};

// ============================================================================
// 技能检测
// ============================================================================

/**
 * 检测技能可用性
 */
async function 检测技能(技能模块) {
  const 结果 = {
    available: false,
    name: 技能模块.name,
    reason: '',
    details: {}
  };
  
  try {
    // 1. 检测是否有 checkAvailability 方法
    if (typeof 技能模块.checkAvailability === 'function') {
      const 检测结果 = await 技能模块.checkAvailability();
      return {
        ...结果,
        ...检测结果,
        available: 检测结果.available !== false
      };
    }
    
    // 2. 检测是否有 execute 方法
    if (typeof 技能模块.execute !== 'function') {
      return {
        ...结果,
        reason: '技能缺少 execute 方法'
      };
    }
    
    // 3. 检测声明的依赖
    if (技能模块.dependencies && Array.isArray(技能模块.dependencies)) {
      const 依赖检测 = await 检测Npm包列表(技能模块.dependencies);
      if (!依赖检测.全部可用) {
        const 缺失包 = Object.entries(依赖检测.详情)
          .filter(([_, v]) => !v.available)
          .map(([k]) => k);
        return {
          ...结果,
          reason: `缺少依赖包: ${缺失包.join(', ')}`,
          details: 依赖检测.详情
        };
      }
      结果.details.dependencies = 依赖检测.详情;
    }
    
    // 4. 没有特殊检测要求的技能，默认可用
    结果.available = true;
    结果.reason = '技能基础检测通过';
    
  } catch (e) {
    结果.reason = `检测异常: ${e.message}`;
  }
  
  return 结果;
}

// ============================================================================
// 工具检测
// ============================================================================

/**
 * 检测工具可用性
 * 
 * 工具模块有两种格式：
 * 1. 单工具格式：{ name, description, execute, abilities, ... }
 * 2. 工具容器格式：{ xxxTools, handleXxxTool, ... }（导出工具列表+处理函数）
 * 
 * 对于工具容器格式，不需要 execute 方法，只要模块能正常加载即可用
 */
async function 检测工具(工具模块) {
  const 结果 = {
    available: false,
    name: 工具模块.name || '未知工具',
    reason: '',
    details: {}
  };
  
  try {
    // 1. 检测是否有 checkAvailability 方法
    if (typeof 工具模块.checkAvailability === 'function') {
      const 检测结果 = await 工具模块.checkAvailability();
      return {
        ...结果,
        ...检测结果,
        available: 检测结果.available !== false
      };
    }
    
    // 2. 判断是否为单工具格式（有 execute 方法）
    const 是单工具 = typeof 工具模块.execute === 'function';
    
    // 3. 判断是否为工具容器格式（有 xxxTools 属性或 handleXxxTool 方法）
    const 是工具容器 = Object.keys(工具模块).some(key => 
      key.endsWith('Tools') || key.startsWith('handle') || key === '初始化' || key === '是否可用'
    );
    
    if (是单工具) {
      // 单工具格式：有 execute 方法，进一步检测依赖
      if (工具模块.dependencies && Array.isArray(工具模块.dependencies)) {
        const 依赖检测 = await 检测Npm包列表(工具模块.dependencies);
        if (!依赖检测.全部可用) {
          const 缺失包 = Object.entries(依赖检测.详情)
            .filter(([_, v]) => !v.available)
            .map(([k]) => k);
          return {
            ...结果,
            reason: `缺少依赖包: ${缺失包.join(', ')}`,
            details: 依赖检测.详情
          };
        }
        结果.details.dependencies = 依赖检测.详情;
      }
      结果.available = true;
      结果.reason = '工具基础检测通过';
    } else if (是工具容器) {
      // 工具容器格式：不需要 execute 方法，只要模块能正常加载即可
      结果.available = true;
      结果.reason = '工具容器模块加载成功';
      结果.details.format = 'container';
    } else {
      // 既不是单工具也不是工具容器，无法识别
      return {
        ...结果,
        reason: '工具缺少 execute 方法且非工具容器格式'
      };
    }
    
  } catch (e) {
    结果.reason = `检测异常: ${e.message}`;
  }
  
  return 结果;
}

// ============================================================================
// 模型/云端服务检测
// ============================================================================

/**
 * 检测模型提供商可用性
 */
async function 检测模型提供商(提供商名, 配置) {
  const 结果 = {
    available: false,
    name: 提供商名,
    reason: '',
    details: {}
  };
  
  try {
    // 检测 API Key 是否配置
    const envKeyNames = getProviderEnvKeyNames(提供商名);
    const envKeyDisplay = envKeyNames[0] || `${提供商名.toUpperCase()}_API_KEY`;
    const apiKey = getProviderApiKeyFromEnv(提供商名) || process.env[`${提供商名.toUpperCase()}_API_KEY`];
    
    if (!apiKey) {
      return {
        ...结果,
        reason: `未配置 API Key`,
        配置建议: `请设置环境变量 ${envKeyDisplay}`
      };
    }
    
    // 检测端点连通性（简单 ping）
    if (配置.端点) {
      try {
        const response = await fetch(配置.端点.replace('/v1', ''), {
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });
        结果.details.endpointStatus = response.ok ? 'ok' : `HTTP ${response.status}`;
      } catch (e) {
        结果.details.endpointStatus = `连接失败: ${e.message}`;
      }
    }
    
    // 云端服务默认可用
    结果.available = true;
    结果.reason = '云端服务默认可用（API Key 已配置）';
    结果.details.hasApiKey = true;
    
  } catch (e) {
    结果.reason = `检测异常: ${e.message}`;
  }
  
  return 结果;
}

// ============================================================================
// 统一检测接口
// ============================================================================

/**
 * 能力检测器类
 */
export class 能力检测器 {
  constructor() {
    this.检测结果 = new Map();
  }
  
  /**
   * 检测单个能力
   */
  async 检测(类型, 名称, 模块或配置 = null) {
    let 结果;
    
    switch (类型) {
      case 'skill':
        结果 = await 检测技能(模块或配置);
        break;
      case 'tool':
        结果 = await 检测工具(模块或配置);
        break;
      case 'model':
        结果 = await 检测模型提供商(名称, 模块或配置);
        break;
      case 'platform':
        结果 = await this.检测平台能力(名称);
        break;
      default:
        结果 = { available: false, reason: `未知的能力类型: ${类型}` };
    }
    
    this.检测结果.set(`${类型}:${名称}`, 结果);
    
    return 结果;
  }
  
  /**
   * 检测平台能力
   */
  async 检测平台能力(能力名) {
    const 配置 = 平台能力检测配置[能力名];
    
    if (!配置) {
      return {
        available: false,
        name: 能力名,
        reason: `未知的平台能力: ${能力名}`
      };
    }
    
    // 检测平台匹配
    if (配置.平台匹配 && !配置.平台匹配.includes(process.platform)) {
      return {
        available: false,
        name: 能力名,
        reason: `当前平台 ${process.platform} 不支持此能力`,
        supportedPlatforms: 配置.平台匹配
      };
    }
    
    // 检测依赖包
    if (配置.依赖包) {
      const 依赖检测 = await 检测Npm包列表(配置.依赖包);
      if (!依赖检测.全部可用) {
        // 依赖不完整，记录警告
      }
    }
    
    // 执行实际检测
    if (配置.检测方法) {
      const 检测结果 = await 配置.检测方法();
      return {
        available: 检测结果.available,
        name: 能力名,
        reason: 检测结果.reason || (检测结果.available ? '检测通过' : '检测未通过'),
        details: 检测结果.details
      };
    }
    
    // 没有检测方法，只检测平台
    return {
      available: true,
      name: 能力名,
      reason: '平台匹配通过'
    };
  }
  
  /**
   * 检测所有平台能力
   */
  async 检测所有平台能力() {
    const 结果 = {};
    const 能力列表 = Object.keys(平台能力检测配置);
    
    for (const 能力名 of 能力列表) {
      结果[能力名] = await this.检测平台能力(能力名);
    }
    
    return 结果;
  }
  
  /**
   * 批量检测能力
   */
  async 批量检测(能力列表) {
    const 结果 = {};
    
    for (const { 类型, 名称, 模块 } of 能力列表) {
      结果[`${类型}:${名称}`] = await this.检测(类型, 名称, 模块);
    }
    
    return 结果;
  }
  
  /**
   * 获取检测结果摘要
   */
  获取摘要() {
    const 摘要 = {
      总数: this.检测结果.size,
      可用数: 0,
      不可用数: 0,
      详情: {}
    };
    
    for (const [key, result] of this.检测结果) {
      if (result.available) {
        摘要.可用数++;
      } else {
        摘要.不可用数++;
      }
      摘要.详情[key] = {
        available: result.available,
        reason: result.reason
      };
    }
    
    return 摘要;
  }
}

// ============================================================================
// 导出
// ============================================================================

export const 默认检测器 = new 能力检测器();

export default {
  能力检测器,
  默认检测器,
  检测技能,
  检测工具,
  检测模型提供商,
  检测Npm包,
  检测系统命令,
  平台能力检测配置
};
