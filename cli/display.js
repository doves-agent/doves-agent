/**
 * 终端显示工具
 * 职责：格式化输出、进度显示、彩色日志
 */

import chalk from 'chalk';
import ora from 'ora';

export const display = {
  // 成功消息
  success(msg) {
    console.log(chalk.green('✅✓'), msg);
  },

  // 错误消息
  error(msg) {
    console.log(chalk.red('❌'), msg);
  },

  // 警告消息
  warn(msg) {
    console.log(chalk.yellow('⚠️'), msg);
  },

  // 信息消息
  info(msg) {
    console.log(chalk.blue('ℹ️'), msg);
  },

  // 标题
  title(msg) {
    console.log(chalk.bold.cyan(`\n${msg}\n`));
  },

  // 分隔线
  divider() {
    console.log(chalk.gray('➖'.repeat(50)));
  },

  // 自定义 spinner 动画 - 不同状态用不同文字
  // ora 自定义 spinner 时，frames 内容直接替代 text
  spinners: {
    thinking: {
      interval: 200,
      frames: [
        '⠋ 思考中.  ',
        '⠙ 思考中.. ',
        '⠹ 思考中...',
        '⠸ 思考中.  ',
        '⠼ 思考中.. ',
        '⠴ 思考中...',
        '⠦ 思考中.  ',
        '⠧ 思考中.. ',
        '⠇ 思考中...',
        '⠏ 思考中.  '
      ]
    },
    waiting: {
      interval: 300,
      frames: [
        '⠋ 等待中.  ',
        '⠙ 等待中.. ',
        '⠹ 等待中...',
        '⠸ 等待中.  ',
        '⠼ 等待中.. ',
        '⠴ 等待中...',
        '⠦ 等待中.  ',
        '⠧ 等待中.. ',
        '⠇ 等待中...',
        '⠏ 等待中.  '
      ]
    },
    routing: {
      interval: 200,
      frames: [
        '⠋ 路由分析中.  ',
        '⠙ 路由分析中.. ',
        '⠹ 路由分析中...',
        '⠸ 路由分析中.  ',
        '⠼ 路由分析中.. ',
        '⠴ 路由分析中...',
        '⠦ 路由分析中.  ',
        '⠧ 路由分析中.. ',
        '⠇ 路由分析中...',
        '⠏ 路由分析中.  '
      ]
    }
  },

  // 创建加载动画
  spinner(text) {
    return ora({
      text: text,
      spinner: this.spinners.thinking,
      color: 'cyan'
    });
  },

  // 格式化任务状态
  taskStatus(status) {
    const statusMap = {
      pending: chalk.yellow('等待中'),
      running: chalk.blue('执行中'),
      waiting_children: chalk.magenta('等待子任务'),
      completed: chalk.green('已完成'),
      completed_with_errors: chalk.yellow('已完成⚠'),
      failed: chalk.red('失败'),
      terminated: chalk.gray('已终止'),
      cancelled: chalk.gray('已取消')
    };
    return statusMap[status] || status;
  },

  // 格式化时间
  time(date) {
    const d = new Date(date);
    return d.toLocaleString('zh-CN');
  },

  // 格式化任务列表
  taskList(tasks) {
    if (!tasks || tasks.length === 0) {
      this.info('没有任务');
      return;
    }

    tasks.forEach(task => {
      const taskId = (task.id || task._id || '').toString();
      const status = task.status || '';
      const desc = task.description || '';
      console.log(
        `  ${chalk.gray(taskId.slice(0, 8))}  ` +
        `${this.taskStatus(status)}  ` +
        `${desc.slice(0, 40)}`
      );
    });
  },

  // 格式化消息气泡
  message(role, content) {
    if (role === 'user') {
      console.log(chalk.cyan('👤 你:'), content);
    } else if (role === 'assistant') {
      console.log(chalk.magenta('🕊️ 白鸽:'), content);
    } else {
      console.log(chalk.gray(`${role}:`), content);
    }
  },

  // 清屏
  clear() {
    console.clear();
  }
};
