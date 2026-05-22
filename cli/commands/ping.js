/**
 * Ping 命令 - 测试网关连通性
 */

import { Command } from 'commander';
import { display } from '../display.js';
import { DoveClient } from '../client.js';

export const pingCommand = new Command('ping')
  .description('测试网关连通性')
  .option('-c, --count <n>', '测试次数', '1')
  .action(async (options) => {
    const client = new DoveClient();
    const count = parseInt(options.count, 10);
    
    display.info(`测试网关: ${client.baseUrl}`);
    console.log('');
    
    let successCount = 0;
    let totalLatency = 0;
    
    for (let i = 0; i < count; i++) {
      const result = await client.ping();
      
      if (result.success && result.pong) {
        successCount++;
        totalLatency += result.latency;
        display.success(`Pong: ${result.latency}ms${count > 1 ? ` (seq=${i + 1})` : ''}`);
      } else {
        display.error(`失败: ${result.error || '未知错误'}${count > 1 ? ` (seq=${i + 1})` : ''}`);
      }
      
      // 多次测试时短暂间隔
      if (i < count - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    
    console.log('');
    if (successCount > 0) {
      display.info(`统计: ${successCount}/${count} 成功, 平均延迟 ${Math.round(totalLatency / successCount)}ms`);
    } else {
      display.error('所有测试失败，请检查网关服务是否启动');
      display.info('启动命令: npm run start:gateway 或 pm2 start 网关');
      process.exit(1);
    }
  });
