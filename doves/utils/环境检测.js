/**
 * @file utils/环境检测
 * @description 检测鸽子运行环境（Docker/虚拟机/物理机）
 * 
 * 根据检测结果给出安全建议：
 * - Docker容器：安全，推荐
 * - Windows虚拟机：可接受（Windows无法进Docker）
 * - Linux虚拟机：警告，建议放进Docker
 * - 物理机：严重警告，需要用户确认
 * 
 * @module 环境检测
 */

import { platform, hostname } from 'os';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import readline from 'readline';

// ============================================================================
// 检测函数
// ============================================================================

/**
 * 检测是否在Docker容器中
 * 
 * 检测方法：
 * 1. 检查 /.dockerenv 文件是否存在
 * 2. 检查 /proc/1/cgroup 是否包含 docker 或 containerd
 * 3. 检查环境变量
 * 
 * @returns {boolean}
 */
export function 检测Docker() {
  // Windows 不支持 Docker 检测这些方式
  if (platform() === 'win32') {
    // Windows 上检查环境变量
    return !!process.env.DOCKER_CONTAINER || 
           process.env.KUBERNETES_SERVICE_HOST !== undefined;
  }
  
  // 方法1: 检查 /.dockerenv 文件
  if (existsSync('/.dockerenv')) {
    return true;
  }
  
  // 方法2: 检查 /proc/1/cgroup
  try {
    if (existsSync('/proc/1/cgroup')) {
      const cgroup = readFileSync('/proc/1/cgroup', 'utf-8');
      if (cgroup.includes('docker') || 
          cgroup.includes('containerd') ||
          cgroup.includes('kubepods')) {
        return true;
      }
    }
  } catch (e) {
    // 忽略读取错误
  }
  
  // 方法3: 检查环境变量
  if (process.env.DOCKER_CONTAINER || 
      process.env.KUBERNETES_SERVICE_HOST) {
    return true;
  }
  
  // 方法4: 检查 /proc/self/cgroup (某些容器)
  try {
    if (existsSync('/proc/self/cgroup')) {
      const cgroup = readFileSync('/proc/self/cgroup', 'utf-8');
      if (cgroup.includes('docker') || 
          cgroup.includes('containerd') ||
          cgroup.includes('kubepods')) {
        return true;
      }
    }
  } catch (e) {
    // 忽略
  }
  
  return false;
}

/**
 * 检测是否在虚拟机中
 * 
 * 检测方法：
 * 1. 使用 systemd-detect-virt 命令（Linux）
 * 2. 检查 DMI 信息（Linux）
 * 3. 检查 Windows WMI（Windows）
 * 
 * @returns {Promise<{isVM: boolean, type: string, vendor: string}>}
 */
export async function 检测虚拟机() {
  const currentPlatform = platform();
  
  // 先检测Docker，如果在Docker里就不算虚拟机
  if (检测Docker()) {
    return { isVM: false, type: 'docker', vendor: 'docker' };
  }
  
  // Linux 系统
  if (currentPlatform === 'linux') {
    return await 检测Linux虚拟机();
  }
  
  // Windows 系统
  if (currentPlatform === 'win32') {
    return await 检测Windows虚拟机();
  }
  
  // macOS 系统
  if (currentPlatform === 'darwin') {
    return await 检测Mac虚拟机();
  }
  
  return { isVM: false, type: '未知', vendor: '未知' };
}

/**
 * Linux 虚拟机检测
 */
async function 检测Linux虚拟机() {
  // 方法1: 使用 systemd-detect-virt 命令
  try {
    const result = execSync('systemd-detect-virt 2>/dev/null || echo "none"', {
      encoding: 'utf-8',
      timeout: 5000
    }).trim();
    
    if (result && result !== 'none') {
      // systemd-detect-virt 返回虚拟机类型
      // vmware, kvm, qemu, xen, microsoft(hyper-v), oracle(virtualbox), etc.
      const isContainer = ['docker', 'lxc', 'lxd', 'openvz', 'rkt', 'systemd-nspawn'].includes(result);
      
      if (!isContainer) {
        return { isVM: true, type: result, vendor: 获取虚拟机厂商(result) };
      }
    }
  } catch (e) {
    // 命令不存在或执行失败，继续其他方法
  }
  
  // 方法2: 检查 DMI 信息
  try {
    if (existsSync('/sys/class/dmi/id/product_name')) {
      const productName = readFileSync('/sys/class/dmi/id/product_name', 'utf-8').trim().toLowerCase();
      const vmKeywords = ['vmware', 'virtualbox', 'virtual', 'qemu', 'kvm', 'xen', 'hyper-v', 'parallels'];
      
      for (const keyword of vmKeywords) {
        if (productName.includes(keyword)) {
          return { isVM: true, type: keyword, vendor: 获取虚拟机厂商(keyword) };
        }
      }
    }
    
    if (existsSync('/sys/class/dmi/id/sys_vendor')) {
      const sysVendor = readFileSync('/sys/class/dmi/id/sys_vendor', 'utf-8').trim().toLowerCase();
      const vmVendors = ['vmware', 'qemu', 'xen', 'microsoft corporation', 'innotek', 'parallels'];
      
      for (const vendor of vmVendors) {
        if (sysVendor.includes(vendor)) {
          return { isVM: true, type: vendor, vendor: 获取虚拟机厂商(vendor) };
        }
      }
    }
  } catch (e) {
    // 忽略权限错误等
  }
  
  // 方法3: 检查 /proc/cpuinfo
  try {
    if (existsSync('/proc/cpuinfo')) {
      const cpuinfo = readFileSync('/proc/cpuinfo', 'utf-8').toLowerCase();
      const vmKeywords = ['vmware', 'virtualbox', 'qemu', 'virtual'];
      
      for (const keyword of vmKeywords) {
        if (cpuinfo.includes(keyword)) {
          return { isVM: true, type: keyword, vendor: 获取虚拟机厂商(keyword) };
        }
      }
    }
  } catch (e) {
    // 忽略
  }
  
  return { isVM: false, type: 'physical', vendor: 'physical' };
}

/**
 * Windows 虚拟机检测
 */
async function 检测Windows虚拟机() {
  try {
    // 使用 WMI 检测
    const result = execSync(
      'wmic computersystem get model,manufacturer /format:list',
      { encoding: 'utf-8', timeout: 10000 }
    );
    
    const lines = result.toLowerCase();
    const vmKeywords = ['vmware', 'virtualbox', 'virtual', 'qemu', 'xen', 'hyper-v', 'parallels'];
    
    for (const keyword of vmKeywords) {
      if (lines.includes(keyword)) {
        return { isVM: true, type: keyword, vendor: 获取虚拟机厂商(keyword) };
      }
    }
    
    // 检查特定的 Hyper-V 标记
    if (lines.includes('microsoft') && lines.includes('virtual')) {
      return { isVM: true, type: 'hyper-v', vendor: 'Microsoft' };
    }
    
  } catch (e) {
    // WMI 命令失败
  }
  
  // 检查环境变量
  const processorIdentifier = (process.env.PROCESSOR_IDENTIFIER || '').toLowerCase();
  if (processorIdentifier.includes('virtual') || processorIdentifier.includes('qemu')) {
    return { isVM: true, type: 'virtual', vendor: 'Unknown' };
  }
  
  return { isVM: false, type: 'physical', vendor: 'physical' };
}

/**
 * macOS 虚拟机检测
 */
async function 检测Mac虚拟机() {
  try {
    const result = execSync('system_profiler SPHardwareDataType', {
      encoding: 'utf-8',
      timeout: 10000
    }).toLowerCase();
    
    const vmKeywords = ['vmware', 'parallels', 'virtualbox', 'virtual'];
    
    for (const keyword of vmKeywords) {
      if (result.includes(keyword)) {
        return { isVM: true, type: keyword, vendor: 获取虚拟机厂商(keyword) };
      }
    }
  } catch (e) {
    // 忽略
  }
  
  return { isVM: false, type: 'physical', vendor: 'physical' };
}

/**
 * 获取虚拟机厂商友好名称
 */
function 获取虚拟机厂商(type) {
  const vendorMap = {
    'vmware': 'VMware',
    'virtualbox': 'Oracle VirtualBox',
    'qemu': 'QEMU/KVM',
    'kvm': 'KVM',
    'xen': 'Xen',
    'hyper-v': 'Microsoft Hyper-V',
    'microsoft': 'Microsoft Hyper-V',
    'microsoft corporation': 'Microsoft Hyper-V',
    'innotek': 'Oracle VirtualBox',
    'parallels': 'Parallels',
    'oracle': 'Oracle VirtualBox'
  };
  
  return vendorMap[type.toLowerCase()] || type;
}

// ============================================================================
// 环境检测结果
// ============================================================================

/**
 * @typedef {Object} 环境检测结果
 * @property {string} 平台 - 操作系统平台 (windows, linux, darwin)
 * @property {boolean} isDocker - 是否在Docker容器中
 * @property {boolean} isVM - 是否在虚拟机中
 * @property {boolean} isPhysical - 是否在物理机中
 * @property {string} vmType - 虚拟机类型
 * @property {string} vmVendor - 虚拟机厂商
 * @property {string} 安全等级 - safe, warning, danger
 * @property {string} 建议 - 运行建议
 */

/**
 * 执行完整的环境检测
 * 
 * @returns {Promise<环境检测结果>}
 */
export async function 检测运行环境() {
  const currentPlatform = platform();
  const isDocker = 检测Docker();
  const vmInfo = await 检测虚拟机();
  
  const result = {
    平台: currentPlatform,
    isDocker,
    isVM: vmInfo.isVM,
    isPhysical: !isDocker && !vmInfo.isVM,
    vmType: vmInfo.type,
    vmVendor: vmInfo.vendor,
    安全等级: '安全',
    建议: ''
  };
  
  // 判断安全等级和建议
  if (isDocker) {
    result.安全等级 = '安全';
    result.建议 = '运行在Docker容器中，环境隔离良好';
  } else if (vmInfo.isVM) {
    // Windows 虚拟机不警告（因为Windows无法进Docker）
    if (currentPlatform === 'win32') {
      result.安全等级 = '安全';
      result.建议 = '运行在Windows虚拟机中，环境可接受';
    } else {
      // Linux/macOS 虚拟机建议放进Docker
      result.安全等级 = 'warning';
      result.建议 = `运行在${vmInfo.vendor}虚拟机中，建议使用Docker容器以获得更好的隔离性`;
    }
  } else {
    // 物理机运行，危险
    result.安全等级 = 'danger';
    if (currentPlatform === 'win32') {
      result.建议 = '运行在Windows物理机上，建议使用Windows虚拟机或WSL2+Docker隔离环境';
    } else {
      result.建议 = '运行在物理机上，强烈建议使用Docker容器或虚拟机隔离环境';
    }
  }
  
  return result;
}

// ============================================================================
// 用户确认处理
// ============================================================================

/**
 * 等待用户确认（在终端中）
 * 
 * @param {string} message - 提示消息
 * @returns {Promise<boolean>}
 */
export function 等待用户确认(message = '确认继续？') {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      const confirmed = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
      resolve(confirmed);
    });
  });
}

/**
 * 启动前环境检测
 * 
 * 在鸽子启动时调用，检测环境并根据结果给出警告或要求确认
 * 
 * @param {string} 鸽子类型 - '官方鸽子' 或 '野鸽子'
 * @param {Object} options - 选项
 * @param {boolean} options.skipConfirm - 跳过确认（用于自动化场景）
 * @returns {Promise<{canStart: boolean, envInfo: 环境检测结果}>}
 */
export async function 启动前环境检测(鸽子类型, options = {}) {
  const prefix = `[${鸽子类型}]`;
  
  console.log('');
  console.log(`${prefix} ========================================`);
  console.log(`${prefix} 环境检测`);
  console.log(`${prefix} ========================================`);
  
  const envInfo = await 检测运行环境();
  
  console.log(`${prefix} 操作系统: ${envInfo.平台}`);
  console.log(`${prefix} Docker容器: ${envInfo.isDocker ? '是' : '否'}`);
  console.log(`${prefix} 虚拟机: ${envInfo.isVM ? `是 (${envInfo.vmVendor})` : '否'}`);
  console.log(`${prefix} 物理机: ${envInfo.isPhysical ? '是' : '否'}`);
  console.log(`${prefix} 安全等级: ${envInfo.安全等级.toUpperCase()}`);
  console.log(`${prefix} ========================================`);
  console.log('');
  
  // 根据安全等级处理
  if (envInfo.安全等级 === '安全') {
    console.log(`${prefix} ✅ ${envInfo.建议}`);
    console.log('');
    return { canStart: true, envInfo };
  }
  
  if (envInfo.安全等级 === 'warning') {
    console.warn(`${prefix} ⚠️  ${envInfo.建议}`);
    console.log('');
    return { canStart: true, envInfo };
  }
  
  if (envInfo.安全等级 === 'danger') {
    console.warn(`${prefix} ❌ 警告: ${envInfo.建议}`);
    console.log('');
    console.log(`${prefix} ========================================`);
    console.warn(`${prefix} ⚠️  安全风险警告 ⚠️`);
    console.log(`${prefix} ========================================`);
    console.log(`${prefix} 您正在物理机上直接运行鸽子程序！`);
    console.log(`${prefix}`);
    console.log(`${prefix} 物理机运行的风险：`);
    console.log(`${prefix}   - 技能可能直接访问您的文件系统`);
    console.log(`${prefix}   - 恶意技能可能造成数据泄露或损坏`);
    console.log(`${prefix}   - 无法有效隔离不同任务的执行环境`);
    console.log(`${prefix}`);
    console.log(`${prefix} 推荐的安全运行方式：`);
    if (envInfo.平台 === 'win32') {
      console.log(`${prefix}   1. 使用 Windows 虚拟机隔离`);
      console.log(`${prefix}   2. 使用 WSL2 + Docker 容器`);
    } else {
      console.log(`${prefix}   1. 使用 Docker 容器运行（推荐）`);
      console.log(`${prefix}   2. 使用虚拟机隔离`);
    }
    console.log(`${prefix} ========================================`);
    console.log('');
    
    if (options.skipConfirm) {
      console.log(`${prefix} 已配置跳过确认，继续启动...`);
      console.log('');
      return { canStart: true, envInfo };
    }
    
    // 需要用户确认
    const confirmed = await 等待用户确认(`${prefix} 我了解风险，确认继续在物理机运行？`);
    
    if (!confirmed) {
      console.log(`${prefix} 已取消启动。请使用Docker容器或虚拟机运行。`);
      console.log('');
      return { canStart: false, envInfo };
    }
    
    console.log(`${prefix} 用户确认继续，正在启动...`);
    console.log('');
    return { canStart: true, envInfo };
  }
  
  return { canStart: true, envInfo };
}

// ============================================================================
// 导出
// ============================================================================

export default {
  检测Docker,
  检测虚拟机,
  检测运行环境,
  启动前环境检测,
  等待用户确认
};
