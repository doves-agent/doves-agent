/**
 * IM适配器抽象层
 * 
 * 定义IM平台适配器的抽象基类和注册表
 * 支持钉钉、飞书、企业微信等多种IM平台的统一接入
 */

/**
 * IM适配器抽象基类
 * 所有具体IM平台适配器必须继承此类
 */
export class IM适配器 {
  /**
   * @param {string} 平台名称 - 平台标识名称
   * @param {Object} 配置 - 平台特定配置
   */
  constructor(平台名称, 配置 = {}) {
    this.平台名称 = 平台名称;
    this.配置 = 配置;
    this.已初始化 = false;
    this.最后错误 = null;
  }

  /**
   * 初始化适配器
   * 子类必须实现此方法
   * @throws {Error} 如果未实现
   */
  async 初始化() {
    throw new Error('子类必须实现 初始化()');
  }

  /**
   * 发送消息到指定用户
   * 子类必须实现此方法
   * @param {string} 用户ID - 目标用户标识
   * @param {Object} 消息 - 消息对象（需支持 toText/toMarkdown/toJSON 方法）
   * @throws {Error} 如果未实现
   */
  async 发送消息(用户ID, 消息) {
    throw new Error('子类必须实现 发送消息()');
  }

  /**
   * 等待用户回复
   * 子类必须实现此方法
   * @param {string} 用户ID - 目标用户标识
   * @param {number} 超时毫秒 - 等待超时时间（默认5分钟）
   * @returns {Promise<Object>} 用户回复结果
   * @throws {Error} 如果未实现
   */
  async 等待回复(用户ID, 超时毫秒 = 300000) {
    throw new Error('子类必须实现 等待回复()');
  }

  /**
   * 解析用户回复消息
   * 子类必须实现此方法
   * @param {Object} 原始消息 - 平台原始消息格式
   * @returns {Object} 标准化回复对象
   * @throws {Error} 如果未实现
   */
  async 解析回复(原始消息) {
    throw new Error('子类必须实现 解析回复()');
  }

  /**
   * 测试连接是否可用
   * 子类必须实现此方法
   * @returns {Promise<boolean>} 连接是否成功
   * @throws {Error} 如果未实现
   */
  async 测试连接() {
    throw new Error('子类必须实现 测试连接()');
  }

  // ==================== 媒体文件接口（富媒体支持） ====================

  /**
   * 下载媒体文件
   * 从 IM 平台下载并解密媒体文件
   * @param {Object} 原始消息项 - 平台原始消息项（含媒体引用）
   * @returns {Promise<{ data: Buffer, kind: string, fileName?: string } | null>}
   */
  async 下载媒体(原始消息项) {
    // 默认实现：不支持
    return null;
  }

  /**
   * 上传媒体文件到平台 CDN
   * @param {string} 文件路径 - 本地文件路径
   * @param {string} 用户ID - 目标用户ID（部分平台需要）
   * @returns {Promise<Object>} 平台特定上传结果（含 CDN 引用）
   */
  async 上传媒体(文件路径, 用户ID) {
    throw new Error('子类必须实现 上传媒体()');
  }

  /**
   * 发送富媒体消息
   * @param {string} 用户ID - 目标用户ID
   * @param {Object} 上传结果 - 上传媒体() 的返回值
   * @param {string} 文件名 - 文件名
   * @param {string} [附加文字] - 附加文字说明
   * @returns {Promise<Object>} 发送结果
   */
  async 发送富媒体消息(用户ID, 上传结果, 文件名, 附加文字) {
    throw new Error('子类必须实现 发送富媒体消息()');
  }

  /**
   * 检查是否支持媒体操作
   * @returns {boolean}
   */
  支持媒体() {
    return false;
  }

  /**
   * 获取适配器状态
   * @returns {Object} 当前状态信息
   */
  获取状态() {
    return {
      平台名称: this.平台名称,
      已初始化: this.已初始化,
      最后错误: this.最后错误,
      配置: this._安全配置()
    };
  }

  /**
   * 安全地返回配置（隐藏敏感信息）
   * @private
   */
  _安全配置() {
    const 敏感字段 = ['secret', 'token', 'key', 'password', 'webhookUrl'];
    const 安全配置 = {};
    
    for (const [键, 值] of Object.entries(this.配置)) {
      if (敏感字段.some(敏感词 => 键.toLowerCase().includes(敏感词.toLowerCase()))) {
        安全配置[键] = 值 ? '***已配置***' : '未配置';
      } else {
        安全配置[键] = 值;
      }
    }
    
    return 安全配置;
  }

  /**
   * 记录错误
   * @protected
   * @param {Error} 错误 - 错误对象
   */
  _记录错误(错误) {
    this.最后错误 = {
      message: 错误.message,
      timestamp: toLocalISOString(),
      stack: 错误.stack
    };
  }

  /**
   * 清除错误状态
   * @protected
   */
  _清除错误() {
    this.最后错误 = null;
  }
}

/**
 * 适配器注册表（单例模式）
 * 管理所有已注册的IM适配器实例
 */
class _适配器注册表 {
  constructor() {
    this.适配器 = new Map();
    this.初始化时间 = null;
  }

  /**
   * 注册适配器实例
   * @param {string} 平台名 - 平台标识名称
   * @param {IM适配器} 适配器实例 - 适配器实例
   */
  注册(平台名, 适配器实例) {
    if (!(适配器实例 instanceof IM适配器)) {
      throw new Error('注册的适配器必须是 IM适配器 的子类实例');
    }
    
    this.适配器.set(平台名, 适配器实例);
    console.log(`[IM适配器] 已注册: ${平台名}`);
  }

  /**
   * 获取指定平台的适配器
   * @param {string} 平台名 - 平台标识名称
   * @returns {IM适配器|undefined} 适配器实例
   */
  获取(平台名) {
    return this.适配器.get(平台名);
  }

  /**
   * 获取所有已注册的适配器
   * @returns {Array<[string, IM适配器]>} 平台名和适配器实例的数组
   */
  获取所有() {
    return Array.from(this.适配器.entries());
  }

  /**
   * 检查指定平台的适配器是否可用
   * @param {string} 平台名 - 平台标识名称
   * @returns {boolean} 是否可用
   */
  是否可用(平台名) {
    const 适配器 = this.适配器.get(平台名);
    return 适配器 && 适配器.已初始化;
  }

  /**
   * 获取所有可用平台列表
   * @returns {string[]} 可用平台名称数组
   */
  获取可用平台() {
    return Array.from(this.适配器.entries())
      .filter(([_, 适配器]) => 适配器.已初始化)
      .map(([平台名, _]) => 平台名);
  }

  /**
   * 注销适配器
   * @param {string} 平台名 - 平台标识名称
   * @returns {boolean} 是否成功注销
   */
  注销(平台名) {
    if (this.适配器.has(平台名)) {
      this.适配器.delete(平台名);
      console.log(`[IM适配器] 已注销: ${平台名}`);
      return true;
    }
    return false;
  }

  /**
   * 获取注册表状态
   * @returns {Object} 状态信息
   */
  获取状态() {
    const 所有适配器 = this.获取所有();
    return {
      初始化时间: this.初始化时间,
      注册数量: 所有适配器.length,
      可用数量: this.获取可用平台().length,
      平台列表: 所有适配器.map(([平台名, 适配器]) => ({
        平台名,
        状态: 适配器.获取状态()
      }))
    };
  }
}

// 导出单例实例
export const 适配器注册表 = new _适配器注册表();

/**
 * 初始化IM适配器
 * 根据配置列表初始化并注册所有适配器
 * 
 * @param {Array<Object>} 配置列表 - 适配器配置数组
 * @param {string} 配置列表[].平台 - 平台名称（如 'dingtalk'）
 * @param {Object} 配置列表[].配置 - 平台特定配置
 * @returns {Promise<Object>} 初始化结果
 */
export async function 初始化IM适配器(配置列表 = []) {
  const 结果 = {
    成功: [],
    失败: [],
    总数: 配置列表.length
  };

  for (const 配置 of 配置列表) {
    try {
      if (配置.平台 === 'dingtalk') {
        const { 钉钉适配器 } = await import('./钉钉适配器.js');
        const adapter = new 钉钉适配器(配置);
        await adapter.初始化();
        适配器注册表.注册('dingtalk', adapter);
        结果.成功.push({ 平台: 'dingtalk', 状态: '已初始化' });
      } else if (配置.平台 === 'feishu') {
        const { 飞书适配器 } = await import('./飞书适配器.js');
        const adapter = new 飞书适配器(配置);
        await adapter.初始化();
        适配器注册表.注册('feishu', adapter);
        结果.成功.push({ 平台: 'feishu', 状态: '已初始化' });
      } else {
        结果.失败.push({ 
          平台: 配置.平台, 
          错误: `不支持的平台类型: ${配置.平台}` 
        });
      }
      // 后续可扩展其他平台：wecom 等
    } catch (错误) {
      console.error(`[IM适配器] 初始化 ${配置.平台} 失败:`, 错误.message);
      结果.失败.push({ 
        平台: 配置.平台, 
        错误: 错误.message 
      });
    }
  }

  适配器注册表.初始化时间 = toLocalISOString();
  
  console.log(`[IM适配器] 初始化完成: ${结果.成功.length}/${结果.总数} 成功`);
  return 结果;
}

/**
 * 发送消息到指定平台
 * 便捷函数，自动从注册表获取适配器
 * 
 * @param {string} 平台名 - 平台名称
 * @param {string} 用户ID - 目标用户ID
 * @param {Object} 消息 - 消息对象
 * @returns {Promise<Object>} 发送结果
 */
export async function 发送IM消息(平台名, 用户ID, 消息) {
  const 适配器 = 适配器注册表.获取(平台名);
  
  if (!适配器) {
    throw new Error(`未找到平台适配器: ${平台名}`);
  }
  
  if (!适配器.已初始化) {
    throw new Error(`适配器未初始化: ${平台名}`);
  }
  
  return await 适配器.发送消息(用户ID, 消息);
}

/**
 * 等待用户回复
 * 便捷函数，自动从注册表获取适配器
 * 
 * @param {string} 平台名 - 平台名称
 * @param {string} 用户ID - 目标用户ID
 * @param {number} 超时毫秒 - 超时时间
 * @returns {Promise<Object>} 用户回复
 */
export async function 等待IM回复(平台名, 用户ID, 超时毫秒 = 300000) {
  const 适配器 = 适配器注册表.获取(平台名);
  
  if (!适配器) {
    throw new Error(`未找到平台适配器: ${平台名}`);
  }
  
  if (!适配器.已初始化) {
    throw new Error(`适配器未初始化: ${平台名}`);
  }
  
  return await 适配器.等待回复(用户ID, 超时毫秒);
}

// 默认导出
export default {
  IM适配器,
  适配器注册表,
  初始化IM适配器,
  发送IM消息,
  等待IM回复
};
