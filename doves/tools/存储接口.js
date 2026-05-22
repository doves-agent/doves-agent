/**
 * @file tools/存储接口
 * @description 存储统一接口，提供统一的存储操作抽象层
 *
 * 存储支柱：
 * 1. MongoDB - 状态存储 + 分布式协调
 * 2. Git存储 - 快照/回滚/文件版本管理
 * 3. Git记忆 - 关键词检索/记忆存储
 * 4. OSS - 大文件/用户文件存储
 *
 * 归属：鸽群 Skill
 */

import { MongoDB适配器 } from './存储接口/MongoDB适配器.js';
import { Git记忆适配器 } from './存储接口/Git记忆适配器.js';
import { Git数据适配器 } from './存储接口/Git数据适配器.js';
import { OSS适配器 } from './存储接口/OSS适配器.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('存储接口', { 前缀: '[存储接口]', 级别: 'debug', 显示调用位置: true });

// ==================== 统一存储接口 ====================

/**
 * 统一存储接口类（通过鸽子代理访问数据）
 */
export class 存储接口 {
  constructor(代理实例 = null, 数据库名 = 'doves_user_data') {
    this.mongo = new MongoDB适配器(代理实例, 数据库名);
    this.memory = new Git记忆适配器();
    this.storage = new Git数据适配器();
    this.oss = new OSS适配器();
    
    this.代理 = 代理实例;
    this.数据库名 = 数据库名;
  }

  /**
   * 设置代理
   */
  设置代理(代理实例, 数据库名 = 'doves_user_data') {
    this.代理 = 代理实例;
    this.数据库名 = 数据库名;
    this.mongo = new MongoDB适配器(代理实例, 数据库名);
  }

  /**
   * 获取存储状态
   */
  async getStatus() {
    return {
      mongo: { available: !!this.代理 },
      memory: { available: await this.memory.checkAvailable() },
      storage: { available: await this.storage.checkAvailable() },
      oss: { available: await this.oss.checkAvailable() }
    };
  }

  /**
   * 根据数据特征自动选择存储方式
   * @param {Object} data - 数据
   * @param {Object} options - 选项
   * @returns {string} 推荐的存储类型
   */
  recommendStorage(data, options = {}) {
    // 大文件 -> OSS
    if (options.isLargeFile || (Buffer.isBuffer(data) && data.length > 1024 * 1024)) {
      return 'oss';
    }
    
    // 需要语义搜索 -> Git记忆
    if (options.needSemanticSearch || options.searchable) {
      return 'memory';
    }

    // 需要快照/版本控制 -> Git数据
    if (options.needSnapshot || options.needVersioning) {
      return 'storage';
    }
    
    // 默认 -> MongoDB
    return 'mongo';
  }
}

// ==================== 工具函数 ====================

let _gatewayClient = null;

/**
 * 获取鸽子代理客户端（通过加密通道或 HTTP）
 * 
 * 遵循"统一代理"原则，鸽子通过服务端访问数据，禁止直连数据库
 * 返回 DovesProxy 实例，提供与 MongoDB 兼容的接口
 * 
 * @param {CryptoClient} [cryptoClient] - 可选的加密客户端
 * @returns {Promise<DovesProxy>}
 */
export async function getDovesProxy(cryptoClient = null) {
  if (_gatewayClient) {
    return _gatewayClient;
  }
  
  const { DovesProxy } = await import('../doves_proxy/index.js');
  
  _gatewayClient = new DovesProxy({
    cryptoClient,
    serverUrl: process.env.SERVER_URL,
    apiKey: process.env.SERVER_API_KEY
  });
  
  // 验证连接
  const health = await _gatewayClient.healthCheck();
  if (!health.success) {
    _gatewayClient = null;
    throw new Error(`服务端连接失败: ${health.error}`);
  }
  
  return _gatewayClient;
}

// ==================== 导出 ====================
// 存储接口 already exported via export class/function

export { MongoDB适配器 };
export { Git记忆适配器 };
export { Git数据适配器 };
export { OSS适配器 };

export default {
  存储接口,
  MongoDB适配器,
  Git记忆适配器,
  Git数据适配器,
  OSS适配器,
  getDovesProxy
};
