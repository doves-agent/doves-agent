/**
 * 复合桌面自动化技能
 * 多步操作编排：打开应用 → 等待 → 输入 → 截图 → 保存
 * 支持录制回放（基于Git记忆存储操作序列）
 */

export default {
  name: 'desktop_automation',
  description: '复合桌面操作编排：多步操作自动化执行',
  category: '电脑操作',

  /**
   * 执行复合桌面自动化
   * @param {Object} params
   * @param {Array} params.steps - 操作步骤列表
   * @param {string} [params.name] - 自动化任务名称（用于记忆和回放）
   * @param {boolean} [params.record] - 是否录制操作序列到Git记忆
   * @param {Object} context - 执行上下文
   *
   * 步骤格式:
   * [
   *   { action: 'screenshot', path: '...' },
   *   { action: 'activate_window', title: '...' },
   *   { action: 'type', text: '...', delay: 10 },
   *   { action: 'hotkey', modifiers: 'ctrl', key: 's' },
   *   { action: 'click', x: 100, y: 200 },
   *   { action: 'wait', ms: 500 },
   *   { action: 'scroll', delta: -5 },
   *   { action: 'exec', command: '...' },
   * ]
   */
  async execute(params, context) {
    const { steps = [], name, record = false } = params;

    if (steps.length === 0) {
      return { success: false, error: '操作步骤列表为空' };
    }

    try {
      const { mcpConnectionManager } = await import('../../../../tools/mcp客户端.js');
      const callMCP = (tool, args) => mcpConnectionManager.callTool('os_mcp', tool, args);

      const results = [];
      let stepIndex = 0;

      for (const step of steps) {
        stepIndex++;
        let result;

        switch (step.action) {
          case 'screenshot':
            result = await callMCP('screenshot_full', {
              save_path: step.path || `auto_screenshot_${stepIndex}_${Date.now()}.png`,
            });
            break;

          case 'activate_window':
            const findResult = await callMCP('window_find', { title: step.title });
            const findData = findResult?.content?.[0]?.text;
            if (findData) {
              const parsed = JSON.parse(findData);
              if (parsed.windows?.length > 0) {
                result = await callMCP('window_activate', { handle: String(parsed.windows[0].handle || parsed.windows[0].id) });
              } else {
                result = { content: [{ type: 'text', text: `未找到窗口: ${step.title}` }] };
              }
            } else {
              result = findResult;
            }
            break;

          case 'type':
            result = await callMCP('keyboard_type', { text: step.text });
            break;

          case 'hotkey':
            result = await callMCP('keyboard_hotkey', {
              modifier: step.modifiers || '',
              key: step.key,
            });
            break;

          case 'click':
            result = await callMCP('mouse_click', {
              x: step.x,
              y: step.y,
              button: step.button || 'left',
            });
            break;

          case 'wait':
            await new Promise(resolve => setTimeout(resolve, step.ms || 500));
            result = { content: [{ type: 'text', text: JSON.stringify({ waited: step.ms || 500 }) }] };
            break;

          case 'scroll':
            result = await callMCP('mouse_scroll', { amount: step.delta });
            break;

          case 'exec':
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);
            try {
              const { stdout, stderr } = await execAsync(step.command, { timeout: step.timeout || 30000 });
              result = { content: [{ type: 'text', text: JSON.stringify({ success: true, stdout: stdout.slice(0, 2000) }) }] };
            } catch (err) {
              result = { isError: true, content: [{ type: 'text', text: `命令执行失败: ${err.message}` }] };
            }
            break;

          default:
            result = { isError: true, content: [{ type: 'text', text: `未知操作类型: ${step.action}` }] };
        }

        const stepResult = {
          step: stepIndex,
          action: step.action,
          success: !result.isError,
          error: result.isError ? result.content?.[0]?.text : null,
        };

        results.push(stepResult);

        // 如果步骤失败且是关键操作，可选择是否继续
        if (result.isError && step.critical) {
          return {
            success: false,
            error: `关键步骤 ${stepIndex} 失败: ${result.content?.[0]?.text}`,
            completedSteps: results,
            failedAt: stepIndex,
          };
        }
      }

      // 录制到Git记忆
      if (record && name) {
        try {
          const Git记忆 = await import('../../../../tools/Git存储/记忆仓库.js');
          if (Git记忆.是否可用()) {
            await Git记忆.添加记忆({
              用户ID: context?.userId || 'default',
              类别: '技能记忆',
              内容: `桌面自动化 "${name}": ${steps.length}个步骤`,
              元数据: { type: 'desktop_automation', name, steps, results },
            });
          }
        } catch { /* ignore */ }
      }

      const successCount = results.filter(r => r.success).length;
      return {
        success: successCount === results.length,
        name: name || 'unnamed',
        totalSteps: steps.length,
        successCount,
        failedCount: results.length - successCount,
        results,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};
