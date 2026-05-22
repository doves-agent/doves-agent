/**
 * 服务器状态管理
 * 从 ssh_agent/index.js 提取
 */

import { executeCommand } from './SSH连接管理.js';

/**
 * 获取服务器状态（CPU/内存/磁盘）
 */
export async function getServerStatus(params) {
  const { host } = params;
  
  if (!host) {
    return { success: false, error: '缺少主机配置' };
  }
  
  try {
    // 使用跨平台命令获取状态
    const commands = {
      // CPU 使用率
      cpu: 'top -bn1 2>/dev/null | grep "Cpu(s)" | awk \'{print $2}\' | cut -d"%" -f1 || echo "N/A"',
      // 内存使用
      memory: 'free -m 2>/dev/null | awk \'NR==2{printf "%s/%s MB (%.1f%%)", $3, $2, $3*100/$2}\' || echo "N/A"',
      // 磁盘使用
      disk: 'df -h / 2>/dev/null | awk \'NR==2{printf "%s/%s (%s)", $3, $2, $5}\' || echo "N/A"',
      // 系统负载
      load: 'cat /proc/loadavg 2>/dev/null | awk \'{print $1, $2, $3}\' || uptime | awk -F"load average:" \'{print $2}\' || echo "N/A"',
      // 运行时间
      uptime: 'uptime -p 2>/dev/null || uptime | awk -F"up " \'{print $2}\' | awk -F"," \'{print $1}\' || echo "N/A"',
      // 进程数
      processes: 'ps aux 2>/dev/null | wc -l || echo "N/A"'
    };
    
    const results = {};
    
    for (const [key, cmd] of Object.entries(commands)) {
      const result = await executeCommand({ host, command: cmd, timeout: 10000 });
      results[key] = result.success ? result.stdout.trim() : '获取失败';
    }
    
    // 解析 CPU 使用率
    let cpuPercent = 'N/A';
    if (results.cpu && results.cpu !== 'N/A') {
      cpuPercent = results.cpu + '%';
    }
    
    // 解析内存
    let memoryInfo = results.memory;
    
    // 解析磁盘
    let diskInfo = results.disk;
    
    return {
      success: true,
      host: host.host,
      status: {
        cpu: cpuPercent,
        memory: memoryInfo,
        disk: diskInfo,
        load: results.load,
        uptime: results.uptime,
        processes: results.processes,
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 管理系统服务
 */
export async function manageService(params) {
  const { host, service, action: serviceAction } = params;
  
  if (!host || !service || !serviceAction) {
    return { success: false, error: '缺少主机配置、服务名或操作类型' };
  }
  
  const validActions = ['start', 'stop', 'restart', 'status', 'enable', 'disable'];
  if (!validActions.includes(serviceAction)) {
    return { success: false, error: `无效操作: ${serviceAction}，支持: ${validActions.join(', ')}` };
  }
  
  try {
    // 检测系统使用的服务管理器
    const detectorResult = await executeCommand({
      host,
      command: 'which systemctl 2>/dev/null && echo "systemd" || (which service 2>/dev/null && echo "sysvinit" || echo "unknown")',
      timeout: 5000
    });
    
    const serviceManager = detectorResult.stdout.trim();
    let command = '';
    
    if (serviceManager.includes('systemd')) {
      // 使用 systemctl
      switch (serviceAction) {
        case 'start':
          command = `sudo systemctl start ${service}`;
          break;
        case 'stop':
          command = `sudo systemctl stop ${service}`;
          break;
        case 'restart':
          command = `sudo systemctl restart ${service}`;
          break;
        case 'status':
          command = `systemctl status ${service} --no-pager`;
          break;
        case 'enable':
          command = `sudo systemctl enable ${service}`;
          break;
        case 'disable':
          command = `sudo systemctl disable ${service}`;
          break;
      }
    } else if (serviceManager.includes('sysvinit')) {
      // 使用 service 命令
      command = `sudo service ${service} ${serviceAction}`;
    } else {
      // 尝试直接运行服务脚本
      command = `sudo /etc/init.d/${service} ${serviceAction}`;
    }
    
    const result = await executeCommand({
      host,
      command,
      timeout: 30000
    });
    
    // 对于 status 操作，返回更详细的信息
    if (serviceAction === 'status') {
      return {
        success: true,
        service,
        action: serviceAction,
        output: result.stdout || result.stderr,
        isActive: result.stdout.includes('active (running)') || result.stdout.includes('is running'),
        timestamp: new Date().toISOString()
      };
    }
    
    return {
      success: result.success,
      service,
      action: serviceAction,
      output: result.stdout || result.stderr,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 实时查看服务器日志
 */
export async function tailLog(params) {
  const { host, path: logPath, lines = 50, follow = false } = params;
  
  if (!host || !logPath) {
    return { success: false, error: '缺少主机配置或日志路径' };
  }
  
  try {
    // 检查日志文件是否存在
    const checkResult = await executeCommand({
      host,
      command: `test -f "${logPath}" && echo "exists" || echo "not_found"`,
      timeout: 5000
    });
    
    if (checkResult.stdout.trim() === 'not_found') {
      return { success: false, error: `日志文件不存在: ${logPath}` };
    }
    
    // 获取日志内容
    const tailCmd = follow
      ? `timeout 10 tail -n ${lines} -f "${logPath}" 2>/dev/null || tail -n ${lines} "${logPath}"`
      : `tail -n ${lines} "${logPath}"`;
    
    const result = await executeCommand({
      host,
      command: tailCmd,
      timeout: follow ? 15000 : 30000
    });
    
    // 获取文件大小
    const sizeResult = await executeCommand({
      host,
      command: `ls -lh "${logPath}" 2>/dev/null | awk '{print $5}'`,
      timeout: 5000
    });
    
    return {
      success: result.success,
      logPath,
      lines,
      content: result.stdout || result.stderr,
      fileSize: sizeResult.stdout.trim(),
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 查找日志文件
 */
export async function findLogs(params) {
  const { host, directory = '/var/log', pattern = '*.log' } = params;
  
  if (!host) {
    return { success: false, error: '缺少主机配置' };
  }
  
  try {
    const result = await executeCommand({
      host,
      command: `find "${directory}" -name "${pattern}" -type f 2>/dev/null | head -20`,
      timeout: 30000
    });
    
    const logs = result.stdout.trim().split('\n').filter(l => l.trim());
    
    return {
      success: true,
      directory,
      pattern,
      logs: logs.map(log => ({ path: log }))
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
