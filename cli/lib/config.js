/**
 * 统一配置管理模块
 * 
 * 所有配置读写都应通过此模块，确保：
 * 1. 配置加载时合并默认值
 * 2. 配置保存时采用合并式写入，避免丢失字段
 * 3. 配置文件路径统一：~/.dove/config.json
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// 配置文件路径
const CONFIG_DIR = path.join(os.homedir(), '.dove');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// 默认配置
const DEFAULT_CONFIG = {
  gateway: 'http://localhost:3003',
  gateways: [],  // 多 gateway 列表（扇出/容灾双模式：--gateway 扇出，无参数容灾）
  timeout: 30000,
  chatLog: {
    enabled: false  // 对话日志开关，dove config chat-log on/off
  },
  chat: {
    continuousMode: true  // 是否启用持续对话模式，false 则默认单次
  },
  wechatBindings: {},    // 微信绑定，按白鸽 userId 索引: { [userId]: { enabled, botToken, botBaseUrl, botUserId } }
  wechat: {              // 当前活跃用户的微信通道状态（运行时由 _syncWechatBinding 同步）
    enabled: false,
    botToken: '',
    botBaseUrl: '',
    botUserId: '',
  }
};

// 配置缓存
let configCache = null;

// ==================== 安全工具函数 ====================

/**
 * 清除文件只读和隐藏属性（Windows专用）
 */
function clearFileAttrs(filePath) {
  if (process.platform === 'win32' && fs.existsSync(filePath)) {
    try {
      // 使用 attrib 命令清除只读和隐藏属性
      execSync(`attrib -r -h "${filePath}"`, { stdio: 'ignore' });
    } catch (e) {
      // 忽略错误
    }
  }
}

/**
 * 设置文件权限为 600 (仅所有者可读写)
 * Windows 上通过隐藏属性增加保护
 */
function secureFile(filePath) {
  try {
    if (process.platform !== 'win32') {
      fs.chmodSync(filePath, 0o600);
    }
  } catch (e) {
    // 权限设置失败不影响功能
  }
}

/**
 * 安全地创建目录（权限 700）
 */
function secureMkdir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(dirPath, 0o700);
      } catch (e) {
        // 忽略错误
      }
    }
  }
}

// ==================== 核心配置函数 ====================

/**
 * 加载配置（带缓存）
 * 总是合并默认值，确保配置结构完整
 * 
 * @param {boolean} forceReload - 是否强制重新加载（忽略缓存）
 * @returns {object} 配置对象
 */
export function loadConfig(forceReload = false) {
  // 使用缓存
  if (!forceReload && configCache) {
    return { ...configCache };
  }
  
  let fileConfig = {};
  
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      fileConfig = JSON.parse(content);
    }
  } catch (e) {
    // 配置文件损坏或无法读取，使用空对象
    console.warn(`[Config] 警告: 无法读取配置文件 (${e.message})`);
  }
  
  // 合并默认值（fileConfig 覆盖 DEFAULT_CONFIG）
  configCache = { ...DEFAULT_CONFIG, ...fileConfig };
  
  return { ...configCache };
}

/**
 * 保存配置（合并式写入）
 * 不会覆盖文件中已有的字段，只会更新传入的字段
 * 
 * @param {object} updates - 要更新的配置字段
 * @returns {object} 更新后的完整配置
 */
export function saveConfig(updates) {
  // 先加载现有配置
  const currentConfig = loadConfig(true); // 强制重新加载，忽略缓存
  
  // 合并更新
  const newConfig = { ...currentConfig, ...updates };
  
  // 确保目录存在
  secureMkdir(CONFIG_DIR);
  
  // 清除目标文件的隐藏属性（Windows）
  clearFileAttrs(CONFIG_FILE);
  
  // 写入文件（使用原子操作避免锁定问题）
  try {
    const tempFile = CONFIG_FILE + '.tmp';
    
    // 先写入临时文件
    fs.writeFileSync(tempFile, JSON.stringify(newConfig, null, 2));
    
    // 尝试原子替换
    try {
      fs.renameSync(tempFile, CONFIG_FILE);
    } catch (renameErr) {
      // Windows 上 rename 可能失败，尝试直接复制
      clearFileAttrs(CONFIG_FILE);  // 再次清除，确保能覆盖
      fs.copyFileSync(tempFile, CONFIG_FILE);
      fs.unlinkSync(tempFile);
    }
    
    secureFile(CONFIG_FILE);
    
    // 更新缓存
    configCache = { ...newConfig };
  } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EACCES') {
      console.warn(`[Config] 警告: 无法保存配置文件 (${e.message})`);
      console.warn(`[Config] 配置将仅存在于当前会话中`);
      // 更新内存缓存，保证当前会话可用
      configCache = { ...newConfig };
    } else {
      throw e;
    }
  }
  
  return { ...newConfig };
}

/**
 * 删除配置字段
 * 
 * @param {string|string[]} keys - 要删除的配置键
 * @returns {object} 更新后的完整配置
 */
export function deleteConfigKeys(keys) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  const currentConfig = loadConfig(true);
  
  for (const key of keyList) {
    delete currentConfig[key];
  }
  
  // 合并默认值后保存
  const newConfig = { ...DEFAULT_CONFIG, ...currentConfig };
  
  secureMkdir(CONFIG_DIR);
  
  // 清除目标文件的隐藏属性（Windows）
  clearFileAttrs(CONFIG_FILE);
  
  try {
    const tempFile = CONFIG_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(newConfig, null, 2));
    
    try {
      fs.renameSync(tempFile, CONFIG_FILE);
    } catch (renameErr) {
      clearFileAttrs(CONFIG_FILE);
      fs.copyFileSync(tempFile, CONFIG_FILE);
      fs.unlinkSync(tempFile);
    }
    
    secureFile(CONFIG_FILE);
    configCache = { ...newConfig };
  } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EACCES') {
      console.warn(`[Config] 警告: 无法保存配置文件 (${e.message})`);
      configCache = { ...newConfig };
    } else {
      throw e;
    }
  }
  
  return { ...newConfig };
}

/**
 * 重置配置（保留账号信息）
 * 
 * @param {boolean} keepAccount - 是否保留账号信息（默认 true）
 * @returns {object} 重置后的配置
 */
export function resetConfig(keepAccount = true) {
  if (keepAccount) {
    const currentConfig = loadConfig();
    const accountFields = ['token', 'userId', 'username', 'role', 'authType', 'expiresAt', 'lastRefreshTime', 'anonymous'];
    const accountData = {};
    
    for (const key of accountFields) {
      if (currentConfig[key] !== undefined) {
        accountData[key] = currentConfig[key];
      }
    }
    
    return saveConfig(accountData);
  } else {
    // 完全重置
    const newConfig = { ...DEFAULT_CONFIG };
    secureMkdir(CONFIG_DIR);
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
    secureFile(CONFIG_FILE);
    configCache = { ...newConfig };
    return { ...newConfig };
  }
}

/**
 * 获取配置文件路径
 */
export function getConfigPath() {
  return CONFIG_FILE;
}

/**
 * 获取配置目录路径
 */
export function getConfigDir() {
  return CONFIG_DIR;
}

/**
 * 清除缓存（用于测试或需要强制重新加载时）
 */
export function clearCache() {
  configCache = null;
}

// 导出常量和工具函数
export { CONFIG_DIR, CONFIG_FILE, DEFAULT_CONFIG, secureFile, secureMkdir };

// ==================== 微信绑定按用户隔离 ====================

/**
 * 保存当前白鸽用户的微信绑定
 * @param {string} userId - 白鸽用户 ID
 * @param {Object} binding - { enabled, botToken, botBaseUrl, botUserId }
 */
export function saveWechatBinding(userId, binding) {
  const config = loadConfig(true);
  if (!config.wechatBindings) config.wechatBindings = {};
  config.wechatBindings[userId] = { ...binding };
  // 同步到 wechat 运行时字段
  config.wechat = { ...binding };
  saveConfig(config);
}

/**
 * 加载指定白鸽用户的微信绑定到运行时 wechat 字段
 * @param {string} userId - 白鸽用户 ID
 * @returns {Object|null} 绑定数据，null 表示未绑定
 */
export function loadWechatBinding(userId) {
  const config = loadConfig(true);
  const binding = config.wechatBindings?.[userId] || null;
  // 同步到 wechat 运行时字段
  if (binding) {
    config.wechat = { ...binding };
  } else {
    config.wechat = { enabled: false, botToken: '', botBaseUrl: '', botUserId: '' };
  }
  // 直接写缓存，不触发文件写入
  configCache = { ...config };
  return binding;
}

/**
 * 删除指定白鸽用户的微信绑定
 * @param {string} userId - 白鸽用户 ID
 */
export function deleteWechatBinding(userId) {
  const config = loadConfig(true);
  if (config.wechatBindings) {
    delete config.wechatBindings[userId];
  }
  config.wechat = { enabled: false, botToken: '', botBaseUrl: '', botUserId: '' };
  saveConfig(config);
}

/**
 * 切换白鸽账号时同步微信绑定（应在 auth login 后调用）
 * @param {string} userId - 新登录的白鸽用户 ID
 */
export function syncWechatOnAccountSwitch(userId) {
  return loadWechatBinding(userId);
}

