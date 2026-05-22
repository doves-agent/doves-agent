/**
 * SSH 连接管理与命令执行
 * 从 ssh_agent/index.js 提取
 */

import { DovesProxy } from '../../doves_proxy/index.js';

import { 创建日志器 } from '@dove/common/日志管理器.js';

// ============================================================================
// 日志器
// ============================================================================

export const logger = 创建日志器('SSH远程控制', { 前缀: '[SSH远程控制]', 级别: 'debug', 显示调用位置: true });

// ============================================================================
// SSH 连接缓存
// ============================================================================

export const connectionCache = new Map();  // 连接缓存
let ssh2 = null;  // SSH2 库懒加载

// 主机配置集合名
export const HOSTS_COLLECTION = 'ssh_hosts';

/**
 * 获取 SSH2 库
 */
export async function getSSH2() {
  if (!ssh2) {
    try {
      ssh2 = await import('ssh2');
    } catch (error) {
      throw new Error('ssh2 库未安装，请运行: npm install ssh2');
    }
  }
  return ssh2;
}

/**
 * 获取数据库连接（通过鸽子代理）
 * @returns {Promise<{client: DovesProxy, db: Function}>}
 */
export async function getDatabaseConnection() {
  const client = new DovesProxy({
    serverUrl: process.env.SERVER_URL,
    jwt: process.env.SERVER_JWT,
    apiKey: process.env.SERVER_API_KEY
  });
  
  const dbName = process.env.MONGODB_DB || 'dove_agent';
  
  return { client, db: client.db(dbName) };
}

// ============================================================================
// SSH 连接管理
// ============================================================================

/**
 * 生成主机唯一标识
 */
export function getHostKey(config) {
  return `${config.username}@${config.host}:${config.port || 22}`;
}

/**
 * 连接到 SSH 主机
 */
export async function connectSSH(config) {
  try {
    const { Client } = await getSSH2();
    const hostKey = getHostKey(config);
    
    // 检查缓存中是否有可用连接
    const cached = connectionCache.get(hostKey);
    if (cached && cached.isConnected) {
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('连接测试超时')), 3000);
          cached.client.exec('echo alive', (err) => {
            clearTimeout(timeout);
            if (err) reject(err);
            else resolve();
          });
        });
        cached.lastUsed = Date.now();
        return { success: true, client: cached.client, cached: true };
      } catch (e) {
        connectionCache.delete(hostKey);
      }
    }
    
    return new Promise((resolve, reject) => {
      const client = new Client();
      
      const connectionConfig = {
        host: config.host,
        port: config.port || 22,
        username: config.username,
        readyTimeout: config.timeout || 30000,
        keepaliveInterval: config.keepaliveInterval || 10000,
        keepaliveCountMax: config.keepaliveCountMax || 3
      };
      
      // 认证方式
      if (config.privateKey) {
        connectionConfig.privateKey = config.privateKey;
        if (config.passphrase) {
          connectionConfig.passphrase = config.passphrase;
        }
      } else if (config.password) {
        connectionConfig.password = config.password;
      } else {
        connectionConfig.agent = process.env.SSH_AUTH_SOCK || undefined;
      }
      
      client.on('ready', () => {
        connectionCache.set(hostKey, {
          client,
          config: connectionConfig,
          lastUsed: Date.now(),
          isConnected: true
        });
        
        logger.info(`SSH 连接成功: ${hostKey}`);
        resolve({ success: true, client, cached: false });
      });
      
      client.on('error', (err) => {
        logger.error(`SSH 连接失败: ${hostKey}`, err.message);
        reject(new Error(`SSH 连接失败: ${err.message}`));
      });
      
      client.on('close', () => {
        const cached = connectionCache.get(hostKey);
        if (cached) {
          cached.isConnected = false;
        }
        logger.info(`SSH 连接关闭: ${hostKey}`);
      });
      
      client.connect(connectionConfig);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 断开 SSH 连接
 */
export async function disconnectSSH(hostKey) {
  const cached = connectionCache.get(hostKey);
  if (cached && cached.client) {
    try {
      cached.client.end();
    } catch (e) { logger.warn(`关闭SSH连接失败: ${e.message}`); }
    connectionCache.delete(hostKey);
  }
  return { success: true };
}

/**
 * 获取或创建 SSH 连接
 */
export async function getSSHConnection(config) {
  const hostKey = getHostKey(config);
  const cached = connectionCache.get(hostKey);
  
  if (cached && cached.isConnected) {
    cached.lastUsed = Date.now();
    return { success: true, client: cached.client };
  }
  
  return await connectSSH(config);
}

// ============================================================================
// 命令执行
// ============================================================================

/**
 * 执行远程命令
 */
export async function executeCommand(params) {
  const { host, command, timeout = 60000, env, cwd } = params;
  
  if (!host || !command) {
    return { success: false, error: '缺少主机配置或命令' };
  }
  
  try {
    const connectResult = await getSSHConnection(host);
    if (!connectResult.success) {
      return connectResult;
    }
    
    const client = connectResult.client;
    
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let exitCode = 0;
      
      const timeoutId = setTimeout(() => {
        reject(new Error(`命令执行超时 (${timeout}ms)`));
      }, timeout);
      
      let fullCommand = command;
      if (cwd) {
        fullCommand = `cd "${cwd}" && ${command}`;
      }
      if (env && Object.keys(env).length > 0) {
        const envStr = Object.entries(env)
          .map(([k, v]) => `${k}="${v}"`)
          .join(' ');
        fullCommand = `export ${envStr} && ${fullCommand}`;
      }
      
      client.exec(fullCommand, (err, stream) => {
        if (err) {
          clearTimeout(timeoutId);
          resolve({ success: false, error: err.message });
          return;
        }
        
        stream.on('close', (code) => {
          clearTimeout(timeoutId);
          exitCode = code;
          
          resolve({
            success: code === 0,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: code
          });
        });
        
        stream.on('data', (data) => {
          stdout += data.toString();
        });
        
        stream.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 执行交互式命令
 */
export async function executeInteractive(params) {
  const { host, command, sudoPassword, timeout = 120000 } = params;
  
  if (!host || !command) {
    return { success: false, error: '缺少主机配置或命令' };
  }
  
  try {
    const connectResult = await getSSHConnection(host);
    if (!connectResult.success) {
      return connectResult;
    }
    
    const client = connectResult.client;
    
    return new Promise((resolve, reject) => {
      let output = '';
      const timeoutId = setTimeout(() => {
        reject(new Error(`命令执行超时 (${timeout}ms)`));
      }, timeout);
      
      client.exec(command, { pty: true }, (err, stream) => {
        if (err) {
          clearTimeout(timeoutId);
          resolve({ success: false, error: err.message });
          return;
        }
        
        stream.on('close', () => {
          clearTimeout(timeoutId);
          resolve({ success: true, output: output.trim() });
        });
        
        stream.on('data', (data) => {
          const text = data.toString();
          output += text;
          
          // 自动处理 sudo 密码提示
          if (sudoPassword && (text.includes('[sudo]') || text.includes('Password:'))) {
            stream.write(sudoPassword + '\n');
          }
        });
        
        stream.stderr.on('data', (data) => {
          output += data.toString();
        });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}
