/**
 * 系统诊断命令
 * 用法: dove test [options]
 */

import { Command } from 'commander';
import { DoveClient } from '../client.js';
import { display } from '../display.js';

export const testCommand = new Command('test')
  .description('系统诊断测试')
  .option('-g, --gateway <url>', '指定网关地址')
  .option('-j, --json', 'JSON 格式输出')
  .option('-v, --verbose', '详细信息')
  .action(async (options) => {
    const client = new DoveClient();
    
    if (options.gateway) {
      client.baseUrl = options.gateway.replace(/\/$/, '');
    }
    
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║           白鸽系统诊断测试                            ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`网关地址: ${client.baseUrl}`);
    console.log('');
    
    try {
      console.log('▶ 网关连通性测试...');
      const healthStart = Date.now();

      try {
        const healthResult = await client.get('/health');
        const latency = Date.now() - healthStart;

        if (healthResult.success) {
          console.log(`  ✓ 网关在线 (延迟: ${latency}ms)`);
        } else {
          console.log(`  ✗ 网关异常: ${healthResult.error}`);
          process.exit(1);
        }
      } catch (e) {
        console.log(`  ✗ 无法连接网关: ${e.message}`);
        process.exit(1);
      }
      
      console.log('');
      console.log('▶ 认证状态检查...');
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
        console.log(`  ✓ 已登录: ${verifyResult.username || verifyResult.userId}`);
        console.log(`    认证类型: ${verifyResult.authType}`);
        console.log(`    过期时间: ${verifyResult.expiresAt}`);
      }
      
      console.log('');
      console.log('▶ 系统诊断...');

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
      console.log(` 用户ID:    ${data.user.userId}`);
      console.log(` 用户名:    ${data.user.username || 'anonymous'}`);
      console.log(` 认证类型:  ${data.user.authType}`);
      console.log(` 网关版本:  ${data.gateway.version}`);
      console.log(` 运行时间:  ${formatUptime(data.gateway.uptime)}`);
      
      if (!isAdmin && data.userResources) {
        console.log('');
        console.log('─'.repeat(50));
        console.log(' 可达性检查');
        console.log('─'.repeat(50));
        const reach = data.reachability;
        console.log(` 网关:      ${reach.gateway === '正常' ? '✓ 正常' : '✗ 异常'}`);
        console.log(` 数据库:    ${reach.database === '正常' ? '✓ 正常' : '✗ 异常'}`);
        console.log(` OSS:       ${reach.oss === '正常' ? '✓ 正常' : reach.oss === '未启用' ? '- 未启用' : '✗ 异常'}`);
        
        console.log('');
        console.log('─'.repeat(50));
        console.log(' 数据库配额');
        console.log('─'.repeat(50));
        const db = data.userResources.database;
        for (const [key, value] of Object.entries(db.usage)) {
          const limit = db.limits[key];
          const percent = db.percentages[key];
          const bar = generateProgressBar(percent);
          console.log(` ${key.padEnd(14)} ${String(value).padStart(5)}/${limit} [${bar}] ${percent}%`);
        }
        console.log(` ${'总计'.padEnd(14)} ${db.totalDocs} 个文档`);
        
        console.log('');
        console.log('─'.repeat(50));
        console.log(' OSS 存储');
        console.log('─'.repeat(50));
        const oss = data.userResources.oss;
        if (oss.error) {
          console.log(` 状态:      ✗ ${oss.error}`);
        } else {
          console.log(` 文件数:    ${oss.files}`);
          console.log(` 总大小:    ${formatSize(oss.totalSize)}`);
          console.log(` 上限:      ${formatSize(oss.limit)}`);
        }
        
        console.log('');
        console.log('─'.repeat(50));
        console.log(' Git记忆');
        console.log('─'.repeat(50));
        console.log(' 状态:      暂未实现');
        
        console.log('');
        console.log('─'.repeat(50));
        console.log(' Git存储');
        console.log('─'.repeat(50));
        console.log(' 状态:      暂未实现');
      }
      
      if (isAdmin && data.system) {
        console.log('');
        console.log('─'.repeat(50));
        console.log(' 系统状态 (管理员视图)');
        console.log('─'.repeat(50));
        
        const sys = data.system;
        console.log('');
        console.log(' [管理员数据库]');
        console.log(`   数据库名:   ${sys.database.admin.name}`);
        console.log(`   集合数:     ${sys.database.admin.collections}`);
        console.log(`   数据大小:   ${formatSize(sys.database.admin.dataSize)}`);
        
        console.log('');
        console.log(' [用户数据库]');
        console.log(`   数据库名:   ${sys.database.user.name}`);
        console.log(`   集合数:     ${sys.database.user.collections}`);
        console.log(`   数据大小:   ${formatSize(sys.database.user.dataSize)}`);
        
        if (data.doves) {
          console.log('');
          console.log('─'.repeat(50));
          console.log(' 鸽群状态');
          console.log('─'.repeat(50));
          console.log(` 在线实例: ${data.doves.count || 0}`);
        }
      }
      
      // 显示 API Key 状态
      console.log('');
      console.log('─'.repeat(50));
      console.log(' API Key 状态');
      console.log('─'.repeat(50));
      
      try {
        const keysResult = await client.get('/api/user/keys');
        const keysData = keysResult.data;

        // 显示官方 Key
        console.log('');
        console.log(' 官方 Key:');
        for (const [provider, cfg] of Object.entries(keysData.officialKeys || {})) {
          const status = cfg.configured ? '✓' : '✗';
          const enabled = cfg.enabled ? '' : ' (禁用)';
          console.log(`   ${status} ${provider.padEnd(10)} ${enabled}`);
        }

        // 显示用户 Key
        const userKeys = Object.entries(keysData.userKeys || {});
        if (userKeys.length > 0) {
          console.log('');
          console.log(' 用户 Key:');
          for (const [provider, cfg] of userKeys) {
            console.log(`   ✓ ${provider.padEnd(10)} (优先使用)`);
          }
        }
      } catch (e) {
        console.log('   (无法获取 Key 状态)');
      }
      
      console.log('');
      console.log('─'.repeat(50));
      console.log(` 诊断完成: ${data.timestamp}`);
      console.log('');
      
    } catch (err) {
      display.error(err.message);
      process.exit(1);
    }
  });

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}天 ${hours}小时 ${mins}分钟`;
  if (hours > 0) return `${hours}小时 ${mins}分钟`;
  return `${mins}分钟`;
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

export default testCommand;
