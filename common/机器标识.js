/**
 * 统一机器标识模块
 * 
 * 为 CLI / Server / Doves 三大组件提供统一的机器标识符，
 * 支持本地亲和调度（"帮我关机"只派给本机鸽子执行）。
 * 
 * 标识格式：{os}_{hash}_{component}_{index}
 * - os：操作系统短码 win(win32) / mac(darwin) / lin(linux)
 * - hash：8位hex设备唯一哈希（持久化到 .env 的 MACHINE_ID 字段）
 * - component：cli / server / dove
 * - index：同组件多实例序号（从0开始）
 * 
 * 示例：
 * - win_48e77d00_cli_0
 * - win_48e77d00_server_0
 * - win_48e77d00_dove_0
 * - win_48e77d00_dove_8
 * - mac_a1b2c3de_dove_0
 * - lin_f5e4d3c2_dove_0
 * 
 * 同机检测：比较 {os}_{hash} 前缀是否相同
 */

import { hostname } from 'os';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ==================== OS 短码映射 ====================

/**
 * 获取当前操作系统短码
 * @returns {string} 'win' | 'mac' | 'lin' | 'other'
 */
export function 获取OS短码() {
  const platform = process.platform;
  if (platform === 'win32') return 'win';
  if (platform === 'darwin') return 'mac';
  if (platform === 'linux') return 'lin';
  return 'other';
}

/**
 * OS 短码白名单（用于格式验证）
 */
const OS_SHORT_CODES = ['win', 'mac', 'lin', 'other'];

// ==================== MachineId 生成 ====================

/**
 * 生成设备哈希（8位hex，基于稳定的机器特征）
 * 使用 hostname + OS + 稳定环境标识，确保同一台机器每次生成相同结果
 * @returns {string} 如 "48e77d00"
 */
function 生成设备哈希() {
  const host = hostname() || 'unknown';
  const seed = [
    host,
    process.platform,
    process.arch,
    process.env.COMPUTERNAME || process.env.HOSTNAME || '',
    process.env.USERDOMAIN || '',
  ].join(':');
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0').substring(0, 8);
}

/**
 * 生成 machineId（格式：{os}_{hash}）
 * @returns {string} 如 "win_48e77d00"
 */
function 生成machineId() {
  const os = 获取OS短码();
  const hash = 生成设备哈希();
  return `${os}_${hash}`;
}

/**
 * 查找 .env 文件路径
 * @returns {string|null} .env 文件绝对路径
 */
function 查找env文件() {
  const 可能路径 = [];
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    可能路径.push(join(__dirname, '..', '.env'));
    可能路径.push(join(__dirname, '../..', '.env'));
    可能路径.push(join(__dirname, '.env'));
  } catch (e) {
    console.warn('[机器标识] 推断 .env 路径失败，使用当前目录:', e.message);
  }
  可能路径.push(join(process.cwd(), '.env'));
  可能路径.push(join(process.cwd(), '..', '.env'));
  for (const 路径 of 可能路径) {
    if (existsSync(路径)) return 路径;
  }
  return null;
}

/**
 * 判断是否为合法 machineId 格式 ({os}_{8hex})
 * @param {string} machineId
 * @returns {boolean}
 */
export function 是合法machineId(machineId) {
  if (!machineId) return false;
  const parts = machineId.split('_');
  return parts.length === 2 && OS_SHORT_CODES.includes(parts[0]) && /^[0-9a-f]{8}$/.test(parts[1]);
}

/**
 * 从 .env 文件读取 MACHINE_ID
 * @param {string} envPath
 * @returns {string|null}
 */
function 从env读取(envPath) {
  try {
    const content = readFileSync(envPath, 'utf-8');
    const match = content.match(/^MACHINE_ID=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    console.warn('[机器标识] 读取 .env 文件失败:', e.message);
    return null;
  }
}

/**
 * 将 MACHINE_ID 写入 .env 文件
 * @param {string} envPath
 * @param {string} machineId
 */
function 写入env(envPath, machineId) {
  try {
    let content = '';
    if (existsSync(envPath)) {
      content = readFileSync(envPath, 'utf-8');
    }
    if (content.includes('MACHINE_ID=')) {
      content = content.replace(/^MACHINE_ID=.*$/m, `MACHINE_ID=${machineId}`);
    } else {
      if (!content.endsWith('\n')) content += '\n';
      content += `\n# 机器标识（自动生成，用于本地亲和调度）\nMACHINE_ID=${machineId}\n`;
    }
    writeFileSync(envPath, content, 'utf-8');
  } catch (e) {
    console.warn('[机器标识] 写入 .env 失败:', e.message);
  }
}

/**
 * 获取或生成机器标识
 * 优先从环境变量读取，其次从 .env 文件读取，不符合格式则重新生成
 * 
 * @param {Object} 选项 - 配置选项
 * @param {string} 选项.envPath - 指定 .env 文件路径（可选）
 * @returns {string} 机器标识，如 "win_48e77d00"
 */
export function 获取或生成机器标识(选项 = {}) {
  // 1. 从环境变量或 .env 读取
  let raw = process.env.MACHINE_ID || null;
  const envPath = 选项.envPath || 查找env文件();
  if (!raw && envPath) {
    raw = 从env读取(envPath);
  }
  
  // 2. 格式校验：确保符合 {os}_{8hex} 格式
  let machineId = null;
  if (raw && 是合法machineId(raw)) {
    machineId = raw;
  }
  
  if (!machineId) {
    machineId = 生成machineId();
    console.log(`[机器标识] 生成新标识: ${machineId}${envPath ? `，已写入 ${envPath}` : ''}`);
  }
  
  // 3. 持久化（写入 .env，供后续启动读取）
  if (envPath && machineId !== raw) {
    写入env(envPath, machineId);
  }
  
  // 4. 缓存到环境变量
  process.env.MACHINE_ID = machineId;
  
  return machineId;
}

/**
 * 生成分组标识（完整标识符）
 * @param {string} machineId - 机器标识（如 win_48e77d00）
 * @param {string} component - 组件类型：cli / server / dove
 * @param {number} index - 实例序号（从0开始）
 * @returns {string} 完整标识符，如 "win_48e77d00_dove_0"
 */
export function 生成分组标识(machineId, component, index = 0) {
  return `${machineId}_${component}_${index}`;
}

/**
 * 从分组标识中提取 machineId
 * 格式: {os}_{8hex}_{component}_{index} → {os}_{8hex}
 * @param {string} 分组标识 - 如 "win_48e77d00_dove_0"
 * @returns {string|null} machineId，如 "win_48e77d00"
 */
export function 提取机器标识(分组标识) {
  if (!分组标识) return null;
  const parts = 分组标识.split('_');
  if (parts.length >= 4 && OS_SHORT_CODES.includes(parts[0]) && /^[0-9a-f]{8}$/.test(parts[1])) {
    return `${parts[0]}_${parts[1]}`;
  }
  return null;
}

/**
 * 判断两个分组标识是否属于同一台机器
 * @param {string} 标识A
 * @param {string} 标识B
 * @returns {boolean}
 */
export function 是否同机器(标识A, 标识B) {
  return 提取机器标识(标识A) === 提取机器标识(标识B);
}

/**
 * 从 API Key 中提取鸽子ID
 * API Key 格式: sk_{doveId}_{48hex_secret}
 * 
 * @param {string} apiKey - API Key 字符串
 * @returns {string|null} 鸽子ID
 */
export function 从ApiKey提取DoveId(apiKey) {
  if (!apiKey || !apiKey.startsWith('sk_')) return null;
  const match = apiKey.match(/^sk_(.*)_([0-9a-f]{48})$/);
  return match ? match[1] : null;
}

/**
 * 验证请求中的 doveId 与认证的 doveId 属于同一台机器
 * 比较机器前缀 {os}_{hash} 是否一致
 * 
 * @param {string} requestDoveId - 请求中指定的鸽子ID
 * @param {string} authDoveId - 认证得到的鸽子ID
 * @returns {boolean} 是否属于同一台机器
 */
export function 验证同机器鸽子(requestDoveId, authDoveId) {
  if (requestDoveId === authDoveId) return true;
  return 提取机器标识(requestDoveId) === 提取机器标识(authDoveId);
}
