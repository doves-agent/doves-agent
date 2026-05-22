/**
 * 电脑操作员审核规则
 * 检查桌面操作的安全性
 */
export default {
  customChecks: [
    {
      name: 'computer_operator_safety',
      check: (规划结果, 原始任务) => {
        const 子任务列表 = 规划结果.subTasks || [];
        const warnings = [];
        const errors = [];

        for (const 子任务 of 子任务列表) {
          const 工具名 = 子任务.toolName || 子任务.工具名 || '';
          const desc = 子任务.description || '';

          // 终止进程 - 高风险
          if (工具名 === '终止进程' || 工具名 === 'computer_process_terminate' || desc.includes('终止进程') || desc.includes('结束进程')) {
            const pid = 子任务.arguments?.pid || 'unknown';
            errors.push(
              `进程终止操作: 子任务 "${子任务.id || 'unknown'}" 涉及终止进程 PID=${pid}，必须获得用户明确确认后才能执行`
            );
          }

          // 关闭窗口 - 高风险
          if (工具名 === '窗口关闭' || 工具名 === 'computer_window_close' || desc.includes('关闭窗口')) {
            const windowId = 子任务.arguments?.windowId || 'unknown';
            errors.push(
              `窗口关闭操作: 子任务 "${子任务.id || 'unknown'}" 涉及关闭窗口 ${windowId}，必须获得用户明确确认后才能执行`
            );
          }

          // 执行系统命令 - 高风险
          if (工具名 === '执行命令' || 工具名 === 'computer_exec' || desc.includes('执行命令') || desc.includes('运行命令')) {
            const command = 子任务.arguments?.command || '';
            // 毁灭性命令检测
            const dangerousPatterns = [
              /rm\s+-rf\s+\//, /del\s+\/f\s+\/s/, /format\s+[a-z]:/i,
              /shutdown\s+\/s/, /shutdown\s+\/r/, /taskkill\s+\/f\s+\/im/
            ];
            const isDestructive = dangerousPatterns.some(p => p.test(command));

            if (isDestructive) {
              errors.push(
                `毁灭性命令检测: 子任务 "${子任务.id || 'unknown'}" 包含潜在毁灭性命令 "${command}"，已自动阻止执行`
              );
            } else {
              errors.push(
                `系统命令执行: 子任务 "${子任务.id || 'unknown'}" 涉及执行命令 "${command.slice(0, 100)}"，必须获得用户明确确认后才能执行`
              );
            }
          }

          // 批量操作提醒
          if (desc.includes('批量') || desc.includes('所有') || desc.includes('全部')) {
            warnings.push(
              `批量操作提醒: 子任务 "${子任务.id || 'unknown'}" 涉及批量操作，建议先在小范围验证`
            );
          }

          // 鼠标/键盘自动化操作提醒
          if (工具名 && (工具名.startsWith('computer_type') || 工具名.startsWith('computer_hotkey') || 工具名.startsWith('computer_mouse') || ['键盘输入', '快捷键', '鼠标点击', '鼠标移动', '鼠标拖拽', '鼠标滚轮'].includes(工具名))) {
            warnings.push(
              `输入操作: 子任务 "${子任务.id || 'unknown'}" 涉及 ${工具名} 操作，请确保目标窗口已激活`
            );
          }
        }

        return {
          passed: errors.length === 0,
          warnings,
          errors
        };
      }
    }
  ]
};
