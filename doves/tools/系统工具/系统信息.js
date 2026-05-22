/**
 * @file tools/系统工具/系统信息
 * @description 系统信息处理：CPU、内存、环境变量、路径、网络、命令执行、磁盘、进程、时间
 */

import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('系统信息', { 前缀: '[系统信息]', 级别: 'debug' });

const execAsync = promisify(exec);

const text = (content) => ({ content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }] });

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(2)} ${units[i]}`;
}

export async function handleSystemInfo() {
  const cpus = os.cpus();
  const info = {
    platform: os.platform(),
    type: os.type(),
    release: os.release(),
    arch: os.arch(),
    hostname: os.hostname(),
    uptime: `${Math.floor(os.uptime() / 3600)} 小时`,
    cpu: {
      model: cpus[0]?.model || 'Unknown',
      cores: cpus.length,
      speed: cpus[0]?.speed ? `${cpus[0].speed} MHz` : 'Unknown'
    },
    memory: {
      total: formatBytes(os.totalmem()),
      free: formatBytes(os.freemem()),
      used: formatBytes(os.totalmem() - os.freemem()),
      usagePercent: ((1 - os.freemem() / os.totalmem()) * 100).toFixed(1) + '%'
    },
    user: {
      username: os.userInfo().username,
      homedir: os.homedir(),
      shell: os.userInfo().shell || 'N/A'
    },
    nodeVersion: process.version
  };
  return text(info);
}

export async function handleSystemEnv(args) {
  if (args.name) {
    const value = process.env[args.name];
    return text({ name: args.name, value: value || null });
  }
  const envVars = {
    PATH: process.env.PATH,
    HOME: process.env.HOME || process.env.USERPROFILE,
    USER: process.env.USER || process.env.USERNAME,
    TEMP: process.env.TEMP || process.env.TMP,
    JAVA_HOME: process.env.JAVA_HOME,
    NODE_PATH: process.env.NODE_PATH,
    PYTHONPATH: process.env.PYTHONPATH,
    LANG: process.env.LANG,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    PROGRAMFILES: process.env.ProgramFiles,
    SYSTEMROOT: process.env.SystemRoot,
    EDITOR: process.env.EDITOR,
    SHELL: process.env.SHELL
  };
  Object.keys(envVars).forEach(key => {
    if (envVars[key] === undefined) delete envVars[key];
  });
  return text(envVars);
}

export async function handleSystemPaths() {
  const home = os.homedir();
  const paths = {
    home,
    desktop: `${home}/Desktop`,
    documents: `${home}/Documents`,
    downloads: `${home}/Downloads`,
    pictures: `${home}/Pictures`,
    music: `${home}/Music`,
    videos: `${home}/Videos`,
    temp: os.tmpdir(),
    appData: process.env.APPDATA,
    localAppData: process.env.LOCALAPPDATA,
    programFiles: process.env.ProgramFiles
  };
  Object.keys(paths).forEach(key => {
    if (paths[key] === undefined) delete paths[key];
  });
  return text(paths);
}

export async function handleSystemNetwork() {
  const interfaces = os.networkInterfaces();
  const result = {};
  for (const [name, nets] of Object.entries(interfaces)) {
    result[name] = nets.map(net => ({
      family: net.family,
      address: net.address,
      netmask: net.netmask,
      mac: net.mac,
      internal: net.internal
    }));
  }
  return text(result);
}

export async function handleSystemExec(args) {
  const command = args.command;
  const isGuiApp = _isGuiAppCommand(command);

  // GUI 应用特殊处理：不能用 execAsync 阻塞等待（GUI 应用不会自行退出，会超时失败）
  // 改用 spawn 分离启动，然后验证进程是否成功运行
  if (isGuiApp && !args._forceSync) {
    return await _handleGuiAppExec(command, args);
  }

  try {
    const options = { 
      timeout: args.timeout || 30000,
      maxBuffer: 1024 * 1024 * 10
    };
    if (args.cwd) options.cwd = args.cwd;
    
    const { stdout, stderr } = await execAsync(command, options);
    const result = {
      command,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      success: true
    };

    return text(result);
  } catch (error) {
    return text({
      command,
      error: error.message,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      success: false
    });
  }
}

/**
 * GUI 应用启动：用 spawn 分离启动，不阻塞等待，然后验证进程
 * 解决 notepad/calc/mspaint 等 GUI 应用用 execAsync 会超时的问题
 * @private
 */
async function _handleGuiAppExec(command, args) {
  const { spawn } = await import('child_process');
  const cwd = args.cwd || undefined;

  try {
    if (os.platform() === 'win32') {
      // Windows: 用 start 命令分离启动
      const child = spawn('cmd.exe', ['/c', 'start', '"白鸽"', command], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        ...(cwd ? { cwd } : {}),
      });
      child.unref();
    } else {
      // Linux/macOS: nohup 后台运行
      const child = spawn('sh', ['-c', `nohup ${command} >/dev/null 2>&1 &`], {
        detached: true,
        stdio: 'ignore',
        ...(cwd ? { cwd } : {}),
      });
      child.unref();
    }

    // 等待后验证目标进程是否已启动
    const 验证结果 = await _验证进程启动(command, 1500);
    return text({
      command,
      success: 验证结果.found,
      verified: true,
      processFound: 验证结果.found,
      verifyDetail: 验证结果.found
        ? `GUI 应用已确认启动: ${验证结果.name} (PID: ${验证结果.pid})`
        : `命令已发送但未在 1500ms 内检测到目标进程，应用可能仍在启动中`,
    });
  } catch (err) {
    return text({
      command,
      error: err.message,
      success: false,
    });
  }
}

/**
 * 判断命令是否为 GUI 应用启动命令
 * 特征：stdout 为空或极短 + 命令本身是单个词或常见应用名
 * 注意：powershell -Command / cmd /c 是 CLI 调用，不走 GUI 路径
 * @private
 */
function _isGuiAppCommand(command) {
  const cmd = command.trim().toLowerCase();
  const firstWord = cmd.split(/\s+/)[0].replace(/^.+[\\\/]/, '').replace(/\.exe$/i, '');
  const platform = os.platform();

  // CLI 调用排除：powershell/cmd 带执行参数时是 CLI 命令，不走 GUI 路径
  const cliFlags = /^((powershell|pwsh)\s+(-command|-c|-file|-enc|-encodedcommand)|cmd\s+(\/c|\/k|\/c\s|\/k\s))/i;
  if (cliFlags.test(cmd.trim())) {
    return false;
  }

  // 通用 GUI 应用（Windows 单命令启动）
  const windowsGuiApps = [
    'notepad', 'calc', 'mspaint', 'write', 'wordpad',
    'charmap', 'msinfo32', 'resmon', 'taskmgr', 'cmd', 'powershell',
    'explorer', 'control', 'mstsc', 'snippingtool', 'stikynot',
    'regedit', 'mmc', 'eventvwr', 'diskmgmt', 'devmgmt',
  ];

  // macOS: open -a AppName 模式启动 GUI 应用
  // "open" 命令在 macOS 上启动应用后立即返回，不阻塞
  // 但为了获得 verified + processFound 反馈，仍走 GUI 验证路径
  if (platform === 'darwin' && firstWord === 'open') {
    // "open -a ..." 是 GUI 应用启动，"open file.txt" 也走 GUI 验证
    return true;
  }

  // Linux: xdg-open / gtk-launch / gnome-* 等命令
  if (platform === 'linux' && ['xdg-open', 'gtk-launch', 'gnome-open', 'kde-open'].includes(firstWord)) {
    return true;
  }

  return windowsGuiApps.includes(firstWord);
}

/**
 * 从命令中提取进程名并验证是否已启动
 * 支持 Windows (tasklist) / macOS (pgrep) / Linux (pgrep)
 * @private
 */
async function _验证进程启动(command, delay) {
  let 进程名 = command.trim();
  const platform = os.platform();

  // macOS: "open -a AppName" → 提取 AppName 作为进程名
  if (platform === 'darwin' && 进程名.startsWith('open -a ')) {
    // 提取 -a 后面的应用名
    const appMatch = 进程名.match(/open\s+-a\s+["']?([^"'\s]+)["']?/i);
    if (appMatch) {
      进程名 = appMatch[1];
      // macOS 应用名可能不带 .app 后缀，进程查找时两者都试
    }
  } else {
    // 去掉常见前缀（start, cmd /c, open 等）
    进程名 = 进程名.replace(/^(start\s+|cmd\s*\/c\s+|powershell\s+(-command\s+)?)/i, '');
  }

  // 去掉路径，只保留文件名
  进程名 = 进程名.replace(/^.*[\\/]([^\\/]+)$/, '$1');
  // 去掉扩展名
  进程名 = 进程名.replace(/\.exe$/i, '');
  // 去掉引号和参数
  进程名 = 进程名.replace(/["']/g, '').split(/\s+/)[0];

  if (!进程名 || 进程名.length < 2) {
    return { found: false };
  }

  await new Promise(r => setTimeout(r, delay));

  // 直接用已有的 execAsync + tasklist/pgrep 查找
  try {
    if (platform === 'win32') {
      const { stdout } = await execAsync(`tasklist /fi "imagename eq ${进程名}*" /fo csv`, { timeout: 5000 });
      const lines = stdout.trim().split('\n').slice(1);
      if (lines.length > 0 && lines[0].trim()) {
        const name = lines[0].split(',')[0].replace(/"/g, '');
        const pid = parseInt(lines[0].split(',')[1].replace(/"/g, ''));
        return { found: true, pid, name };
      }
    } else {
      // macOS / Linux: 用 pgrep 查找
      // macOS 应用名匹配: 尝试多种模式（AppName, App Name, AppName.app）
      const searchPatterns = [进程名];
      // macOS 应用可能有空格（如 "Google Chrome"），尝试用 -f 模糊匹配
      if (platform === 'darwin') {
        try {
          const { stdout } = await execAsync(`pgrep -lf '${进程名}'`, { timeout: 5000 });
          if (stdout.trim()) {
            const firstLine = stdout.trim().split('\n')[0];
            const match = firstLine.match(/^(\d+)\s+(.+)/);
            if (match) {
              return { found: true, pid: parseInt(match[1]), name: match[2] };
            }
          }
        } catch (e) { logger.debug(`macOS pgrep -lf 未找到 ${进程名}: ${e.message}`); }
      }
      // 通用 pgrep
      const { stdout } = await execAsync(`pgrep -l ${进程名}`, { timeout: 5000 });
      if (stdout.trim()) {
        const [pid, name] = stdout.trim().split('\n')[0].split(' ');
        return { found: true, pid: parseInt(pid), name };
      }
    }
  } catch (e) {
    logger.debug(`进程查找命令执行失败 (${进程名}): ${e.message}`);
  }

  return { found: false, name: 进程名 };
}

export async function handleSystemDiskUsage(args) {
  const path = args.path || (os.platform() === 'win32' ? 'C:\\' : '/');
  try {
    const { execSync } = await import('child_process');
    if (os.platform() === 'win32') {
      const output = execSync(`wmic logicaldisk where "DeviceID='${path.charAt(0)}:'" get Size,FreeSpace /format:csv`, { encoding: 'utf-8' });
      const lines = output.trim().split('\n').filter(l => l.trim());
      if (lines.length >= 2) {
        const [, free, total] = lines[1].split(',');
        return text({
          path: path.charAt(0) + ':',
          total: formatBytes(parseInt(total)),
          free: formatBytes(parseInt(free)),
          used: formatBytes(parseInt(total) - parseInt(free)),
          usagePercent: ((1 - parseInt(free) / parseInt(total)) * 100).toFixed(1) + '%'
        });
      }
    } else {
      const output = execSync(`df -h "${path}" | tail -1`, { encoding: 'utf-8' });
      const parts = output.trim().split(/\s+/);
      return text({
        path,
        total: parts[1],
        used: parts[2],
        available: parts[3],
        usagePercent: parts[4]
      });
    }
  } catch (error) {
    return text({ error: error.message });
  }
  return text({ error: '无法获取磁盘信息' });
}

export async function handleSystemProcesses(args) {
  try {
    let command;
    if (os.platform() === 'win32') {
      command = args.filter 
        ? `tasklist /FI "IMAGENAME eq ${args.filter}*"`
        : 'tasklist';
    } else {
      command = args.filter 
        ? `ps aux | grep -i "${args.filter}"`
        : 'ps aux';
    }
    const { stdout } = await execAsync(command, { timeout: 10000 });
    return text({
      filter: args.filter || 'all',
      processes: stdout.trim()
    });
  } catch (error) {
    return text({ error: error.message });
  }
}

export async function handleSystemDatetime(args) {
  const now = new Date();
  const result = {
    iso: now.toISOString(),
    local: now.toLocaleString('zh-CN'),
    utc: now.toUTCString(),
    timestamp: now.getTime(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffset: now.getTimezoneOffset(),
    components: {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      hour: now.getHours(),
      minute: now.getMinutes(),
      second: now.getSeconds(),
      dayOfWeek: now.getDay(),
      dayOfWeekName: ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
    }
  };
  
  if (args.format) {
    let formatted = args.format
      .replace('YYYY', now.getFullYear())
      .replace('MM', String(now.getMonth() + 1).padStart(2, '0'))
      .replace('DD', String(now.getDate()).padStart(2, '0'))
      .replace('HH', String(now.getHours()).padStart(2, '0'))
      .replace('mm', String(now.getMinutes()).padStart(2, '0'))
      .replace('ss', String(now.getSeconds()).padStart(2, '0'));
    result.formatted = formatted;
  }
  
  return text(result);
}
