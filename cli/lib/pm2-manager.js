/**
 * PM2 跨平台管理模块
 * 支持 Windows、macOS、Linux 的进程管理和开机启动
 */

import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { getStartupStatus, enableStartup, disableStartup } from './pm2-开机启动.js';
// 命名导出，供 import * as pm2 使用
export { getStartupStatus, enableStartup, disableStartup };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 平台检测
const PLATFORM = os.platform();
const IS_WINDOWS = PLATFORM === 'win32';
const IS_MACOS = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';

// 项目根目录 (CLI 的上级目录)
const PROJECT_ROOT = dirname(dirname(__dirname));

// PM2 应用名称
const APP_NAMES = {
  server: 'server',
  dove: 'dove'
};

/**
 * 检查 PM2 是否已安装
 * @returns {boolean}
 */
export function isPM2Installed() {
  try {
    execSync('pm2 --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取 PM2 版本
 * @returns {string|null}
 */
export function getPM2Version() {
  try {
    const result = execSync('pm2 --version', { encoding: 'utf-8', stdio: 'pipe' });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * 获取平台信息
 * @returns {Object}
 */
export function getPlatformInfo() {
  return {
    platform: PLATFORM,
    isWindows: IS_WINDOWS,
    isMacos: IS_MACOS,
    isLinux: IS_LINUX,
    arch: os.arch(),
    hostname: os.hostname(),
    homedir: os.homedir()
  };
}

/**
 * 执行 PM2 命令
 * @param {string} args - PM2 参数
 * @param {Object} options - 选项
 * @returns {Object} { success, stdout, stderr }
 */
function execPM2(args, options = {}) {
  const cwd = options.cwd || PROJECT_ROOT;
  
  try {
    const result = execSync(`pm2 ${args}`, {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: options.env || 'development' }
    });
    
    return { success: true, stdout: result, stderr: '' };
  } catch (error) {
    return { 
      success: false, 
      stdout: error.stdout || '', 
      stderr: error.stderr || error.message 
    };
  }
}

/**
 * 获取所有服务状态
 * @returns {Object}
 */
export function getStatus() {
  const result = execPM2('list --no-color');
  
  if (!result.success) {
    return { success: false, error: result.stderr, apps: [] };
  }
  
  // 解析 PM2 输出
  const apps = parsePM2List(result.stdout);
  
  return { success: true, apps };
}

/**
 * 解析 PM2 列表输出
 * @param {string} output - PM2 输出
 * @returns {Array}
 */
function parsePM2List(output) {
  const apps = [];
  const lines = output.split('\n');
  
  // PM2 输出可能被换行，需要合并连续的行
  // 使用 id 列来识别应用行
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    // 检查是否是应用行（以 │ 数字 开头）
    const idMatch = line.match(/│\s*(\d+)\s*│/);
    if (!idMatch) continue;
    
    // 如果下一行不是新的应用行，合并
    while (i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      // 下一行是新的应用行则停止
      if (nextLine.match(/│\s*\d+\s*│/) || nextLine.includes('───')) break;
      line += ' ' + nextLine.trim();
      i++;
    }
    
    // 解析合并后的行
    // 列顺序: id, name, namespace, version, mode, pid, uptime, ↺, status, cpu, mem, user, watching
    const parts = line.split('│').map(p => p.trim()).filter(p => p);
    
    if (parts.length >= 9) {
      const id = parts[0];
      const name = parts[1];
      const mode = parts[4] || '';
      const pid = parts[5] || '';       // PID 在第6列
      const uptime = parts[6] || '';    // uptime 在第7列
      const restarts = parts[7] || '0';
      const status = parts[8] || '';
      const cpu = parts[9] || '';
      const mem = parts[10] || '';
      
      // 只关心我们的应用
      if (Object.values(APP_NAMES).includes(name)) {
        apps.push({
          name,
          id: parseInt(id),
          mode,
          pid: pid && pid !== '0' ? parseInt(pid) : null,
          uptime,
          status,
          restarts: parseInt(restarts),
          cpu,
          mem,
          running: status === 'online',
          errored: status === 'errored',
          stopped: status === 'stopped' || status === 'stopping'
        });
      }
    }
  }
  
  return apps;
}

/**
 * 启动服务
 * @param {string} type - 服务类型: 'server' | 'dove'
 * @param {Object} options - 选项
 * @returns {Object}
 */
export function startService(type = 'server', options = {}) {
  const appName = APP_NAMES[type];
  
  if (!appName) {
    return { success: false, error: `未知服务类型: ${type}，可选: server, dove` };
  }
  
  // 检查是否已经在运行
  const status = getStatus();
  if (status.success) {
    const existing = status.apps.find(app => app.name === appName);
    if (existing && existing.running) {
      return { success: true, message: `${appName} 已在运行中`, app: existing };
    }
  }
  
  // 启动服务
  const env = options.prod ? 'production' : 'development';
  const result = execPM2(`start ecosystem.config.cjs --only ${appName}`, { env });
  
  if (result.success) {
    return { 
      success: true, 
      message: `${appName} 启动成功`,
      stdout: result.stdout 
    };
  }
  
  return { success: false, error: result.stderr || '启动失败' };
}

/**
 * 启动全部服务（Server + Doves 分别启动，独立进程）
 * @param {Object} options - 选项
 * @param {boolean} options.gateway - 是否启动服务端（Server）
 * @param {number} options.doves - 鸽子数量
 * @param {number} options.port - 网关端口
 * @param {boolean} options.prod - 生产模式
 * @returns {Object}
 */
export function startCombinedService(options = {}) {
  const results = [];
  const env = options.prod ? 'production' : 'development';
  const doves = options.doves !== undefined ? parseInt(options.doves, 10) : 3;
  
  // 1. 启动 Server（如果需要）
  if (options.gateway !== false) {
    const serverResult = startService('server', { prod: options.prod });
    results.push({ service: 'server', ...serverResult });
  }
  
  // 2. 启动 Doves（如果需要）
  if (doves > 0) {
    // 先更新 ecosystem.config.cjs 中 dove 的 --doves 参数
    // 由于 PM2 使用 ecosystem.config.cjs，这里直接启动
    const doveResult = startService('dove', { prod: options.prod });
    results.push({ service: 'dove', ...doveResult });
  }
  
  const allSuccess = results.every(r => r.success);
  const messages = results.map(r => `${r.service}: ${r.message}`).join('; ');
  
  return {
    success: allSuccess,
    message: messages,
    results
  };
}

/**
 * 停止服务
 * @param {string} type - 服务类型: 'server' | 'dove'
 * @returns {Object}
 */
export function stopService(type = 'server') {
  const appName = APP_NAMES[type];
  
  if (!appName) {
    return { success: false, error: `未知服务类型: ${type}` };
  }
  
  const result = execPM2(`stop ${appName}`);
  
  if (result.success) {
    return { success: true, message: `${appName} 已停止` };
  }
  
  return { success: false, error: result.stderr || '停止失败' };
}

/**
 * 重启服务
 * @param {string} type - 服务类型: 'server' | 'dove'
 * @param {Object} options - 选项
 * @returns {Object}
 */
export function restartService(type = 'server', options = {}) {
  const appName = APP_NAMES[type];
  
  if (!appName) {
    return { success: false, error: `未知服务类型: ${type}` };
  }
  
  const env = options.prod ? 'production' : 'development';
  const result = execPM2(`restart ${appName}`, { env });
  
  if (result.success) {
    return { success: true, message: `${appName} 重启成功` };
  }
  
  return { success: false, error: result.stderr || '重启失败' };
}

/**
 * 删除服务
 * @param {string} type - 服务类型: 'server' | 'dove'
 * @returns {Object}
 */
export function deleteService(type = 'server') {
  const appName = APP_NAMES[type];
  
  if (!appName) {
    return { success: false, error: `未知服务类型: ${type}` };
  }
  
  const result = execPM2(`delete ${appName}`);
  
  if (result.success) {
    return { success: true, message: `${appName} 已删除` };
  }
  
  return { success: false, error: result.stderr || '删除失败' };
}

/**
 * 查看日志
 * @param {string} type - 服务类型: 'server' | 'dove'
 * @param {Object} options - 选项
 */
export function showLogs(type = 'server', options = {}) {
  const appName = APP_NAMES[type];
  const lines = options.lines || 100;
  
  if (!appName) {
    console.error(`未知服务类型: ${type}`);
    return;
  }
  
  // 使用 spawn 实时输出日志
  const pm2 = spawn('pm2', ['logs', appName, '--lines', lines], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit'
  });
  
  return new Promise((resolve) => {
    pm2.on('close', () => resolve());
    pm2.on('error', (err) => {
      console.error('日志输出错误:', err.message);
      resolve();
    });
  });
}

/**
 * 保存当前 PM2 进程列表
 * @returns {Object}
 */
export function savePM2() {
  try {
    execSync('pm2 save', { stdio: 'pipe' });
    return { success: true, message: 'PM2 进程列表已保存' };
  } catch (err) {
    return { success: false, error: '保存失败: ' + err.message };
  }
}

/**
 * 获取服务详细信息
 * @param {string} type - 服务类型: 'server' | 'dove'
 * @returns {Object}
 */
export function getServiceInfo(type = 'server') {
  const appName = APP_NAMES[type];
  
  if (!appName) {
    return { success: false, error: `未知服务类型: ${type}` };
  }
  
  const result = execPM2(`show ${appName}`);
  
  if (!result.success) {
    return { success: false, error: result.stderr || '获取信息失败' };
  }
  
  // 解析输出
  const info = {
    name: appName,
    status: '未知',
    pid: null,
    uptime: null,
    restarts: 0,
    memory: null,
    cpu: null
  };
  
  const lines = result.stdout.split('\n');
  for (const line of lines) {
    const statusMatch = line.match(/status\s*│\s*(\S+)/);
    if (statusMatch) info.status = statusMatch[1];
    
    const pidMatch = line.match(/pid\s*│\s*(\d+)/);
    if (pidMatch) info.pid = parseInt(pidMatch[1]);
    
    const uptimeMatch = line.match(/uptime\s*│\s*(.+)/);
    if (uptimeMatch) info.uptime = uptimeMatch[1].trim();
    
    const restartMatch = line.match(/restarts\s*│\s*(\d+)/);
    if (restartMatch) info.restarts = parseInt(restartMatch[1]);
    
    const memMatch = line.match(/memory usage\s*│\s*(.+)/);
    if (memMatch) info.memory = memMatch[1].trim();
    
    const cpuMatch = line.match(/cpu usage\s*│\s*(.+)/);
    if (cpuMatch) info.cpu = cpuMatch[1].trim();
  }
  
  return { success: true, info };
}

// 导出所有函数
export default {
  isPM2Installed,
  getPM2Version,
  getPlatformInfo,
  getStatus,
  startService,
  startCombinedService,
  stopService,
  restartService,
  deleteService,
  showLogs,
  getStartupStatus,
  enableStartup,
  disableStartup,
  savePM2,
  getServiceInfo,
  APP_NAMES
};
