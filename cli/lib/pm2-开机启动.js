/**
 * @file pm2-开机启动.js
 * @description PM2 开机启动管理（跨平台），从 pm2-manager.js 抽取
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

const PLATFORM = os.platform();
const IS_WINDOWS = PLATFORM === 'win32';
const IS_MACOS = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';

/**
 * 检查开机启动状态
 */
export function getStartupStatus() {
  const result = { 
    enabled: false, 
    platform: PLATFORM,
    method: null,
    details: null 
  };
  
  if (IS_WINDOWS) {
    try {
      const status = execSync('pm2-startup check', { encoding: 'utf-8', stdio: 'pipe' });
      result.enabled = status.includes('installed') || status.includes('enabled');
      result.method = 'pm2-windows-startup';
      result.details = status.trim();
    } catch {
      try {
        const regResult = execSync(
          'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v PM2',
          { encoding: 'utf-8', stdio: 'pipe' }
        );
        result.enabled = regResult.includes('PM2');
        result.method = 'registry';
      } catch {
        result.enabled = false;
      }
    }
  } else if (IS_MACOS) {
    const plistPath = join(os.homedir(), 'Library/LaunchAgents/com.keymetrics.pm2.plist');
    result.enabled = existsSync(plistPath);
    result.method = 'launchd';
  } else if (IS_LINUX) {
    try {
      execSync('systemctl is-enabled pm2-$USER', { stdio: 'pipe' });
      result.enabled = true;
      result.method = 'systemd';
    } catch {
      result.enabled = existsSync('/etc/init.d/pm2-init.sh');
      result.method = result.enabled ? 'init.d' : null;
    }
  }
  
  return result;
}

/**
 * 启用开机启动
 */
export function enableStartup() {
  if (IS_WINDOWS) {
    try {
      execSync('npm list -g pm2-windows-startup', { stdio: 'pipe' });
    } catch {
      console.log('正在安装 pm2-windows-startup...');
      try {
        execSync('npm install -g pm2-windows-startup', { stdio: 'inherit' });
      } catch (err) {
        return { success: false, error: '安装 pm2-windows-startup 失败: ' + err.message };
      }
    }
    
    try {
      execSync('pm2-startup install', { stdio: 'inherit' });
      execSync('pm2 save', { stdio: 'pipe' });
      return { success: true, message: '开机启动已启用 (Windows)' };
    } catch (err) {
      return { success: false, error: '启用开机启动失败: ' + err.message };
    }
    
  } else if (IS_MACOS || IS_LINUX) {
    try {
      const startupCmd = execSync('pm2 startup', { encoding: 'utf-8', stdio: 'pipe' });
      const cmdMatch = startupCmd.match(/sudo\s+.+/);
      
      if (cmdMatch) {
        console.log('\n请执行以下命令来完成开机启动配置:\n');
        console.log(cmdMatch[0]);
        console.log('\n然后执行: pm2 save\n');
        return { 
          success: true, 
          needSudo: true, 
          command: cmdMatch[0],
          message: '需要执行上述命令来完成配置'
        };
      }
      
      execSync('pm2 save', { stdio: 'pipe' });
      return { success: true, message: `开机启动已启用 (${IS_MACOS ? 'macOS' : 'Linux'})` };
      
    } catch (err) {
      return { success: false, error: '启用开机启动失败: ' + err.message };
    }
  }
  
  return { success: false, error: '不支持的操作系统' };
}

/**
 * 禁用开机启动
 */
export function disableStartup() {
  if (IS_WINDOWS) {
    try {
      execSync('pm2-startup uninstall', { stdio: 'inherit' });
      return { success: true, message: '开机启动已禁用 (Windows)' };
    } catch (err) {
      return { success: false, error: '禁用开机启动失败: ' + err.message };
    }
    
  } else if (IS_MACOS || IS_LINUX) {
    try {
      execSync('pm2 unstartup', { encoding: 'utf-8', stdio: 'pipe' });
      return { success: true, message: `开机启动已禁用 (${IS_MACOS ? 'macOS' : 'Linux'})` };
    } catch (err) {
      return { success: false, error: '禁用开机启动失败: ' + err.message };
    }
  }
  
  return { success: false, error: '不支持的操作系统' };
}
