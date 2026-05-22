/**
 * 对话管理 - 对话列表、选择、UserQuestion处理及会话模式
 */

import { display } from '../../display.js';
import { DoveClient } from '../../client.js';
import { loadConfig as loadChatConfig } from '../../lib/config.js';
import { select, input, multiSelect } from '../../lib/interactive.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';
import { 对话日志 } from '../../lib/chat-logger.js';
import { formatRelativeTime } from './辅助函数.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function showConversationList(client) {
  const spinner = display.spinner('获取对话列表...').start();
  
  try {
    const conversations = await client.listConversations();
    spinner.stop();
    
    if (!conversations || conversations.length === 0) {
      display.info('暂无对话记录');
      return;
    }
    
    display.title('📋 对话列表');
    console.log('');
    
    conversations.forEach((conv, index) => {
      const title = conv.标题 || '无标题';
      const turnCount = (conv.对话轮次 || []).length;
      const convId = conv.对话ID || '?';
      
      // 创建时间
      const createdRelative = formatRelativeTime(conv.创建时间戳 || conv.createdAtTs || conv.createdAt);
      // 更新时间
      const updatedRelative = formatRelativeTime(conv.更新时间戳 || conv.updatedAtTs || conv.updatedAt);
      
      console.log(chalk.cyan(`  ${String(index + 1).padStart(2)}. `) +
                  chalk.white(title.slice(0, 40)) +
                  (title.length > 40 ? '...' : ''));
      console.log(chalk.gray(`       ID: ${convId}`));
      console.log(chalk.gray(`       轮次: ${turnCount}轮 | 创建: ${createdRelative} | 更新: ${updatedRelative}`));
      console.log('');
    });
    
    display.info(`共 ${conversations.length} 个对话`);
    
  } catch (err) {
    spinner.stop();
    display.error(`获取对话列表失败: ${err.message}`);
  }
}

// 选择对话
export async function selectConversation(client) {
  const spinner = display.spinner('获取对话列表...').start();
  
  try {
    const conversations = await client.listConversations();
    spinner.stop();
    
    if (!conversations || conversations.length === 0) {
      display.info('暂无对话记录，将开始新对话');
      return null;
    }
    
    const choices = conversations.map((conv, index) => {
      const title = conv.标题 || '无标题';
      const turnCount = (conv.对话轮次 || []).length;
      const convId = conv.对话ID || '?';
      
      // 创建时间和更新时间
      const createdRelative = formatRelativeTime(conv.创建时间戳 || conv.createdAtTs || conv.createdAt);
      const updatedRelative = formatRelativeTime(conv.更新时间戳 || conv.updatedAtTs || conv.updatedAt);
      
      // 如果更新时间和创建时间相同，只显示一个
      const timeInfo = createdRelative === updatedRelative 
        ? createdRelative 
        : `${updatedRelative}更新`;
      
      return {
        name: `${index + 1}. ${title.slice(0, 30)}${title.length > 30 ? '...' : ''} (${turnCount}轮, ${timeInfo})`,
        value: convId,
        short: title.slice(0, 20)
      };
    });
    
    // 添加"新对话"选项（序号0，排在最前）
    choices.unshift({
      name: '0. 🆕 开始新对话',
      value: '__new__',
      short: '新对话'
    });
    
    const selectedId = await select('选择对话', choices, '__new__');
    
    return selectedId === '__new__' ? null : selectedId;
    
  } catch (err) {
    spinner.stop();
    display.error(`获取对话列表失败: ${err.message}`);
    return null;
  }
}

// 处理用户问题（来自 interaction_ask 工具）

export async function handleUserQuestion(client, taskId, questionData, eventId = null) {
  const { id: questionId, question, type, options, defaultAnswer } = questionData;
  
  对话日志.用户回答(null, question, '(待回答)');
  
  // 提前输出问题内容（多行文本不能作为 inquirer 的 message）
  // 原因：inquirer screen-manager 用 eraseLines(height) 清除旧内容后重新渲染，
  // 当 message 含换行符时，首次渲染（含 "Use arrow keys" 提示）与后续渲染的行数不一致，
  // eraseLines 擦除行数偏差会暴露 inquirer 渲染区域之外的旧内容（TUI 残留等），
  // 表现为按上下键时选项上方突然冒出本不该显示的信息。
  // 解决：多行文本提前输出，inquirer message 只用单行短文本。
  // 注意：必须用 process.stdout.write 而非 console.log，因为 processQuestion
  // 会在调用此函数前拦截 console.log/error，避免日志干扰 inquirer 渲染。
  // inquirer 自身也使用 process.stdout.write（通过 readline），不受拦截影响。
  if (question && typeof question === 'string' && question.trim()) {
    process.stdout.write(question + '\n');
    process.stdout.write('\n');
  }
  
  let answer;
  
  // 自定义输入标记值
  const CUSTOM_INPUT = '__custom_input__';
  
  if (type === 'confirmation') {
    // 确认类型：箭头选择 是/否 + 自定义输入（安全优先）
    const defaultYes = defaultAnswer === 'yes' || defaultAnswer === 'true';
    const confirmVal = await select('请选择:', [
      { name: '\u2713 是', value: 'yes' },
      { name: '\u2717 否', value: 'no' },
      { name: '\u270f\ufe0f 自定义输入', value: CUSTOM_INPUT },
    ], defaultYes ? 'yes' : 'no');
    answer = confirmVal === CUSTOM_INPUT ? await input('请输入:', defaultAnswer) : confirmVal;
  
  } else if (type === 'single_choice' && options && options.length > 0) {
    // 单选类型 + 自定义输入
    const choiceOptions = options.map(opt => ({
      name: `${opt.label}${opt.description ? ` - ${opt.description}` : ''}`,
      value: opt.value,
    }));
    choiceOptions.push({ name: '\u270f\ufe0f 自定义输入', value: CUSTOM_INPUT });
    const selected = await select('请选择:', choiceOptions);
    answer = selected === CUSTOM_INPUT ? await input('请输入:', defaultAnswer) : selected;
  
  } else if (type === 'multi_choice' && options && options.length > 0) {
    // 多选类型 + 自定义输入
    const choiceOptions = options.map(opt => ({
      name: `${opt.label}${opt.description ? ` - ${opt.description}` : ''}`,
      value: opt.value,
    }));
    choiceOptions.push({ name: '\u270f\ufe0f 自定义输入', value: CUSTOM_INPUT });
    const selected = await multiSelect('请选择(空格勾选):', choiceOptions);
    if (selected.includes(CUSTOM_INPUT)) {
      answer = await input('请输入:', defaultAnswer);
    } else {
      answer = selected;
    }
  
  } else {
    // 默认：文本输入
    answer = await input('请回答:', defaultAnswer);
  }
  
  // 提交答案（双通道保障）
  try {
    if (eventId) {
      // 事件集合通道：直接提交
      await client.submitEventAnswer(eventId, answer);
    } else {
      // 流缓冲通道：同时尝试事件集合提交（双通道保障，哪个通走哪个）
      try {
        // 通过 questionId 查找匹配的事件并提交答案
        const eventAnswerResult = await client.submitEventAnswerByQuestionId(questionId, answer);
        if (eventAnswerResult?.success) {
          // 事件集合提交成功，无需再走流缓冲
        } else {
          // 事件集合提交失败，回退到流缓冲模式
          await client.submitAnswer(taskId, questionId, answer);
        }
      } catch (e) {
        // 事件集合提交失败，回退到流缓冲模式
        await client.submitAnswer(taskId, questionId, answer);
      }
    }
    // 提交成功仅记日志（不写终端，避免与 TUI 竞争 stdout）
    对话日志.用户回答(null, question, answer);
  } catch (err) {
    display.error(`提交答案失败: ${err.message}`);
  }
}

/**
 * 从 CLI 选项中提取执行配置参数
 * @param {Object} options - Commander 选项
 * @returns {Object} { profile, constraints }
 */

// ==================== 子命令: chat session (WebSocket 长连接) ====================

/**
 * Session 子命令 - WebSocket 长连接对话模式
 * 原独立命令 session 合并至此
 */
import WebSocket from 'ws';
import { loadConfig as loadConfigFromModule } from '../../lib/config.js';

export function loadSessionConfig() {
  return loadConfigFromModule();
}

export async function startSessionMode(wsUrl, config) {
  display.title('白鸽 CLI 长连接模式');
  console.log('');
  display.info(`连接到: ${wsUrl.replace(/\?token=.*/, '?token=***')}`);
  display.info(`用户: ${config.username || 'anonymous'}`);
  display.info('输入消息开始对话，Ctrl+C 退出');
  display.divider();
  
  let ws = null;
  let isConnected = false;
  let requestId = 0;
  let currentConversationId = null;
  
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  function connect() {
    ws = new WebSocket(wsUrl);
    
    ws.on('open', () => {
      isConnected = true;
      display.success('WebSocket 已连接');
    });
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'chat_response' || msg.type === 'stream') {
          process.stdout.write(msg.data?.content || msg.data?.text || '');
          if (msg.data?.done) console.log('');
        } else if (msg.type === 'error') {
          display.error(msg.data?.message || msg.message || '未知错误');
        }
      } catch (e) {
        // 非JSON消息直接输出
        console.log(data.toString());
      }
    });
    
    ws.on('close', () => {
      isConnected = false;
      display.warn('WebSocket 连接已断开');
    });
    
    ws.on('error', (err) => {
      display.error(`WebSocket 错误: ${err.message}`);
    });
  }
  
  connect();
  
  // 等待连接
  await new Promise(resolve => {
    const check = setInterval(() => {
      if (isConnected) { clearInterval(check); resolve(); }
    }, 100);
    setTimeout(() => { clearInterval(check); resolve(); }, 5000);
  });
  
  // 输入循环
  const askQuestion = () => new Promise(resolve => rl.question('\n你: ', resolve));
  
  while (true) {
    const input = await askQuestion();
    const trimmed = input.trim();
    if (!trimmed) continue;
    if (['exit', 'quit', ':q'].includes(trimmed)) break;
    
    if (ws && isConnected) {
      requestId++;
      ws.send(JSON.stringify({
        type: 'chat',
        requestId,
        conversationId: currentConversationId,
        message: trimmed
      }));
    } else {
      display.error('未连接，尝试重连...');
      connect();
    }
  }
  
  if (ws) ws.close();
  rl.close();
  console.log('');
  display.info('再见！');
}

export function setupChatSubCommands(chatCommand) {
  const sessionSubCommand = new Command('session')
    .description('WebSocket 长连接对话模式')
    .option('-g, --gateway <url>', '服务端地址', process.env.DOVE_SERVER || 'ws://localhost:3003')
    .action(async (options) => {
      const config = loadSessionConfig();
      const token = config.token || process.env.DOVE_TOKEN;

      if (!token) {
        display.error('未登录，请先运行: dove auth login');
        process.exit(1);
      }

      const wsUrl = options.gateway.replace(/^http/, 'ws') + '/ws?token=' + token;
      await startSessionMode(wsUrl, config);
    });

  chatCommand.addCommand(sessionSubCommand);

  const convSubCommand = new Command('conv')
    .description('对话管理 (list/show/delete)')
    .argument('[action]', '操作: list|show|delete', 'list')
    .argument('[id]', '对话ID')
    .option('-l, --limit <number>', '限制数量', '20')
    .option('--json', 'JSON格式输出')
    .action(async (action, id, options) => {
      const { ConversationClient } = await import('../../lib/conversation.js');
      const client = new ConversationClient();
      await client.connectEncrypted();

      try {
        switch (action) {
          case 'list':
          case 'ls': {
            const spinner = display.spinner('获取对话列表...').start();
            const conversations = await client.listConversations();
            spinner.stop();

            if (options.json) { console.log(JSON.stringify(conversations, null, 2)); return; }

            display.title('对话列表');
            if (!conversations || conversations.length === 0) {
              display.info('没有对话');
              return;
            }
            conversations.forEach(c => {
              const convId = c.对话ID || '?';
              const title = c.标题 || c.title || c.最新消息 || '(无标题)';
              const time = c.更新时间 || c.updatedAt || '';
              console.log(`  ${chalk.cyan(convId)}  ${title.slice(0, 40)}  ${time}`);
            });
            break;
          }
          case 'show':
          case 'info': {
            if (!id) { display.error('请指定对话ID'); return; }
            const spinner = display.spinner('获取对话详情...').start();
            const conv = await client.getConversation(id);
            spinner.stop();

            if (options.json) { console.log(JSON.stringify(conv, null, 2)); return; }
            console.log(JSON.stringify(conv, null, 2));
            break;
          }
          case 'delete':
          case 'rm': {
            if (!id) { display.error('请指定对话ID'); return; }
            const result = await client.deleteConversation(id);
            if (result.success) { display.success('对话已删除'); }
            else { display.error(result.error || '删除失败'); }
            break;
          }
          default:
            display.error(`未知操作: ${action}`);
            display.info('可用操作: list, show, delete');
        }
      } catch (err) {
        display.error(err.message);
        process.exit(1);
      }
    });

  chatCommand.addCommand(convSubCommand);
}
