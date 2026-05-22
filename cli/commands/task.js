/**
 * 任务命令
 * 用法: dove task <action> [options]
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { display } from '../display.js';
import { DoveClient, AdminClient } from '../client.js';
import { loadConfig } from '../lib/config.js';
import { select, multiSelect, input, confirm, ABILITY_CHOICES } from '../lib/interactive.js';

const TASK_ACTION_CHOICES = [
  { name: 'list     - 列出任务', value: 'list' },
  { name: 'create   - 创建任务', value: 'create' },
  { name: 'publish  - 发布任务（支持分发参数）', value: 'publish' },
  { name: 'status   - 查看任务状态', value: 'status' },
  { name: 'result   - 查看任务结果', value: 'result' },
  { name: 'watch    - 实时监控任务（支持用户确认）', value: 'watch' },
  { name: 'monitor  - 监控所有活跃任务', value: 'monitor' },
  { name: 'cancel   - 取消任务', value: 'cancel' },
  { name: 'trace    - 查看执行轨迹', value: 'trace' },
];

const TASK_TYPE_CHOICES = [
  { name: 'general - 通用任务', value: 'general' },
  { name: 'skill_model_organize - 模型整理', value: 'skill_model_organize' },
];

export const taskCommand = new Command('task')
  .description('任务管理')
  .argument('[action]', '操作: list|create|publish|status|result|watch|monitor|cancel|trace')
  .argument('[id]', '任务ID')
  .option('-d, --description <desc>', '任务描述')
  .option('-t, --type <type>', '任务类型')
  .option('--reward <n>', '饲料奖励', parseInt)
  .option('--timeout <ms>', '超时时间(毫秒)', parseInt)
  .option('--capabilities <caps>', '能力要求(逗号分隔)')
  .option('--min-reputation <n>', '最低信誉要求', parseInt)
  .option('--json', '以JSON格式输出轨迹')
  .option('--detail', '显示完整输入输出(不截断)')
  .option('-a, --all', '查看所有用户的任务（仅超级管理员可用）')
  .option('--uid <userId>', '查看指定用户的任务（仅超级管理员可用）')
  .action(async (action, id, options) => {
    const config = loadConfig();
    const client = config.role === 'admin' ? new AdminClient() : new DoveClient();
    const authed = await client.ensureAuth();
    if (!authed) {
      display.error('登录已过期，请重新执行 dove login');
      process.exit(1);
    }
    
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
      // 无 action 时进入交互式选择
      if (!action) {
        action = await select('选择操作', TASK_ACTION_CHOICES);
      }
      
      switch (action) {
        case 'list':
          await listTasks(client);
          break;
        case 'create':
          await createTask(client, options.description);
          break;
        case 'publish':
          await publishTask(client, options);
          break;
        case 'status':
          await taskStatus(client, id);
          break;
        case 'result':
          await taskResult(client, id);
          break;
        case 'watch':
          await watchTask(client, id);
          break;
        case 'monitor':
          await monitorTasks(client);
          break;
        case 'cancel':
          await cancelTask(client, id);
          break;
        case 'trace':
          await traceTask(client, id, options);
          break;
        default:
          display.error(`未知操作: ${action}`);
          display.info('可用操作: list, create, publish, status, result, watch, monitor, cancel, trace');
      }
    } catch (err) {
      display.error(err.message);
      process.exit(1);
    }
  });

// 列出任务
async function listTasks(client) {
  const spinner = display.spinner('获取任务列表...').start();
  const tasks = await client.listTasks();
  spinner.stop();
  
  display.title('任务列表');
  display.taskList(tasks);
}

// 创建任务
async function createTask(client, description) {
  if (!description) {
    description = await input('输入任务描述');
  }
  if (!description) {
    display.error('任务描述不能为空');
    return;
  }
  
  const spinner = display.spinner('创建任务...').start();
  const result = await client.createTask(description);
  spinner.stop();
  
  display.success(`任务已创建: ${result.id}`);
}

// 发布任务（支持执行参数）
async function publishTask(client, options) {
  let description = options.description;
  if (!description) {
    description = await input('输入任务描述');
  }
  if (!description) {
    display.error('任务描述不能为空');
    return;
  }
  
  // 交互式选择任务类型
  let taskType = options.type;
  if (!taskType) {
    taskType = await select('选择任务类型', TASK_TYPE_CHOICES, 'general');
  }
  
  // 交互式多选能力要求
  let capabilities = options.capabilities ? options.capabilities.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (!options.capabilities) {
    const selected = await multiSelect('选择能力要求（空格勾选，回车确认）', ABILITY_CHOICES);
    capabilities = selected;
  }
  
  const taskConfig = {
    描述: description,
    类型: taskType,
    饲料奖励: options.reward || 1,
    超时时间: options.timeout || 300000,
    信誉要求: options.minReputation || 0,
    requiredCapabilities: capabilities
  };
  
  display.info('发布任务配置:');
  console.log(JSON.stringify(taskConfig, null, 2));
  
  const spinner = display.spinner('发布任务...').start();
  const result = await client.publishTask(taskConfig);
  spinner.stop();
  
  display.success(`任务已发布: ${result.id}`);
  display.info(`饲料奖励: ${taskConfig.饲料奖励}`);
}

// 查看任务状态
async function taskStatus(client, taskId) {
  if (!taskId) {
    display.error('请提供任务ID');
    return;
  }
  
  const spinner = display.spinner('获取任务状态...').start();
  const task = await client.getTask(taskId);
  spinner.stop();
  
  display.title(`任务状态: ${taskId}`);
  
  // 基本信息
  console.log(`描述: ${task.description || '无'}`);
  console.log(`状态: ${task.status}`);
  console.log(`类型: ${task.type || 'general'}`);
  
  // 执行信息
  console.log('\n执行信息:');
  console.log(`  饲料奖励: ${task.饲料奖励 || 1}`);
  
  // 执行者信息
  if (task.执行者) {
    console.log(`  执行者: ${task.执行者}`);
  }
  
  // 结果
  if (task.结果) {
    console.log('\n结果:');
    console.log(JSON.stringify(task.结果, null, 2).slice(0, 500));
  }
}

// 查看任务结果
async function taskResult(client, taskId) {
  if (!taskId) {
    display.error('请提供任务ID');
    return;
  }
  
  const spinner = display.spinner('获取任务结果...').start();
  const result = await client.getTaskResult(taskId);
  spinner.stop();
  
  display.title(`任务结果: ${taskId}`);
  console.log(`状态: ${result.status}`);
  
  if (result.result) {
    console.log('\n结果数据:');
    console.log(JSON.stringify(result.result, null, 2));
  }
  
  if (result.claimers && result.claimers.length > 0) {
    console.log('\n执行者:');
    for (const claimer of result.claimers) {
      console.log(`  - ${claimer.鸽子ID}: ${claimer.状态}`);
    }
  }
}

// 监控任务（增强版：实时状态 + 用户确认）
async function watchTask(client, taskId) {
  if (!taskId) {
    display.error('请提供任务ID');
    display.info('用法: dove task watch <taskId>');
    return;
  }
  
  display.title(`监控任务: ${taskId}`);
  
  // 启动事件流监听（处理鸽子提问）
  const eventAbortController = new AbortController();
  const processedEvents = new Set();
  let questionActive = false;
  
  // 异步监听用户事件
  (async () => {
    try {
      await client.watchUserEvents(async (event) => {
        if (questionActive) return; // 避免并发处理
        
        // 事件去重
        const eventId = event.事件ID || event.id;
        if (eventId && processedEvents.has(eventId)) return;
        if (eventId) processedEvents.add(eventId);
        
        // 处理用户交互事件
        if (event.问题) {
          questionActive = true;
          console.log('');
          console.log(chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
          console.log(chalk.bold.yellow('❓ 鸽子提问: '));
          console.log(chalk.white(event.问题));
          console.log(chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
          
          // 交互式回答
          const answer = await input('你的回答', event.默认答案 || event.defaultAnswer || '');
          
          try {
            await client.submitEventAnswer(event.事件ID || event.id, answer);
            display.success('答案已提交');
          } catch (e) {
            display.error(`提交答案失败: ${e.message}`);
          }
          questionActive = false;
        }
      }, eventAbortController.signal);
    } catch (err) {
      // 事件流被取消或出错 - 不影响主流程
    }
  })();
  
  // SSE 任务监听
  try {
    await client.watchTask(taskId, (update) => {
      const status = update.status || '未知';
      const phase = update.phase || '';
      const time = new Date().toLocaleTimeString('zh-CN');
      
      // 显示状态更新
      console.log(
        `[${time}] ${display.taskStatus(status)} ${phase ? `(${phase})` : ''}`
      );
      
      // 子任务状态变化
      if (update.childrenStatus) {
        const { total = 0, completed = 0, failed = 0 } = update.childrenStatus;
        const running = total - completed - failed;
        if (total > 0) {
          console.log(`  子任务: ${completed}/${total} 完成, ${running} 运行中, ${failed} 失败`);
        }
      }
      
      // 任务完成
      if (status === '已完成' || status === '已完成(部分失败)') {
        eventAbortController.abort();
        if (status === '已完成(部分失败)') {
          display.warn('任务完成（部分子任务失败）');
        } else {
          display.success('任务完成');
        }
        display.divider();
        if (update.result) {
          const resultText = typeof update.result === 'string' 
            ? update.result 
            : (update.result.回复 || update.result.content || JSON.stringify(update.result).slice(0, 500));
          console.log(resultText);
        }
      } else if (status === '失败') {
        eventAbortController.abort();
        display.error(`任务失败: ${update.error || '未知错误'}`);
      } else if (status === '已终止') {
        eventAbortController.abort();
        display.error('任务已终止');
      }
    });
  } catch (err) {
    eventAbortController.abort();
    if (err.name !== 'AbortError') {
      display.error(`监听失败: ${err.message}`);
    }
  }
}

// 监控所有活跃任务
async function monitorTasks(client) {
  display.title('活跃任务监控');
  display.info('按 Ctrl+C 退出监控');
  display.divider();
  
  // 获取活跃任务
  const spinner = display.spinner('获取任务列表...').start();
  const tasks = await client.listTasks();
  spinner.stop();
  
  // 筛选活跃任务
  const activeStatuses = ['等待中', '执行中', '等待子任务'];
  const activeTasks = (tasks || []).filter(t => 
    activeStatuses.includes(t.status)
  );
  
  if (activeTasks.length === 0) {
    display.info('当前没有活跃任务');
    display.info('发送消息创建任务: dove chat "你好"');
    return;
  }
  
  console.log(`找到 ${activeTasks.length} 个活跃任务:\n`);
  
  // 显示活跃任务列表
  for (const task of activeTasks) {
    const taskId = (task.id || '').toString();
    const status = task.status;
    const desc = task.description || '无描述';
    const type = task.type || '-';
    const childrenStatus = task.childrenStatus || {};
    
    console.log(`  ${display.taskStatus(status)}  ${chalk.gray(taskId.slice(0, 12))}  ${desc.slice(0, 40)}`);
    console.log(`    类型: ${type}  创建: ${display.time(task.createdAt)}`);
    
    if (childrenStatus.total > 0) {
      const { total, completed = 0, failed = 0 } = childrenStatus;
      const running = total - completed - failed;
      console.log(`    子任务: ${completed}/${total} 完成, ${running} 运行中, ${failed} 失败`);
    }
    console.log();
  }
  
  display.divider();
  
  // 询问是否监控某个任务
  const taskChoices = activeTasks.map(t => ({
    name: `${(t.id || '').toString().slice(0, 12)}  ${display.taskStatus(t.status)}  ${(t.description || '').slice(0, 30)}`,
    value: (t.id || '').toString(),
  }));
  taskChoices.push({ name: '不监控，仅查看', value: '__none__' });
  
  const selectedTaskId = await select('选择要实时监控的任务', taskChoices, '__none__');
  
  if (selectedTaskId !== '__none__') {
    console.log('');
    await watchTask(client, selectedTaskId);
  }
}

// 取消任务
async function cancelTask(client, taskId) {
  if (!taskId) {
    display.error('请提供任务ID');
    return;
  }
  
  await client.cancelTask(taskId);
  display.success(`任务已取消: ${taskId}`);
}

// 查看任务执行轨迹
async function traceTask(client, taskId, options = {}) {
  if (!taskId) {
    display.error('请提供任务ID');
    return;
  }
  
  const spinner = display.spinner('获取任务执行轨迹...').start();
  let traceData;
  try {
    traceData = await client.getTaskTrace(taskId);
  } catch (err) {
    spinner.stop();
    display.error(err.message);
    return;
  }
  spinner.stop();
  
  // JSON 格式输出
  if (options.json) {
    console.log(JSON.stringify(traceData, null, 2));
    return;
  }
  
  // 树形显示
  const { 任务信息, 轨迹树, 统计 } = traceData;
  
  console.log('');
  display.title(`执行轨迹: ${taskId}`);
  
  // 任务基本信息
  if (任务信息) {
    const 状态图标 = 任务信息.状态 === '已完成' ? '✅' : 任务信息.状态 === '已完成(部分失败)' ? '⚠️' : 任务信息.状态 === '失败' ? '❌' : '🔄';
    console.log(`任务: ${状态图标} ${任务信息.状态 || '未知'}`);
    if (任务信息.routing) {
      console.log(`策略: ${任务信息.routing.策略 || '未知'} | 执行模式: ${任务信息.routing.执行模式 || '未知'}`);
    }
  }
  
  console.log('');
  console.log('执行轨迹:');
  
  // 递归打印树
  function printTree(nodes, prefix = '') {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const isLast = i === nodes.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';
      
      // 状态图标
      const statusIcon = node.状态 === '已完成' ? '✅' 
        : node.状态 === '已完成(部分失败)' ? '⚠️'
        : node.状态 === '失败' ? '❌' 
        : node.状态 === '执行中' ? '🔄' 
        : '⏳';
      
      // 耗时
      const duration = node.耗时 != null ? ` ${formatDuration(node.耗时)}` : '';
      
      // 类型标签
      const typeLabel = `[${node.类型}]`;
      
      // 名称
      let label = node.名称 || node.类型;
      
      // 详细模式显示输入输出
      let detail = '';
      if (options.detail) {
        if (node.输入) detail += ` 输入: ${JSON.stringify(node.输入).slice(0, 100)}`;
        if (node.输出) detail += ` 输出: ${JSON.stringify(node.输出).slice(0, 100)}`;
        if (node.错误) detail += ` 错误: ${node.错误}`;
      }
      
      console.log(`${prefix}${connector}${statusIcon} ${typeLabel} ${label}${duration}${detail}`);
      
      // 递归打印子节点
      if (node.子节点 && node.子节点.length > 0) {
        printTree(node.子节点, prefix + childPrefix);
      }
    }
  }
  
  if (轨迹树 && 轨迹树.length > 0) {
    printTree(轨迹树);
  } else {
    console.log('  (无轨迹记录)');
  }
  
  // 统计
  if (统计) {
    console.log('');
    const totalTime = 统计.总耗时 ? formatDuration(统计.总耗时) : '-';
    console.log(`统计: ${totalTime} | 工具: ${统计.工具调用数} | LLM: - | 子任务: ${统计.子任务成功}/${统计.子任务数} | 技能: ${统计.技能触发数} | 事件: ${统计.事件触发数}`);
  }
}

/** 格式化耗时 */
function formatDuration(ms) {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
