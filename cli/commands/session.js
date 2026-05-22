/**
 * CLI 长连接模式
 * 通过 WebSocket 与网关保持长连接
 * 支持：流式对话、多轮对话、任务推送、统一 API 调用
 */

import { Command } from 'commander';
import WebSocket from 'ws';
import readline from 'readline';
import { display } from '../display.js';
import { loadConfig as loadConfigFromModule } from '../lib/config.js';

/**
 * 加载配置（使用统一配置模块）
 */
function loadConfig() {
  return loadConfigFromModule();
}

/**
 * Session 命令
 */
export const sessionCommand = new Command('session')
  .description('进入长连接模式，持续与网关沟通')
  .option('-g, --gateway <url>', '服务端地址', process.env.DOVE_SERVER || 'ws://localhost:3003')
  .action(async (options) => {
    const config = loadConfig();
    const token = config.token || process.env.DOVE_TOKEN;
    
    if (!token) {
      display.error('未登录，请先运行: dove login');
      process.exit(1);
    }
    
    const wsUrl = options.gateway.replace(/^http/, 'ws') + '/ws?token=' + token;
    
    await startSession(wsUrl, config);
  });

/**
 * 启动 Session 模式
 */
async function startSession(wsUrl, config) {
  display.title('🕊️  白鸽 CLI 长连接模式');
  console.log('');
  display.info(`连接到: ${wsUrl.replace(/\?token=.*/, '?token=***')}`);
  display.info(`用户: ${config.username || 'anonymous'}`);
  display.info('输入消息开始对话，Ctrl+C 退出');
  console.log('');
  display.divider();
  
  // WebSocket 连接
  let ws = null;
  let isConnected = false;
  let requestId = 0;
  const pendingRequests = new Map(); // requestId -> { resolve, reject }
  let currentConversationId = null;
  
  // 创建 readline 接口
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n>>> '
  });
  
  // 连接 WebSocket
  function connect() {
    return new Promise((resolve, reject) => {
      try {
        ws = new WebSocket(wsUrl);
        
        ws.on('open', () => {
          isConnected = true;
          display.success('已连接到服务端');
          rl.prompt();
          resolve();
        });
        
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            handleMessage(message);
          } catch (e) {
            display.error('消息解析失败: ' + e.message);
          }
        });
        
        ws.on('close', () => {
          isConnected = false;
          display.warn('连接已断开');
        });
        
        ws.on('error', (err) => {
          display.error('连接错误: ' + err.message);
          reject(err);
        });
        
      } catch (e) {
        reject(e);
      }
    });
  }
  
  // 处理收到的消息
  function handleMessage(message) {
    switch (message.type) {
      case 'connected':
        // 连接确认
        display.info(`会话ID: ${message.clientId}`);
        break;
        
      case 'response':
        // API 响应
        const pending = pendingRequests.get(message.requestId);
        if (pending) {
          pendingRequests.delete(message.requestId);
          if (message.success) {
            pending.resolve(message.data);
          } else {
            pending.reject(new Error(message.error));
          }
        }
        break;
        
      case 'task_update':
        // 任务状态推送
        displayTaskUpdate(message);
        break;
        
      case 'stream':
        // 流式数据
        displayStreamData(message);
        break;
        
      case 'pong':
        // 心跳响应
        break;
        
      case 'error':
        display.error('服务器错误: ' + message.error);
        break;
        
      default:
        // 其他消息类型
        console.log('[推送]', message.type, JSON.stringify(message.data || {}).slice(0, 100));
    }
  }
  
  // 显示任务更新
  function displayTaskUpdate(message) {
    const { taskId, data } = message;
    const status = data?.status || '未知';
    const phase = data?.phase || '';
    
    // 使用不同颜色显示状态
    const statusColors = {
      pending: '⏳',
      running: '🔄',
      completed: '✅',
      failed: '❌',
      cancelled: '🚫',
      waiting_children: '⏸️'
    };
    
    const icon = statusColors[status] || '❓';
    console.log(`\n${icon} [任务] ${taskId.slice(0, 12)}... ${status}${phase ? ` (${phase})` : ''}`);
    
    // 如果任务完成，显示结果
    if ((status === '已完成' || status === '已完成(部分失败)') && data?.result) {
      const result = data.result;
      if (status === '已完成(部分失败)') {
        console.log('\n⚠️ 任务完成（部分子任务失败）');
      }
      if (result.response || result.content) {
        console.log('\n' + (result.response || result.content));
      }
    }
    
    // 如果任务失败，显示错误
    if (status === '失败' && data?.error) {
      display.error('任务失败: ' + data.error);
    }
    
    rl.prompt();
  }
  
  // 显示流式数据
  function displayStreamData(message) {
    const { content, done } = message;
    if (content) {
      process.stdout.write(content);
    }
    if (done) {
      console.log(''); // 换行
      rl.prompt();
    }
  }
  
  // 发送 API 请求
  async function sendRequest(method, path, body = {}) {
    return new Promise((resolve, reject) => {
      if (!isConnected) {
        reject(new Error('未连接'));
        return;
      }
      
      const reqId = 'req_' + (++requestId);
      pendingRequests.set(reqId, { resolve, reject });
      
      ws.send(JSON.stringify({
        type: 'request',
        requestId: reqId,
        method,
        path,
        body
      }));
      
      // 超时处理
      setTimeout(() => {
        if (pendingRequests.has(reqId)) {
          pendingRequests.delete(reqId);
          reject(new Error('请求超时'));
        }
      }, 60000);
    });
  }
  
  // 发送消息（对话）
  async function sendMessage(text) {
    try {
      const result = await sendRequest('POST', '/api/chat', {
        message: text,
        conversationId: currentConversationId,
        channel: 'local'
      });
      
      if (result.conversationId) {
        currentConversationId = result.conversationId;
      }
      
      display.info(`任务已创建: ${result.taskId}`);
      display.info('等待鸽子处理...');
      
    } catch (e) {
      display.error('发送失败: ' + e.message);
      rl.prompt();
    }
  }
  
  // 处理命令
  async function handleCommand(input) {
    const parts = input.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    
    switch (cmd) {
      case '/help':
        console.log(`
可用命令:
  直接输入文字     与 AI 对话
  /task [id]      查看任务状态
  /tasks          查看任务列表
  /conv [id]      查看对话 / 切换对话
  /new            开始新对话
  /status         查看连接状态
  /clear          清屏
  /help           显示帮助
  Ctrl+C          退出
`);
        break;
        
      case '/task':
        if (args[0]) {
          try {
            const task = await sendRequest('GET', `/api/task/${args[0]}`);
            console.log('\n任务详情:');
            console.log(`  ID: ${task.id}`);
            console.log(`  状态: ${task.status}`);
            console.log(`  阶段: ${task.phase || '-'}`);
            console.log(`  描述: ${task.description}`);
            if (task.result) {
              console.log(`  结果: ${JSON.stringify(task.result).slice(0, 200)}...`);
            }
            if (task.error) {
              console.log(`  错误: ${task.error}`);
            }
          } catch (e) {
            display.error('获取任务失败: ' + e.message);
          }
        } else {
          display.error('请提供任务ID');
        }
        break;
        
      case '/tasks':
        try {
          const tasks = await sendRequest('GET', '/api/task/list');
          console.log('\n任务列表:');
          tasks.slice(0, 10).forEach((task, i) => {
            const status = task.status.padEnd(10);
            const desc = task.description?.slice(0, 40) || '-';
            console.log(`  ${i + 1}. [${status}] ${desc}`);
          });
          if (tasks.length > 10) {
            console.log(`  ... 共 ${tasks.length} 个任务`);
          }
        } catch (e) {
          display.error('获取任务列表失败: ' + e.message);
        }
        break;
        
      case '/conv':
        if (args[0]) {
          try {
            const conv = await sendRequest('GET', `/api/conversations/${args[0]}`);
            currentConversationId = conv.id;
            display.success(`已切换到对话: ${conv.title || conv.id}`);
            console.log(`消息数: ${conv.对话轮次?.length || 0}`);
          } catch (e) {
            display.error('获取对话失败: ' + e.message);
          }
        } else {
          try {
            const convs = await sendRequest('GET', '/api/conversations');
            console.log('\n对话列表:');
            convs.slice(0, 10).forEach((conv, i) => {
              const title = conv.title?.slice(0, 40) || conv.id;
              console.log(`  ${i + 1}. ${title}`);
            });
          } catch (e) {
            display.error('获取对话列表失败: ' + e.message);
          }
        }
        break;
        
      case '/new':
        currentConversationId = null;
        display.success('已开始新对话');
        break;
        
      case '/status':
        console.log('\n连接状态:');
        console.log(`  已连接: ${isConnected ? '是' : '否'}`);
        console.log(`  用户: ${config.username || 'anonymous'}`);
        console.log(`  当前对话: ${currentConversationId || '无'}`);
        console.log(`  待处理请求: ${pendingRequests.size}`);
        break;
        
      case '/clear':
        console.clear();
        display.title('🕊️  白鸽 CLI 长连接模式');
        break;
        
      default:
        display.warn('未知命令，输入 /help 查看帮助');
    }
    
    rl.prompt();
  }
  
  // 处理用户输入
  rl.on('line', async (input) => {
    const trimmed = input.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }
    
    if (trimmed.startsWith('/')) {
      await handleCommand(trimmed);
    } else {
      await sendMessage(trimmed);
    }
  });
  
  // Ctrl+C 退出
  rl.on('close', () => {
    console.log('\n');
    display.info('正在断开连接...');
    if (ws) {
      ws.close();
    }
    display.success('已退出长连接模式');
    process.exit(0);
  });
  
  // 处理 SIGINT (Ctrl+C)
  process.on('SIGINT', () => {
    rl.close();
  });
  
  // 连接并开始
  try {
    await connect();
  } catch (e) {
    display.error('连接失败: ' + e.message);
    process.exit(1);
  }
}
