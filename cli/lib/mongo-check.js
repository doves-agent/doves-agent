/**
 * 服务端存储状态检查模块
 * 
 * 遵循"统一代理"原则：CLI 禁止直连 MongoDB，所有数据操作走 Server API
 * 
 * 功能：
 * - 测试服务端连通性（间接验证数据库状态）
 * - 获取数据库统计信息（通过服务端代理）
 * - 获取集合列表（通过服务端代理）
 * - 检查前置条件
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getSharedCryptoClient } from './base-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 项目根目录
const PROJECT_ROOT = dirname(dirname(__dirname));

/**
 * 加载环境变量
 * @returns {Object} 环境变量对象
 */
export function loadEnv() {
  const envPath = join(PROJECT_ROOT, '.env');
  const env = {};
  
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();
        
        // 移除引号
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        env[key] = value;
      }
    }
  }
  
  // 合并 process.env
  return { ...process.env, ...env };
}

/**
 * 获取服务端 URL
 * @returns {string}
 */
export function getServerUrl() {
  const env = loadEnv();
  return env.SERVER_URL || 'http://localhost:3003';
}

/**
 * 测试服务端连通性（替代直接测试 MongoDB 连接）
 * CLI 禁止直连数据库，通过加密通道 /health 间接验证存储状态
 * @returns {Object} 连接结果
 */
export async function testConnection() {
  const serverUrl = getServerUrl();
  const result = {
    success: false,
    serverUrl,
    latency: null,
    error: null,
    info: null
  };

  const startTime = Date.now();

  try {
    const cryptoClient = getSharedCryptoClient();
    if (!cryptoClient?.connected) {
      result.error = '加密通道未连接，请先执行 dove login 或 dove init';
      result.latency = Date.now() - startTime;
      return result;
    }

    const data = await cryptoClient.request('GET', '/health', null);

    result.latency = Date.now() - startTime;

    if (data.error) {
      result.error = data.error;
      return result;
    }

    result.success = true;
    result.info = {
      status: data.status || data.data?.status || '未知',
      version: data.version || data.data?.version,
      mongo: data.mongo || data.data?.mongo || data.services?.mongo || null,
      uptime: data.uptime || data.data?.uptime || null
    };

  } catch (error) {
    result.latency = Date.now() - startTime;
    result.error = error.message;
  }

  return result;
}

/**
 * 获取数据库统计信息（通过加密通道代理）
 * CLI 禁止直连数据库
 * @param {string} dbName - 数据库名
 * @returns {Object}
 */
export async function getDbStats(dbName = null) {
  const env = loadEnv();
  const targetDb = dbName || env.MONGODB_USER_DB || env.userDb || 'doves_user_data';

  try {
    const cryptoClient = getSharedCryptoClient();
    if (!cryptoClient?.connected) {
      return { success: false, error: '加密通道未连接，请先执行 dove login 或 dove init' };
    }

    const data = await cryptoClient.request('GET', `/api/admin/db-stats?db=${targetDb}`, null);

    if (data.error) {
      return { success: false, error: data.error };
    }

    if (data.success && data.data) {
      return {
        success: true,
        dbName: targetDb,
        ...data.data
      };
    }

    return { success: false, error: data.error || '未知错误' };
  } catch (error) {
    return { success: false, error: `服务端连接失败: ${error.message}` };
  }
}

/**
 * 获取集合列表（通过加密通道代理）
 * CLI 禁止直连数据库
 * @param {string} dbName - 数据库名
 * @returns {Object}
 */
export async function listCollections(dbName = null) {
  const env = loadEnv();
  const targetDb = dbName || env.MONGODB_USER_DB || env.userDb || 'doves_user_data';

  try {
    const cryptoClient = getSharedCryptoClient();
    if (!cryptoClient?.connected) {
      return { success: false, error: '加密通道未连接，请先执行 dove login 或 dove init' };
    }

    const data = await cryptoClient.request('GET', `/api/admin/collections?db=${targetDb}`, null);

    if (data.error) {
      return { success: false, error: data.error };
    }

    if (data.success && data.data) {
      return {
        success: true,
        dbName: targetDb,
        collections: data.data.collections || data.data
      };
    }

    return { success: false, error: data.error || '未知错误' };
  } catch (error) {
    return { success: false, error: `服务端连接失败: ${error.message}` };
  }
}

/**
 * 检查前置条件
 * CLI 禁止直连数据库，通过服务端间接验证
 * @returns {Object}
 */
export async function checkPrerequisite() {
  const result = {
    ready: false,
    serverConnected: false,
    configExists: false,
    errors: []
  };
  
  // 检查配置文件
  const envPath = join(PROJECT_ROOT, '.env');
  result.configExists = existsSync(envPath);
  
  if (!result.configExists) {
    result.errors.push('.env 配置文件不存在');
  }
  
  // 检查服务端连通性（间接验证数据库状态）
  const connResult = await testConnection();
  result.serverConnected = connResult.success;
  
  if (!connResult.success) {
    result.errors.push(`服务端连接失败: ${connResult.error}`);
  }
  
  result.ready = result.configExists && result.serverConnected;
  
  return result;
}

// 导出
export default {
  loadEnv,
  getServerUrl,
  testConnection,
  getDbStats,
  listCollections,
  checkPrerequisite
};
