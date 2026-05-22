/**
 * @file status-诊断.js
 * @description 系统诊断（showTest） + 公共工具函数，从 status.js 抽取
 */

import { display } from '../display.js';
import { DoveClient } from '../client.js';

// ==================== 工具函数 ====================

export function formatUptime(seconds) {
  if (!seconds) return '-';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}天 ${hours}小时 ${mins}分钟`;
  if (hours > 0) return `${hours}小时 ${mins}分钟`;
  return `${mins}分钟`;
}

export function generateProgressBar(percent, width = 20) {
  const p = Math.min(Math.max(percent || 0, 0), 100);
  const filled = Math.round(p / 100 * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ==================== 诊断函数 ====================

/**
 * test: 系统诊断
 */
export async function showTest(options) {
  const client = new DoveClient();
  
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║           白鸽系统诊断                               ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
  
  // 1. 网关连通性
  console.log('▶ 网关连通性...');
  const healthStart = Date.now();
  try {
    const healthResult = await client.get('/health');
    const latency = Date.now() - healthStart;
    if (healthResult.success) {
      console.log(`  ✓ 在线 (延迟: ${latency}ms)`);
    } else {
      console.log(`  ✗ 异常: ${healthResult.error}`);
      process.exit(1);
    }
  } catch (e) {
    console.log(`  ✗ 无法连接: ${e.message}`);
    process.exit(1);
  }
  
  // 2. 认证
  console.log('');
  console.log('▶ 认证状态...');
  const verifyResult = await client.verifyToken();
  if (!verifyResult.valid) {
    console.log('  ! 未登录，尝试匿名登录...');
    const loginResult = await client.anonymousLogin();
    if (!loginResult.success) {
      console.log(`  ✗ 匿名登录失败: ${loginResult.error}`);
      process.exit(1);
    }
    console.log('  ✓ 匿名登录成功');
  } else {
    console.log(`  ✓ 已登录: ${verifyResult.username || verifyResult.userId} (${verifyResult.authType})`);
  }
  
  // 3. 诊断
  console.log('');
  console.log('▶ 系统诊断...');
  try {
    const diagResult = await client.get('/api/diagnostic');
    const data = diagResult.data;

    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const isAdmin = data.user?.role === 'admin';
    
    console.log('');
    console.log('─'.repeat(50));
    console.log(' 基本信息');
    console.log('─'.repeat(50));
    console.log(` 用户:     ${data.user?.username || 'anonymous'} (${data.user?.authType})`);
    console.log(` 网关:     v${data.gateway?.version || '?'}  运行: ${formatUptime(data.gateway?.uptime)}`);
    
    if (data.reachability) {
      console.log('');
      console.log('─'.repeat(50));
      console.log(' 可达性');
      console.log('─'.repeat(50));
      const r = data.reachability;
      console.log(` 网关:     ${r.gateway === '正常' ? '✓' : '✗'}`);
      console.log(` 数据库:   ${r.database === '正常' ? '✓' : '✗'}`);
      console.log(` OSS:      ${r.oss === '正常' ? '✓' : r.oss === '未启用' ? '-' : '✗'}`);
    }
    
    if (data.userResources?.database) {
      console.log('');
      console.log('─'.repeat(50));
      console.log(' 数据库');
      console.log('─'.repeat(50));
      const db = data.userResources.database;
      for (const [key, value] of Object.entries(db.usage || {})) {
        const percent = db.percentages?.[key] || 0;
        console.log(` ${key.padEnd(14)} ${value}/${db.limits?.[key] || '∞'} [${generateProgressBar(percent)}] ${percent}%`);
      }
    }
    
    if (data.userResources?.oss) {
      console.log('');
      console.log('─'.repeat(50));
      console.log(' OSS');
      console.log('─'.repeat(50));
      const oss = data.userResources.oss;
      if (oss.error) {
        console.log(` ✗ ${oss.error}`);
      } else {
        console.log(` 文件: ${oss.files}  大小: ${formatSize(oss.totalSize)} / ${formatSize(oss.limit)}`);
      }
    }
    
    // API Key 状态
    try {
      const keysResult = await client.get('/api/user/keys');
      const keysData = keysResult.data;
      console.log('');
      console.log('─'.repeat(50));
      console.log(' API Key');
      console.log('─'.repeat(50));
      for (const [p, c] of Object.entries(keysData.officialKeys || {})) {
        console.log(` ${c.configured ? '✓' : '✗'} ${p}`);
      }
      for (const [p] of Object.entries(keysData.userKeys || {})) {
        console.log(` ✓ ${p} (用户)`);
      }
    } catch (e) {
      console.warn('[Status] 获取API Key状态失败:', e.message);
    }
    
    console.log('');
  } catch (err) {
    display.error(err.message);
  }
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(2)} ${units[i]}`;
}
