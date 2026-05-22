/**
 * 网关管理 - 服务端地址配置
 */

import { display } from '../../display.js';
import { loadConfig, saveConfig, DEFAULT_CONFIG, getConfigPath } from '../../lib/config.js';
import { input, select } from '../../lib/interactive.js';

import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = getConfigPath();

export async function setGateway(url) {
  // 验证 URL 格式
  try {
    new URL(url);
  } catch {
    display.error('无效的 URL 格式');
    display.info('示例: http://localhost:3003 或 https://api.dove.com');
    return;
  }
  
  const config = loadConfig();
  config.gateway = url.replace(/\/$/, ''); // 移除末尾斜杠
  saveConfig(config);
  
  display.success(`默认服务端已设置: ${config.server}`);
  display.info('使用 dove config server 查看当前服务端');
}

export async function showGateway() {
  const config = loadConfig();
  display.title('服务端配置');
  console.log(`  当前服务端: ${config.server || DEFAULT_CONFIG.server}`);
  console.log(`  配置文件: ${CONFIG_FILE}`);
}

// ==================== 多 Gateway 管理 ====================

/**
 * 多 Gateway 管理（扇出/容灾双模式）
 * 用法:
 *   dove config gateways                    - 显示当前 gateways 列表
 *   dove config gateways add <url>          - 添加 gateway
 *   dove config gateways remove <url>       - 移除 gateway
 *   dove config gateways clear              - 清空 gateways
 *
 * 双模式说明:
 *   扇出模式（调试）: --gateway 明确指定时，并行发送到所有网关
 *   容灾模式（正式）: 无额外参数时，主网关失败后自动尝试备份网关
 */
export async function manageGateways(action, url) {
  const config = loadConfig();
  
  if (!action) {
    // 显示当前 gateways
    display.title('多 Gateway 配置（扇出/容灾双模式）');
    const gateways = config.gateways || [];
    if (gateways.length === 0) {
      console.log('  未配置多 Gateway');
      console.log('  使用 dove config gateways add <url> 添加');
    } else {
      gateways.forEach((gw, i) => {
        console.log(`  ${i + 1}. ${gw}`);
      });
      console.log('');
      display.info('dove chat --gateway 启用扇出模式；无参数时自动容灾切换');
    }
    console.log('');
    display.info('子命令:');
    console.log('  dove config gateways add <url>     添加 gateway');
    console.log('  dove config gateways remove <url>  移除 gateway');
    console.log('  dove config gateways clear         清空 gateways');
    return;
  }
  
  switch (action) {
    case 'add': {
      if (!url) {
        display.error('请提供 URL: dove config gateways add <url>');
        return;
      }
      // 验证 URL 格式
      try { new URL(url); } catch { display.error('无效的 URL 格式'); return; }
      const normalizedUrl = url.replace(/\/$/, '');
      if (!config.gateways) config.gateways = [];
      if (config.gateways.includes(normalizedUrl)) {
        display.warn('该 gateway 已存在');
        return;
      }
      config.gateways.push(normalizedUrl);
      saveConfig(config);
      display.success(`已添加 gateway: ${normalizedUrl} (共 ${config.gateways.length} 个)`);
      break;
    }
    case 'remove': {
      if (!url) {
        display.error('请提供 URL: dove config gateways remove <url>');
        return;
      }
      const normalizedUrl = url.replace(/\/$/, '');
      if (!config.gateways || !config.gateways.includes(normalizedUrl)) {
        display.warn('该 gateway 不存在');
        return;
      }
      config.gateways = config.gateways.filter(gw => gw !== normalizedUrl);
      saveConfig(config);
      display.success(`已移除 gateway: ${normalizedUrl} (剩余 ${config.gateways.length} 个)`);
      break;
    }
    case 'clear': {
      config.gateways = [];
      saveConfig(config);
      display.success('已清空所有 gateways');
      break;
    }
    default:
      display.error(`未知操作: ${action}`);
      display.info('可用操作: add, remove, clear');
  }
}

// 设置配置
