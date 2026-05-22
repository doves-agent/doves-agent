/**
 * 机器标识模块（CLI 内部副本）
 * 
 * 从项目 common/机器标识.js 复制，解决 esbuild 中文路径打包问题
 * 原始文件：白鸽系统/common/机器标识.js
 * 
 * 注意：此文件需与 common/机器标识.js 保持同步
 * 
 * 标识格式：{os}_{hash}_{component}_{index}
 * 如 win_48e77d00_cli_0
 */

import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// 内存缓存
let _cachedMachineId = null;

// ==================== OS 短码 ====================

function getOsCode() {
  const platform = process.platform;
  if (platform === 'win32') return 'win';
  if (platform === 'darwin') return 'mac';
  if (platform === 'linux') return 'lin';
  return 'other';
}

const OS_SHORT_CODES = ['win', 'mac', 'lin', 'other'];

// ==================== MachineId 生成 ====================

function generateDeviceHash() {
  const host = hostname() || 'unknown';
  const uuid = randomUUID();
  const seed = host + uuid;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0').substring(0, 8);
}

function generateMachineId() {
  const os = getOsCode();
  const hash = generateDeviceHash();
  return `${os}_${hash}`;
}

function isValidMachineId(machineId) {
  if (!machineId) return false;
  const parts = machineId.split('_');
  return parts.length === 2 && OS_SHORT_CODES.includes(parts[0]) && /^[0-9a-f]{8}$/.test(parts[1]);
}

// ==================== .env 读写 ====================

function findEnvFile() {
  const paths = [];
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    paths.push(join(__dirname, '..', '..', '.env'));
    paths.push(join(__dirname, '..', '.env'));
  } catch (e) {
    console.warn('[MachineId] 获取__dirname失败:', e.message);
  }
  paths.push(join(process.cwd(), '.env'));
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

function readEnvMachineId(envPath) {
  try {
    const content = readFileSync(envPath, 'utf-8');
    const match = content.match(/^MACHINE_ID=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch (e) {
    console.warn('[MachineId] 读取MACHINE_ID失败:', e.message);
    return null;
  }
}

function writeEnvMachineId(envPath, machineId) {
  try {
    let content = '';
    if (existsSync(envPath)) content = readFileSync(envPath, 'utf-8');
    if (content.includes('MACHINE_ID=')) {
      content = content.replace(/^MACHINE_ID=.+$/m, `MACHINE_ID=${machineId}`);
    } else {
      if (!content.endsWith('\n')) content += '\n';
      content += `\n# 机器标识（自动生成，用于本地亲和调度）\nMACHINE_ID=${machineId}\n`;
    }
    writeFileSync(envPath, content, 'utf-8');
  } catch (e) {
    console.warn('[MachineId] 写入MACHINE_ID失败:', e.message);
  }
}

// ==================== 导出 ====================

/**
 * 获取或生成机器标识
 * 只有 {os}_{8hex} 格式才使用，否则重新生成
 */
export function 获取或生成机器标识() {
  if (_cachedMachineId) return _cachedMachineId;
  
  let raw = process.env.MACHINE_ID || null;
  const envPath = findEnvFile();
  if (!raw && envPath) raw = readEnvMachineId(envPath);
  
  let machineId = null;
  if (raw && isValidMachineId(raw)) {
    machineId = raw;
  }
  
  if (!machineId) {
    machineId = generateMachineId();
  }
  
  if (envPath && machineId !== raw) {
    writeEnvMachineId(envPath, machineId);
  }
  
  process.env.MACHINE_ID = machineId;
  _cachedMachineId = machineId;
  
  return _cachedMachineId;
}

/**
 * 生成分组标识（完整标识符）
 * 与 common/机器标识.js 保持同步
 */
export function 生成分组标识(machineId, component, index = 0) {
  return `${machineId}_${component}_${index}`;
}
