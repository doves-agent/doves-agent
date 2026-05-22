/**
 * 对话管理命令
 * 提供对话列表、查看、删除等功能
 */

import { Command } from 'commander';
import { display } from '../display.js';
import { ConversationClient } from '../lib/conversation.js';
import { loadConfig } from '../lib/config.js';
import { select } from '../lib/interactive.js';
import chalk from 'chalk';

const CONV_ACTION_CHOICES = [
  { name: 'list - 列出对话', value: 'list' },
  { name: 'show - 查看对话详情', value: 'show' },
];

export const convCommand = new Command('conv')
  .description('对话管理')
  .argument('[action]', '操作类型')
  .argument('[args...]', '操作参数')
  .option('-l, --limit <number>', '限制数量', '20')
  .option('--json', 'JSON格式输出')
  .option('-a, --all', '查看所有用户的对话（仅超级管理员可用）')
  .option('--uid <userId>', '查看指定用户的对话（仅超级管理员可用）')
  .action(async (action, args, options) => {
    const config = loadConfig();
    const client = new ConversationClient();
    const authed = await client.ensureAuth();
    if (!authed) {
      display.error('登录已过期，请重新执行 dove login');
      process.exit(1);
    }
    await client.connectEncrypted();

    // 超管 --all 权限检查
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
    
    try {
      // 无 action 时交互式选择
      if (!action) {
        action = await select('选择操作', CONV_ACTION_CHOICES, 'list');
      }
      
      switch (action) {
        case 'list':
        case 'ls':
          await listConversations(client, options);
          break;
        case 'info':
          await showConversation(client, args[0], options);
          break;
        default:
          display.error(`未知操作: ${action}`);
          showHelp();
      }
    } catch (err) {
      display.error(err.message);
      process.exit(1);
    }
  });

/**
 * 列出对话
 */
async function listConversations(client, options) {
  const spinner = display.spinner('获取对话列表...').start();
  const conversations = await client.listConversations();
  spinner.stop();
  
  if (options.json) {
    console.log(JSON.stringify(conversations, null, 2));
    return;
  }
  
  display.title('对话列表');
  
  if (!conversations || conversations.length === 0) {
    display.info('暂无对话');
    return;
  }
  
  const limit = parseInt(options.limit, 10) || 20;
  const items = conversations.slice(0, limit);
  
  items.forEach(conv => {
    const time = conv.更新时间 || conv.lastMessageAt || conv.createdAt || conv.创建时间;
    const timeStr = time ? new Date(typeof time === 'number' ? time : time).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }) : '-';
    
    const preview = conv.最新消息?.substring(0, 40) || conv.lastMessage?.substring(0, 40) || conv.标题?.substring(0, 40) || '无预览';
    // 使用 对话ID（服务端实际字段名），显示完整 ID 便于复制
    const convId = conv.对话ID || conv.conversationId || conv.id || conv._id?.toString() || '?';
    
    console.log(`  ${chalk.cyan(convId)}  ${timeStr}`);
    console.log(`    ${preview}${preview.length >= 40 ? '...' : ''}`);
    console.log();
  });
  
  if (conversations.length > limit) {
    display.info(`还有 ${conversations.length - limit} 条对话未显示，使用 --limit 查看更多`);
  }
}

/**
 * 显示对话详情
 */
async function showConversation(client, conversationId, options) {
  if (!conversationId) {
    display.error('请提供对话ID');
    display.info('用法: dove conv info <对话ID>');
    return;
  }
  
  const spinner = display.spinner('获取对话详情...').start();
  const conv = await client.getConversation(conversationId);
  spinner.stop();
  
  if (options.json) {
    console.log(JSON.stringify(conv, null, 2));
    return;
  }
  
  display.title('对话详情');
  const convId = conv.对话ID || conv.conversationId || conv.id || conv._id?.toString() || '?';
  console.log(`  ID: ${convId}`);
  console.log(`  标题: ${conv.标题 || '-'}`);
  console.log(`  创建: ${conv.创建时间 || conv.createdAt ? new Date(conv.创建时间戳 || conv.createdAt).toLocaleString('zh-CN') : '-'}`);
  console.log(`  更新: ${conv.更新时间 || conv.lastMessageAt ? new Date(conv.更新时间戳 || conv.lastMessageAt).toLocaleString('zh-CN') : '-'}`);
  console.log(`  消息数: ${conv.对话轮次?.length || 0}`);
  
  if (conv.对话轮次 && conv.对话轮次.length > 0) {
    console.log();
    display.title('对话轮次');
    
    conv.对话轮次.forEach((turn, i) => {
      const userMsg = turn.用户消息?.substring(0, 100) || '-';
      const summary = turn.分支摘要?.substring(0, 100) || '(处理中)';
      console.log(`  [${i + 1}] 用户: ${userMsg}${turn.用户消息?.length > 100 ? '...' : ''}`);
      console.log(`       回复: ${summary}${turn.分支摘要?.length > 100 ? '...' : ''}`);
    });
  }
}

function showHelp() {
  console.log('');
  display.title('对话管理命令');
  console.log('  list, ls    列出对话');
  console.log('  info, show  查看对话详情 <对话ID>');
  console.log('');
  display.title('选项');
  console.log('  --limit     限制显示数量 (默认: 20)');
  console.log('  --json      JSON格式输出');
  console.log('');
  display.title('示例');
  console.log('  dove conv list');
  console.log('  dove conv list --limit 50');
  console.log('  dove conv info conv_xxx');
}
