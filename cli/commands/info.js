/**
 * 信息命令
 * 用法: dove info
 * 查看当前账号在当前网关下的可用系统情况
 * 普通用户：显示自己的资源配额
 * 管理员：显示整个系统状态
 */

import { Command } from 'commander';
import { display } from '../display.js';
import { DoveClient, AdminClient } from '../client.js';

export const infoCommand = new Command('info')
  .description('查看当前账号的可用资源信息')
  .option('-g, --gateway <url>', '指定网关地址')
  .option('-j, --json', 'JSON 格式输出')
  .option('--admin', '管理员视角（仅超级管理员可用）')
  .action(async (options) => {
    const client = new DoveClient();
    
    if (options.gateway) {
      client.baseUrl = options.gateway.replace(/\/$/, '');
    }
    
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║           白鸽资源信息                               ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`网关: ${client.baseUrl}`);
    console.log('');
    
    try {
      let verifyResult = await client.verifyToken();
      
      if (!verifyResult.valid) {
        console.log('▶ 自动登录...');
        const loginResult = await client.anonymousLogin();
        if (!loginResult.success) {
          display.error('登录失败: ' + loginResult.error);
          process.exit(1);
        }
        verifyResult = await client.verifyToken();
      }
      
      const isAdmin = client.isAdmin();
      
      console.log('─'.repeat(50));
      console.log(' 账号');
      console.log('─'.repeat(50));
      console.log(` 用户ID:   ${verifyResult.userId}`);
      console.log(` 用户名:   ${verifyResult.username || 'anonymous'}`);
      
      if (isAdmin) {
        console.log(` 角色:     超级管理员`);
      } else {
        console.log(` 类型:     ${verifyResult.anonymous ? '匿名用户' : '注册用户'}`);
      }
      
      console.log(` 认证:     ${verifyResult.authType === 'admin' ? '管理员 (24h)' : verifyResult.authType === 'permanent' ? '长期 (7天)' : '临时 (24h)'}`);
      console.log(` 过期:     ${verifyResult.expiresAt}`);
      
      // 管理员视角
      if (isAdmin || options.admin) {
        const adminClient = new AdminClient();
        await showAdminInfo(adminClient, options.json);
        return;
      }
      
      // 普通用户视角
      const diagResult = await client.get('/api/diagnostic');
      const data = diagResult.data;

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      
      if (data.reachability) {
        console.log('');
        console.log('─'.repeat(50));
        console.log(' 可达性');
        console.log('─'.repeat(50));
        const reach = data.reachability;
        console.log(` 网关:     ${reach.gateway === '正常' ? '✓ 正常' : '✗ 异常'}`);
        console.log(` 数据库:   ${reach.database === '正常' ? '✓ 正常' : '✗ 异常'}`);
        console.log(` OSS:      ${reach.oss === '正常' ? '✓ 正常' : reach.oss === '未启用' ? '- 未启用' : '✗ 异常'}`);
      }
      
      if (data.userResources?.database) {
        console.log('');
        console.log('─'.repeat(50));
        console.log(' 数据库配额');
        console.log('─'.repeat(50));
        const db = data.userResources.database;
        
        for (const [key, value] of Object.entries(db.usage)) {
          const limit = db.limits[key];
          const percent = db.percentages[key];
          const bar = generateProgressBar(percent);
          const status = percent > 90 ? '⚠' : percent > 70 ? '!' : ' ';
          console.log(` ${status} ${key.padEnd(12)} ${String(value).padStart(5)}/${limit} [${bar}] ${percent}%`);
        }
        console.log(`   总计:        ${db.totalDocs} 个文档`);
      }
      
      if (data.userResources?.oss) {
        console.log('');
        console.log('─'.repeat(50));
        console.log(' OSS 存储');
        console.log('─'.repeat(50));
        const oss = data.userResources.oss;
        
        if (oss.error) {
          console.log(` 状态:     ✗ ${oss.error}`);
        } else {
          const percent = Math.round(oss.totalSize / oss.limit * 100);
          const bar = generateProgressBar(percent);
          console.log(` 文件数:   ${oss.files}`);
          console.log(` 已用:     ${formatSize(oss.totalSize)}`);
          console.log(` 上限:     ${formatSize(oss.limit)}`);
          console.log(` 使用率:   [${bar}] ${percent}%`);
        }
      }
      
      if (data.userResources?.memory) {
        console.log('');
        console.log('─'.repeat(50));
        console.log(' Git记忆');
        console.log('─'.repeat(50));
        const memory = data.userResources.memory;
        console.log(` 状态:     ${memory.status === 'not_implemented' ? '暂未实现' : '可用'}`);
      }
      
      if (data.userResources?.storage) {
        console.log('');
        console.log('─'.repeat(50));
        console.log(' Git存储');
        console.log('─'.repeat(50));
        const storage = data.userResources.storage;
        console.log(` 状态:     ${storage.status === 'not_implemented' ? '暂未实现' : '可用'}`);
      }
      
      // 显示 API Key 状态
      console.log('');
      console.log('─'.repeat(50));
      console.log(' API Key 配置');
      console.log('─'.repeat(50));
      
      try {
        const keysResult = await client.get('/api/user/keys');
        const keysData = keysResult.data;

        // 显示官方 Key
        for (const [provider, cfg] of Object.entries(keysData.officialKeys || {})) {
          const status = cfg.configured ? '✓' : '✗';
          const label = provider.padEnd(10);
          console.log(` ${status} 官方 ${label} ${cfg.configured ? '可用' : '未配置'}`);
        }

        // 显示用户 Key
        const userKeys = Object.entries(keysData.userKeys || {});
        if (userKeys.length > 0) {
          console.log('');
          for (const [provider, cfg] of userKeys) {
            const label = provider.padEnd(10);
            console.log(` ✓ 用户 ${label} 已配置 (优先)`);
          }
        }

        console.log('');
        display.info('使用 dove config list-keys 查看详情');
      } catch (e) {
        console.log(` 状态:     无法获取 (${e.message})`);
      }
      
      console.log('');
      console.log('─'.repeat(50));
      console.log(` 查询时间: ${data.timestamp}`);
      console.log('');
      
    } catch (err) {
      display.error(err.message);
      process.exit(1);
    }
  });

// 管理员信息展示
async function showAdminInfo(client, jsonOutput) {
  try {
    const data = await client.getAdminDiagnostic();
    
    if (jsonOutput) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    
    // 网关状态
    if (data.gateway) {
      console.log('');
      console.log('─'.repeat(50));
      console.log(' 网关状态');
      console.log('─'.repeat(50));
      console.log(` 状态:     在线`);
      console.log(` 运行时间: ${formatUptime(data.gateway.uptime)}`);
      console.log(` 内存:     ${formatSize(data.gateway.memory.heapUsed)} / ${formatSize(data.gateway.memory.heapTotal)}`);
    }
    
    // 数据库状态
    if (data.database) {
      console.log('');
      console.log('─'.repeat(50));
      console.log(' 数据库状态');
      console.log('─'.repeat(50));
      console.log(` 管理库:   ${data.database.admin.name}`);
      console.log(`   集合数: ${data.database.admin.collections}`);
      console.log(`   数据量: ${formatSize(data.database.admin.dataSize)}`);
      console.log(` 用户库:   ${data.database.user.name}`);
      console.log(`   集合数: ${data.database.user.collections}`);
      console.log(`   数据量: ${formatSize(data.database.user.dataSize)}`);
    }
    
    // 用户统计
    if (data.users) {
      console.log('');
      console.log('─'.repeat(50));
      console.log(' 用户统计');
      console.log('─'.repeat(50));
      console.log(` 总用户数: ${data.users.total}`);
      console.log(` 24h活跃:  ${data.users.active24h}`);
    }
    
    // 任务统计
    if (data.tasks) {
      console.log('');
      console.log('─'.repeat(50));
      console.log(' 任务统计');
      console.log('─'.repeat(50));
      const tasks = data.tasks.byStatus;
      for (const [status, count] of Object.entries(tasks)) {
        console.log(` ${status.padEnd(12)} ${count}`);
      }
    }
    
    // 鸽群状态
    console.log('');
    console.log('─'.repeat(50));
    console.log(' 鸽群状态');
    console.log('─'.repeat(50));
    console.log(` 总数:     ${data.doves.count}`);
    console.log(` 在线:     ${data.doves.online}`);
    if (data.doves.instances.length > 0) {
      console.log('');
      for (const dove of data.doves.instances) {
        const statusIcon = dove.status === '在线' ? '✓' : dove.status === '忙碌' ? '⚡' : '✗';
        const nameTag = dove.name ? ` ${dove.name}` : '';
        const tasksTag = dove.activeTasks ? ` [${dove.activeTasks}任务]` : '';
        console.log(` ${statusIcon} ${dove.id}${nameTag} (${dove.platform})${tasksTag}`);
      }
    }
    
    // OSS 状态
    if (data.oss && data.oss.enabled) {
      console.log('');
      console.log('─'.repeat(50));
      console.log(' OSS 存储');
      console.log('─'.repeat(50));
      if (data.oss.error) {
        console.log(` 状态:     ✗ ${data.oss.error}`);
      } else {
        console.log(` 文件数:   ${data.oss.files}`);
        console.log(` 总大小:   ${formatSize(data.oss.totalSize)}`);
      }
    }
    
    console.log('');
    console.log('─'.repeat(50));
    console.log(` 查询时间: ${data.timestamp}`);
    console.log('');
    
  } catch (err) {
    if (err.message.includes('403') || err.message.includes('管理员权限')) {
      display.error('需要超级管理员权限');
    } else {
      display.error(err.message);
    }
    process.exit(1);
  }
}

function formatUptime(seconds) {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时`;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days} 天 ${hours} 小时`;
}

function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(2)} ${units[i]}`;
}

function generateProgressBar(percent, width = 20) {
  const filled = Math.round(percent / 100 * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export default infoCommand;
