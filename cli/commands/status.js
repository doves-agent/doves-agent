/**
 * 状态命令（KISS 合并版）
 * 合并: status + info + show + ping + test
 * 
 * 用法:
 *   dove status          # 系统概览（默认，原 status+info+show）
 *   dove status ping     # 连通性测试（原 ping）
 *   dove status test     # 系统诊断（原 test）
 *   dove status info     # 详细资源信息（原 info）
 *   dove status show     # 配置与账号信息（原 show）
 */

import { Command } from 'commander';
import { display } from '../display.js';
import { DoveClient, AdminClient } from '../client.js';
import { loadConfig } from './config.js';
import { formatUptime, generateProgressBar, showTest } from './status-诊断.js';

// ==================== 工具函数 ====================

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(2)} ${units[i]}`;
}

function getResourceStatusLabel(status) {
  const labels = { pending: '等待分配', initializing: '初始化中', ready: '已就绪', failed: '分配失败' };
  return labels[status] || status;
}

// ==================== 子命令实现 ====================

/**
 * 默认: 系统概览（一眼看全）
 */
async function showOverview(options) {
  const config = loadConfig();
  const client = config.role === 'admin' ? new AdminClient() : new DoveClient();
  
  // 🔒 超管 --all 标记
  if (options.all) {
    if (!client.isAdmin()) {
      display.error('--all 选项仅超级管理员可用，请使用 dove login --admin 登录');
      process.exit(1);
    }
    client.setAdminAll(true);
  }
  
  // 超管 --uid 权限检查
  if (options.uid) {
    if (!client.isAdmin()) {
      display.error('--uid 选项仅超级管理员可用，请使用 dove login --admin 登录');
      process.exit(1);
    }
    client.setTargetUserId(options.uid);
  }
  
  // --json 模式：直接输出 JSON 概述
  if (options.json) {
    const output = { success: false, gateway: client.baseUrl };
    try {
      const pingResult = await client.ping();
      output.pong = !!(pingResult.success && pingResult.pong);
      output.latency = pingResult.latency || 0;
      
      const verifyResult = await client.verifyToken();
      output.status = pingResult.success && pingResult.pong ? '在线' : '离线';
      output.userId = client.config.userId;
      output.username = client.config.username;
      output.account = { userId: client.config.userId, username: client.config.username, authType: client.config.authType };
      
      const diagResult = await client.get('/api/diagnostic');
      const data = diagResult.data;
      output.success = true;
      output.doves = data.doves;
      output.gateway = data.gateway;
      output.reachability = data.reachability;
    } catch (e) { console.warn('[Status] 诊断信息获取失败:', e.message); }
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║           白鸽系统概览                               ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
  console.log(` 网关: ${client.baseUrl}`);
  
  // 连通性
  const pingResult = await client.ping();
  if (!pingResult.success || !pingResult.pong) {
    console.log(` 状态: ✗ 网关不可达`);
    display.error('网关未响应，请先启动服务端');
    display.info('启动命令: npm run start:server');
    return;
  }
  console.log(` 状态: ✓ 在线 (${pingResult.latency}ms)`);
  
  // 多 Gateway 信息（扇出/容灾双模式）
  const gateways = client.config.gateways || [];
  if (gateways.length > 0) {
    console.log('');
    console.log('─'.repeat(50));
    console.log(' 多 Gateway（扇出/容灾双模式）');
    console.log('─'.repeat(50));
    console.log(` 主: ${client.baseUrl} ✓ 在线 (${pingResult.latency}ms)`);
    
    // 逐个 ping 备用 gateway
    for (const gw of gateways) {
      try {
        const gwClient = new DoveClient();
        gwClient.baseUrl = gw;
        gwClient.token = client.token;
        gwClient.config = { ...client.config };
        const gwPing = await gwClient.ping(3000);
        if (gwPing.success && gwPing.pong) {
          const instanceInfo = gwPing.serverIndex !== undefined ? ` [#${gwPing.serverIndex}]` : '';
          const primaryTag = gwPing.isPrimary === false ? ' (从)' : '';
          console.log(` 从: ${gw} ✓ 在线 (${gwPing.latency}ms)${instanceInfo}${primaryTag}`);
        } else {
          console.log(` 从: ${gw} ✗ 无响应`);
        }
      } catch (e) {
        console.log(` 从: ${gw} ✗ 连接失败`);
      }
    }
  }
  
  // 认证状态
  const verifyResult = await client.verifyToken();
  if (verifyResult.valid) {
    console.log(` 账号: ${verifyResult.username || verifyResult.userId} (${verifyResult.authType})`);
  } else {
    console.log(' 账号: 未登录');
  }
  
  // 快速诊断（合并 info 的核心信息）
  try {
    const diagResult = await client.get('/api/diagnostic');
    const data = diagResult.data;

    if (data.reachability) {
      console.log('');
      console.log('─'.repeat(50));
      console.log(' 可达性');
      console.log('─'.repeat(50));
      const r = data.reachability;
      console.log(` 数据库:  ${r.database === '正常' ? '✓ 正常' : '✗ 异常'}`);
      console.log(` OSS:     ${r.oss === '正常' ? '✓ 正常' : r.oss === '未启用' ? '- 未启用' : '✗ 异常'}`);
    }

    if (data.userResources?.database) {
      console.log('');
      console.log('─'.repeat(50));
      console.log(' 数据库配额');
      console.log('─'.repeat(50));
      const db = data.userResources.database;
      for (const [key, value] of Object.entries(db.usage || {})) {
        const limit = db.limits?.[key] || '∞';
        const percent = db.percentages?.[key] || 0;
        const bar = generateProgressBar(percent);
        console.log(` ${key.padEnd(12)} ${String(value).padStart(5)}/${limit} [${bar}] ${percent}%`);
      }
      console.log(` ${'总计'.padEnd(12)} ${db.totalDocs || 0} 个文档`);
    }

    if (data.userResources?.oss) {
      console.log('');
      console.log('─'.repeat(50));
      console.log(' OSS 存储');
      console.log('─'.repeat(50));
      const oss = data.userResources.oss;
      if (oss.error) {
        console.log(` 状态: ✗ ${oss.error}`);
      } else {
        const percent = Math.round((oss.totalSize || 0) / (oss.limit || 1) * 100);
        console.log(` 文件: ${oss.files || 0}  已用: ${formatSize(oss.totalSize)}  上限: ${formatSize(oss.limit)}`);
        console.log(` 使用率: [${generateProgressBar(percent)}] ${percent}%`);
      }
    }

    if (options.json) {
      console.log('');
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (e) {
    // 诊断失败不阻断概览
  }
  
  console.log('');
}

/**
 * ping: 连通性测试
 */
async function showPing(options) {
  const client = new DoveClient();
  const count = parseInt(options.count, 10) || 1;
  const gateways = client.config.gateways || [];
  const allGateways = [client.baseUrl, ...gateways.filter(u => u !== client.baseUrl)];
  
  if (allGateways.length > 1) {
    display.info(`测试 ${allGateways.length} 个网关`);
  } else {
    display.info(`测试网关: ${client.baseUrl}`);
  }
  console.log('');
  
  for (const gw of allGateways) {
    const gwClient = new DoveClient();
    gwClient.baseUrl = gw;
    gwClient.token = client.token;
    gwClient.config = { ...client.config };
    
    let successCount = 0;
    let totalLatency = 0;
    
    for (let i = 0; i < count; i++) {
      const result = await gwClient.ping();
      if (result.success && result.pong) {
        successCount++;
        totalLatency += result.latency;
        const instanceInfo = result.serverIndex !== undefined ? ` [#${result.serverIndex}]` : '';
        const primaryTag = result.isPrimary === false ? ' (从)' : '';
        display.success(`${gw}: ${result.latency}ms${instanceInfo}${primaryTag}${count > 1 ? ` (seq=${i + 1})` : ''}`);
      } else {
        display.error(`${gw}: 失败 - ${result.error || '未知错误'}${count > 1 ? ` (seq=${i + 1})` : ''}`);
      }
      if (i < count - 1) await new Promise(r => setTimeout(r, 500));
    }
    
    if (count > 1 && successCount > 0) {
      display.info(`  统计: ${successCount}/${count} 成功, 平均延迟 ${Math.round(totalLatency / successCount)}ms`);
    }
  }
  
  console.log('');
}

/**
 * info: 详细资源信息（含管理员视图）
 */
async function showInfo(options) {
  const client = new DoveClient();
  
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║           白鸽资源详情                               ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
  
  let verifyResult = await client.verifyToken();
  if (!verifyResult.valid) {
    console.log('▶ 自动登录...');
    const loginResult = await client.anonymousLogin();
    if (!loginResult.success) { display.error('登录失败: ' + loginResult.error); process.exit(1); }
    verifyResult = await client.verifyToken();
  }
  
  const isAdmin = client.isAdmin();
  
  console.log(` 用户: ${verifyResult.username || 'anonymous'}  角色: ${isAdmin ? '管理员' : verifyResult.anonymous ? '匿名' : '用户'}`);
  console.log(` 认证: ${verifyResult.authType}  过期: ${verifyResult.expiresAt}`);
  
  if (isAdmin || options.admin) {
    try {
      const data = await client.getAdminDiagnostic();
      if (options.json) { console.log(JSON.stringify(data, null, 2)); return; }
      
      console.log('');
      if (data.gateway) {
        console.log('─'.repeat(50));
        console.log(' 网关');
        console.log('─'.repeat(50));
        console.log(` 运行: ${formatUptime(data.gateway?.uptime)}  内存: ${formatSize(data.gateway?.memory?.heapUsed)} / ${formatSize(data.gateway?.memory?.heapTotal)}`);
      }
      
      console.log('');
      console.log('─'.repeat(50));
      console.log(' 数据库');
      console.log('─'.repeat(50));
      if (data.database) {
        console.log(` 管理库: ${data.database.admin?.name} (${data.database.admin?.collections} 集合, ${formatSize(data.database.admin?.dataSize)})`);
        console.log(` 用户库: ${data.database.user?.name} (${data.database.user?.collections} 集合, ${formatSize(data.database.user?.dataSize)})`);
      }
      
      console.log('');
      if (data.users || data.tasks) {
        console.log('─'.repeat(50));
        console.log(' 用户与任务');
        console.log('─'.repeat(50));
        console.log(` 总用户: ${data.users?.total || 0}  24h活跃: ${data.users?.active24h || 0}`);
        if (data.tasks?.byStatus) {
          for (const [s, c] of Object.entries(data.tasks.byStatus)) {
            console.log(` ${s.padEnd(14)} ${c}`);
          }
        }
      }
      
      console.log('');
      console.log('─'.repeat(50));
      console.log(' 鸽群');
      console.log('─'.repeat(50));
      console.log(` 总数: ${data.doves?.count || 0}  在线: ${data.doves?.online || 0}`);
      if (data.doves?.instances && data.doves.instances.length > 0) {
        for (const d of data.doves.instances) {
          const statusIcon = d.status === '在线' ? '✓' : d.status === '忙碌' ? '⚡' : '✗';
          const nameTag = d.name ? ` ${d.name}` : '';
          const tasksTag = d.activeTasks ? ` [${d.activeTasks}任务]` : '';
          console.log(` ${statusIcon} ${d.id}${nameTag} (${d.platform})${tasksTag}`);
        }
      }
    } catch (err) {
      if (err.message.includes('403')) display.error('需要超级管理员权限');
      else display.error(err.message);
    }
    return;
  }
  
  // 普通用户视图
  const diagResult = await client.get('/api/diagnostic');
  const data = diagResult.data;
  
  if (options.json) { console.log(JSON.stringify(data, null, 2)); return; }
  
  if (data.reachability) {
    console.log('');
    console.log('─'.repeat(50));
    console.log(' 可达性');
    console.log('─'.repeat(50));
    const r = data.reachability;
    console.log(` 网关:  ${r.gateway === '正常' ? '✓' : '✗'}  数据库: ${r.database === '正常' ? '✓' : '✗'}  OSS: ${r.oss === '正常' ? '✓' : r.oss === '未启用' ? '-' : '✗'}`);
  }
  
  if (data.userResources?.database) {
    console.log('');
    console.log('─'.repeat(50));
    console.log(' 数据库');
    console.log('─'.repeat(50));
    const db = data.userResources.database;
    for (const [key, value] of Object.entries(db.usage || {})) {
      const percent = db.percentages?.[key] || 0;
      const bar = generateProgressBar(percent);
      const mark = percent > 90 ? '⚠' : ' ';
      console.log(` ${mark} ${key.padEnd(12)} ${value}/${db.limits?.[key] || '∞'} [${bar}] ${percent}%`);
    }
    console.log(`   总计:        ${db.totalDocs} 个文档`);
  }
  
  if (data.userResources?.oss) {
    console.log('');
    console.log('─'.repeat(50));
    console.log(' OSS');
    console.log('─'.repeat(50));
    const oss = data.userResources.oss;
    if (oss.error) { console.log(` ✗ ${oss.error}`); }
    else {
      const percent = Math.round((oss.totalSize || 0) / (oss.limit || 1) * 100);
      console.log(` 文件: ${oss.files}  已用: ${formatSize(oss.totalSize)}  上限: ${formatSize(oss.limit)}  [${generateProgressBar(percent)}] ${percent}%`);
    }
  }
  
  // API Key
  try {
    const keysResult = await client.get('/api/user/keys');
    const keysData = keysResult.data;
    console.log('');
    console.log('─'.repeat(50));
    console.log(' API Key');
    console.log('─'.repeat(50));
    for (const [p, c] of Object.entries(keysData.officialKeys || {})) {
      console.log(` ${c.configured ? '✓' : '✗'} ${p.padEnd(10)} ${c.configured ? '可用' : '未配置'}`);
    }
    for (const [p] of Object.entries(keysData.userKeys || {})) {
      console.log(` ✓ ${p.padEnd(10)} 用户(优先)`);
    }
  } catch (e) {
    console.warn('[Status] 获取API Key状态失败:', e.message);
  }
  
  console.log('');
}

/**
 * show: 配置与账号信息
 */
async function showConfig(options) {
  const config = loadConfig();
  const client = new DoveClient();
  
  if (options.json) {
    const output = {
      config: { gateway: config.gateway, gateways: config.gateways || [], timeout: config.timeout },
      account: { userId: config.userId, username: config.username, authType: config.authType, anonymous: config.anonymous, expiresAt: config.expiresAt }
    };
    if (options.secret) output.account.token = config.token;
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║           白鸽配置信息                               ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
  console.log('─'.repeat(50));
  console.log(' 网络');
  console.log('─'.repeat(50));
  console.log(` 网关:   ${config.gateway || 'http://localhost:3003'}`);
  console.log(` 超时:   ${config.timeout || 30000}ms`);
  
  // 多 Gateway 信息
  const gateways = config.gateways || [];
  if (gateways.length > 0) {
    console.log('');
    console.log('─'.repeat(50));
    console.log(' 多 Gateway（开发测试模式）');
    console.log('─'.repeat(50));
    gateways.forEach((gw, i) => {
      console.log(` ${i + 1}. ${gw}`);
    });
    console.log(' 扇出发送: dove chat "你好" --gateways ' + gateways.join(','));
  }
  
  console.log('');
  console.log('─'.repeat(50));
  console.log(' 账号');
  console.log('─'.repeat(50));
  
  if (config.token) {
    console.log(` 状态:   ✓ 已登录`);
    console.log(` 用户:   ${config.userId || '?'}  (${config.username || 'anonymous'})`);
    console.log(` 类型:   ${config.authType === 'permanent' ? '长期(7天)' : '临时(24h)'}`);
    console.log(` Token:  ${options.secret ? config.token : config.token.substring(0, 20) + '...'}`);
    
    console.log('');
    try {
      const result = await client.verifyToken();
      console.log(` 验证:   ${result.valid ? '✓ 有效' : '✗ 无效/过期'}`);
      if (result.expiresAt) console.log(` 过期:   ${result.expiresAt}`);
    } catch (e) {
      console.log(` 验证:   ✗ ${e.message}`);
    }
  } else {
    console.log(' 状态:   ✗ 未登录');
    console.log('');
    display.info('dove auth login -a    # 匿名登录');
    display.info('dove auth login        # 账号登录');
  }
  console.log('');
}

// ==================== 命令注册 ====================

const statusCmd = new Command('status')
  .description('系统状态 (概览/ping/诊断/详情/配置)')
  .option('-j, --json', 'JSON 格式输出')
  .option('-g, --gateway <url>', '指定网关地址')
  .option('-a, --all', '查看所有用户的数据（仅超级管理员可用）')
  .option('--uid <userId>', '查看指定用户的数据（仅超级管理员可用）')
  .option('--admin', '管理员视角')
  .option('--secret', '显示敏感信息')
  .action(async (options) => {
    // 默认: 概览
    await showOverview(options);
  });

// 子命令: ping
statusCmd
  .command('ping')
  .description('连通性测试')
  .option('-c, --count <n>', '测试次数', '1')
  .action(async (options) => {
    await showPing(options);
  });

// 子命令: test
statusCmd
  .command('test')
  .description('系统诊断')
  .option('-j, --json', 'JSON 格式输出')
  .option('-v, --verbose', '详细信息')
  .action(async function(options) {
    await showTest({ ...this.parent?.opts(), ...options });
  });

// 子命令: info
statusCmd
  .command('info')
  .description('详细资源信息')
  .option('-j, --json', 'JSON 格式输出')
  .option('--admin', '管理员视角')
  .action(async function(options) {
    await showInfo({ ...this.parent?.opts(), ...options });
  });

// 子命令: show
statusCmd
  .command('show')
  .description('配置与账号信息')
  .option('-j, --json', 'JSON 格式输出')
  .option('--secret', '显示敏感信息')
  .action(async function(options) {
    await showConfig({ ...this.parent?.opts(), ...options });
  });

export const statusCommand = statusCmd;
export default statusCommand;
