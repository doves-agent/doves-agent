/**
 * SSH 远程控制技能 - ssh_agent
 * 
 * 功能：
 * - SSH 连接管理：连接、断开、状态检查
 * - 远程命令执行：执行命令、获取输出
 * - 文件传输：上传、下载（SFTP）
 * - 远程主机管理：添加、删除、列出主机配置
 * - Docker 远程控制：检查、镜像管理、容器管理
 * 
 * 数据访问：通过鸽子代理访问数据，禁止直连数据库
 */

import { DovesProxy } from '../../doves_proxy/index.js';
import { ObjectId } from '@dove/common/对象标识.js';
import { createTimestampFields } from '@dove/common/时间工具.js';

// 从子模块导入
import {
  logger, connectionCache, HOSTS_COLLECTION,
  getSSH2, getDatabaseConnection, getHostKey,
  connectSSH, disconnectSSH, getSSHConnection,
  executeCommand, executeInteractive
} from './SSH连接管理.js';
import {
  getSFTP, uploadFile, downloadFile,
  listRemoteDir, createRemoteDir, removeRemote
} from './文件传输.js';
import {
  handleDockerCheck, handleDockerListImages, handleDockerListContainers,
  handleDockerRun, handleDockerStop, handleDockerExec, handleDockerLogs
} from './Docker远程控制.js';
import {
  getServerStatus, manageService, tailLog, findLogs
} from './服务器状态.js';

// ============================================================================
// 主机配置管理
// ============================================================================

/**
 * 添加 SSH 主机配置
 */
async function addHost(hostConfig) {
  try {
    const { client, db } = await getDatabaseConnection();
    
    const host = {
      _id: new ObjectId().toString(),
      name: hostConfig.name || hostConfig.host,
      host: hostConfig.host,
      port: hostConfig.port || 22,
      username: hostConfig.username,
      // 安全存储凭证（生产环境需要加密）
      credentials: {
        privateKey: hostConfig.privateKey,
        password: hostConfig.password,
        passphrase: hostConfig.passphrase
      },
      tags: hostConfig.tags || [],
      group: hostConfig.group || 'default',
      ...createTimestampFields(),
      lastConnected: null,
      connectionCount: 0,
      metadata: hostConfig.metadata || {}
    };
    
    await db.collection(HOSTS_COLLECTION).insertOne(host);
    client.close();
    
    logger.info(`SSH 主机已添加: ${host.name} (${host.host})`);
    return { success: true, hostId: host._id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 获取主机配置
 */
async function getHost(hostId) {
  try {
    const { client, db } = await getDatabaseConnection();
    const host = await db.collection(HOSTS_COLLECTION).findOne({ _id: hostId });
    client.close();
    return host;
  } catch (error) {
    logger.error('获取主机配置失败:', error.message);
    return null;
  }
}

/**
 * 列出所有主机
 */
async function listHosts(filter = {}) {
  try {
    const { client, db } = await getDatabaseConnection();
    const hosts = await db.collection(HOSTS_COLLECTION)
      .find(filter)
      .project({ credentials: 0 })
      .toArray();
    client.close();
    return hosts;
  } catch (error) {
    logger.error('列出主机失败:', error.message);
    return [];
  }
}

/**
 * 删除主机
 */
async function deleteHost(hostId) {
  try {
    const { client, db } = await getDatabaseConnection();
    await db.collection(HOSTS_COLLECTION).deleteOne({ _id: hostId });
    client.close();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// 系统信息获取
// ============================================================================

/**
 * 获取远程主机系统信息
 */
async function getSystemInfo(params) {
  const { host } = params;
  
  if (!host) {
    return { success: false, error: '缺少主机配置' };
  }
  
  try {
    const commands = {
      hostname: 'hostname',
      os: 'uname -a',
      cpu: 'cat /proc/cpuinfo 2>/dev/null | grep "model name" | head -1 || sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "unknown"',
      memory: 'free -h 2>/dev/null || vm_stat 2>/dev/null | head -5 || echo "unknown"',
      disk: 'df -h 2>/dev/null | head -5 || echo "unknown"',
      uptime: 'uptime',
      users: 'who | head -5'
    };
    
    const results = {};
    
    for (const [key, cmd] of Object.entries(commands)) {
      const result = await executeCommand({ host, command: cmd, timeout: 10000 });
      results[key] = result.success ? result.stdout : '获取失败';
    }
    
    return {
      success: true,
      info: results,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// 连接状态检查
// ============================================================================

/**
 * 检查本地 SSH 能力
 */
async function checkLocalSSHCapability() {
  try {
    await getSSH2();
    return { available: true, ssh2Installed: true };
  } catch (error) {
    return { available: false, ssh2Installed: false, error: error.message };
  }
}

/**
 * 获取连接状态
 */
async function getConnectionStatus() {
  const connections = [];
  
  for (const [hostKey, cached] of connectionCache.entries()) {
    connections.push({
      hostKey,
      isConnected: cached.isConnected,
      lastUsed: new Date(cached.lastUsed).toISOString()
    });
  }
  
  return {
    success: true,
    activeConnections: connections.length,
    connections
  };
}

// ============================================================================
// 操作处理函数
// ============================================================================

async function handleAddHost(params) {
  return await addHost(params.hostConfig);
}

async function handleGetHost(params) {
  const host = await getHost(params.hostId);
  if (host) {
    return { success: true, host };
  }
  return { success: false, error: '主机不存在' };
}

async function handleListHosts(params) {
  const hosts = await listHosts(params.filter || {});
  return { success: true, count: hosts.length, hosts };
}

async function handleDeleteHost(params) {
  return await deleteHost(params.hostId);
}

async function handleConnect(params) {
  const result = await connectSSH(params.host);
  if (result.success) {
    return { success: true, message: 'SSH 连接成功', hostKey: getHostKey(params.host) };
  }
  return result;
}

async function handleDisconnect(params) {
  const hostKey = params.hostKey || (params.host && getHostKey(params.host));
  if (hostKey) {
    return await disconnectSSH(hostKey);
  }
  for (const key of connectionCache.keys()) {
    await disconnectSSH(key);
  }
  return { success: true, message: '所有 SSH 连接已断开' };
}

// ============================================================================
// Skill 主执行函数
// ============================================================================

async function execute(params, context) {
  const { action } = params;
  
  // 主机管理操作
  const hostManagementHandlers = {
    add_host: handleAddHost,
    get_host: handleGetHost,
    list_hosts: handleListHosts,
    delete_host: handleDeleteHost,
    connection_status: getConnectionStatus,
    check_capability: checkLocalSSHCapability
  };
  
  // SSH 操作
  const sshHandlers = {
    connect: handleConnect,
    disconnect: handleDisconnect,
    exec: executeCommand,
    exec_interactive: executeInteractive,
    upload: uploadFile,
    download: downloadFile,
    list_dir: listRemoteDir,
    mkdir: createRemoteDir,
    remove: removeRemote,
    system_info: getSystemInfo,
    // 服务器状态管理
    server_status: getServerStatus,
    service_manage: manageService,
    tail_log: tailLog,
    find_logs: findLogs,
    // Docker 远程控制
    docker_check: handleDockerCheck,
    docker_list_images: handleDockerListImages,
    docker_list_containers: handleDockerListContainers,
    docker_run: handleDockerRun,
    docker_stop: handleDockerStop,
    docker_exec: handleDockerExec,
    docker_logs: handleDockerLogs
  };
  
  // 检查主机管理操作
  if (hostManagementHandlers[action]) {
    return await hostManagementHandlers[action](params);
  }
  
  // 检查 SSH 操作
  const handler = sshHandlers[action];
  if (!handler) {
    return { success: false, error: `未知操作: ${action}` };
  }
  
  try {
    return await handler(params);
  } catch (error) {
    logger.error(`执行 ${action} 失败:`, error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// 导出
// ============================================================================

export default {
  name: 'SSH远程控制',
  description: 'SSH 远程控制技能 - 连接管理、命令执行、文件传输、主机管理、Docker远程控制',
  
  // 能力声明（用于任务匹配）
  abilities: ['远程执行', 'SSH', '文件传输', 'Docker管理'],

  // 内置技能，不需要拥有权检查
  需要拥有权: false,

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['connect', 'disconnect', 'exec', 'exec_interactive', 'upload', 'download', 'list_dir', 'mkdir', 'remove', 'system_info', 'add_host', 'get_host', 'list_hosts', 'delete_host', 'connection_status', 'check_capability', 'server_status', 'service_manage', 'tail_log', 'find_logs', 'docker_check', 'docker_list_images', 'docker_list_containers', 'docker_run', 'docker_stop', 'docker_exec', 'docker_logs'],
        description: '操作类型'
      },
      host: {
        type: 'object',
        properties: {
          host: { type: 'string', description: '主机地址' },
          port: { type: 'integer', default: 22, description: 'SSH端口' },
          username: { type: 'string', description: '用户名' },
          password: { type: 'string', description: '密码' },
          privateKey: { type: 'string', description: '私钥' }
        },
        description: '主机配置'
      },
      command: {
        type: 'string',
        description: '要执行的命令'
      },
      localPath: {
        type: 'string',
        description: '本地文件路径'
      },
      remotePath: {
        type: 'string',
        description: '远程文件路径'
      },
      timeout: {
        type: 'integer',
        default: 60000,
        description: '超时时间(毫秒)'
      },
      service: {
        type: 'string',
        description: '服务名（service_manage 时使用）'
      },
      path: {
        type: 'string',
        description: '日志路径（tail_log 时使用）'
      },
      lines: {
        type: 'integer',
        default: 50,
        description: '日志行数（tail_log 时使用）'
      }
    },
    required: ['action']
  },
  execute
};
