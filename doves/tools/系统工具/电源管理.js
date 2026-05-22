/**
 * @file tools/系统工具/电源管理
 * @description 系统电源控制：关机、重启、休眠、锁屏（高风险操作）
 */

import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('电源管理', { 前缀: '[电源管理]', 级别: 'debug', 显示调用位置: true });

const execAsync = promisify(exec);
const text = (content) => ({ content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }] });

export async function handleSystemPower(args) {
  const action = args.action;
  const delaySeconds = args.delay ?? 5;
  const reason = args.reason || '';
  
  const powerCommands = {
    shutdown: {
      win32: `shutdown /s /t ${delaySeconds}`,
      darwin: `sudo shutdown -h +${Math.ceil(delaySeconds / 60)}`,
      linux: `shutdown -h +${Math.ceil(delaySeconds / 60)}`
    },
    reboot: {
      win32: `shutdown /r /t ${delaySeconds}`,
      darwin: `sudo shutdown -r +${Math.ceil(delaySeconds / 60)}`,
      linux: `shutdown -r +${Math.ceil(delaySeconds / 60)}`
    },
    sleep: {
      win32: `rundll32.exe powrprof.dll,SetSuspendState 0,1,0`,
      darwin: `pmset sleepnow`,
      linux: `systemctl suspend`
    },
    lock: {
      win32: `rundll32.exe user32.dll,LockWorkStation`,
      darwin: `pmset displaysleepnow`,
      linux: `xdg-screensaver lock`
    }
  };
  
  const actionNames = { shutdown: '关机', reboot: '重启', sleep: '休眠', lock: '锁屏' };
  
  if (!powerCommands[action]) {
    return text({ error: `未知电源操作: ${action}，支持: shutdown, reboot, sleep, lock` });
  }
  
  const command = powerCommands[action][os.platform()] || powerCommands[action].linux;
  
  try {
    logger.info(`执行 ${actionNames[action]}: ${command}, 原因: ${reason}`);
    await execAsync(command, { timeout: 10000 });
    return text({
      success: true,
      action: actionNames[action],
      command,
      delay: delaySeconds,
      message: `${actionNames[action]}指令已发送，${delaySeconds > 0 ? `${delaySeconds}秒后执行` : '即将执行'}`
    });
  } catch (err) {
    return text({
      success: false,
      action: actionNames[action],
      error: err.message,
      hint: '可能需要管理员权限执行此操作'
    });
  }
}
