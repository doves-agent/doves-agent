/**
 * @file llm/key-manager
 * @description API Key 管理，提供获取、优先级管理与缓存
 */

/**
 * 提供商名称映射：中文 -> 英文 key
 */
const 提供商名称映射 = {
  '百炼': 'bailian',
  'DeepSeek': 'deepseek',
  'GLM': 'glm',
  '自定义': 'custom'
};

/**
 * API Key 管理器类
 */
export class KeyManager {
  constructor(配置 = {}) {
    this.DovesProxy = 配置.DovesProxy;
    this.系统配置 = 配置.系统配置 || {};
    
    // Key 缓存
    this.key缓存 = new Map();
    this.缓存过期时间 = 配置.缓存过期时间 || 5 * 60 * 1000; // 5分钟
  }

  /**
   * 获取用户 API Key（优先用户配置）
   * @param {string} userId - 用户ID
   * @param {string} provider - 提供商名称
   * @returns {Object} API Key 配置
   */
  async 获取用户APIKey(userId, provider) {
    const 配置键名 = 提供商名称映射[provider] || provider;
    const 缓存键 = `${userId}:${配置键名}`;
    
    // 检查缓存
    const 缓存项 = this.key缓存.get(缓存键);
    if (缓存项 && Date.now() - 缓存项.时间 < this.缓存过期时间) {
      return 缓存项.数据;
    }
    
    // 从服务端获取
    const 结果 = await this._从服务端获取(userId, 配置键名);
    
    // 存入缓存
    this.key缓存.set(缓存键, { 数据: 结果, 时间: Date.now() });
    
    return 结果;
  }

  /**
   * 从服务端获取 API Key 配置
   * @private
   */
  async _从服务端获取(userId, provider) {
    try {
      if (this.DovesProxy) {
        const 用户配置 = await this.DovesProxy.getUserKeys(userId);
        
        // 用户配置格式: { userId, bailian: { configured: true }, ... }
        if (用户配置 && 用户配置[provider]?.configured) {
          // 用户配置了密钥，返回官方配置（实际密钥值在服务端管理）
          const 官方配置 = this.系统配置?.llm?.[provider];
          return {
            apiKey: 官方配置?.apiKey || '',
            source: 'user',
            models: 官方配置?.models || []
          };
        }
      }
    } catch (错误) {
      // 用户没有配置，使用官方
    }
    
    // 返回官方配置
    const 官方配置 = this.系统配置?.llm?.[provider];
    return {
      apiKey: 官方配置?.apiKey || '',
      source: 'official',
      models: 官方配置?.models || []
    };
  }

  /**
   * 获取任何可用的 API Key
   * @param {string} provider - 提供商名称
   * @returns {Object} API Key 配置
   */
  获取官方Key(provider) {
    const 配置键名 = 提供商名称映射[provider] || provider;
    const 官方配置 = this.系统配置?.llm?.[配置键名];
    
    return {
      apiKey: 官方配置?.apiKey || '',
      source: 'official',
      models: 官方配置?.models || []
    };
  }

  /**
   * 检查是否有可用的 API Key
   * @param {string} provider - 提供商名称
   * @returns {boolean}
   */
  有可用Key(provider) {
    const 配置键名 = 提供商名称映射[provider] || provider;
    const 官方配置 = this.系统配置?.llm?.[配置键名];
    return !!(官方配置?.apiKey);
  }

  /**
   * 清除缓存
   */
  清除缓存() {
    this.key缓存.clear();
  }

  /**
   * 更新系统配置
   * @param {Object} 配置 - 新的系统配置
   */
  更新系统配置(配置) {
    this.系统配置 = 配置;
    this.清除缓存();
  }
}

export { 提供商名称映射 };
