/**
 * 对话命令
 * 用法: dove chat [message]
 * 
 * 双通道: CLI -> [直连] 鸽子 或 CLI -> Server -> 鸽子
 * 直连优先，Server 中转为备用通道
 */

import { Command } from 'commander';
import { display } from '../display.js';
import { DoveClient } from '../client.js';
import { loadConfig as loadChatConfig } from '../lib/config.js';
import { select, multiSelect, input, EXECUTION_MODE_CHOICES, TOOL_LEVEL_CHOICES, ABILITY_CHOICES } from '../lib/interactive.js';

import { interactiveChat } from './chat/交互式聊天.js';
import { sendMessage } from './chat/聊天消息发送.js';
import { showConversationList, selectConversation, loadSessionConfig, startSessionMode, setupChatSubCommands } from './chat/对话管理.js';
import { getWeChatChannel, _检查语义事件 } from './chat/辅助函数.js';

export const chatCommand = new Command('chat')
  .description('开始对话')
  .argument('[message]', '消息内容')
  .option('-c, --conversation <id>', '对话ID')
  .option('-l, --list', '显示对话列表')
  .option('--select', '从列表中选择对话继续')
  .option('-m, --model <model>', '指定模型')
  .option('-s, --stream', '流式输出', true)
  // 执行配置选项
  .option('-p, --profile <name>', '加载执行配置 (如 crawler-10, no-split)')
  .option('--no-split', '禁止任务拆分')
  .option('--no-parallel', '禁止并行执行')
  .option('--no-flash', '禁止Flash快速回复')
  .option('--max-concurrency <n>', '最大并发数', parseInt)
  .option('--max-depth <n>', '最大拆分深度', parseInt)
  .option('--execution-mode <mode>', '执行模式 (decomposition_first|interleaved|pipeline|direct)')
  .option('--plan-first', '建议规划后再执行')
  .option('--tool-level <level>', '工具安全级别 (safe|caution|dangerous)')
  .option('--enable-ability <abilities>', '启用能力 (逗号分隔)')
  .option('--disable-ability <abilities>', '禁用能力 (逗号分隔)')
  .option('--disable-tool <tools>', '禁用工具 (逗号分隔)', (v) => v)
  .option('--gateway <url>', '指定网关地址（调试扇出模式，可多次指定）')
  .option('--async', '异步模式 (不等待任务完成)')
  .option('--ws', '使用 WebSocket 长连接模式')
  .option('--direct', '强制直连鸽子模式（失败则报错，不降级）')
  .option('--no-direct', '禁用直连，强制走 Server 中转')
  .option('--debug', '调试模式（不清屏、保留所有输出、强制写日志）')
  .action(async (message, cmd) => {
    // Commander 11+: action 回调的最后一个参数就是 options 对象，无需 .opts()
    const options = typeof cmd.opts === 'function' ? cmd.opts() : cmd;

    // debug 模式：尽早设置环境变量，确保所有子模块生效
    if (options.debug || process.env.DOVE_DEBUG) {
      process.env.DOVE_DEBUG = '1';
      process.env.DEBUG_CHAT = '1';
    }

    try {
      // WebSocket 长连接模式
      if (options.ws) {
        const config = loadSessionConfig();
        const token = config.token || process.env.DOVE_TOKEN;
        if (!token) {
          display.error('未登录，请先运行: dove auth login');
          return;
        }
        const wsUrl = (process.env.DOVE_SERVER || 'ws://localhost:3003').replace(/^http/, 'ws') + '/ws?token=' + token;
        await startSessionMode(wsUrl, config);
        return;
      }

      // 显示对话列表
      if (options.list) {
        const client = new DoveClient();
        await client.connectEncrypted();
        await showConversationList(client);
        return;
      }

      // 选择对话继续
      if (options.select) {
        const client = new DoveClient();
        await client.connectEncrypted();
        const conversationId = await selectConversation(client);
        if (conversationId) {
          await interactiveChat(client, conversationId, options);
        }
        return;
      }

      // 创建客户端
      const client = new DoveClient();

      // 建立加密通道（所有 API 请求的前置条件）
      await client.connectEncrypted();

      // 直连模式提示
      if (options.direct) {
        display.info('直连模式: 尝试直接连接鸽子...');
        try {
          const direct = await client._getDirectConnection();
          if (direct) {
            const dove = direct.getConnectedDove();
            display.success(`直连成功: 鸽子 ${dove?.doveId || dove?.鸽子ID || '未知'}`);
          } else {
            display.warn('直连失败: 没有可直连的鸽子');
            return;
          }
        } catch (e) {
          display.error(`直连失败: ${e.message}`);
          return;
        }
      } else if (options.direct === false) {
        // --no-direct 明确禁用直连
        if (process.env.DEBUG_CHAT) {
          display.info('已禁用直连，使用 Server 中转模式');
        }
      } else {
        // 默认：尝试直连，失败则打印错误后走 Server 中转
        try {
          const direct = await client._getDirectConnection();
          if (direct) {
            const dove = direct.getConnectedDove();
            display.success(`直连已建立: 鸽子 ${dove?.doveId || dove?.鸽子ID || '未知'}`);
          }
        } catch (e) {
          display.error(`直连失败: ${e.message}`);
          display.info('已切换到 Server 中转模式');
        }
      }

      // 如果有消息，直接发送
      if (message) {
        // 检查语义事件
        const eventResult = await _检查语义事件(client, message);
        if (eventResult) {
          display.info('已触发事件，进入对话模式...');
          await interactiveChat(client, options.conversation || null, options);
          return;
        }

        if (options.conversation) {
          await sendMessage(client, options.conversation, message, options, null, true);
        } else {
          // 创建新对话并发送（非交互模式下的消息发送）
          const convId = await sendMessage(client, null, message, options, null, true);
          if (options.async) {
            display.success(`任务已提交 (对话ID: ${convId})`);
            process.exit(0);
          }
        }
        return;
      }

      // 没有消息，检查是否指定了对话ID
      let conversationId = options.conversation || null;

      // 有对话ID且未指定扇出网关，进入交互模式
      if (conversationId && !options.gateway) {
        await interactiveChat(client, conversationId, options);
        return;
      }

      // 交互式对话
      if (options.gateway) {
        // 扇出模式（--gateway 明确指定）
        const gateways = Array.isArray(options.gateway) ? options.gateway : [options.gateway];
        display.info(`扇出模式: ${gateways.length} 个网关`);
      }
      // 统一进入交互式（扇出/容灾/单网关模式由 sendMessage 内部判断）
      await interactiveChat(client, conversationId, options);
    } catch (err) {
      display.error(err.message);
      process.exit(1);
    }
  });

// 注册子命令 (来自对话管理模块)
setupChatSubCommands(chatCommand);

export default chatCommand;
