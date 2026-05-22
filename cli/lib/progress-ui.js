/**
 * 任务进度 TUI 组件
 * 提供交互式终端界面展示任务拓扑和实时进度
 * 
 * 视图模式：compact（简约模式，默认且唯一）
 * 
 * 设计说明：
 * - 早期版本支持 1/2/3 键盘切换三种视图（compact/tree/detail），
 *   但 raw mode 键盘监听与 inquirer（用户确认交互）竞争 stdin，
 *   导致鸽子提问时无法正确展示确认界面。
 * - Web CLI (`dove web`) 已提供更丰富的监控界面，
 *   终端 TUI 无需键盘交互，仅保留简约模式自动渲染。
 */

import chalk from 'chalk';
import { STATUS_ICONS, renderCompact } from './progress-ui-renderers.js';

// ANSI 转义码
const ANSI = {
  clear: '\x1b[2J',
  home: '\x1b[H',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  saveCursor: '\x1b[s',
  restoreCursor: '\x1b[u',
  eraseLine: '\x1b[2K',
  eraseBelow: '\x1b[J',
  eraseAbove: '\x1b[1J',
  moveUp: (n) => `\x1b[${n}A`,
};

/**
 * 任务进度 TUI 类
 */
export class TaskProgressUI {
  constructor(options = {}) {
    this.rootTask = null;
    this.subtasks = [];
    this.activeSubtaskId = null;
    this.pendingQuestion = null;
    this.lastUpdate = Date.now();
    this.linesRendered = 0;
    this.isQuestionActive = false;
    this._destroyed = false;
    this._animFrame = 0;       // 动画帧计数（状态行点点效果）
    this._animInterval = null; // 动画计时器
    this._renderAnchorSaved = false;  // 渲染锚点（saveCursor）是否有效
    this._errors = [];               // 累积的错误信息（TUI停止后重新输出）
    
    // 终端尺寸
    this.width = process.stdout.columns || 80;
    this.height = process.stdout.rows || 24;
    
    // 监听终端尺寸变化
    this._resizeHandler = () => {
      this.width = process.stdout.columns || 80;
      this.height = process.stdout.rows || 24;
      if (this.rootTask && !this.isQuestionActive) {
        this.render();
      }
    };
    process.stdout.on('resize', this._resizeHandler);
  }

  /**
   * 启动 TUI（无键盘监听，避免与 inquirer 竞争 stdin）
   */
  start() {
    if (!process.stdout.isTTY) {
      return; // 非 TTY 环境，不启动 TUI
    }
    
    // 隐藏光标
    process.stdout.write(ANSI.hideCursor);
    
    // 清屏
    this.clear();
    
    // 启动动画计时器（状态行动态点点效果，让用户感知任务在推进）
    this._animInterval = setInterval(() => {
      this._animFrame = (this._animFrame + 1) % 4;
      if (this.rootTask && !this.isQuestionActive) {
        this.render();
      }
    }, 500);
  }

  /**
   * 停止 TUI
   */
  stop() {
    // 停止动画计时器
    if (this._animInterval) {
      clearInterval(this._animInterval);
      this._animInterval = null;
    }
    
    // 先清理最后一帧（restoreCursor 回到渲染起点 + eraseBelow）
    // 必须在 showCursor 之前，避免光标跳回时闪烁
    this.clear();
    
    // 显示光标
    process.stdout.write(ANSI.showCursor);
    
    // 重新输出累积的错误信息（TUI运行期间被覆盖的错误，停止后补显）
    if (this._errors.length > 0) {
      for (const err of this._errors) {
        console.log(chalk.red('✗'), err);
      }
      this._errors = [];
    }
  }

  /**
   * 销毁 TUI，释放所有监听器
   * 在不再使用 TUI 时调用（如 sendMessage 结束后）
   */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    
    // 停止 TUI
    this.stop();
    
    // 移除 resize 监听器
    if (this._resizeHandler) {
      process.stdout.off('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    
    // 清空引用
    this.rootTask = null;
    this.subtasks = [];
    this.pendingQuestion = null;
  }

  /**
   * 更新任务数据
   */
  updateTask(task) {
    this.rootTask = task;
    this.lastUpdate = Date.now();
    
    // 更新子任务列表
    if (task.children && Array.isArray(task.children)) {
      this.subtasks = task.children.map((child, index) => ({
        id: child.id || child.任务ID || `sub_${index}`,
        description: child.description || child.描述 || `子任务 ${index + 1}`,
        status: child.status || child.状态 || '等待中',
        progress: child.progress || 0,
        assignedTo: child.assignedTo || child.执行者 || null,
        model: child.model || child.模型 || null,
        provider: child.provider || child.提供商 || null,
        toolLevel: child.toolLevel || child.工具权限 || '安全',
        phase: child.phase || child.阶段 || null,
        duration: child.duration || child.耗时 || null,
        startedAt: child.startedAt || child.开始时间 || null,
        completedAt: child.completedAt || child.完成时间 || null,
      }));
    } else if (task.childrenStatus) {
      // 从 childrenStatus 推断子任务状态
      const { total = 0, completed = 0, failed = 0 } = task.childrenStatus;
      const running = total - completed - failed;
      
      // 如果没有子任务详情，生成占位符；已有占位符则更新状态
      if (total > 0) {
        if (this.subtasks.length === 0) {
          this.subtasks = Array.from({ length: total }, (_, i) => ({
            id: `sub_${i}`,
            description: `子任务 ${i + 1}`,
            status: i < completed ? '已完成' : (i < completed + running ? '执行中' : '等待中'),
            progress: i < completed ? 100 : 0,
            toolLevel: '安全',
          }));
        } else {
          // 已有占位符：根据最新计数更新状态
          let compIdx = 0, runIdx = 0, pendIdx = 0;
          for (const sub of this.subtasks) {
            if (compIdx < completed) {
              sub.status = '已完成';
              sub.progress = 100;
              compIdx++;
            } else if (runIdx < running) {
              sub.status = '执行中';
              sub.progress = 50;
              runIdx++;
            } else {
              sub.status = '等待中';
              sub.progress = 0;
              pendIdx++;
            }
          }
        }
      }
    }
    
    // 默认选中第一个运行中的任务
    if (!this.activeSubtaskId) {
      const runningTask = this.subtasks.find(s => s.status === '执行中');
      this.activeSubtaskId = runningTask?.id || this.subtasks[0]?.id;
    }
    
    if (!this.isQuestionActive) {
      this.render();
    }
  }

  /**
   * 显示用户问题（暂停 TUI，让 inquirer 接管）
   * 
   * 使用 moveUp + eraseBelow 清理 TUI，避免 save/restore cursor 在终端滚动后定位错误
   */
  showQuestion(question) {
    this.isQuestionActive = true;
    this.pendingQuestion = question;
    
    // 用 linesRendered 计数上移清除 TUI —— 比 saveCursor 更可靠
    //（saveCursor 会在终端滚动后（inquirer 选项过多）定位到错误位置导致跳屏）
    if (this.linesRendered > 0) {
      process.stdout.write(ANSI.moveUp(this.linesRendered));
      process.stdout.write(ANSI.eraseBelow);
      this.linesRendered = 0;
    }
    this._renderAnchorSaved = false;
    
    // 显示光标（inquirer 需要光标可见）
    process.stdout.write(ANSI.showCursor);
    
    // 显示问题标题（简洁分隔，不干扰 inquirer 渲染）
    console.log('');
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold.yellow('❓ 鸽子提问'));
    console.log('');
  }

  /**
   * 隐藏问题（恢复 TUI）
   * 
   * 使用 \x1b[2J\x1b[H 全屏清除，彻底避免 save/restore cursor 因终端滚动导致的跳屏。
   * 全屏清除后重新渲染 TUI，屏幕状态始终可控。
   */
  hideQuestion() {
    this.isQuestionActive = false;
    this.pendingQuestion = null;
    
    // 已销毁则不再渲染
    if (this._destroyed) return;
    
    // 全屏清除：最可靠的方式，不受 inquirer 渲染行数/终端滚动影响
    process.stdout.write('\x1b[2J\x1b[H');
    
    // 重置所有追踪状态
    this._renderAnchorSaved = false;
    this.linesRendered = 0;
    
    // 重新隐藏光标（TUI 渲染模式）
    process.stdout.write(ANSI.hideCursor);
    
    // 重新渲染 TUI
    if (this.rootTask) {
      this.render();
    }
  }

  /**
   * 添加错误信息（在 TUI 区域内显示，停止时补显到终端）
   */
  addError(message) {
    this._errors.push(message);
    // 限制累积数量，避免内存增长
    if (this._errors.length > 20) this._errors.shift();
    // 如果 TUI 正在运行，触发渲染让错误显示在 TUI 区域
    if (this.rootTask && !this.isQuestionActive) {
      this.render();
    }
  }

  /**
   * 清屏
   * 优先使用 save/restore cursor 定位渲染起点（可靠锚点），
   * 回退到 move-up-N-lines 方式（兼容未保存锚点的场景）
   */
  clear() {
    if (this._renderAnchorSaved) {
      // 可靠锚点：restoreCursor 回到渲染前的光标位置，eraseBelow 清除
      process.stdout.write(ANSI.restoreCursor);
      process.stdout.write(ANSI.eraseBelow);
      this._renderAnchorSaved = false;
      this.linesRendered = 0;
    } else if (this.linesRendered > 0) {
      // 回退方式：向上移动 linesRendered 行
      process.stdout.write(ANSI.moveUp(this.linesRendered));
      process.stdout.write(ANSI.eraseBelow);
      this.linesRendered = 0;
    }
  }

  /**
   * 主渲染方法
   */
  render() {
    if (!process.stdout.isTTY) return;
    if (!this.rootTask) return;
    
    // 清除上一帧（回到渲染起点 + 清除下方）
    this.clear();
    
    // 保存光标位置作为渲染锚点（供下次 clear / showQuestion 使用）
    process.stdout.write(ANSI.saveCursor);
    this._renderAnchorSaved = true;
    
    // 收集所有输出行
    const lines = [];
    
    // 分隔线
    const divider = chalk.gray('━'.repeat(Math.min(this.width - 2, 60)));
    
    lines.push('');
    lines.push(divider);
    
    // 根据模式渲染（仅 compact）
    this.renderCompact(lines);
    
    lines.push(divider);
    lines.push('');
    
    // 输出所有行
    this.linesRendered = lines.length;
    lines.forEach(line => {
      process.stdout.write(line + '\n');
    });
  }

  renderCompact(lines) { renderCompact(this, lines); }

  /**
   * 格式化时间
   */
  formatTime(timestamp) {
    if (!timestamp) return '-';
    const d = new Date(timestamp);
    return d.toLocaleTimeString('zh-CN');
  }

  /**
   * 格式化耗时
   */
  formatDuration(ms) {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  }
}

export default TaskProgressUI;
