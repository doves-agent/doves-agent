/**
 * 服务管理库
 * 整合 PM2 和 MongoDB 管理，提供统一的服务管理接口
 */

import * as pm2 from './pm2-manager.js';
import * as mongo from './mongo-check.js';
import { getSharedCryptoClient } from './base-client.js';

/**
 * 服务类型枚举
 */
export const ServiceType = {
  SERVER: 'server',   // 服务端
  DOVE: 'dove'        // 鸽子
};

/**
 * 服务名称映射
 */
export const ServiceNames = {
  [ServiceType.SERVER]: '服务端',
  [ServiceType.DOVE]: '鸽子'
};

/**
 * 获取完整系统状态
 * @returns {Object}
 */
export async function getFullStatus() {
  // 并行获取 PM2 状态和 MongoDB 状态
  const [pm2Status, mongoStatus, startupStatus] = await Promise.all([
    Promise.resolve(pm2.getStatus()),
    mongo.testConnection(),
    Promise.resolve(pm2.getStartupStatus())
  ]);
  
  return {
    pm2: {
      installed: pm2.isPM2Installed(),
      version: pm2.getPM2Version(),
      apps: pm2Status.apps || [],
      error: pm2Status.error
    },
    mongo: {
      connected: mongoStatus.success,
      uri: mongoStatus.uri,
      latency: mongoStatus.latency,
      version: mongoStatus.info?.version,
      error: mongoStatus.error
    },
    startup: startupStatus,
    platform: pm2.getPlatformInfo()
  };
}

/**
 * 检查服务启动前置条件
 * @returns {Object}
 */
export async function checkPrerequisites() {
  const result = {
    ready: false,
    checks: {
      pm2: { passed: false, message: '' },
      mongo: { passed: false, message: '' },
      config: { passed: false, message: '' }
    },
    errors: []
  };
  
  // 检查 PM2
  if (pm2.isPM2Installed()) {
    result.checks.pm2 = {
      passed: true,
      message: `PM2 已安装 (v${pm2.getPM2Version()})`
    };
  } else {
    result.checks.pm2 = {
      passed: false,
      message: 'PM2 未安装，请运行: npm install -g pm2'
    };
    result.errors.push('PM2 未安装');
  }
  
  // 检查 MongoDB
  const mongoResult = await mongo.testConnection();
  if (mongoResult.success) {
    result.checks.mongo = {
      passed: true,
      message: `MongoDB 已连接 (${mongoResult.latency}ms, v${mongoResult.info?.version})`
    };
  } else {
    result.checks.mongo = {
      passed: false,
      message: `MongoDB 连接失败: ${mongoResult.error}`
    };
    result.errors.push('MongoDB 连接失败');
  }
  
  // 检查配置文件
  const prereq = await mongo.checkPrerequisite();
  if (prereq.configExists) {
    result.checks.config = {
      passed: true,
      message: '配置文件已存在'
    };
  } else {
    result.checks.config = {
      passed: false,
      message: '.env 配置文件不存在'
    };
    result.errors.push('配置文件不存在');
  }
  
  result.ready = result.checks.pm2.passed && 
                 result.checks.mongo.passed && 
                 result.checks.config.passed;
  
  return result;
}

/**
 * 启动服务
 * @param {string} type - 服务类型: 'server' | 'dove'
 * @param {Object} options - 选项
 * @returns {Object}
 */
export async function startService(type = ServiceType.SERVER, options = {}) {
  // 检查前置条件
  const prereq = await checkPrerequisites();
  
  if (!prereq.ready) {
    return {
      success: false,
      error: '前置条件不满足',
      checks: prereq.checks
    };
  }
  
  return pm2.startService(type, options);
}

/**
 * 停止服务
 * @param {string} type - 服务类型: 'server' | 'dove'
 * @returns {Object}
 */
export function stopService(type = ServiceType.SERVER) {
  return pm2.stopService(type);
}

/**
 * 重启服务
 * @param {string} type - 服务类型: 'server' | 'dove'
 * @param {Object} options - 选项
 * @returns {Object}
 */
export function restartService(type = ServiceType.SERVER, options = {}) {
  return pm2.restartService(type, options);
}

/**
 * 获取服务状态
 * @param {string} type - 服务类型: 'server' | 'dove'
 * @returns {Object}
 */
export function getServiceStatus(type = ServiceType.SERVER) {
  return pm2.getServiceInfo(type);
}

/**
 * 查看服务日志
 * @param {string} type - 服务类型: 'server' | 'dove'
 * @param {Object} options - 选项
 */
export function showLogs(type = ServiceType.SERVER, options = {}) {
  return pm2.showLogs(type, options);
}

/**
 * 启用开机启动
 * @returns {Object}
 */
export function enableStartup() {
  return pm2.enableStartup();
}

/**
 * 禁用开机启动
 * @returns {Object}
 */
export function disableStartup() {
  return pm2.disableStartup();
}

/**
 * 获取开机启动状态
 * @returns {Object}
 */
export function getStartupStatus() {
  return pm2.getStartupStatus();
}

/**
 * 保存 PM2 进程列表
 * @returns {Object}
 */
export function saveProcessList() {
  return pm2.savePM2();
}

/**
 * 启动所有服务（Server + Doves 独立进程）
 * @param {Object} options - 选项
 * @returns {Object}
 */
export async function startAll(options = {}) {
  const results = {
    server: null,
    dove: null
  };
  
  // 分别启动 Server 和 Doves
  results.server = await startService(ServiceType.SERVER, options);
  results.dove = await startService(ServiceType.DOVE, options);
  
  return results;
}

/**
 * 停止所有服务
 * @returns {Object}
 */
export function stopAll() {
  const results = {
    server: stopService(ServiceType.SERVER),
    dove: stopService(ServiceType.DOVE)
  };
  
  return results;
}

/**
 * 获取服务运行摘要
 * @returns {Object}
 */
export async function getServiceSummary() {
  const status = await getFullStatus();
  const summary = {
    platform: status.platform,
    mongo: {
      connected: status.mongo.connected,
      uri: status.mongo.uri,
      latency: status.mongo.latency
    },
    pm2: {
      installed: status.pm2.installed,
      version: status.pm2.version
    },
    services: {},
    startup: status.startup
  };
  
  // 处理服务状态
  for (const app of status.pm2.apps) {
    summary.services[app.name] = {
      running: app.running,
      status: app.status,
      pid: app.pid,
      uptime: app.uptime,
      memory: app.mem,
      cpu: app.cpu,
      restarts: app.restarts
    };
  }
  
  return summary;
}

/**
 * 获取鸽子数量（通过加密通道查询，禁止直连数据库）
 * @returns {Object} { total, online }
 */
export async function getDoveStats() {
  try {
    const cryptoClient = getSharedCryptoClient();
    if (!cryptoClient?.connected) {
      return { total: 0, online: 0, error: '加密通道未连接' };
    }

    const data = await cryptoClient.request('GET', '/api/dove/stats', null);

    if (data.error) {
      return { total: 0, online: 0, error: data.error };
    }

    if (data.success && data.data) {
      return {
        total: data.data.total || 0,
        online: data.data.online || 0
      };
    }

    return { total: 0, online: 0, error: data.error || '未知错误' };
  } catch (err) {
    return { total: 0, online: 0, error: `服务端连接失败: ${err.message}` };
  }
}

// 导出所有
export default {
  ServiceType,
  ServiceNames,
  getFullStatus,
  checkPrerequisites,
  startService,
  stopService,
  restartService,
  getServiceStatus,
  showLogs,
  enableStartup,
  disableStartup,
  getStartupStatus,
  saveProcessList,
  startAll,
  stopAll,
  getServiceSummary,
  getDoveStats
};
