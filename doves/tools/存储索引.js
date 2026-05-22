/**
 * @file tools/存储索引
 * @description 统一管理存储支柱：OSS、Git记忆、Git存储
 *
 * 存储支柱：
 * 1. MongoDB - 状态存储 + 分布式协调
 * 2. Git存储 - 快照/回滚/文件版本管理
 * 3. Git记忆 - 关键词检索/记忆存储
 * 4. OSS - 大文件/用户文件存储
 *
 * 归属：鸽群 Skill
 */

import OSS存储 from './oss存储.js';
import Git记忆 from './Git存储/记忆仓库.js';
import Git数据 from './Git存储/数据仓库.js';

/**
 * 简单日志器
 */
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('存储系统', { 前缀: '[存储系统]', 级别: 'debug', 显示调用位置: true });

// ==================== 初始化 ====================

/**
 * 初始化所有存储系统
 * @param {object} 配置 - 配置选项
 * @returns {Promise<{成功: boolean, 状态?: object}>}
 */
export async function 初始化所有存储(配置 = {}) {
  const 状态 = {
    OSS: { 可用: false, 信息: '' },
    Git记忆: { 可用: false, 信息: '' },
    Git数据: { 可用: false, 信息: '' }
  };
  
  try {
    // 初始化 OSS（只在显式传入配置时才调用初始化）
    if (配置.OSS) {
      OSS存储.初始化(配置.OSS);
    }
    const oss测试 = await OSS存储.测试连接();
    状态.OSS = {
      可用: oss测试.成功,
      信息: oss测试.成功 ? oss测试.信息 : oss测试.错误
    };
  } catch (e) {
    状态.OSS.信息 = `初始化失败: ${e.message}`;
  }
  
  try {
    // 初始化Git记忆
    if (配置.Git记忆) {
      // no-op, 连接通过API按需建立
    }
    状态.Git记忆 = {
      可用: Git记忆.是否可用(),
      信息: Git记忆.是否可用() ? '通过Server API连接' : 'Server未配置'
    };
  } catch (e) {
    状态.Git记忆.信息 = `初始化失败: ${e.message}`;
  }

  try {
    // 初始化Git数据
    状态.Git数据 = {
      可用: Git数据.是否可用(),
      信息: Git数据.是否可用() ? '通过Server API连接' : 'Server未配置'
    };
  } catch (e) {
    状态.Git数据.信息 = `初始化失败: ${e.message}`;
  }
  
  const 成功 = 状态.OSS.可用 || 状态.Git记忆.可用 || 状态.Git数据.可用;
  
  logger.info('存储系统初始化完成:', 状态);
  
  return { 成功, 状态 };
}

/**
 * 获取所有存储状态
 * @returns {Promise<object>}
 */
export async function 获取所有状态() {
  const 状态 = {};
  
  try {
    const oss状态 = await OSS存储.测试连接();
    状态.OSS = {
      可用: oss状态.成功,
      信息: oss状态.成功 ? oss状态.信息 : oss状态.错误
    };
  } catch (e) {
    状态.OSS = { 可用: false, 信息: e.message };
  }
  
  try {
    状态.Git记忆 = { 可用: Git记忆.是否可用(), 信息: Git记忆.是否可用() ? '正常' : 'Server未配置' };
  } catch (e) {
    状态.Git记忆 = { 可用: false, 信息: e.message };
  }

  try {
    状态.Git数据 = { 可用: Git数据.是否可用(), 信息: Git数据.是否可用() ? '正常' : 'Server未配置' };
  } catch (e) {
    状态.Git数据 = { 可用: false, 信息: e.message };
  }
  
  return 状态;
}

// ==================== 便捷操作 ====================

/**
 * 智能存储 - 根据文件大小自动选择存储方式
 * @param {Buffer|string} 源 - 文件内容或路径
 * @param {string} 文件名 - 文件名
 * @param {object} 选项 - 选项
 * @returns {Promise<{成功: boolean, 路径?: string, 网址?: string, 错误?: string}>}
 */
export async function 存储(源, 文件名, 选项 = {}) {
  // 判断文件大小
  let 大小 = 0;
  if (Buffer.isBuffer(源)) {
    大小 = 源.length;
  } else if (typeof 源 === 'string') {
    try {
      const { statSync } = await import('fs');
      大小 = statSync(源).size;
    } catch (e) {
      // 假设是字符串内容
      大小 = Buffer.byteLength(源);
    }
  }
  
  // 大文件（> 10MB）优先使用 OSS
  const 大文件阈值 = 选项.大文件阈值 || 10 * 1024 * 1024;
  
  if (大小 > 大文件阈值 && OSS存储.是否可用()) {
    const 结果 = await OSS存储.上传(源, 文件名, 选项);
    return {
      成功: 结果.成功,
      路径: 结果.路径,
      网址: 结果.网址,
      存储类型: 'OSS',
      错误: 结果.错误
    };
  }
  
  // Buffer 类型数据优先使用 OSS（更可靠）
  if (Buffer.isBuffer(源) && OSS存储.是否可用()) {
    const 结果 = await OSS存储.上传(源, 文件名, 选项);
    return {
      成功: 结果.成功,
      路径: 结果.路径,
      网址: 结果.网址,
      存储类型: 'OSS',
      错误: 结果.错误
    };
  }
  
  // 文件路径类型，使用Git数据存储
  if (typeof 源 === 'string' && Git数据.是否可用()) {
    const { existsSync } = await import('fs');
    if (existsSync(源)) {
      try {
        const 快照结果 = await Git数据.创建快照({ 名称: 文件名, 描述: 选项.描述 || '' });
        if (快照结果) {
          return {
            成功: true,
            路径: 快照结果.标签名,
            存储类型: 'Git数据',
            快照: 快照结果
          };
        }
      } catch { /* fall through */ }
    }
  }
  
  // 回退到 OSS
  if (OSS存储.是否可用()) {
    const 结果 = await OSS存储.上传(源, 文件名, 选项);
    return {
      成功: 结果.成功,
      路径: 结果.路径,
      网址: 结果.网址,
      存储类型: 'OSS',
      错误: 结果.错误
    };
  }
  
  return { 成功: false, 错误: '无可用的存储系统' };
}

/**
 * 保存记忆
 * @param {string} 用户ID 
 * @param {Array} 消息列表 
 * @param {object} 元数据 
 * @returns {Promise<{成功: boolean, 错误?: string}>}
 */
export async function 保存记忆(用户ID, 消息列表, 元数据 = {}) {
  if (!Git记忆.是否可用()) {
    return { 成功: false, 错误: '记忆系统不可用' };
  }

  try {
    const 结果 = await Git记忆.添加记忆({
      用户ID,
      消息列表,
      元数据
    });
    return { 成功: true, 结果 };
  } catch (e) {
    return { 成功: false, 错误: e.message };
  }
}

/**
 * 搜索记忆
 * @param {string} 查询文本 
 * @param {string} 用户ID 
 * @param {object} 选项 
 * @returns {Promise<{成功: boolean, 结果?: Array, 错误?: string}>}
 */
export async function 搜索记忆(查询文本, 用户ID = null, 选项 = {}) {
  if (!Git记忆.是否可用()) {
    return { 成功: false, 错误: '记忆系统不可用' };
  }

  try {
    const 结果 = await Git记忆.搜索记忆({
      查询: 查询文本,
      用户ID,
      ...选项
    });
    return { 成功: true, 结果 };
  } catch (e) {
    return { 成功: false, 错误: e.message };
  }
}

/**
 * 创建快照
 * @param {string} 路径 - 文件或目录路径
 * @param {object} 选项 - 选项
 * @returns {Promise<{成功: boolean, 快照?: object, 错误?: string}>}
 */
export async function 创建快照(路径, 选项 = {}) {
  if (!Git数据.是否可用()) {
    return { 成功: false, 错误: 'Git数据存储不可用' };
  }

  try {
    const 结果 = await Git数据.创建快照({ 名称: 选项.名称 || 路径, 描述: 选项.描述 || '' });
    return { 成功: true, 快照: 结果 };
  } catch (e) {
    return { 成功: false, 错误: e.message };
  }
}

export async function 回滚快照(快照ID, 目标路径 = null, 选项 = {}) {
  if (!Git数据.是否可用()) {
    return { 成功: false, 错误: 'Git数据存储不可用' };
  }

  try {
    return await Git数据.恢复快照({ 标签名: 快照ID });
  } catch (e) {
    return { 成功: false, 错误: e.message };
  }
}

// ==================== 导出 ====================

export {
  OSS存储,
  Git记忆,
  Git数据
};

export default {
  初始化所有存储,
  获取所有状态,
  OSS存储,
  Git记忆,
  Git数据,
  存储,
  保存记忆,
  搜索记忆,
  创建快照,
  回滚快照
};
