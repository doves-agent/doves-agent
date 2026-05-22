/**
 * @file progress-ui-renderers.js
 * @description TaskProgressUI 渲染方法 + 常量，从 progress-ui.js 抽取
 */

import chalk from 'chalk';

// 状态图标
export const STATUS_ICONS = {
  pending: chalk.gray('⏸'),
  running: chalk.cyan('⏳'),
  completed: chalk.green('✅'),
  completed_with_errors: chalk.yellow('⚠️'),
  failed: chalk.red('❌'),
  terminated: chalk.gray('🚫'),
  cancelled: chalk.gray('⏹'),
};

// 阶段图标
export const PHASE_ICONS = {
  thinking: '🤔',
  tool_calling: '🔧',
  generating: '✍️',
  waiting: '⏳',
};

// 阶段中文标签
export const PHASE_LABELS = {
  thinking: '思考中',
  tool_calling: '调用工具',
  generating: '生成回复',
  waiting: '等待中',
};

// 工具权限级别颜色
export const TOOL_LEVEL_COLORS = {
  safe: chalk.green,
  caution: chalk.yellow,
  dangerous: chalk.red,
};

/**
 * 简洁模式渲染
 * - 无子任务时：显示动态状态行（阶段 + 动画点），不显示空进度条
 * - 有子任务时：显示真实进度条 + 子任务列表
 */
export function renderCompact(ui, lines) {
  const task = ui.rootTask;
  const status = task.status || '等待中';
  const type = task.type || 'task';
  const desc = task.description || '任务执行中';
  const phase = task.phase || null;
  
  const icon = STATUS_ICONS[status] || '⏳';
  const childrenStatus = task.childrenStatus || {};
  const completed = childrenStatus.completed || childrenStatus.已完成 || 0;
  const total = childrenStatus.total || childrenStatus.总数 || ui.subtasks.length || 0;
  
  if (total === 0) {
    // 无子任务：显示动态状态行，不显示空的进度条
    const phaseLabel = phase ? (PHASE_LABELS[phase] || phase) : (type === 'routing' ? '路由分析中' : '分配任务中');
    const typeLabel = type === 'routing' ? '路由' : (type === 'branch' ? '分支' : type);
    const dots = '.'.repeat(ui._animFrame || 0).padEnd(3, ' ');
    lines.push(`${icon} ${chalk.white(desc.slice(0, 40))} ${chalk.gray(`[${typeLabel}]`)} ${chalk.cyan(phaseLabel + dots)}`);
  } else {
    // 有子任务：显示真实进度条
    const progressPercent = Math.round((completed / total) * 100);
    const barWidth = 20;
    const filled = Math.max(0, Math.min(barWidth, Math.round((progressPercent / 100) * barWidth)));
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    
    lines.push(`${icon} ${chalk.white(desc.slice(0, 40))} ${chalk.gray(`[${type}]`)} ${chalk.cyan(bar)} ${progressPercent}% ${completed}/${total} 子任务`);
    
    const maxShow = 5;
    const subtaskList = ui.subtasks.slice(0, maxShow);
    
    subtaskList.forEach((sub, index) => {
      const prefix = index === subtaskList.length - 1 && ui.subtasks.length <= maxShow ? '└─' : '├─';
      const subIcon = STATUS_ICONS[sub.status] || '⏸';
      const subDesc = sub.description.slice(0, 30);
      
      let extra = '';
      if (sub.status === '执行中') {
        extra = chalk.gray(` [${sub.assignedTo || 'dove'}] ${sub.model || ''}`);
      }
      
      lines.push(`  ${prefix} ${subIcon} ${subDesc}${extra}`);
    });
    
    if (ui.subtasks.length > maxShow) {
      lines.push(`  ${chalk.gray(`... 还有 ${ui.subtasks.length - maxShow} 个子任务`)}`);
    }
  }
  
  // 显示累积的错误信息（在 TUI 区域内，不被覆盖）
  if (ui._errors && ui._errors.length > 0) {
    lines.push('');
    for (const err of ui._errors.slice(-3)) {  // 最多显示最近3条
      lines.push(chalk.red(`  ✗ ${err}`));
    }
    if (ui._errors.length > 3) {
      lines.push(chalk.gray(`  ... 还有 ${ui._errors.length - 3} 条错误`));
    }
  }
}
