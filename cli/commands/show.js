/**
 * 显示命令
 * 用法: dove show
 * 显示所有可配置信息和已配置信息
 */

import { Command } from 'commander';
import { display } from '../display.js';
import { DoveClient } from '../client.js';
import { loadConfig } from './config.js';
import os from 'os';
import path from 'path';

export const showCommand = new Command('show')
  .description('显示当前配置和账号信息')
  .option('-j, --json', 'JSON 格式输出')
  .option('-s, --secret', '显示敏感信息（Token等）')
  .action(async (options) => {
    try {
      const config = loadConfig();
      const client = new DoveClient();
      
      console.log('');
      console.log('╔══════════════════════════════════════════════════════╗');
      console.log('║           白鸽配置信息                               ║');
      console.log('╚══════════════════════════════════════════════════════╝');
      
      if (options.json) {
        const output = {
          config: {
            gateway: config.gateway,
            timeout: config.timeout
          },
          account: {
            userId: config.userId,
            username: config.username,
            authType: config.authType,
            anonymous: config.anonymous,
            expiresAt: config.expiresAt
          }
        };
        if (options.secret) {
          output.account.token = config.token;
        }
        console.log(JSON.stringify(output, null, 2));
        return;
      }
      
      // 配置信息
      console.log('');
      console.log('─'.repeat(50));
      console.log(' 网络配置');
      console.log('─'.repeat(50));
      console.log(` 网关地址:   ${config.gateway || 'http://localhost:3003'}`);
      console.log(` 超时时间:   ${config.timeout || 30000}ms`);
      console.log(` 配置文件:   ${getConfigPath()}`);
      
      // 账号信息
      console.log('');
      console.log('─'.repeat(50));
      console.log(' 账号信息');
      console.log('─'.repeat(50));
      
      if (config.token) {
        console.log(` 登录状态:   ✓ 已登录`);
        console.log(` 用户ID:     ${config.userId || '未知'}`);
        console.log(` 用户名:     ${config.username || 'anonymous'}`);
        console.log(` 认证类型:   ${config.authType === 'permanent' ? '长期认证 (7天)' : '临时认证 (24h)'}`);
        console.log(` 匿名用户:   ${config.anonymous ? '是' : '否'}`);
        
        if (options.secret) {
          console.log(` Token:      ${config.token}`);
        } else {
          console.log(` Token:      ${config.token.substring(0, 20)}...`);
        }
        
        // 验证 Token 有效性
        console.log('');
        console.log(' 验证 Token...');
        try {
          const result = await client.verifyToken();
          if (result.valid) {
            console.log(` Token 状态: ✓ 有效`);
            console.log(` 过期时间:   ${result.expiresAt}`);
          } else {
            console.log(` Token 状态: ✗ 无效或已过期`);
          }
        } catch (e) {
          console.log(` Token 状态: ✗ 验证失败 (${e.message})`);
        }
      } else {
        console.log(' 登录状态:   ✗ 未登录');
        console.log('');
        display.info('使用以下命令登录:');
        console.log('  dove login -a      # 匿名登录');
        console.log('  dove login         # 账号登录');
        console.log('  dove login -r      # 注册新账号');
      }
      
      // 可用命令
      console.log('');
      console.log('─'.repeat(50));
      console.log(' 可用命令');
      console.log('─'.repeat(50));
      console.log(' dove config gateway <url>  设置网关地址');
      console.log(' dove config set <k> <v>    设置配置项');
      console.log(' dove login                  登录账号');
      console.log(' dove logout                 登出账号');
      console.log(' dove test                   系统诊断');
      console.log(' dove info                   查看可用资源');
      console.log('');
      
    } catch (err) {
      display.error(err.message);
      process.exit(1);
    }
  });

function getConfigPath() {
  return path.join(os.homedir(), '.dove', 'config.json');
}

export default showCommand;
