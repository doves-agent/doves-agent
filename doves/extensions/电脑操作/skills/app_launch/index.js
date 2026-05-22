/**
 * 应用启动技能
 * 通过自然语言描述启动应用，自动匹配已知应用路径
 */

// 常见应用路径数据库（可按需扩展，Git记忆会记住用户常用应用）
// macOS 使用 "open -a AppName" 启动应用，系统自动定位 .app 包
// Linux 使用应用名直接启动（依赖 desktop entry 注册）
// Windows 使用可执行文件名或 start 命令
const 已知应用 = {
  windows: {
    '记事本': 'notepad.exe',
    'notepad': 'notepad.exe',
    '计算器': 'calc.exe',
    'calculator': 'calc.exe',
    '画图': 'mspaint.exe',
    'mspaint': 'mspaint.exe',
    '命令提示符': 'cmd.exe',
    'cmd': 'cmd.exe',
    'PowerShell': 'powershell.exe',
    'powershell': 'powershell.exe',
    '任务管理器': 'taskmgr.exe',
    'taskmgr': 'taskmgr.exe',
    '资源管理器': 'explorer.exe',
    'explorer': 'explorer.exe',
    '控制面板': 'control.exe',
    'control': 'control.exe',
    '截图工具': 'SnippingTool.exe',
    '注册表编辑器': 'regedit.exe',
    'regedit': 'regedit.exe',
    '字符映射表': 'charmap.exe',
    '远程桌面': 'mstsc.exe',
    'Windows设置': 'ms-settings:',
    'settings': 'ms-settings:',
    '浏览器': 'start https://',
    'browser': 'start https://',
    'Edge': 'start msedge',
    'Chrome': 'start chrome',
    'VS Code': 'code',
    'vscode': 'code',
    '终端': 'wt.exe',
    'terminal': 'wt.exe',
  },
  darwin: {
    '计算器': 'open -a Calculator',
    'calculator': 'open -a Calculator',
    '计算器2': 'open -a Calculator2',
    '日历': 'open -a Calendar',
    'calendar': 'open -a Calendar',
    '备忘录': 'open -a Notes',
    'notes': 'open -a Notes',
    '终端': 'open -a Terminal',
    'terminal': 'open -a Terminal',
    'iTerm': 'open -a iTerm',
    'iterm': 'open -a iTerm',
    '文本编辑': 'open -a TextEdit',
    'textedit': 'open -a TextEdit',
    'Safari': 'open -a Safari',
    'safari': 'open -a Safari',
    '浏览器': 'open -a Safari',
    'browser': 'open -a Safari',
    'Chrome': 'open -a "Google Chrome"',
    'chrome': 'open -a "Google Chrome"',
    'Edge': 'open -a "Microsoft Edge"',
    'edge': 'open -a "Microsoft Edge"',
    'Firefox': 'open -a Firefox',
    'firefox': 'open -a Firefox',
    'VS Code': 'open -a "Visual Studio Code"',
    'vscode': 'open -a "Visual Studio Code"',
    'Finder': 'open -a Finder',
    'finder': 'open -a Finder',
    '资源管理器': 'open -a Finder',
    '系统设置': 'open -a "System Settings"',
    'settings': 'open -a "System Settings"',
    '系统偏好设置': 'open -a "System Preferences"',
    '活动监视器': 'open -a "Activity Monitor"',
    '截图': 'open -a Screenshot',
    'screenshot': 'open -a Screenshot',
    '预览': 'open -a Preview',
    'preview': 'open -a Preview',
    '地图': 'open -a Maps',
    'maps': 'open -a Maps',
    '邮件': 'open -a Mail',
    'mail': 'open -a Mail',
    '音乐': 'open -a Music',
    'music': 'open -a Music',
    '照片': 'open -a Photos',
    'photos': 'open -a Photos',
    'Xcode': 'open -a Xcode',
    'xcode': 'open -a Xcode',
    'App Store': 'open -a "App Store"',
    '字典': 'open -a Dictionary',
    'dictionary': 'open -a Dictionary',
  },
  linux: {
    '计算器': 'gnome-calculator',
    'calculator': 'gnome-calculator',
    '终端': 'gnome-terminal',
    'terminal': 'gnome-terminal',
    '文本编辑': 'gedit',
    'gedit': 'gedit',
    '文件管理器': 'nautilus',
    'nautilus': 'nautilus',
    '资源管理器': 'nautilus',
    '系统监视器': 'gnome-system-monitor',
    '浏览器': 'xdg-open https://',
    'browser': 'xdg-open https://',
    'Chrome': 'google-chrome',
    'chrome': 'google-chrome',
    'Firefox': 'firefox',
    'firefox': 'firefox',
    'VS Code': 'code',
    'vscode': 'code',
    '设置': 'gnome-control-center',
    'settings': 'gnome-control-center',
  },
};

export default {
  name: 'app_launch',
  description: '打开/启动电脑上的应用程序',
  category: '电脑操作',

  /**
   * 执行应用启动
   * @param {Object} params
   * @param {string} params.appName - 应用名称
   * @param {string} [params.command] - 具体命令（可选，优先使用）
   * @param {Object} context - 执行上下文
   */
  async execute(params, context) {
    const { appName, command } = params;
    const isWindows = process.platform === 'win32';

    // 如果用户指定了具体命令，直接执行
    if (command) {
      try {
        const { mcpConnectionManager } = await import('../../../../tools/mcp客户端.js');
        return await mcpConnectionManager.callTool('os_mcp', 'process_start', { command });
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    // 根据平台选择对应应用库
    const 平台映射 = {
      win32: 已知应用.windows,
      darwin: 已知应用.darwin,
      linux: 已知应用.linux,
    };
    const appMap = 平台映射[process.platform] || {};
    const appCommand = appMap[appName] || appMap[appName.toLowerCase()];

    if (appCommand) {
      try {
        const { mcpConnectionManager } = await import('../../../../tools/mcp客户端.js');
        const result = await mcpConnectionManager.callTool('os_mcp', 'process_start', { command: appCommand });

        // 尝试记录到Git记忆
        try {
          const Git记忆 = await import('../../../../tools/Git存储/记忆仓库.js');
          if (Git记忆.是否可用()) {
            await Git记忆.添加记忆({
              用户ID: context?.userId || 'default',
              类别: '经验记忆',
              内容: `启动应用: ${appName} -> ${appCommand}`,
              元数据: { type: 'app_launch', appName, command: appCommand },
            });
          }
        } catch { /* 记忆记录失败不阻塞主流程 */ }

        return {
          success: true,
          appName,
          command: appCommand,
          message: `已启动 ${appName}`,
          result,
        };
      } catch (err) {
        return { success: false, error: err.message, appName };
      }
    }

    const 平台提示 = {
      win32: `可以尝试: 在开始菜单搜索 "${appName}"，右键→打开文件位置获取路径`,
      darwin: `可以尝试: 在聚焦搜索(⌘+空格)中搜索 "${appName}"，或提供应用全称`,
      linux: `可以尝试: which ${appName} 或 dpkg -l | grep ${appName}`,
    };
    return {
      success: false,
      appName,
      message: `未找到应用 "${appName}" 的启动命令。请提供具体命令或可执行文件路径。`,
      hint: 平台提示[process.platform] || `可以尝试: which ${appName} 或 find / -name "${appName}*"`,
    };
  },
};
